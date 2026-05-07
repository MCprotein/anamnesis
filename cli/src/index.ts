#!/usr/bin/env node

// anamnesis CLI entrypoint.
//
// v0.1 implements `init`. `update` and `promote` land in subsequent rounds.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  init,
  InitError,
  summarizeChanges,
  type InitResult,
} from "./commands/init.js";
import {
  update,
  UpdateError,
  type UpdateResult,
} from "./commands/update.js";
import {
  promote,
  PromoteError,
  type PromoteResult,
  type PromotableType,
} from "./commands/promote.js";
import {
  status,
  StatusError,
  type StatusResult,
} from "./commands/status.js";
import {
  doctor,
  DoctorError,
  type DoctorResult,
} from "./commands/doctor.js";
import {
  bootstrap,
  OntologyBootstrapError,
  type BootstrapResult,
} from "./commands/ontology.js";
import {
  dogfoodCheck,
  DogfoodError,
  type DogfoodResult,
} from "./commands/dogfood.js";
import {
  benchmarkCompare,
  benchmarkReport,
  BenchmarkError,
  type BenchmarkCompareResult,
  type BenchmarkResult,
} from "./commands/benchmark.js";
import {
  benchmarkGallery,
  BenchmarkGalleryError,
  type BenchmarkGalleryResult,
} from "./commands/benchmark_gallery.js";
import {
  agentTaskBenchmark,
  agentTaskBenchmarkTemplate,
  AgentTaskBenchmarkError,
  type AgentTaskBenchmarkResult,
} from "./commands/benchmark_task.js";
import {
  promptDeltaGate,
  PromptDeltaGateError,
  type PromptDeltaGateResult,
} from "./commands/benchmark_prompt_gate.js";
import {
  migrateAgentfile,
  MigrateError,
  type MigrateAgentfileResult,
} from "./commands/migrate.js";
import {
  collectGenerationBoundaryStatus,
  formatBootstrapGenerationBoundaryLines,
  formatGenerationBoundaryLines,
} from "./core/generation-boundary.js";
import { PACKAGE_VERSION } from "./core/version.js";
import type { ToolName } from "./core/agentfile.js";

const VERSION = PACKAGE_VERSION;
const SUPPORTED_TOOLS = ["claude-code", "codex", "cursor"] as const satisfies
  readonly ToolName[];

// ---------------------------------------------------------------------------
// Arg parsing — tiny, deliberate, no dependency.
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      flags[arg.slice(1)] = true;
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

function parseToolsFlag(value: string | boolean | undefined): ToolName[] | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) {
    throw new InitError("--tools requires a comma-separated list or 'all'");
  }
  const raw = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (raw.length === 0) {
    throw new InitError("--tools requires at least one adapter");
  }
  if (raw.length === 1 && raw[0] === "all") {
    return [...SUPPORTED_TOOLS];
  }
  const tools: ToolName[] = [];
  for (const tool of raw) {
    if (!SUPPORTED_TOOLS.includes(tool as ToolName)) {
      throw new InitError(
        `unknown adapter '${tool}' in --tools. Expected one of: ${SUPPORTED_TOOLS.join(", ")}, all`,
      );
    }
    if (!tools.includes(tool as ToolName)) tools.push(tool as ToolName);
  }
  return tools;
}

function parseCommaListFlag(value: string | boolean | undefined): string[] | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

