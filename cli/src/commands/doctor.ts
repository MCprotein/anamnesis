// `anamnesis doctor` — read-only installation integrity diagnostics.
//
// This command is stricter than `status`: it turns drift and broken wiring
// into actionable issues, but never edits the project.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  findAgentfile,
  fragmentAdapterEnabled,
  readAgentfile,
  type Fragment,
  type ToolName,
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
  loadFragment,
  archivedFragmentDirOf,
  fragmentDirOf,
  type Capability,
  type FragmentDefinition,
} from "../core/fragments.js";
import { effectiveScopes } from "../core/scope.js";
import {
  RendererRegistry,
  type RenderAction,
  type RenderContext,
} from "../core/render.js";
import { registerClaudeCode } from "../adapters/claude-code/index.js";
import { registerCodex } from "../adapters/codex/index.js";
import { registerCursor } from "../adapters/cursor/index.js";
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
import { status, type ContinuityCheck, type StatusResult } from "./status.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DoctorSeverity = "error" | "warning";

export type DoctorIssueCode =
  | "manifest-missing"
  | "manifest-invalid"
  | "fragment-library-missing"
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
  | "ontology-enrichment-missing";

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
    const st = status({ projectRoot, libraryRoot });
    addStatusIssues(st.entries, st.fragments, issues);
    addContinuityIssues(st.continuity.checks, issues);
    addOntologyGapIssues(st.ontology.gaps, issues);
    addDeclinedIssues(st.declined, issues);
  }

  const library = libraryFragmentMap(libraryRoot);
  const renderActions = addAdapterIssuesAndCollectActions({
    projectRoot,
    libraryRoot,
    library,
    issues,
    scopes: effectiveScopes(agentfile),
  });
  addSettingsIssues(projectRoot, manifest, renderActions, issues);
  addCodexHookIssues(projectRoot, manifest, renderActions, issues);

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  const summary = { errors, warnings };
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

interface ResolvedFragment {
  entry: Fragment;
  fragment: FragmentDefinition;
  fragmentDir: string;
}

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

function addAdapterIssuesAndCollectActions(opts: {
  projectRoot: string;
  libraryRoot: string;
  library: Map<string, FragmentDefinition>;
  issues: DoctorIssue[];
  scopes: Array<{
    path: string;
    tools: ToolName[];
    fragments: Fragment[];
  }>;
}): RenderAction[] {
  const registry = buildRendererRegistry();
  const actions: RenderAction[] = [];

  for (const scope of opts.scopes) {
    for (const installed of scope.fragments) {
      const resolved = resolveInstalledFragmentForDoctor({
        entry: installed,
        libraryRoot: opts.libraryRoot,
        library: opts.library,
        issues: opts.issues,
        scopePath: scope.path,
      });
      if (!resolved) continue;
      const { entry, fragment, fragmentDir } = resolved;
      const ctx: RenderContext = {
        fragment,
        fragmentDir,
        projectRoot: opts.projectRoot,
        scopePath: scope.path,
        settings: DEFAULT_SETTINGS,
        params: {},
      };

      for (const tool of scope.tools) {
        if (!fragmentAdapterEnabled(entry, tool)) continue;
        for (const cap of fragment.capabilities) {
          if (!capabilitySupportsTool(cap, tool)) continue;
          if (!registry.get(tool, cap.type)) {
            opts.issues.push({
              severity: "error",
              code: "adapter-renderer-missing",
              scopePath: scope.path,
              fragmentId: fragment.id,
              message: `no renderer for ${tool}:${cap.type} required by fragment '${fragment.id}'`,
            });
          }
        }

        try {
          actions.push(...registry.planFragment(ctx, tool));
        } catch (e) {
          opts.issues.push({
            severity: "error",
            code: "render-plan-failed",
            scopePath: scope.path,
            fragmentId: fragment.id,
            message: `failed to plan ${tool} output for fragment '${fragment.id}': ${(e as Error).message}`,
          });
        }
      }
    }
  }

  return dedupeActions(actions);
}

