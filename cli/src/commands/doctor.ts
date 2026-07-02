// `anamnesis doctor` — read-only installation integrity diagnostics.
//
// This command is stricter than `status`: it turns drift and broken wiring
// into actionable issues, but never edits the project.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  findAgentfile,
  readAgentfile,
} from "../core/agentfile.js";
import {
  emptyManifest,
  manifestPath,
  readManifest,
  type Manifest,
  ManifestParseError,
} from "../core/manifest.js";
import {
  loadAllFragments,
  loadBaseFragment,
  type FragmentDefinition,
} from "../core/fragments.js";
import { effectiveScopes } from "../core/scope.js";
import type { RenderAction } from "../core/render.js";
import {
  hookRegistrationPresent,
  readSettings,
  type HookRegistration,
} from "../core/settings.js";
import {
  CODEX_CONFIG_PATH,
  CODEX_HOOKS_PATH,
  analyzeCodexHookOwnership,
  codexHookRegistrationPresent,
  codexHooksFeatureEnabled,
  type CodexHookOwnershipWarning,
  type CodexHookRegistration,
} from "../core/codex_native.js";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";
import {
  contextDiagnostics,
  type ContextDiagnosticIssue,
  type ContextDiagnosticSeverity,
} from "./context_diagnostics.js";
import { status, type ContinuityCheck, type StatusResult } from "./status.js";
import {
  analyzeExecutableSecurity,
  type ExecutableSecurityIssue,
} from "../core/executable_security.js";
import {
  analyzeAgentConfigDamage,
  type AgentConfigDamageIssue,
} from "../core/agent_config_damage.js";
import {
  collectInstalledRenderActions,
  type InstalledRenderPlanProblem,
} from "./render_plan.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DoctorSeverity = "error" | ContextDiagnosticSeverity;

export type DoctorIssueCode =
  | "manifest-missing"
  | "manifest-invalid"
  | "fragment-library-missing"
  | "fragment-dependency-missing"
  | "fragment-dependency-version-unsatisfied"
  | "fragment-dependency-cycle"
  | "fragment-update-available"
  | "tracked-entry-missing"
  | "tracked-entry-user-modified"
  | "adapter-renderer-missing"
  | "render-plan-failed"
  | "settings-invalid"
  | "codex-config-missing"
  | "codex-config-invalid"
  | "codex-hook-config-invalid"
  | "hook-registration-missing"
  | "codex-hook-registration-missing"
  | "codex-hook-ownership-warning"
  | "continuity-project-memory-missing"
  | "continuity-ontology-missing"
  | "continuity-handoff-missing"
  | "continuity-active-handoff-stale"
  | "continuity-adapter-surface-missing"
  | "continuity-drift-detected"
  | "declined-rule-stale"
  | "ontology-static-missing"
  | "ontology-bootstrap-missing"
  | "ontology-bootstrap-stale"
  | "ontology-enrichment-missing"
  | ExecutableSecurityIssue["code"]
  | AgentConfigDamageIssue["code"]
  | ContextDiagnosticIssue["code"];

export interface DoctorIssue {
  severity: DoctorSeverity;
  code: DoctorIssueCode;
  message: string;
  scopePath?: string;
  fragmentId?: string;
  target?: string;
  repair?: string;
}

export interface DoctorResult {
  projectRoot: string;
  libraryRoot: string;
  generatedAt: string;
  ok: boolean;
  issues: DoctorIssue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
  markdown: string;
  appendedPath?: string;
  evidencePath?: string;
}

export interface DoctorOptions {
  projectRoot: string;
  libraryRoot: string;
  append?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export class DoctorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DoctorError";
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export function doctor(opts: DoctorOptions): DoctorResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();

  if (!findAgentfile(projectRoot)) {
    throw new DoctorError(
      `no Agentfile found in ${projectRoot}. Run 'anamnesis init' first.`,
    );
  }

  const issues: DoctorIssue[] = [];
  const agentfile = readAgentfile(projectRoot);

