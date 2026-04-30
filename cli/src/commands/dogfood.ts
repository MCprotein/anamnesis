// `anamnesis dogfood check` — self-check the repo as a real managed project.
//
// The command is intentionally product-oriented: it scores continuity
// readiness across context, ontology, adapter surfaces, diagnostics, and
// verification. With `--append`, it records a markdown entry for release
// history and version-to-version comparison.

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { status, StatusError, type StatusResult } from "./status.js";
import { doctor, DoctorError, type DoctorResult } from "./doctor.js";
import {
  bootstrap,
  OntologyBootstrapError,
  type BootstrapResult,
} from "./ontology.js";
import type { ToolName } from "../core/agentfile.js";

export type CriterionId =
  | "context-continuity"
  | "ontology-availability"
  | "adapter-parity"
  | "diagnostics-quality"
  | "verification-strength";

export type CriterionStatus = "pass" | "fail";

export interface DogfoodCriterion {
  id: CriterionId;
  label: string;
  status: CriterionStatus;
  detail: string;
}

export type CheckOutcome = "pass" | "fail" | "skipped";

export interface CommandCheck {
  name: string;
  command: string[];
  outcome: CheckOutcome;
  durationMs: number;
  detail: string;
}

export interface DogfoodResult {
  projectRoot: string;
  libraryRoot: string;
  generatedAt: string;
  status: StatusResult;
  doctor: DoctorResult;
  bootstrap: BootstrapResult;
  checks: CommandCheck[];
  criteria: DogfoodCriterion[];
  score: {
    passed: number;
    total: number;
    previous: number | null;
    trend: "improved" | "regressed" | "unchanged" | "new-baseline";
  };
  appendedPath?: string;
  ok: boolean;
  markdown: string;
}

export interface DogfoodOptions {
  projectRoot: string;
  libraryRoot: string;
  append?: boolean;
  outputPath?: string;
  now?: () => Date;
  runner?: (cmd: string[], opts: { cwd: string }) => CommandCheck;
}

export class DogfoodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DogfoodError";
  }
}

const SUPPORTED_TOOLS: ToolName[] = ["claude-code", "codex", "cursor"];

export function dogfoodCheck(opts: DogfoodOptions): DogfoodResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);
  const outputPath = path.resolve(
    projectRoot,
    opts.outputPath ?? path.join("docs", "DOGFOOD.md"),
  );
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();

  let st: StatusResult;
  let doc: DoctorResult;
  let boot: BootstrapResult;
  try {
    st = status({ projectRoot, libraryRoot });
    doc = doctor({ projectRoot, libraryRoot });
    boot = bootstrap({ projectRoot, dryRun: true });
  } catch (e) {
    if (
      e instanceof StatusError ||
      e instanceof DoctorError ||
      e instanceof OntologyBootstrapError
    ) {
      throw new DogfoodError(e.message);
    }
    throw e;
  }

  const checks = runVerificationChecks(projectRoot, opts.runner ?? runCommand);
  const criteria = scoreCriteria(st, doc, checks);
  const passed = criteria.filter((c) => c.status === "pass").length;
  const total = criteria.length;
  const previous = previousScore(outputPath);
  const trend =
    previous === null
      ? "new-baseline"
      : passed > previous
        ? "improved"
        : passed < previous
          ? "regressed"
          : "unchanged";
  const markdown = renderMarkdown({
    generatedAt,
    st,
    doc,
    boot,
    checks,
    criteria,
    passed,
    total,
    previous,
    trend,
  });

  let appendedPath: string | undefined;
  if (opts.append === true) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const prefix =
      fs.existsSync(outputPath) && fs.readFileSync(outputPath, "utf8").trim() !== ""
        ? "\n\n"
        : "";
    fs.appendFileSync(outputPath, `${prefix}${markdown}`, "utf8");
    appendedPath = path.relative(projectRoot, outputPath);
  }

  return {
    projectRoot,
    libraryRoot,
    generatedAt,
    status: st,
    doctor: doc,
    bootstrap: boot,
    checks,
    criteria,
    score: { passed, total, previous, trend },
    appendedPath,
    ok: passed === total,
    markdown,
  };
}

function runVerificationChecks(
  projectRoot: string,
  runner: (cmd: string[], opts: { cwd: string }) => CommandCheck,
): CommandCheck[] {
  return [
    runNpmScript(projectRoot, "typecheck", ["npm", "run", "typecheck"], runner),
    runNpmScript(projectRoot, "test", ["npm", "test"], runner),
  ];
}