function parsePositiveIntFlag(
  value: string | boolean | undefined,
  flagName: string,
): number | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) {
    throw new MigrateError(`${flagName} requires a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new MigrateError(`${flagName} requires a positive integer`);
  }
  return parsed;
}

function parseOptionalPositiveIntegerFlag(
  value: string | boolean | undefined,
  flagName: string,
): number | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) {
    throw new PromptDeltaGateError(`${flagName} requires a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new PromptDeltaGateError(`${flagName} requires a positive integer`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Library root discovery
// ---------------------------------------------------------------------------

/**
 * Find the library root relative to the CLI entrypoint.
 *
 * Layout:
 *   <library>/cli/dist/index.js   (built, npm-installed)
 *   <library>/cli/src/index.ts    (dev via tsx)
 *
 * In both cases the library root is two levels up from __dirname.
 */
function resolveLibraryRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}

// ---------------------------------------------------------------------------
// Help / version
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(
    `anamnesis ${VERSION} — AI coding agent config lifecycle manager

Usage:
  anamnesis <command> [options]

Commands:
  init                          First-time setup for the current project
  update                        Re-apply library state (dry-run by default)
  status                        Show installed fragments + drift + suggestions
  doctor                        Diagnose install integrity and adapter wiring
  dogfood check                 Run continuity self-check and optionally append
                                  a record to docs/DOGFOOD.md
  benchmark report             Generate a deterministic context-quality
                                  benchmark report for docs/BENCHMARKS.md
  benchmark compare            Compare two benchmark report JSON snapshots
                                  and optionally append a delta report
  benchmark gallery            Generate or validate docs/BENCHMARK-GALLERY.md
                                  from runtime evidence
  benchmark task               Record a model-dependent agent task benchmark
                                  separately from deterministic scorecards
  benchmark prompt-gate        Decide whether prompt-time context delta
                                  injection is justified by evidence
  migrate agentfile            Plan or apply Agentfile schema migrations
  promote <source>              Lift a project file into the library as a fragment
  ontology bootstrap            Generate .anamnesis/ontology/<id>.bootstrap.yaml
                                  from project files (Layer A — deterministic)

Flags (init):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --dry-run                     Show plan without writing
  --allow-exec-adapters         Permit executable adapter writes
                                  (.claude/*, .cursor/rules, Codex hooks)
  --tools <list|all>            Adapter surfaces to install on first init
                                  (comma-separated: claude-code,codex,cursor;
                                  default: claude-code)
  --project-name <name>         Override project name (default: dir basename)
  --monorepo                    Detect package.json workspaces and generate
                                  a multi-scope Agentfile with one scope per
                                  workspace sub-project (silent fall-back to
                                  single-scope if no monorepo detected)
  --no-bootstrap                Skip the post-install 'ontology bootstrap'
                                  pass (fragments with introspectors auto-
                                  populate .anamnesis/ontology/<id>.bootstrap.yaml)

Flags (update):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --apply                       Actually write (default is dry-run)
  --bump-pinned                 Explicitly bump pinned fragments to current
  --allow-exec-adapters         Permit executable adapter writes
                                  (.claude/*, .cursor/rules, Codex hooks)

Flags (status / doctor):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)

Flags (doctor):
  --append                      Append markdown to docs/DOCTOR.md and record
                                  runtime evidence
  --output <path>               Override doctor check log path

Flags (status):
  --json                        Print structured JSON for CI/tools

Flags (dogfood check):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --append                      Append markdown result to docs/DOGFOOD.md
  --output <path>               Override self-check log path

Flags (benchmark report):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --json                        Print structured JSON
  --append                      Append markdown result to docs/BENCHMARKS.md
  --output <path>               Override benchmark log path

Flags (benchmark compare):
  --project-root <path>         Target directory (default: cwd)
  --baseline <path>             Baseline benchmark report JSON file
  --after <path>                After benchmark report JSON file
  --json                        Print structured JSON
  --append                      Append markdown result to docs/BENCHMARKS.md
  --output <path>               Override benchmark log path

Flags (benchmark gallery):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON
  --write                       Write docs/BENCHMARK-GALLERY.md
  --validate                    Fail when generated gallery differs on disk
  --source <path[,path]>        Extra evidence JSONL source(s)
  --output <path>               Override gallery path

Flags (benchmark task):
  --project-root <path>         Target directory (default: cwd)
  --input <path>                Agent task benchmark JSON input
  --template                    Print a JSON input template
  --json                        Print structured JSON
  --append                      Append markdown to docs/AGENT-TASK-BENCHMARKS.md
  --output <path>               Override agent task benchmark log path

Flags (benchmark prompt-gate):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --json                        Print structured JSON
  --append                      Append markdown to docs/BENCHMARKS.md
  --output <path>               Override prompt gate log path
  --source <path[,path]>        Extra evidence JSONL source(s)
  --max-tokens <n>              Max estimated prompt delta token budget
                                  (default: 800)

Flags (migrate agentfile):
  --project-root <path>         Target directory (default: cwd)
  --apply                       Actually write after backup (default is dry-run)
  --json                        Print structured JSON
  --to <version>                Optional explicit target Agentfile schema

Flags (ontology bootstrap):
  --project-root <path>         Target directory (default: cwd)
  --scope <path>                Run only this Agentfile scope
                                  (default: all effective scopes)
  --fragment <id>               Run only this fragment's introspector
                                  (default: all installed fragments)
  --dry-run                     Print plan without writing

Flags (promote):
  --as <fragment-id>            Target fragment id (required)
  --type <capability>           Capability type (auto-detected from path if omitted)
                                  one of: project_memory | executable_hook |
                                          slash_command | skill | ontology
  --name <name>                 Override skill / slash_command name
  --region <id>                 For project_memory: region id to extract from
                                  source AGENTS.md (defaults to fragment id)
  --description <text>          Set/override fragment description
  --project-root <path>         Source directory (default: cwd)
  --library <path>              Library path (default: bundled)

Global:
  --help, -h                    Show this help
  --version, -v                 Show version

Docs: https://github.com/MCprotein/anamnesis`,
  );
}

// ---------------------------------------------------------------------------
// Reporters
// ---------------------------------------------------------------------------

function reportInit(result: InitResult): void {
  const s = summarizeChanges(result.changes);
  const fragIds = result.selectedFragments.map((f) => f.id).join(", ") || "(none)";
  console.log(`anamnesis init — ${result.agentfile.project.name}`);
  console.log(`  tools: ${result.agentfile.tools.join(", ")}`);
  console.log(`  fragments (root): ${fragIds}`);
  if (result.monorepoDetection?.isMonorepo) {
    const det = result.monorepoDetection;
    console.log(
      `  monorepo: detected via ${det.declaredVia} — ${det.scopes.length} scope(s)`,
    );
    for (const scope of det.scopes) {
      const ids = scope.matchedRules.map((r) => r.suggest).join(", ") || "(none)";
      console.log(`    ${scope.path.padEnd(20)} ${ids}`);
    }
    if (det.emptyScopes.length > 0) {
      console.log(
        `  empty workspace dirs (no rule match): ${det.emptyScopes.join(", ")}`,
      );
    }
  }
  console.log(
    `  changes: create=${s.create} update=${s.update} noop=${s.noop} blocked=${s.blocked} user-modified=${s.userModified}`,
  );
  if (!result.writtenToDisk) {
    console.log("  (dry-run — no files written)");
  }
  if (s.blocked > 0) {
    console.log(
      "  (some writes blocked — re-run with --allow-exec-adapters to include hooks/commands/skills)",
    );
  }
  if (result.bootstrapError) {
    console.log(`  ontology bootstrap: failed — ${result.bootstrapError}`);
  } else if (result.bootstrapResult) {
    const wrote = result.bootstrapResult.entries.filter(
      (e) => e.outcome === "written",
    ).length;
    const skipped = result.bootstrapResult.entries.filter((e) =>
      e.outcome.startsWith("skipped"),
    ).length;
    console.log(
      `  ontology bootstrap: ${wrote} fragment(s) populated, ${skipped} skipped`,
    );
  }
  console.log("  generation boundary:");
  console.log(
    "    cli-generated: AGENTS.md managed context, static ontology slices, and any .bootstrap.yaml facts above",
  );
  console.log(
    "    agent-required: run /ontology-enrich for semantic ontology; run /handoff-prepare before switching agents with in-progress work",
  );
}

function reportStatus(result: StatusResult, projectRoot: string): void {
  const { agentfile, scopes, suggested, declined, summary } = result;
  console.log(`anamnesis status — ${agentfile.project.name}`);
  console.log(`  tools: ${agentfile.tools.join(", ")}`);

  const isMonorepo = scopes.length > 1;

  if (isMonorepo) {
    console.log(`  scopes (${scopes.length}):`);
    for (const scope of scopes) {
      const driftCount = scope.entries.filter(
        (e) => e.drift !== "clean",
      ).length;
      const cleanCount = scope.entries.length - driftCount;
      const driftSummary =
        driftCount === 0
          ? `${cleanCount} clean`
          : `${driftCount} drift / ${cleanCount} clean`;
      console.log(
        `    [${scope.path}]  ${scope.fragments.length} fragment(s), ${driftSummary}`,
      );
      for (const f of scope.fragments) {
        console.log(`      ${formatFragmentLine(f)}`);
      }
      const drifted = scope.entries.filter((e) => e.drift !== "clean");
      for (const e of drifted) {
        const tgt =
          e.target === "region"
            ? `${e.file} [region:${e.regionId}]`
            : e.path;
        console.log(`      ${e.drift.padEnd(15)} ${tgt}`);
      }
    }
  } else {
    // Single-scope: flat list (back-compat with v0.2 format).
    console.log(`  fragments (${summary.fragmentTotal}):`);
    for (const f of result.fragments) {
      console.log(`    ${formatFragmentLine(f)}`);
    }
    const drifted = result.entries.filter((e) => e.drift !== "clean");
    if (drifted.length === 0) {
      console.log(`  drift: none (${summary.entriesClean} entries clean)`);
    } else {
      console.log(`  drift:`);
      for (const e of drifted) {
        const tgt =
          e.target === "region"
            ? `${e.file} [region:${e.regionId}]`
            : e.path;
        console.log(`    ${e.drift.padEnd(15)} ${tgt}`);
      }
    }
  }

  if (suggested.length > 0) {
    console.log(`  suggested (rulebook matches not yet installed):`);
    for (const s of suggested) {
      console.log(`    ${s.suggest.padEnd(20)} ${s.reason}`);
    }
  }

  if (declined.length > 0) {
    console.log(`  declined:`);
    for (const d of declined) {
      const when = d.declinedAt ? ` (${d.declinedAt})` : "";
      const why = d.reason ? `: ${d.reason}` : "";
      const state = d.matched ? "active" : "stale";
      console.log(`    ${d.id}${when} [${state}]${why}`);
    }
  }

  const continuity = result.continuity;
  console.log(
    `  continuity: ${continuity.ready ? "ready" : "issues"} (${continuity.passed}/${continuity.total})`,
  );
  for (const check of continuity.checks.filter((c) => c.status === "fail")) {
    console.log(`    fail ${check.label}: ${check.detail}`);
  }
  const codexHooks = result.codexHooks;
  if (
    agentfile.tools.includes("codex") ||
    codexHooks.summary.total > 0 ||
    codexHooks.parseError
  ) {
    if (codexHooks.readable) {
      const s = codexHooks.summary;
      console.log(
        `  codex hooks: ${s.total} total (anamnesis ${s.anamnesis}, omx ${s.omx}, plugin ${s.plugin}, user ${s.user}, invalid ${s.invalid}; warnings ${s.warnings})`,
      );
      for (const warning of codexHooks.warnings.slice(0, 3)) {
        console.log(`    warning ${warning.kind}: ${warning.detail}`);
      }
      if (codexHooks.warnings.length > 3) {
        console.log(
          `    ... ${codexHooks.warnings.length - 3} more hook warning(s)`,
        );
      }
    } else {
      console.log(`  codex hooks: unavailable (${codexHooks.parseError})`);
    }
  }
  const ontology = result.ontology;
  console.log(
    `  ontology gaps: ${ontology.summary.warnings} warning(s), ${ontology.summary.info} info`,
  );
  for (const gap of ontology.gaps.filter((g) => g.severity === "warning")) {
    const scope = gap.scopePath === "." ? "" : ` [${gap.scopePath}]`;
    const target = gap.target ? ` ${gap.target}` : "";
    console.log(
      `    ${gap.severity.padEnd(7)} ${gap.fragmentId}:${gap.kind}${scope}${target}`,
    );
    console.log(`      ${gap.detail}`);
    console.log(`      next: ${gap.next}`);
  }
  const evidence = result.evidence;
  if (evidence.latest) {
    const freshness =
      evidence.latest_age_ms !== undefined
        ? ` (${formatAge(evidence.latest_age_ms)} old${evidence.latest_stale ? "; stale" : ""})`
        : "";
    console.log(
      `  evidence: ${evidence.total} record(s), latest ${evidence.latest.kind} at ${evidence.latest.generated_at}${freshness}`,
    );
    for (const kind of evidence.byKind) {
      console.log(
        `    ${kind.kind}: ${kind.total} record(s), latest ${kind.latest.generated_at} (${formatAge(kind.latest_age_ms)} old${kind.stale ? "; stale" : ""})`,
      );
    }
    if (evidence.invalid > 0) {
      console.log(`    invalid evidence line(s): ${evidence.invalid}`);
    }
  } else {
    const suffix =
      evidence.invalid > 0 ? ` (${evidence.invalid} invalid line(s))` : "";
    console.log(`  evidence: none${suffix}`);
  }
  for (const line of formatGenerationBoundaryLines(
    collectGenerationBoundaryStatus(projectRoot),
  )) {
    console.log(line);
  }
}

function reportDoctor(result: DoctorResult): void {
  const verdict = result.ok ? "ok" : "issues found";
  console.log(`anamnesis doctor — ${verdict}`);
  console.log(
    `  issues: ${result.summary.errors} error(s), ${result.summary.warnings} warning(s)`,
  );
  if (result.issues.length === 0) {
    console.log("  installation integrity checks passed");
    for (const line of formatGenerationBoundaryLines(
      collectGenerationBoundaryStatus(result.projectRoot),
    )) {
      console.log(line);
    }
    reportAppendEvidence(result.appendedPath, result.evidencePath);
    return;
  }
  for (const issue of result.issues) {
    const scope = issue.scopePath ? ` [${issue.scopePath}]` : "";
    const target = issue.target ? ` ${issue.target}` : "";
    console.log(
      `  ${issue.severity.padEnd(7)} ${issue.code}${scope}${target}`,
    );
    console.log(`    ${issue.message}`);
    if (issue.repair) {
      console.log(`    repair: ${issue.repair}`);
    }
  }
  for (const line of formatGenerationBoundaryLines(
    collectGenerationBoundaryStatus(result.projectRoot),
  )) {
    console.log(line);
  }
  reportAppendEvidence(result.appendedPath, result.evidencePath);
}

function formatAge(ms: number): string {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ms < minute) return `${Math.floor(ms / 1000)}s`;
  if (ms < hour) return `${Math.floor(ms / minute)}m`;
  if (ms < day) return `${Math.floor(ms / hour)}h`;
  return `${Math.floor(ms / day)}d`;
}