  let manifest: Manifest = emptyManifest();
  let manifestReadable = true;
  const mfPath = manifestPath(projectRoot);
  if (!fs.existsSync(mfPath)) {
    manifestReadable = false;
    issues.push({
      severity: "error",
      code: "manifest-missing",
      message: `.anamnesis/manifest.json is missing`,
      target: ".anamnesis/manifest.json",
    });
  } else {
    try {
      manifest = readManifest(projectRoot);
    } catch (e) {
      manifestReadable = false;
      if (e instanceof ManifestParseError) {
        issues.push({
          severity: "error",
          code: "manifest-invalid",
          message: e.message,
          target: ".anamnesis/manifest.json",
        });
      } else {
        throw e;
      }
    }
  }

  if (manifestReadable) {
    const stableNow = () => new Date(generatedAt);
    const st = status({ projectRoot, libraryRoot, now: stableNow });
    addStatusIssues(st.entries, st.fragments, issues);
    addDependencyIssues(st.dependencies.problems, issues);
    addContinuityIssues(st.continuity.checks, issues);
    addOntologyGapIssues(st.ontology.gaps, issues);
    addDeclinedIssues(st.declined, issues);
    addContextDiagnosticIssues(
      contextDiagnostics({ projectRoot, now: stableNow }).issues,
      issues,
    );
  }

  const library = libraryFragmentMap(libraryRoot);
  const renderPlan = collectInstalledRenderActions({
    projectRoot,
    libraryRoot,
    library,
    scopes: effectiveScopes(agentfile),
  });
  addRenderPlanProblems(renderPlan.problems, issues);
  const renderActions = renderPlan.actions;
  addExecutableSecurityIssues(
    analyzeExecutableSecurity(renderActions).issues,
    issues,
  );
  addAgentConfigDamageIssues(
    analyzeAgentConfigDamage({ projectRoot, manifest }).issues,
    issues,
  );
  addSettingsIssues(projectRoot, manifest, renderActions, issues);
  addCodexHookIssues(projectRoot, manifest, renderActions, issues);

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const info = issues.filter((i) => i.severity === "info").length;
  const summary = { errors, warnings, info };
  const ok = errors === 0;
  const markdown = renderDoctorMarkdown({
    generatedAt,
    projectName: agentfile.project.name,
    ok,
    issues,
    summary,
  });