function runNpmScript(
  projectRoot: string,
  scriptName: string,
  command: string[],
  runner: (cmd: string[], opts: { cwd: string }) => CommandCheck,
): CommandCheck {
  if (!hasPackageScript(projectRoot, scriptName)) {
    return {
      name: `npm ${scriptName}`,
      command,
      outcome: "skipped",
      durationMs: 0,
      detail: `package.json script '${scriptName}' not found`,
    };
  }
  return runner(command, { cwd: projectRoot });
}

function hasPackageScript(projectRoot: string, scriptName: string): boolean {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    scripts?: Record<string, unknown>;
  };
  return typeof pkg.scripts?.[scriptName] === "string";
}

function runCommand(cmd: string[], opts: { cwd: string }): CommandCheck {
  const start = Date.now();
  const bin = process.platform === "win32" && cmd[0] === "npm" ? "npm.cmd" : cmd[0]!;
  const result = spawnSync(bin, cmd.slice(1), {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  const durationMs = Date.now() - start;
  const stderr = (result.stderr ?? "").trim();
  const stdout = (result.stdout ?? "").trim();
  const detail =
    result.status === 0
      ? "passed"
      : (stderr || stdout || result.error?.message || `exit ${result.status}`);
  return {
    name: cmd.join(" "),
    command: cmd,
    outcome: result.status === 0 ? "pass" : "fail",
    durationMs,
    detail,
  };
}

function scoreCriteria(
  st: StatusResult,
  doc: DoctorResult,
  checks: CommandCheck[],
): DogfoodCriterion[] {
  const tools = new Set(st.agentfile.tools);
  const allToolsEnabled = SUPPORTED_TOOLS.every((t) => tools.has(t));
  const hasBaseContext = hasCleanRegion(st, "AGENTS.md", "anamnesis-base");
  const ontologyFiles = st.entries.filter(
    (e) =>
      e.target === "file" &&
      e.path.startsWith(".anamnesis/ontology/") &&
      e.drift === "clean",
  );
  const driftClean =
    st.summary.entriesMissing === 0 &&
    st.summary.entriesUserModified === 0 &&
    st.summary.fragmentLibraryMissing === 0 &&
    st.summary.fragmentUpdatesAvailable === 0;
  const verificationPassed =
    checks.length > 0 &&
    checks.every((c) => c.outcome === "pass") &&
    checks.some((c) => c.name.includes("typecheck")) &&
    checks.some((c) => c.name.includes("test"));

  return [
    {
      id: "context-continuity",
      label: "Context continuity",
      status: allToolsEnabled && hasBaseContext ? "pass" : "fail",
      detail: allToolsEnabled
        ? "all supported tools enabled and AGENTS.md baseline is clean"
        : `enabled tools: ${st.agentfile.tools.join(", ")}`,
    },
    {
      id: "ontology-availability",
      label: "Ontology availability",
      status: ontologyFiles.length > 0 ? "pass" : "fail",
      detail:
        ontologyFiles.length > 0
          ? `${ontologyFiles.length} clean ontology file(s)`
          : "no clean .anamnesis/ontology/*.yaml file tracked",
    },
    {
      id: "adapter-parity",
      label: "Adapter parity surface",
      status: adapterParityReady(st) ? "pass" : "fail",
      detail: "Claude native surfaces, Codex AGENTS fallbacks, and Cursor rules checked",
    },
    {
      id: "diagnostics-quality",
      label: "Diagnostics quality",
      status: doc.ok && driftClean ? "pass" : "fail",
      detail: `doctor ${doc.summary.errors} error(s), ${doc.summary.warnings} warning(s); drift clean=${driftClean}`,
    },
    {
      id: "verification-strength",
      label: "Verification strength",
      status: verificationPassed ? "pass" : "fail",
      detail: checks
        .map((c) => `${c.name}: ${c.outcome} (${c.durationMs}ms)`)
        .join("; "),
    },
  ];
}

function adapterParityReady(st: StatusResult): boolean {
  const tools = new Set(st.agentfile.tools);
  if (tools.has("claude-code")) {
    const ok =
      hasCleanFile(st, ".claude/hooks/inject-ontology.sh") &&
      hasCleanFile(st, ".claude/hooks/inject-handoff.sh") &&
      hasCleanFile(st, ".claude/commands/load-context.md") &&
      hasCleanFile(st, ".claude/commands/handoff-prepare.md") &&
      hasCleanFile(st, ".claude/skills/load-context/SKILL.md") &&
      hasCleanFile(st, ".claude/skills/ontology-enrich/SKILL.md");
    if (!ok) return false;
  }
  if (tools.has("codex")) {
    const ok =
      hasCleanRegion(st, "AGENTS.md", "codex-cmd-load-context") &&
      hasCleanRegion(st, "AGENTS.md", "codex-cmd-handoff-prepare") &&
      hasCleanRegion(st, "AGENTS.md", "codex-skill-load-context") &&
      hasCleanRegion(st, "AGENTS.md", "codex-skill-ontology-enrich");
    if (!ok) return false;
  }
  if (tools.has("cursor")) {
    const ok =
      hasCleanFile(st, ".cursor/rules/load-context-cmd.mdc") &&
      hasCleanFile(st, ".cursor/rules/handoff-prepare-cmd.mdc") &&
      hasCleanFile(st, ".cursor/rules/load-context.mdc") &&
      hasCleanFile(st, ".cursor/rules/ontology-enrich.mdc");
    if (!ok) return false;
  }
  return true;
}

function hasCleanRegion(st: StatusResult, file: string, regionId: string): boolean {
  return st.entries.some(
    (e) =>
      e.target === "region" &&
      e.file === file &&
      e.regionId === regionId &&
      e.drift === "clean",
  );
}

function hasCleanFile(st: StatusResult, filePath: string): boolean {
  return st.entries.some(
    (e) => e.target === "file" && e.path === filePath && e.drift === "clean",
  );
}

function previousScore(outputPath: string): number | null {
  if (!fs.existsSync(outputPath)) return null;
  const text = fs.readFileSync(outputPath, "utf8");
  const matches = Array.from(
    text.matchAll(/Continuity readiness score:\s+(\d+)\/5/g),
  );
  const last = matches.at(-1);
  return last?.[1] ? Number(last[1]) : null;
}

function renderMarkdown(input: {
  generatedAt: string;
  st: StatusResult;
  doc: DoctorResult;
  boot: BootstrapResult;
  checks: CommandCheck[];
  criteria: DogfoodCriterion[];
  passed: number;
  total: number;
  previous: number | null;
  trend: DogfoodResult["score"]["trend"];
}): string {
  const trendText =
    input.previous === null
      ? "new baseline"
      : `${input.trend} vs previous ${input.previous}/5`;
  const bootstrapSummary = summarizeBootstrap(input.boot);
  const checks = input.checks
    .map(
      (c) =>
        `| \`${c.command.join(" ")}\` | ${c.outcome} | ${c.durationMs} | ${escapeCell(c.detail)} |`,
    )
    .join("\n");
  const criteria = input.criteria
    .map((c) => `| ${c.label} | ${c.status} | ${escapeCell(c.detail)} |`)
    .join("\n");

  return [
    `## Automated Self-Check — ${input.generatedAt}`,
    "",
    `Continuity readiness score: ${input.passed}/${input.total} (${trendText})`,
    "",
    `Project: ${input.st.agentfile.project.name}`,
    `Tools: ${input.st.agentfile.tools.join(", ")}`,
    `Fragments: ${input.st.fragments.map((f) => `${f.id}@${f.installedVersion}:${f.status}`).join(", ")}`,
    `Drift: ${input.st.summary.entriesClean} clean, ${input.st.summary.entriesUserModified} modified, ${input.st.summary.entriesMissing} missing`,
    `Doctor: ${input.doc.ok ? "ok" : "issues"} (${input.doc.summary.errors} errors, ${input.doc.summary.warnings} warnings)`,
    `Ontology bootstrap dry-run: ${bootstrapSummary}`,
    "",
    "| Criterion | Result | Detail |",
    "|---|---|---|",
    criteria,
    "",
    "| Verification command | Result | ms | Detail |",
    "|---|---|---:|---|",
    checks || "| _(none)_ | skipped | 0 | no verification commands configured |",
  ].join("\n");
}

function summarizeBootstrap(result: BootstrapResult): string {
  const counts = new Map<string, number>();
  for (const entry of result.entries) {
    counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