function reportAppendEvidence(
  appendedPath: string | undefined,
  evidencePath: string | undefined,
): void {
  if (appendedPath) {
    console.log(`  appended: ${appendedPath}`);
  }
  if (evidencePath) {
    console.log(`  evidence: ${evidencePath}`);
  }
}

function formatFragmentLine(
  f: { id: string; installedVersion: number; libraryVersion: number | null; pinned: boolean; status: string },
): string {
  let tag: string;
  switch (f.status) {
    case "in-sync":
      tag = "in-sync";
      break;
    case "update-available":
      tag = `update available → ${f.libraryVersion}`;
      break;
    case "pinned":
      tag = `pinned (lib has ${f.libraryVersion})`;
      break;
    case "library-missing":
      tag = "library-missing";
      break;
    default:
      tag = f.status;
  }
  return `${f.id}@${f.installedVersion}  [${tag}]`;
}

function reportPromote(result: PromoteResult): void {
  console.log(
    `anamnesis promote — ${result.isNewFragment ? "created" : "extended"} fragment '${result.fragmentId}'`,
  );
  console.log(`  capability: ${result.capability.type}`);
  console.log(`  files written:`);
  for (const f of result.filesWritten) {
    console.log(`    + ${f}`);
  }
  console.log(`  fragment dir: ${result.fragmentDir}`);
  console.log(
    `\nNext: review the fragment, optionally add a rule to rulebook.md, commit.`,
  );
}