  let appendedPath: string | undefined;
  let evidencePath: string | undefined;
  if (opts.append === true) {
    const outputPath = path.resolve(
      projectRoot,
      opts.outputPath ?? path.join("docs", "DOCTOR.md"),
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const prefix =
      fs.existsSync(outputPath) && fs.readFileSync(outputPath, "utf8").trim() !== ""
        ? "\n\n"
        : "";
    fs.appendFileSync(outputPath, `${prefix}${markdown}\n`, "utf8");
    appendedPath = displayPathFromProject(projectRoot, outputPath);
    evidencePath = appendEvidenceRecord(
      projectRoot,
      doctorEvidenceRecord({
        generatedAt,
        projectName: agentfile.project.name,
        ok,
        issues,
        summary,
        appendedPath,
      }),
    );
  }

  return {
    projectRoot,
    libraryRoot,
    generatedAt,
    ok,
    issues,
    summary,
    markdown,
    appendedPath,
    evidencePath,
  };
}

// ---------------------------------------------------------------------------
// Status-derived issues
// ---------------------------------------------------------------------------

type StatusEntry = ReturnType<typeof status>["entries"][number];
type StatusFragment = ReturnType<typeof status>["fragments"][number];

function addStatusIssues(
  entries: StatusEntry[],
  fragments: StatusFragment[],
  issues: DoctorIssue[],
): void {
  for (const f of fragments) {
    if (f.status === "library-missing") {
      issues.push({
        severity: "error",
        code: "fragment-library-missing",
        fragmentId: f.id,
        message: `installed fragment '${f.id}' is missing from the library`,
      });
    } else if (f.status === "update-available") {
      issues.push({
        severity: "warning",
        code: "fragment-update-available",
        fragmentId: f.id,
        message: `fragment '${f.id}' is installed at ${f.installedVersion}; library has ${f.libraryVersion}`,
      });
    }
  }

  for (const e of entries) {
    const target =
      e.target === "region"
        ? `${e.file} [region:${e.regionId}]`
        : e.path;
    if (e.drift === "missing") {
      issues.push({
        severity: "error",
        code: "tracked-entry-missing",
        fragmentId: e.fragmentId,
        target,
        message: `tracked ${e.target} is missing: ${target}`,
      });
    } else if (e.drift === "user-modified") {
      issues.push({
        severity: "warning",
        code: "tracked-entry-user-modified",
        fragmentId: e.fragmentId,
        target,
        message: `tracked ${e.target} differs from last applied content: ${target}`,
        repair:
          "manual merge review required: compare the file against the latest rendered fragment output. If the local edit is intentional, keep it and accept the warning; otherwise merge the library content from the backup/update plan and re-run `anamnesis update --apply --allow-exec-adapters`.",
      });
    }
  }
}

function addDependencyIssues(
  problems: StatusResult["dependencies"]["problems"],
  issues: DoctorIssue[],
): void {
  for (const problem of problems) {
    if (problem.kind === "cycle") {
      issues.push({
        severity: "error",
        code: "fragment-dependency-cycle",
        scopePath: problem.scopePath,
        fragmentId: problem.fragmentId,
        target: problem.cycle?.join(" -> "),
        message: `fragment dependency cycle in scope '${problem.scopePath}': ${problem.cycle?.join(" -> ")}`,
        repair:
          "Break the cycle in fragment.yaml `requires`; dependencies must form an acyclic graph before rendering.",
      });
      continue;
    }

    const target = `${problem.fragmentId} -> ${problem.dependencyId}`;
    if (problem.kind === "missing") {
      issues.push({
        severity: "error",
        code: "fragment-dependency-missing",
        scopePath: problem.scopePath,
        fragmentId: problem.fragmentId,
        target,
        message:
          `fragment '${problem.fragmentId}' in scope '${problem.scopePath}' ` +
          `requires missing fragment '${problem.dependencyId}'`,
        repair:
          "Run `anamnesis update --dry-run` to inspect the dependency addition, then `anamnesis update --apply` to add the required fragment to Agentfile.",
      });
    } else {
      const pinned = problem.kind === "pinned-version-unsatisfied"
        ? " pinned"
        : "";
      issues.push({
        severity: "error",
        code: "fragment-dependency-version-unsatisfied",
        scopePath: problem.scopePath,
        fragmentId: problem.fragmentId,
        target,
        message:
          `fragment '${problem.fragmentId}' in scope '${problem.scopePath}' ` +
          `requires '${problem.dependencyId}' >=${problem.requiredMinVersion}, ` +
          `but${pinned} installed version is ${problem.installedVersion}`,
        repair:
          problem.kind === "pinned-version-unsatisfied"
            ? "Unpin the dependency fragment or re-run update with `--bump-pinned` after reviewing the version change."
            : "Run `anamnesis update --apply` to bump the dependency fragment to a compatible library version.",
      });
    }
  }
}

function addContinuityIssues(
  checks: ContinuityCheck[],
  issues: DoctorIssue[],
): void {
  for (const check of checks) {
    if (check.status === "pass") continue;
    const code = continuityIssueCode(check);
    issues.push({
      severity: "warning",
      code,
      target: check.targets.join(", ") || undefined,
      message: `${check.label} continuity check failed: ${check.detail}`,
      repair: continuityRepair(check),
    });
  }
}

function addOntologyGapIssues(
  gaps: StatusResult["ontology"]["gaps"],
  issues: DoctorIssue[],
): void {
  for (const gap of gaps) {
    if (gap.severity !== "warning") continue;
    issues.push({
      severity: "warning",
      code: ontologyGapIssueCode(gap.kind),
      scopePath: gap.scopePath,
      fragmentId: gap.fragmentId,
      target: gap.target,
      message: gap.detail,
      repair: gap.next,
    });
  }
}

function addDeclinedIssues(
  declined: StatusResult["declined"],
  issues: DoctorIssue[],
): void {
  for (const entry of declined) {
    if (entry.matched) continue;
    issues.push({
      severity: "warning",
      code: "declined-rule-stale",
      target: `Agentfile declined:${entry.id}`,
      message: `declined fragment '${entry.id}' no longer matches the current rulebook`,
      repair:
        "Remove this entry from Agentfile.declined if it was only suppressing an old rulebook match. Keep it if the project intentionally documents a permanent opt-out.",
    });
  }
}

function addContextDiagnosticIssues(
  diagnostics: readonly ContextDiagnosticIssue[],
  issues: DoctorIssue[],
): void {
  for (const diagnostic of diagnostics) {
    issues.push({
      severity: diagnostic.severity,
      code: diagnostic.code,
      target: `${diagnostic.source_path} ${diagnostic.stable_ref}`,
      message: diagnostic.message,
      repair: diagnostic.repair,
    });
  }
}

function ontologyGapIssueCode(
  kind: StatusResult["ontology"]["gaps"][number]["kind"],
): DoctorIssueCode {
  switch (kind) {
    case "static-missing":
      return "ontology-static-missing";
    case "bootstrap-missing":
      return "ontology-bootstrap-missing";
    case "bootstrap-stale":
      return "ontology-bootstrap-stale";
    case "enrichment-missing":
      return "ontology-enrichment-missing";
    case "introspector-unavailable":
    case "introspector-not-applicable":
      throw new Error(`non-warning ontology gap kind reached doctor: ${kind}`);
  }
}

function continuityRepair(check: ContinuityCheck): string {
  switch (check.id) {
    case "project-memory":
    case "handoff":
    case "adapter-surfaces":
    case "managed-drift":
      return "Run `anamnesis update --dry-run --allow-exec-adapters` to inspect the planned repair. If the output is acceptable, run `anamnesis update --apply --allow-exec-adapters`; user-modified managed files still require manual merge review.";
    case "ontology":
      return "Run `anamnesis ontology bootstrap --dry-run` to inspect generated ontology, then run without `--dry-run` when the bootstrap output should be written.";
    case "active-handoff":
      return "Open `.anamnesis/handoff/active.md`, remove completed or superseded open entries, and point each active task at an existing latest archive.";
  }
}

function continuityIssueCode(check: ContinuityCheck): DoctorIssueCode {
  switch (check.id) {
    case "project-memory":
      return "continuity-project-memory-missing";
    case "ontology":
      return "continuity-ontology-missing";
    case "handoff":
      return "continuity-handoff-missing";
    case "active-handoff":
      return "continuity-active-handoff-stale";
    case "adapter-surfaces":
      return "continuity-adapter-surface-missing";
    case "managed-drift":
      return "continuity-drift-detected";
  }
}

// ---------------------------------------------------------------------------
// Adapter / settings diagnostics
// ---------------------------------------------------------------------------

function addRenderPlanProblems(
  problems: readonly InstalledRenderPlanProblem[],
  issues: DoctorIssue[],
): void {
  for (const problem of problems) {
    issues.push({
      severity: "error",
      code: problem.code,
      scopePath: problem.scopePath,
      fragmentId: problem.fragmentId,
      target: problem.target,
      message: problem.message,
    });
  }
}

function addExecutableSecurityIssues(
  securityIssues: readonly ExecutableSecurityIssue[],
  issues: DoctorIssue[],
): void {
  for (const issue of securityIssues) {
    issues.push({
      severity: issue.severity,
      code: issue.code,
      fragmentId: issue.fragmentId,
      target: issue.target,
      message: issue.message,
      repair: issue.repair,
    });
  }
}

function addAgentConfigDamageIssues(
  damageIssues: readonly AgentConfigDamageIssue[],
  issues: DoctorIssue[],
): void {
  for (const issue of damageIssues) {
    issues.push({
      severity: issue.severity,
      code: issue.code,
      target: issue.target,
      message: issue.message,
      repair: issue.repair,
    });
  }
}

function addSettingsIssues(
  projectRoot: string,
  manifest: Manifest,
  actions: RenderAction[],
  issues: DoctorIssue[],
): void {
  const trackedFiles = new Set(manifest.files.map((f) => f.path));
  const expectedHooks: HookRegistration[] = [];

  for (const action of actions) {
    if (action.kind !== "file" || !action.settingsHook) continue;
    const installed =
      trackedFiles.has(action.path) ||
      fs.existsSync(path.join(projectRoot, action.path));
    if (!installed) continue;
    expectedHooks.push({
      event: action.settingsHook.event,
      matcher: action.settingsHook.matcher,
      command: action.path,
    });
  }

  if (expectedHooks.length === 0) return;

  let settings: Record<string, unknown>;
  try {
    settings = readSettings(projectRoot);
  } catch (e) {
    issues.push({
      severity: "error",
      code: "settings-invalid",
      target: ".claude/settings.json",
      message: `.claude/settings.json could not be parsed: ${(e as Error).message}`,
      repair:
        "Fix `.claude/settings.json` so it is valid JSON, then re-run `anamnesis update --apply --allow-exec-adapters` to restore hook registrations.",
    });
    return;
  }

  for (const reg of expectedHooks) {
    if (hookRegistrationPresent(settings, reg)) continue;
    const matcher = reg.matcher ? `:${reg.matcher}` : "";
    issues.push({
      severity: "error",
      code: "hook-registration-missing",
      target: ".claude/settings.json",
      message: `.claude/settings.json is missing ${reg.event}${matcher} registration for ${reg.command}`,
      repair:
        "Re-run `anamnesis update --apply --allow-exec-adapters` after reviewing any user-modified managed hook files. If the hook file itself is user-modified, merge or restore it first so update can safely register it.",
    });
  }
}

function addCodexHookIssues(
  projectRoot: string,
  manifest: Manifest,
  actions: RenderAction[],
  issues: DoctorIssue[],
): void {
  const trackedFiles = new Set(manifest.files.map((f) => f.path));
  const expectedHooks: CodexHookRegistration[] = [];

  for (const action of actions) {
    if (action.kind !== "file" || !action.codexHook) continue;
    const installed =
      trackedFiles.has(action.path) ||
      fs.existsSync(path.join(projectRoot, action.path));
    if (!installed) continue;
    expectedHooks.push(action.codexHook);
  }

  if (expectedHooks.length === 0) return;

  const configPath = path.join(projectRoot, CODEX_CONFIG_PATH);
  if (!fs.existsSync(configPath)) {
    issues.push({
      severity: "error",
      code: "codex-config-missing",
      target: CODEX_CONFIG_PATH,
      message: `${CODEX_CONFIG_PATH} is missing; Codex native hooks are not enabled for this project`,
      repair:
        "Re-run `anamnesis update --apply --allow-exec-adapters` to merge the Codex native hook feature flag.",
    });
  } else {
    try {
      const config = fs.readFileSync(configPath, "utf8");
      if (!codexHooksFeatureEnabled(config)) {
        issues.push({
          severity: "error",
          code: "codex-config-invalid",
          target: CODEX_CONFIG_PATH,
          message: `${CODEX_CONFIG_PATH} does not enable [features].hooks = true`,
          repair:
            "Re-run `anamnesis update --apply --allow-exec-adapters` to merge the Codex native hook feature flag.",
        });
      }
    } catch (e) {
      issues.push({
        severity: "error",
        code: "codex-config-invalid",
        target: CODEX_CONFIG_PATH,
        message: `${CODEX_CONFIG_PATH} could not be read: ${(e as Error).message}`,
      });
    }
  }

  const hooksPath = path.join(projectRoot, CODEX_HOOKS_PATH);
  if (!fs.existsSync(hooksPath)) {
    issues.push({
      severity: "error",
      code: "codex-hook-registration-missing",
      target: CODEX_HOOKS_PATH,
      message: `${CODEX_HOOKS_PATH} is missing Codex native hook registrations`,
      repair:
        "Re-run `anamnesis update --apply --allow-exec-adapters` to merge Codex native hook registrations while preserving user hooks.",
    });
    return;
  }

  let hooksContent = "";
  try {
    hooksContent = fs.readFileSync(hooksPath, "utf8");
    JSON.parse(hooksContent);
  } catch (e) {
    issues.push({
      severity: "error",
      code: "codex-hook-config-invalid",
      target: CODEX_HOOKS_PATH,
      message: `${CODEX_HOOKS_PATH} could not be parsed: ${(e as Error).message}`,
      repair:
        "Fix `.codex/hooks.json` so it is valid JSON, then re-run `anamnesis update --apply --allow-exec-adapters`.",
    });
    return;
  }

  for (const reg of expectedHooks) {
    if (codexHookRegistrationPresent(hooksContent, reg)) continue;
    const matcher = reg.matcher ? `:${reg.matcher}` : "";
    issues.push({
      severity: "error",
      code: "codex-hook-registration-missing",
      target: CODEX_HOOKS_PATH,
      message: `${CODEX_HOOKS_PATH} is missing ${reg.event}${matcher} registration for ${reg.command}`,
      repair:
        "Re-run `anamnesis update --apply --allow-exec-adapters` after reviewing any user-modified managed hook files.",
    });
  }

  addCodexHookOwnershipWarnings(projectRoot, hooksContent, issues);
}

function addCodexHookOwnershipWarnings(
  projectRoot: string,
  hooksContent: string,
  issues: DoctorIssue[],
): void {
  const ownership = analyzeCodexHookOwnership(hooksContent, { projectRoot });
  for (const warning of ownership.warnings) {
    issues.push({
      severity: "warning",
      code: "codex-hook-ownership-warning",
      target: CODEX_HOOKS_PATH,
      message: warning.detail,
      repair: codexHookOwnershipRepair(warning),
    });
  }
}

function codexHookOwnershipRepair(
  warning: CodexHookOwnershipWarning,
): string {
  switch (warning.kind) {
    case "duplicate-command":
      return "Remove the duplicate hook entry, or re-run `anamnesis update --apply --allow-exec-adapters` so managed anamnesis hook commands are refreshed without duplicating user hooks.";
    case "relative-managed-command":
      return "Re-run `anamnesis update --apply --allow-exec-adapters` to replace older relative anamnesis hook commands with Git-root-resolving wrappers.";
    case "stale-managed-command":
      return "Remove the stale Codex hook registration or re-run `anamnesis update --apply --allow-exec-adapters` to regenerate managed hook wrappers and registrations.";
    case "malformed-entry":
      return "Fix `.codex/hooks.json` so every event maps to matcher entries with a `hooks` array, then re-run `anamnesis doctor`.";
  }
}

function libraryFragmentMap(
  libraryRoot: string,
): Map<string, FragmentDefinition> {
  const fragments = loadAllFragments(libraryRoot);
  const base = loadBaseFragment(libraryRoot);
  if (base) fragments.set(base.id, base);
  return fragments;
}

function renderDoctorMarkdown(input: {
  generatedAt: string;
  projectName: string;
  ok: boolean;
  issues: readonly DoctorIssue[];
  summary: DoctorResult["summary"];
}): string {
  const issueRows =
    input.issues.length === 0
      ? ["| (none) | ok | installation integrity checks passed | |"]
      : input.issues.map(
          (issue) =>
            `| ${issue.severity} | ${issue.code} | ${escapeCell(issue.target ?? issue.scopePath ?? "")} | ${escapeCell(issue.message)} |`,
        );
  return [
    `## Doctor Check — ${input.generatedAt}`,
    "",
    `Project: ${input.projectName}`,
    `Status: ${input.ok ? "ok" : "issues"}`,
    `Issues: ${input.summary.errors} error(s), ${input.summary.warnings} warning(s), ${input.summary.info} info`,
    "",
    "| Severity | Code | Target | Message |",
    "|---|---|---|---|",
    ...issueRows,
  ].join("\n");
}

function doctorEvidenceRecord(input: {
  generatedAt: string;
  projectName: string;
  ok: boolean;
  issues: readonly DoctorIssue[];
  summary: DoctorResult["summary"];
  appendedPath: string;
}): RuntimeEvidenceRecord {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "doctor-check",
    generated_at: input.generatedAt,
    command: ["anamnesis", "doctor"],
    project: { name: input.projectName },
    summary: {
      ok: input.ok,
      errors: input.summary.errors,
      warnings: input.summary.warnings,
      info: input.summary.info,
    },
    details: {
      issues: input.issues.map((issue) => ({
        severity: issue.severity,
        code: issue.code,
        ...(issue.scopePath ? { scope_path: issue.scopePath } : {}),
        ...(issue.fragmentId ? { fragment_id: issue.fragmentId } : {}),
        ...(issue.target ? { target: issue.target } : {}),
        message: issue.message,
        ...(issue.repair ? { repair: issue.repair } : {}),
      })),
    },
    artifacts: {
      markdown: input.appendedPath,
    },
  };
}

function displayPathFromProject(projectRoot: string, targetPath: string): string {
  const rel = path.relative(projectRoot, targetPath).split(path.sep).join("/");
  if (rel === "") return ".";
  if (rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) {
    return targetPath;
  }
  return rel;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