function resolveInstalledFragmentForDoctor(opts: {
  entry: Fragment;
  libraryRoot: string;
  library: Map<string, FragmentDefinition>;
  issues: DoctorIssue[];
  scopePath: string;
}): ResolvedFragment | undefined {
  const currentDir = fragmentDirOf(opts.libraryRoot, opts.entry.id);
  const current = opts.library.get(opts.entry.id);

  if (opts.entry.pinned !== true) {
    return current
      ? { entry: opts.entry, fragment: current, fragmentDir: currentDir }
      : undefined;
  }

  if (current?.version === opts.entry.version) {
    return { entry: opts.entry, fragment: current, fragmentDir: currentDir };
  }

  const archivedDir = archivedFragmentDirOf(
    opts.libraryRoot,
    opts.entry.id,
    opts.entry.version,
  );
  const archivedPath = path.join(archivedDir, "fragment.yaml");
  if (!fs.existsSync(archivedPath)) {
    opts.issues.push({
      severity: "error",
      code: "fragment-library-missing",
      scopePath: opts.scopePath,
      fragmentId: opts.entry.id,
      target: archivedPath,
      message: `pinned fragment '${opts.entry.id}@${opts.entry.version}' is missing from the version archive`,
    });
    return undefined;
  }

  try {
    const fragment = loadFragment(archivedDir, { expectedId: opts.entry.id });
    if (fragment.version !== opts.entry.version) {
      opts.issues.push({
        severity: "error",
        code: "fragment-library-missing",
        scopePath: opts.scopePath,
        fragmentId: opts.entry.id,
        target: archivedPath,
        message: `pinned fragment '${opts.entry.id}@${opts.entry.version}' archive declares version ${fragment.version}`,
      });
      return undefined;
    }
    return { entry: opts.entry, fragment, fragmentDir: archivedDir };
  } catch (e) {
    opts.issues.push({
      severity: "error",
      code: "fragment-library-missing",
      scopePath: opts.scopePath,
      fragmentId: opts.entry.id,
      target: archivedPath,
      message: `pinned fragment '${opts.entry.id}@${opts.entry.version}' archive could not be loaded: ${(e as Error).message}`,
    });
    return undefined;
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
          message: `${CODEX_CONFIG_PATH} does not enable [features].codex_hooks = true`,
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

  addCodexHookOwnershipWarnings(hooksContent, issues);
}

function addCodexHookOwnershipWarnings(
  hooksContent: string,
  issues: DoctorIssue[],
): void {
  const ownership = analyzeCodexHookOwnership(hooksContent);
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
    case "malformed-entry":
      return "Fix `.codex/hooks.json` so every event maps to matcher entries with a `hooks` array, then re-run `anamnesis doctor`.";
  }
}

function capabilitySupportsTool(cap: Capability, tool: ToolName): boolean {
  if (
    "adapters_supported" in cap &&
    cap.adapters_supported !== undefined &&
    !cap.adapters_supported.includes(tool)
  ) {
    return false;
  }
  return true;
}

function buildRendererRegistry(): RendererRegistry {
  const registry = new RendererRegistry();
  registerClaudeCode(registry);
  registerCodex(registry);
  registerCursor(registry);
  return registry;
}

function libraryFragmentMap(
  libraryRoot: string,
): Map<string, FragmentDefinition> {
  const fragments = loadAllFragments(libraryRoot);
  const base = loadBaseFragment(libraryRoot);
  if (base) fragments.set(base.id, base);
  return fragments;
}

function dedupeActions(actions: RenderAction[]): RenderAction[] {
  const seen = new Set<string>();
  const out: RenderAction[] = [];
  for (const action of actions) {
    const key =
      action.kind === "region"
        ? `region|${action.file}|${action.regionId}`
        : `file|${action.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
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
    `Issues: ${input.summary.errors} error(s), ${input.summary.warnings} warning(s)`,
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

const DEFAULT_SETTINGS = {
  ontology_file: "system_graph.yaml",
  agents_md_path: "AGENTS.md",
  claude_md_path: "CLAUDE.md",
};