function reportBootstrap(result: BootstrapResult): void {
  console.log(`anamnesis ontology bootstrap`);
  for (const e of result.entries) {
    let suffix = "";
    if (e.outcome === "written" || e.outcome === "unchanged") {
      suffix = ` → ${e.path}`;
    }
    const scope =
      e.scopePath === "." || e.scopePath === ""
        ? ""
        : ` [${e.scopePath}]`;
    console.log(`  ${e.fragmentId.padEnd(20)} ${e.outcome}${scope}${suffix}`);
  }
  if (!result.writtenToDisk) {
    console.log("  (dry-run or nothing changed — no files written)");
  }
  for (const line of formatBootstrapGenerationBoundaryLines(result)) {
    console.log(line);
  }
  const enrichmentTargets = bootstrapEnrichmentTargets(result);
  if (enrichmentTargets.length > 0) {
    console.log("  semantic follow-up:");
    console.log(
      "    Layer A facts are only the baseline. Ask the active agent to run /ontology-enrich next.",
    );
    for (const target of enrichmentTargets) {
      console.log(`    /ontology-enrich -> ${target}`);
    }
  }
}

function bootstrapEnrichmentTargets(result: BootstrapResult): string[] {
  const targets = new Set<string>();
  for (const entry of result.entries) {
    if (
      entry.path &&
      (entry.outcome === "written" || entry.outcome === "unchanged")
    ) {
      targets.add(entry.path.replace(/\.bootstrap\.yaml$/, ".enriched.yaml"));
    }
  }
  return Array.from(targets).sort();
}

function reportDogfood(result: DogfoodResult): void {
  console.log(
    `anamnesis dogfood check — ${result.status.agentfile.project.name}`,
  );
  const previous =
    result.score.previous === null ? "no previous score" : `${result.score.previous}/5`;
  console.log(
    `  continuity readiness: ${result.score.passed}/${result.score.total} (${result.score.trend}; ${previous})`,
  );
  console.log(`  tools: ${result.status.agentfile.tools.join(", ")}`);
  console.log(
    `  status: ${result.status.summary.entriesClean} clean, ${result.status.summary.entriesUserModified} modified, ${result.status.summary.entriesMissing} missing`,
  );
  console.log(
    `  doctor: ${result.doctor.ok ? "ok" : "issues"} (${result.doctor.summary.errors} errors, ${result.doctor.summary.warnings} warnings)`,
  );
  for (const criterion of result.criteria) {
    console.log(`  ${criterion.status.padEnd(4)} ${criterion.label}`);
  }
  for (const check of result.checks) {
    console.log(
      `  ${check.outcome.padEnd(7)} ${check.command.join(" ")} (${check.durationMs}ms)`,
    );
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

function reportBenchmark(result: BenchmarkResult): void {
  console.log(
    `anamnesis benchmark report — ${result.status.agentfile.project.name}`,
  );
  console.log(`  tools: ${result.status.agentfile.tools.join(", ")}`);
  console.log(`  ready layers: ${result.summary.ready}/${result.summary.total}`);
  console.log(
    `  continuity: ${result.scorecard.continuity.passed}/${result.scorecard.continuity.total}`,
  );
  console.log(
    `  doctor: ${result.doctor.ok ? "ok" : "issues"} (${result.scorecard.diagnostics.doctor_errors} errors, ${result.scorecard.diagnostics.doctor_warnings} warnings)`,
  );
  console.log(
    `  codex hook warnings: ${result.scorecard.diagnostics.codex_hook_warnings}`,
  );
  console.log(
    `  evidence: ${result.scorecard.evidence.records} valid, ${result.scorecard.evidence.invalid_records} invalid`,
  );
  for (const layer of result.layers) {
    console.log(
      `  ${layer.status.padEnd(7)} ${layer.label}: ${layer.score}/${layer.total}`,
    );
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

function reportBenchmarkCompare(result: BenchmarkCompareResult): void {
  console.log(`anamnesis benchmark compare — ${result.after.projectName}`);
  console.log(`  baseline: ${result.baselinePath}`);
  console.log(`  after: ${result.afterPath}`);
  console.log(
    `  summary: ${result.summary.improved} improved, ${result.summary.regressed} regressed, ${result.summary.unchanged} unchanged`,
  );
  for (const delta of result.deltas) {
    const unit = delta.unit ?? "";
    const signed = delta.delta > 0 ? `+${delta.delta}` : String(delta.delta);
    console.log(
      `  ${delta.verdict.padEnd(9)} ${delta.label}: ${delta.before}${unit} -> ${delta.after}${unit} (${signed})`,
    );
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

function reportBenchmarkGallery(result: BenchmarkGalleryResult): void {
  console.log("anamnesis benchmark gallery");
  console.log(
    `  evidence: ${result.evidenceRecords} valid, ${result.invalidEvidenceLines} invalid`,
  );
  console.log(`  entries: ${result.entries.length}`);
  console.log(`  claim candidates: ${result.claimCandidates.length}`);
  if (result.warnings.length > 0) {
    console.log(`  warnings: ${result.warnings.length}`);
    for (const warning of result.warnings) {
      console.log(`    - ${warning}`);
    }
  }
  if (result.writtenPath) {
    console.log(`  written: ${result.writtenPath}`);
  }
  if (result.validation) {
    console.log(
      `  validation: ${result.validation.ok ? "ok" : "stale"} (${result.validation.checkedPath})`,
    );
  }
}

function reportAgentTaskBenchmark(result: AgentTaskBenchmarkResult): void {
  console.log(`anamnesis benchmark task — ${result.input.project.name}`);
  console.log(`  task: ${result.input.task.id}`);
  console.log(`  run: ${result.input.run.id}`);
  console.log(
    `  agent/model: ${result.input.run.agent} / ${result.input.run.model}`,
  );
  console.log(`  context state: ${result.input.run.context_state}`);
  console.log(`  score: ${result.score.points}/${result.score.total}`);
  console.log(
    `  metrics: questions=${result.input.metrics.questions_before_action}, tool_turns=${result.input.metrics.tool_turns_to_context}, elapsed_ms=${result.input.metrics.elapsed_ms}`,
  );
  console.log(
    `  first correct action: ${result.input.metrics.first_correct_action ? "yes" : "no"}`,
  );
  console.log(
    `  handoff recovered: ${result.input.metrics.handoff_recovered ? "yes" : "no"}`,
  );
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

function reportPromptDeltaGate(result: PromptDeltaGateResult): void {
  console.log(
    `anamnesis benchmark prompt-gate — ${result.status.agentfile.project.name}`,
  );
  console.log(`  decision: ${result.decision.recommendation}`);
  console.log(
    `  implement prompt delta: ${result.decision.shouldImplementPromptDelta ? "yes" : "no"}`,
  );
  console.log(`  reason: ${result.decision.reason}`);
  console.log(
    `  evidence: ${result.evidence.records} valid, ${result.evidence.invalidRecords} invalid`,
  );
  console.log(
    `  context budget: ~${result.contextBudget.estimatedTokens}/${result.contextBudget.maxPromptDeltaTokens} tokens, duplicate risk ${result.contextBudget.duplicateContextRisk}`,
  );
  for (const signal of result.signals) {
    console.log(`  ${signal.status.padEnd(4)} ${signal.label}: ${signal.detail}`);
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidenceRecordPath) {
    console.log(`  evidence: ${result.evidenceRecordPath}`);
  }
}

function reportMigrate(result: MigrateAgentfileResult): void {
  const verdict = result.changed
    ? result.applied
      ? "applied"
      : "changes available"
    : "no changes";
  console.log(`anamnesis migrate agentfile — ${verdict}`);
  console.log(`  path: ${result.agentfilePath}`);
  console.log(`  version: ${result.currentVersion} -> ${result.targetVersion}`);
  if (result.migrations.length === 0) {
    console.log("  migrations: none");
  } else {
    console.log("  migrations:");
    for (const migration of result.migrations) {
      console.log(`    ${migration.id}: ${migration.title}`);
    }
  }
  if (result.backupPath) {
    console.log(`  backup: ${result.backupPath}`);
  }
  if (result.changed && !result.applied) {
    console.log("  (dry-run — re-run with --apply to actually write)");
    for (const line of formatWholeFileDiff(result)) {
      console.log(line);
    }
  }
  console.log(`  next: ${result.nextCommand}`);
}

function formatWholeFileDiff(result: MigrateAgentfileResult): string[] {
  if (result.currentContent === result.newContent) return [];
  const lines = [
    `--- a/${result.agentfilePath}`,
    `+++ b/${result.agentfilePath}`,
  ];
  for (const line of result.currentContent.split(/\r?\n/)) {
    lines.push(`-${line}`);
  }
  for (const line of result.newContent.split(/\r?\n/)) {
    lines.push(`+${line}`);
  }
  return lines;
}

function reportUpdate(result: UpdateResult): void {
  const s = summarizeChanges(result.changes);
  const fragIds = result.agentfile.fragments.map((f) => f.id).join(", ") || "(none)";
  console.log(`anamnesis update — ${result.agentfile.project.name}`);
  console.log(`  fragments: ${fragIds}`);
  console.log(
    `  changes: create=${s.create} update=${s.update} noop=${s.noop} blocked=${s.blocked} user-modified=${s.userModified}`,
  );
  if (result.suggested.length > 0) {
    const ids = result.suggested.map((r) => r.suggest).join(", ");
    console.log(`  suggested (not installed): ${ids}`);
    console.log(`    → add to Agentfile.fragments[] and re-run, or list under 'declined' to silence.`);
  }
  if (s.userModified > 0) {
    console.log(
      `  (${s.userModified} user-modified — your edits are preserved; library updates skipped for those.)`,
    );
  }
  if (s.blocked > 0) {
    console.log(
      "  (some writes blocked — re-run with --allow-exec-adapters to include hooks/commands/skills)",
    );
  }
  if (result.writtenToDisk) {
    if (result.backedUpFiles && result.backedUpFiles.length > 0) {
      console.log(`  backup: ${result.backupDir}`);
    }
    if (result.prunedBackupDirs && result.prunedBackupDirs.length > 0) {
      console.log(`  pruned backups: ${result.prunedBackupDirs.length}`);
    }
    if (result.evidencePath) {
      console.log(`  evidence: ${result.evidencePath}`);
    }
  } else {
    console.log("  (dry-run — re-run with --apply to actually write)");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  const { command, positional, flags } = parseArgs(argv);

  if (flags.help || flags.h) {
    printHelp();
    return 0;
  }
  if (flags.version || flags.v) {
    console.log(VERSION);
    return 0;
  }

  if (!command) {
    printHelp();
    return 0;
  }

  switch (command) {
    case "init":
      try {
        const result = init({
          projectRoot: (flags["project-root"] as string | undefined) ?? process.cwd(),
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          dryRun: flags["dry-run"] === true,
          allowExecAdapters: flags["allow-exec-adapters"] === true,
          tools: parseToolsFlag(flags["tools"]),
          projectName: flags["project-name"] as string | undefined,
          monorepo: flags["monorepo"] === true,
          noBootstrap: flags["no-bootstrap"] === true,
        });
        reportInit(result);
        return 0;
      } catch (e) {
        if (e instanceof InitError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }

    case "update":
      try {
        const result = update({
          projectRoot: (flags["project-root"] as string | undefined) ?? process.cwd(),
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          apply: flags["apply"] === true,
          bumpPinned: flags["bump-pinned"] === true,
          allowExecAdapters: flags["allow-exec-adapters"] === true,
        });
        reportUpdate(result);
        return 0;
      } catch (e) {
        if (e instanceof UpdateError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }

    case "status":
      try {
        const projectRoot =
          (flags["project-root"] as string | undefined) ?? process.cwd();
        const result = status({
          projectRoot,
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
        });
        if (flags["json"] === true) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          reportStatus(result, projectRoot);
        }
        return 0;
      } catch (e) {
        if (e instanceof StatusError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }

    case "doctor":
      try {
        const result = doctor({
          projectRoot:
            (flags["project-root"] as string | undefined) ?? process.cwd(),
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          append: flags["append"] === true,
          outputPath: flags["output"] as string | undefined,
        });
        reportDoctor(result);
        return result.ok ? 0 : 1;
      } catch (e) {
        if (e instanceof DoctorError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }

    case "dogfood": {
      const sub = positional[0];
      if (sub !== "check") {
        console.error(
          `error: unknown 'dogfood' subcommand: ${sub ?? "(none)"}`,
        );
        console.error(
          `usage: anamnesis dogfood check [--append] [--output=<path>]`,
        );
        return 1;
      }
      try {
        const result = dogfoodCheck({
          projectRoot:
            (flags["project-root"] as string | undefined) ?? process.cwd(),
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          append: flags["append"] === true,
          outputPath: flags["output"] as string | undefined,
        });
        reportDogfood(result);
        return result.ok ? 0 : 1;
      } catch (e) {
        if (e instanceof DogfoodError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }
    }

    case "benchmark": {
      const sub = positional[0];
      if (
        sub !== "report" &&
        sub !== "compare" &&
        sub !== "gallery" &&
        sub !== "task" &&
        sub !== "prompt-gate"
      ) {
        console.error(
          `error: unknown 'benchmark' subcommand: ${sub ?? "(none)"}`,
        );
        console.error(
          `usage: anamnesis benchmark report [--json] [--append] [--output=<path>]`,
        );
        console.error(
          `       anamnesis benchmark compare --baseline <path> --after <path> [--json] [--append] [--output=<path>]`,
        );
        console.error(
          `       anamnesis benchmark gallery [--json] [--write] [--validate] [--output=<path>]`,
        );
        console.error(
          `       anamnesis benchmark task --input <path> [--json] [--append] [--output=<path>]`,
        );
        console.error(
          `       anamnesis benchmark prompt-gate [--json] [--append] [--output=<path>]`,
        );
        return 1;
      }
      try {
        if (sub === "prompt-gate") {
          const maxTokens = parseOptionalPositiveIntegerFlag(
            flags["max-tokens"],
            "--max-tokens",
          );
          const result = promptDeltaGate({
            projectRoot:
              (flags["project-root"] as string | undefined) ?? process.cwd(),
            libraryRoot:
              (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
            append: flags["append"] === true,
            outputPath: flags["output"] as string | undefined,
            sources: parseCommaListFlag(flags["source"]),
            ...(maxTokens !== undefined ? { maxPromptDeltaTokens: maxTokens } : {}),
          });
          if (flags["json"] === true) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            reportPromptDeltaGate(result);
          }
          return 0;
        }

        if (sub === "task") {
          if (flags["template"] === true) {
            console.log(JSON.stringify(agentTaskBenchmarkTemplate(), null, 2));
            return 0;
          }
          const inputPath = flags["input"];
          if (typeof inputPath !== "string") {
            console.error(
              `usage: anamnesis benchmark task --input <path> [--json] [--append] [--output=<path>]`,
            );
            console.error(
              `       anamnesis benchmark task --template`,
            );
            return 1;
          }
          const result = agentTaskBenchmark({
            projectRoot:
              (flags["project-root"] as string | undefined) ?? process.cwd(),
            inputPath,
            append: flags["append"] === true,
            outputPath: flags["output"] as string | undefined,
          });
          if (flags["json"] === true) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            reportAgentTaskBenchmark(result);
          }
          return 0;
        }

        if (sub === "gallery") {
          const result = benchmarkGallery({
            projectRoot:
              (flags["project-root"] as string | undefined) ?? process.cwd(),
            outputPath: flags["output"] as string | undefined,
            write: flags["write"] === true,
            validate: flags["validate"] === true,
            sources: parseCommaListFlag(flags["source"]),
          });
          if (flags["json"] === true) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            reportBenchmarkGallery(result);
          }
          return result.ok ? 0 : 1;
        }

        if (sub === "compare") {
          const baselinePath = flags["baseline"];
          const afterPath = flags["after"];
          if (typeof baselinePath !== "string" || typeof afterPath !== "string") {
            console.error(
              `usage: anamnesis benchmark compare --baseline <path> --after <path> [--json] [--append] [--output=<path>]`,
            );
            return 1;
          }
          const result = benchmarkCompare({
            projectRoot:
              (flags["project-root"] as string | undefined) ?? process.cwd(),
            baselinePath,
            afterPath,
            append: flags["append"] === true,
            outputPath: flags["output"] as string | undefined,
          });
          if (flags["json"] === true) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            reportBenchmarkCompare(result);
          }
          return 0;
        }

        const result = benchmarkReport({
          projectRoot:
            (flags["project-root"] as string | undefined) ?? process.cwd(),
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          append: flags["append"] === true,
          outputPath: flags["output"] as string | undefined,
        });
        if (flags["json"] === true) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          reportBenchmark(result);
        }
        return 0;
      } catch (e) {
        if (
          e instanceof BenchmarkError ||
          e instanceof BenchmarkGalleryError ||
          e instanceof AgentTaskBenchmarkError ||
          e instanceof PromptDeltaGateError
        ) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }
    }

    case "migrate": {
      const sub = positional[0];
      if (sub !== "agentfile") {
        console.error(
          `error: unknown 'migrate' subcommand: ${sub ?? "(none)"}`,
        );
        console.error(
          `usage: anamnesis migrate agentfile [--apply] [--json] [--to=<version>]`,
        );
        return 1;
      }
      try {
        const result = migrateAgentfile({
          projectRoot:
            (flags["project-root"] as string | undefined) ?? process.cwd(),
          apply: flags["apply"] === true,
          targetVersion: parsePositiveIntFlag(flags["to"], "--to"),
        });
        if (flags["json"] === true) {
          console.log(JSON.stringify(migrateJson(result), null, 2));
        } else {
          reportMigrate(result);
        }
        return 0;
      } catch (e) {
        if (e instanceof MigrateError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }
    }

    case "promote": {
      const source = (positional[0] as string | undefined) ?? "";
      const fragmentId = flags["as"] as string | undefined;
      if (!source) {
        console.error("error: promote requires a source path positional argument.");
        console.error(
          "usage: anamnesis promote <source> --as=<fragment-id> [--type=<capability>]",
        );
        return 1;
      }
      if (!fragmentId) {
        console.error("error: promote requires --as=<fragment-id>");
        return 1;
      }
      try {
        const result = promote({
          projectRoot:
            (flags["project-root"] as string | undefined) ?? process.cwd(),
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          source,
          fragmentId,
          capabilityType: flags["type"] as PromotableType | undefined,
          name: flags["name"] as string | undefined,
          region: flags["region"] as string | undefined,
          description: flags["description"] as string | undefined,
        });
        reportPromote(result);
        return 0;
      } catch (e) {
        if (e instanceof PromoteError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }
    }

    case "ontology": {
      const sub = positional[0];
      if (sub !== "bootstrap") {
        console.error(
          `error: unknown 'ontology' subcommand: ${sub ?? "(none)"}`,
        );
        console.error(
          `usage: anamnesis ontology bootstrap [--scope=<path>] [--fragment=<id>] [--dry-run]`,
        );
        return 1;
      }
      try {
        const result = bootstrap({
          projectRoot:
            (flags["project-root"] as string | undefined) ?? process.cwd(),
          scope: flags["scope"] as string | undefined,
          fragment: flags["fragment"] as string | undefined,
          dryRun: flags["dry-run"] === true,
        });
        reportBootstrap(result);
        return 0;
      } catch (e) {
        if (e instanceof OntologyBootstrapError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }
    }

    default:
      console.error(`unknown command: ${command}`);
      console.error(`run 'anamnesis --help' for usage.`);
      return 1;
  }
}

function migrateJson(result: MigrateAgentfileResult): object {
  return {
    agentfilePath: result.agentfilePath,
    currentVersion: result.currentVersion,
    targetVersion: result.targetVersion,
    applied: result.applied,
    changed: result.changed,
    migrations: result.migrations,
    backupPath: result.backupPath,
    nextCommand: result.nextCommand,
  };
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
