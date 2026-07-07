import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import {
  readAgentfile,
  writeAgentfile,
} from "../core/agentfile.js";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";
import { doctor } from "./doctor.js";
import { init } from "./init.js";
import { status } from "./status.js";
import { update, type UpdateResult } from "./update.js";
import { summarizePlannedChanges } from "./upgrade_plan.js";

export const UPGRADE_BENCHMARK_SCHEMA_VERSION =
  "anamnesis.upgrade_benchmark.v1";
export const UPGRADE_BENCHMARK_OUTPUT_DIR =
  "docs/benchmark-evidence/upgrade";

type UpgradeBenchmarkStatus = "pass" | "fail";

export interface UpgradeBenchmarkCheck {
  id: string;
  label: string;
  status: UpgradeBenchmarkStatus;
  detail: string;
}

export interface UpgradeBenchmarkRunMetrics {
  apply_create: number;
  apply_update: number;
  apply_noop: number;
  apply_blocked: number;
  apply_user_modified: number;
  post_create: number;
  post_update: number;
  post_blocked: number;
  post_user_modified: number;
  post_pending: number;
  doctor_errors: number;
  doctor_warnings: number;
  drift_modified: number;
  drift_missing: number;
  partial_adoptions: number;
  fragment_updates_available: number;
  fragment_library_missing: number;
  suggested_count: number;
}

export interface UpgradeBenchmarkRun {
  fixtureId: string;
  fixtureLabel: string;
  iteration: number;
  status: UpgradeBenchmarkStatus;
  durationMs: number;
  checks: UpgradeBenchmarkCheck[];
  metrics?: UpgradeBenchmarkRunMetrics;
  error?: string;
}

export interface UpgradeBenchmarkFixtureSummary {
  fixtureId: string;
  fixtureLabel: string;
  runs: number;
  passed: number;
  failed: number;
  passRatePct: number;
  durationMs: {
    average: number;
    min: number;
    max: number;
  };
  postPendingTotal: number;
  doctorErrorsTotal: number;
  driftTotal: number;
}

export interface UpgradeBenchmarkArtifacts {
  outputDir?: string;
  json?: string;
  markdown?: string;
  passRateSvg?: string;
  durationSvg?: string;
}

export interface UpgradeBenchmarkResult {
  schemaVersion: typeof UPGRADE_BENCHMARK_SCHEMA_VERSION;
  projectRoot: string;
  generatedAt: string;
  requestedRuns: number;
  ok: boolean;
  summary: {
    fixtures: number;
    runs: number;
    passed: number;
    failed: number;
    passRatePct: number;
    averageDurationMs: number;
    maxDurationMs: number;
    postPendingTotal: number;
    doctorErrorsTotal: number;
    driftTotal: number;
  };
  fixtures: UpgradeBenchmarkFixtureSummary[];
  runs: UpgradeBenchmarkRun[];
  artifacts: UpgradeBenchmarkArtifacts;
  markdown?: string;
  evidencePath?: string;
}

export interface UpgradeBenchmarkOptions {
  projectRoot: string;
  runs?: number;
  write?: boolean;
  append?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export class UpgradeBenchmarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpgradeBenchmarkError";
  }
}

interface UpgradeBenchmarkFixture {
  id: string;
  label: string;
  execute(ctx: UpgradeBenchmarkFixtureContext): FixtureExecutionResult;
}

interface UpgradeBenchmarkFixtureContext {
  tempRoot: string;
  now: () => Date;
}

interface FixtureExecutionResult {
  metrics: UpgradeBenchmarkRunMetrics;
  checks: UpgradeBenchmarkCheck[];
}

export function upgradeBenchmark(
  opts: UpgradeBenchmarkOptions,
): UpgradeBenchmarkResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const requestedRuns = opts.runs ?? 3;
  if (!Number.isInteger(requestedRuns) || requestedRuns < 1) {
    throw new UpgradeBenchmarkError("--runs requires a positive integer");
  }

  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const stableNow = () => new Date(generatedAt);
  const runs: UpgradeBenchmarkRun[] = [];
  for (const fixture of FIXTURES) {
    for (let iteration = 1; iteration <= requestedRuns; iteration += 1) {
      runs.push(runUpgradeBenchmarkFixture(fixture, iteration, stableNow));
    }
  }

  const fixtureSummaries = summarizeFixtures(runs);
  const summary = summarizeUpgradeBenchmark(runs);
  let result: UpgradeBenchmarkResult = {
    schemaVersion: UPGRADE_BENCHMARK_SCHEMA_VERSION,
    projectRoot,
    generatedAt,
    requestedRuns,
    ok: summary.failed === 0,
    summary,
    fixtures: fixtureSummaries,
    runs,
    artifacts: {},
  };
  const markdown = renderUpgradeBenchmarkMarkdown(result);
  result = { ...result, markdown };

  if (opts.write === true) {
    const artifacts = writeUpgradeBenchmarkArtifacts({
      projectRoot,
      outputPath: opts.outputPath,
      result,
    });
    result = { ...result, artifacts };
  }

  if (opts.append === true) {
    const evidencePath = appendEvidenceRecord(
      projectRoot,
      upgradeBenchmarkEvidenceRecord(result),
    );
    result = { ...result, evidencePath };
  }

  return result;
}

const FIXTURES: readonly UpgradeBenchmarkFixture[] = [
  {
    id: "clean-old-no-settings",
    label: "Clean old project without settings",
    execute: cleanOldNoSettingsFixture,
  },
  {
    id: "pinned-archive",
    label: "Pinned historical fragment archive",
    execute: pinnedArchiveFixture,
  },
  {
    id: "partial-adapter",
    label: "Partial adapter choice",
    execute: partialAdapterFixture,
  },
  {
    id: "stale-codex-hook",
    label: "Stale Codex hook refresh",
    execute: staleCodexHookFixture,
  },
  {
    id: "declined-suggestion",
    label: "Suggested-but-declined fragment",
    execute: declinedSuggestionFixture,
  },
];

function runUpgradeBenchmarkFixture(
  fixture: UpgradeBenchmarkFixture,
  iteration: number,
  now: () => Date,
): UpgradeBenchmarkRun {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "anamnesis-upgrade-benchmark-"),
  );
  const start = performance.now();
  try {
    const execution = fixture.execute({ tempRoot, now });
    const failed = execution.checks.filter((check) => check.status === "fail");
    return {
      fixtureId: fixture.id,
      fixtureLabel: fixture.label,
      iteration,
      status: failed.length > 0 ? "fail" : "pass",
      durationMs: roundMs(performance.now() - start),
      checks: execution.checks,
      metrics: execution.metrics,
    };
  } catch (e) {
    return {
      fixtureId: fixture.id,
      fixtureLabel: fixture.label,
      iteration,
      status: "fail",
      durationMs: roundMs(performance.now() - start),
      checks: [
        {
          id: "fixture-exception",
          label: "Fixture exception",
          status: "fail",
          detail: e instanceof Error ? e.message : String(e),
        },
      ],
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function cleanOldNoSettingsFixture(
  ctx: UpgradeBenchmarkFixtureContext,
): FixtureExecutionResult {
  const oldLibrary = writeBenchmarkLibrary(ctx.tempRoot, "old-library", {
    featureVersion: 1,
    featureContent: "## Feature\n\nv1 rules.\n",
  });
  const newLibrary = writeBenchmarkLibrary(ctx.tempRoot, "new-library", {
    featureVersion: 2,
    featureContent: "## Feature\n\nv2 rules.\n",
  });
  const project = installFeatureProject(ctx.tempRoot, oldLibrary, ctx.now);
  const agentfile = readAgentfile(project);
  writeAgentfile(project, { ...agentfile, settings: undefined });

  const applied = update({
    projectRoot: project,
    libraryRoot: newLibrary,
    apply: true,
    allowExecAdapters: true,
    now: ctx.now,
  });
  const metrics = collectUpgradeMetrics(project, newLibrary, applied, ctx.now);
  const postAgentfile = readAgentfile(project);
  const agentsText = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
  return {
    metrics,
    checks: [
      ...commonHealthChecks(metrics),
      check(
        "feature-bumped",
        "Feature fragment bumped",
        postAgentfile.fragments.find((fragment) => fragment.id === "feature")
          ?.version === 2,
        "feature fragment reached version 2",
      ),
      check(
        "new-content-rendered",
        "New content rendered",
        agentsText.includes("v2 rules"),
        "AGENTS.md contains v2 rules",
      ),
    ],
  };
}

function pinnedArchiveFixture(
  ctx: UpgradeBenchmarkFixtureContext,
): FixtureExecutionResult {
  const oldLibrary = writeBenchmarkLibrary(ctx.tempRoot, "old-library", {
    featureVersion: 1,
    featureContent: "## Feature\n\nv1 rules.\n",
  });
  const newLibrary = writeBenchmarkLibrary(ctx.tempRoot, "new-library", {
    featureVersion: 2,
    featureContent: "## Feature\n\nv2 current rules.\n",
  });
  addFeatureArchive(newLibrary, {
    version: 1,
    content: "## Feature\n\nv1 archived rules.\n",
  });
  const project = installFeatureProject(ctx.tempRoot, oldLibrary, ctx.now);
  const agentfile = readAgentfile(project);
  writeAgentfile(project, {
    ...agentfile,
    fragments: agentfile.fragments.map((fragment) =>
      fragment.id === "feature"
        ? { ...fragment, pinned: true }
        : fragment,
    ),
  });

  const applied = update({
    projectRoot: project,
    libraryRoot: newLibrary,
    apply: true,
    allowExecAdapters: true,
    now: ctx.now,
  });
  const metrics = collectUpgradeMetrics(project, newLibrary, applied, ctx.now);
  const postAgentfile = readAgentfile(project);
  const feature = postAgentfile.fragments.find((fragment) =>
    fragment.id === "feature"
  );
  const agentsText = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
  return {
    metrics,
    checks: [
      ...commonHealthChecks(metrics),
      check(
        "pinned-version-preserved",
        "Pinned version preserved",
        feature?.version === 1 && feature.pinned === true,
        "feature stayed pinned at version 1",
      ),
      check(
        "archive-rendered",
        "Archive content rendered",
        agentsText.includes("v1 archived rules") &&
          !agentsText.includes("v2 current rules"),
        "AGENTS.md uses archived content instead of current content",
      ),
    ],
  };
}

function partialAdapterFixture(
  ctx: UpgradeBenchmarkFixtureContext,
): FixtureExecutionResult {
  const oldLibrary = writeBenchmarkLibrary(ctx.tempRoot, "old-library", {
    featureVersion: 1,
    featureContent: "## Feature\n\nv1 rules.\n",
  });
  const newLibrary = writeBenchmarkLibrary(ctx.tempRoot, "new-library", {
    featureVersion: 2,
    featureContent: "## Feature\n\nv2 rules.\n",
    includeFeatureHook: true,
    featureHookAdapters: ["claude-code", "codex"],
  });
  const project = installFeatureProject(ctx.tempRoot, oldLibrary, ctx.now);
  const agentfile = readAgentfile(project);
  writeAgentfile(project, {
    ...agentfile,
    tools: ["claude-code", "codex"],
    fragments: agentfile.fragments.map((fragment) =>
      fragment.id === "feature"
        ? {
            ...fragment,
            adapters: { "claude-code": true, codex: false },
          }
        : fragment,
    ),
  });

  const applied = update({
    projectRoot: project,
    libraryRoot: newLibrary,
    apply: true,
    allowExecAdapters: true,
    now: ctx.now,
  });
  const metrics = collectUpgradeMetrics(project, newLibrary, applied, ctx.now);
  const postAgentfile = readAgentfile(project);
  const feature = postAgentfile.fragments.find((fragment) =>
    fragment.id === "feature"
  );
  return {
    metrics,
    checks: [
      ...commonHealthChecks(metrics),
      check(
        "claude-hook-installed",
        "Claude hook installed",
        fs.existsSync(path.join(project, ".claude/hooks/feature.sh")),
        ".claude hook exists",
      ),
      check(
        "codex-hook-skipped",
        "Codex hook skipped",
        !fs.existsSync(
          path.join(
            project,
            ".anamnesis/codex-native-hooks/feature-Stop-feature.mjs",
          ),
        ) && !fs.existsSync(path.join(project, ".codex/hooks.json")),
        "codex hook surfaces remain absent",
      ),
      check(
        "adapter-choice-preserved",
        "Adapter choice preserved",
        feature?.version === 2 && feature.adapters?.codex === false,
        "feature updated while keeping codex disabled for that fragment",
      ),
    ],
  };
}

function staleCodexHookFixture(
  ctx: UpgradeBenchmarkFixtureContext,
): FixtureExecutionResult {
  const oldLibrary = writeBenchmarkLibrary(ctx.tempRoot, "old-library", {
    featureVersion: 1,
    featureContent: "## Feature\n\nv1 rules.\n",
  });
  const newLibrary = writeBenchmarkLibrary(ctx.tempRoot, "new-library", {
    featureVersion: 2,
    featureContent: "## Feature\n\nv2 rules.\n",
    includeFeatureHook: true,
    featureHookAdapters: ["claude-code", "codex"],
  });
  const project = installFeatureProject(ctx.tempRoot, oldLibrary, ctx.now);
  const agentfile = readAgentfile(project);
  writeAgentfile(project, {
    ...agentfile,
    tools: ["claude-code", "codex"],
  });
  fs.mkdirSync(path.join(project, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".claude/settings.json"),
    JSON.stringify(
      {
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "./user-stop.sh" }] }],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.mkdirSync(path.join(project, ".codex"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".codex/config.toml"),
    "[features]\ncodex_hooks = true\nmodel_reasoning_effort = \"high\"\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(project, ".codex/hooks.json"),
    JSON.stringify(
      {
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: "node ./user-codex-hook.mjs" },
                {
                  type: "command",
                  command:
                    'node ".anamnesis/codex-native-hooks/feature-Stop-feature.mjs"',
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const applied = update({
    projectRoot: project,
    libraryRoot: newLibrary,
    apply: true,
    allowExecAdapters: true,
    now: ctx.now,
  });
  const metrics = collectUpgradeMetrics(project, newLibrary, applied, ctx.now);
  const codexHooks = fs.readFileSync(
    path.join(project, ".codex/hooks.json"),
    "utf8",
  );
  const codexConfig = fs.readFileSync(
    path.join(project, ".codex/config.toml"),
    "utf8",
  );
  const claudeSettings = fs.readFileSync(
    path.join(project, ".claude/settings.json"),
    "utf8",
  );
  return {
    metrics,
    checks: [
      ...commonHealthChecks(metrics),
      check(
        "codex-stale-registration-replaced",
        "Stale Codex registration replaced",
        codexHooks.includes("git rev-parse --show-toplevel") &&
          !codexHooks.includes(
            'node ".anamnesis/codex-native-hooks/feature-Stop-feature.mjs"',
          ),
        "relative managed Codex hook was replaced by git-root wrapper command",
      ),
      check(
        "user-hook-config-preserved",
        "User hook config preserved",
        codexHooks.includes("node ./user-codex-hook.mjs") &&
          claudeSettings.includes("./user-stop.sh"),
        "user Claude and Codex hook entries remain present",
      ),
      check(
        "codex-feature-flag-normalized",
        "Codex hook flag normalized",
        codexConfig.includes("hooks = true") &&
          !codexConfig.includes("codex_hooks"),
        "legacy codex_hooks flag was normalized to hooks = true",
      ),
    ],
  };
}

function declinedSuggestionFixture(
  ctx: UpgradeBenchmarkFixtureContext,
): FixtureExecutionResult {
  const library = writeBenchmarkLibrary(ctx.tempRoot, "library", {
    featureVersion: 1,
    featureContent: "## Feature\n\nv1 rules.\n",
  });
  const project = path.join(ctx.tempRoot, "declined-project");
  fs.mkdirSync(project, { recursive: true });
  init({
    projectRoot: project,
    libraryRoot: library,
    dryRun: false,
    allowExecAdapters: false,
    noBootstrap: true,
    noContextBootstrap: true,
    tools: ["claude-code"],
    projectName: "declined-project",
    now: ctx.now,
  });
  const agentfile = readAgentfile(project);
  writeAgentfile(project, {
    ...agentfile,
    declined: [
      {
        id: "feature",
        reason: "not part of this service",
        declined_at: "2026-06-01",
      },
    ],
  });
  fs.writeFileSync(path.join(project, "feature.flag"), "");

  const applied = update({
    projectRoot: project,
    libraryRoot: library,
    apply: true,
    allowExecAdapters: true,
    now: ctx.now,
  });
  const metrics = collectUpgradeMetrics(project, library, applied, ctx.now);
  const postAgentfile = readAgentfile(project);
  return {
    metrics,
    checks: [
      ...commonHealthChecks(metrics),
      check(
        "declined-fragment-not-installed",
        "Declined fragment not installed",
        !postAgentfile.fragments.some((fragment) => fragment.id === "feature"),
        "feature remains absent from Agentfile",
      ),
      check(
        "declined-suggestion-suppressed",
        "Declined suggestion suppressed",
        metrics.suggested_count === 0,
        "status reports no suggested feature fragment",
      ),
    ],
  };
}

function writeBenchmarkLibrary(
  tempRoot: string,
  name: string,
  opts: {
    featureVersion: number;
    featureContent: string;
    includeFeatureHook?: boolean;
    featureHookAdapters?: Array<"claude-code" | "codex">;
  },
): string {
  const library = path.join(tempRoot, name);
  const baseDir = path.join(library, "base");
  fs.mkdirSync(path.join(baseDir, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(baseDir, "fragment.yaml"),
    `id: base
version: 1
capabilities:
  - type: project_memory
    source: content/base.md
    region: anamnesis-base
`,
  );
  fs.writeFileSync(
    path.join(baseDir, "content", "base.md"),
    "## anamnesis baseline\n",
  );

  const featureDir = path.join(library, "fragments", "feature");
  fs.mkdirSync(path.join(featureDir, "content"), { recursive: true });
  if (opts.includeFeatureHook === true) {
    fs.mkdirSync(path.join(featureDir, "hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(featureDir, "hooks", "feature.sh"),
      "#!/usr/bin/env bash\nset -euo pipefail\necho feature hook\n",
    );
  }
  fs.writeFileSync(
    path.join(featureDir, "fragment.yaml"),
    `id: feature
version: ${opts.featureVersion}
capabilities:
  - type: project_memory
    source: content/feature.md
    region: feature
${opts.includeFeatureHook === true ? `  - type: executable_hook
    event: Stop
    source: hooks/feature.sh
    adapters_supported: [${(opts.featureHookAdapters ?? ["claude-code"]).join(", ")}]
` : ""}`,
  );
  fs.writeFileSync(
    path.join(featureDir, "content", "feature.md"),
    opts.featureContent,
  );
  fs.writeFileSync(
    path.join(library, "rulebook.md"),
    `## feature
- trigger: \`file_exists: feature.flag\`
- suggest: fragments/feature
- reason: upgrade benchmark fixture.
`,
  );
  return library;
}

function addFeatureArchive(
  library: string,
  opts: { version: number; content: string },
): void {
  const archiveDir = path.join(
    library,
    "fragments",
    "feature",
    ".versions",
    String(opts.version),
  );
  fs.mkdirSync(path.join(archiveDir, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(archiveDir, "fragment.yaml"),
    `id: feature
version: ${opts.version}
capabilities:
  - type: project_memory
    source: content/feature.md
    region: feature
`,
  );
  fs.writeFileSync(
    path.join(archiveDir, "content", "feature.md"),
    opts.content,
  );
}

function installFeatureProject(
  tempRoot: string,
  libraryRoot: string,
  now: () => Date,
): string {
  const project = path.join(tempRoot, "project");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "feature.flag"), "");
  init({
    projectRoot: project,
    libraryRoot,
    dryRun: false,
    allowExecAdapters: false,
    noBootstrap: true,
    noContextBootstrap: true,
    tools: ["claude-code"],
    projectName: "upgrade-benchmark-project",
    now,
  });
  return project;
}

function collectUpgradeMetrics(
  projectRoot: string,
  libraryRoot: string,
  applied: UpdateResult,
  now: () => Date,
): UpgradeBenchmarkRunMetrics {
  const applySummary = summarizePlannedChanges(applied.changes);
  const postDryRun = update({
    projectRoot,
    libraryRoot,
    apply: false,
    allowExecAdapters: true,
    now,
  });
  const postDryRunSummary = summarizePlannedChanges(postDryRun.changes);
  const postStatus = status({ projectRoot, libraryRoot, now });
  const postDoctor = doctor({ projectRoot, libraryRoot, now });
  return {
    apply_create: applySummary.create,
    apply_update: applySummary.update,
    apply_noop: applySummary.noop,
    apply_blocked: applySummary.blocked,
    apply_user_modified: applySummary.userModified,
    post_create: postDryRunSummary.create,
    post_update: postDryRunSummary.update,
    post_blocked: postDryRunSummary.blocked,
    post_user_modified: postDryRunSummary.userModified,
    post_pending:
      postDryRunSummary.create +
      postDryRunSummary.update +
      postDryRunSummary.blocked +
      postDryRunSummary.userModified,
    doctor_errors: postDoctor.summary.errors,
    doctor_warnings: postDoctor.summary.warnings,
    drift_modified: postStatus.summary.entriesUserModified,
    drift_missing: postStatus.summary.entriesMissing,
    partial_adoptions: postStatus.summary.partialAdoptions,
    fragment_updates_available: postStatus.summary.fragmentUpdatesAvailable,
    fragment_library_missing: postStatus.summary.fragmentLibraryMissing,
    suggested_count: postStatus.summary.suggestedCount,
  };
}

function commonHealthChecks(
  metrics: UpgradeBenchmarkRunMetrics,
): UpgradeBenchmarkCheck[] {
  return [
    check(
      "post-dry-run-clean",
      "Post-upgrade dry-run clean",
      metrics.post_pending === 0,
      `pending=${metrics.post_pending}`,
    ),
    check(
      "doctor-errors-clean",
      "Doctor errors clean",
      metrics.doctor_errors === 0,
      `doctor_errors=${metrics.doctor_errors}, doctor_warnings=${metrics.doctor_warnings}`,
    ),
    check(
      "manifest-drift-clean",
      "Manifest drift clean",
      metrics.drift_modified === 0 && metrics.drift_missing === 0,
      `modified=${metrics.drift_modified}, missing=${metrics.drift_missing}`,
    ),
    check(
      "partial-adoptions-clean",
      "Partial adoptions clean",
      metrics.partial_adoptions === 0,
      `partial_adoptions=${metrics.partial_adoptions}`,
    ),
    check(
      "fragment-library-clean",
      "Fragment library clean",
      metrics.fragment_updates_available === 0 &&
        metrics.fragment_library_missing === 0,
      `updates=${metrics.fragment_updates_available}, missing=${metrics.fragment_library_missing}`,
    ),
  ];
}

function check(
  id: string,
  label: string,
  pass: boolean,
  detail: string,
): UpgradeBenchmarkCheck {
  return {
    id,
    label,
    status: pass ? "pass" : "fail",
    detail,
  };
}

function summarizeFixtures(
  runs: readonly UpgradeBenchmarkRun[],
): UpgradeBenchmarkFixtureSummary[] {
  const ids = Array.from(new Set(runs.map((run) => run.fixtureId)));
  return ids.map((fixtureId) => {
    const fixtureRuns = runs.filter((run) => run.fixtureId === fixtureId);
    const durations = fixtureRuns.map((run) => run.durationMs);
    const passed = fixtureRuns.filter((run) => run.status === "pass").length;
    const failed = fixtureRuns.length - passed;
    return {
      fixtureId,
      fixtureLabel: fixtureRuns[0]?.fixtureLabel ?? fixtureId,
      runs: fixtureRuns.length,
      passed,
      failed,
      passRatePct: percent(passed, fixtureRuns.length),
      durationMs: {
        average: roundMs(average(durations)),
        min: roundMs(Math.min(...durations)),
        max: roundMs(Math.max(...durations)),
      },
      postPendingTotal: sumMetric(fixtureRuns, "post_pending"),
      doctorErrorsTotal: sumMetric(fixtureRuns, "doctor_errors"),
      driftTotal:
        sumMetric(fixtureRuns, "drift_modified") +
        sumMetric(fixtureRuns, "drift_missing"),
    };
  });
}

function summarizeUpgradeBenchmark(
  runs: readonly UpgradeBenchmarkRun[],
): UpgradeBenchmarkResult["summary"] {
  const passed = runs.filter((run) => run.status === "pass").length;
  const failed = runs.length - passed;
  const durations = runs.map((run) => run.durationMs);
  return {
    fixtures: new Set(runs.map((run) => run.fixtureId)).size,
    runs: runs.length,
    passed,
    failed,
    passRatePct: percent(passed, runs.length),
    averageDurationMs: roundMs(average(durations)),
    maxDurationMs: roundMs(Math.max(...durations)),
    postPendingTotal: sumMetric(runs, "post_pending"),
    doctorErrorsTotal: sumMetric(runs, "doctor_errors"),
    driftTotal:
      sumMetric(runs, "drift_modified") + sumMetric(runs, "drift_missing"),
  };
}

function sumMetric(
  runs: readonly UpgradeBenchmarkRun[],
  key: keyof UpgradeBenchmarkRunMetrics,
): number {
  return runs.reduce((sum, run) => sum + (run.metrics?.[key] ?? 0), 0);
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percent(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 10000) / 100;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function renderUpgradeBenchmarkMarkdown(
  result: UpgradeBenchmarkResult,
): string {
  const lines = [
    "# Upgrade Benchmark Evidence",
    "",
    `Generated: ${result.generatedAt}`,
    "",
    "Deterministic, public-safe benchmark for existing-project upgrade behavior. It runs sanitized fixtures through init/update/status/doctor paths and records numeric pass/fail dimensions separately from convenience summaries.",
    "",
    "Summary:",
    `- fixtures: ${result.summary.fixtures}`,
    `- runs: ${result.summary.runs}`,
    `- pass rate: ${result.summary.passRatePct}%`,
    `- failures: ${result.summary.failed}`,
    `- post-upgrade pending writes: ${result.summary.postPendingTotal}`,
    `- doctor errors: ${result.summary.doctorErrorsTotal}`,
    `- manifest drift count: ${result.summary.driftTotal}`,
    "",
    "| Fixture | Runs | Pass rate | Avg ms | Max ms | Pending | Doctor errors | Drift |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const fixture of result.fixtures) {
    lines.push(
      `| ${fixture.fixtureLabel} | ${fixture.runs} | ${fixture.passRatePct}% | ${fixture.durationMs.average} | ${fixture.durationMs.max} | ${fixture.postPendingTotal} | ${fixture.doctorErrorsTotal} | ${fixture.driftTotal} |`,
    );
  }
  lines.push(
    "",
    "Claim boundary:",
    "- This benchmark proves deterministic CLI upgrade behavior for sanitized fixtures only.",
    "- It does not prove real private-project compatibility or package registry publishing health.",
    "- Stronger compatibility claims require keeping this matrix green and adding fixtures when published project shapes change.",
    "",
  );
  return lines.join("\n");
}

function writeUpgradeBenchmarkArtifacts(input: {
  projectRoot: string;
  outputPath?: string;
  result: UpgradeBenchmarkResult;
}): UpgradeBenchmarkArtifacts {
  const outputDir = input.outputPath ?? UPGRADE_BENCHMARK_OUTPUT_DIR;
  const absOutputDir = path.isAbsolute(outputDir)
    ? outputDir
    : path.join(input.projectRoot, outputDir);
  fs.mkdirSync(absOutputDir, { recursive: true });

  const artifacts: UpgradeBenchmarkArtifacts = {
    outputDir,
    json: path.posix.join(outputDir, "upgrade-benchmark.json"),
    markdown: path.posix.join(outputDir, "upgrade-benchmark.md"),
    passRateSvg: path.posix.join(outputDir, "upgrade-pass-rate.svg"),
    durationSvg: path.posix.join(outputDir, "upgrade-duration.svg"),
  };
  const jsonResult = {
    ...input.result,
    projectRoot: ".",
    artifacts,
  };
  fs.writeFileSync(
    path.join(absOutputDir, "upgrade-benchmark.json"),
    `${JSON.stringify(jsonResult, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(absOutputDir, "upgrade-benchmark.md"),
    input.result.markdown ?? renderUpgradeBenchmarkMarkdown(input.result),
    "utf8",
  );
  fs.writeFileSync(
    path.join(absOutputDir, "upgrade-pass-rate.svg"),
    renderBarSvg({
      title: "Upgrade benchmark pass rate",
      unit: "%",
      maxValue: 100,
      bars: input.result.fixtures.map((fixture) => ({
        id: fixture.fixtureId,
        label: fixture.fixtureLabel,
        value: fixture.passRatePct,
      })),
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(absOutputDir, "upgrade-duration.svg"),
    renderBarSvg({
      title: "Upgrade benchmark average duration",
      unit: "ms",
      bars: input.result.fixtures.map((fixture) => ({
        id: fixture.fixtureId,
        label: fixture.fixtureLabel,
        value: fixture.durationMs.average,
      })),
    }),
    "utf8",
  );
  return artifacts;
}

function upgradeBenchmarkEvidenceRecord(
  result: UpgradeBenchmarkResult,
): RuntimeEvidenceRecord {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "upgrade-benchmark",
    generated_at: result.generatedAt,
    command: ["anamnesis", "benchmark", "upgrade"],
    project: { name: path.basename(result.projectRoot) },
    summary: {
      schema_version: UPGRADE_BENCHMARK_SCHEMA_VERSION,
      fixtures: result.summary.fixtures,
      runs: result.summary.runs,
      passed: result.summary.passed,
      failed: result.summary.failed,
      pass_rate_pct: result.summary.passRatePct,
      average_duration_ms: result.summary.averageDurationMs,
      max_duration_ms: result.summary.maxDurationMs,
      post_pending_total: result.summary.postPendingTotal,
      doctor_errors_total: result.summary.doctorErrorsTotal,
      drift_total: result.summary.driftTotal,
    },
    details: {
      fixtures: result.fixtures.map((fixture) => ({
        id: fixture.fixtureId,
        runs: fixture.runs,
        pass_rate_pct: fixture.passRatePct,
        failed: fixture.failed,
        post_pending_total: fixture.postPendingTotal,
        doctor_errors_total: fixture.doctorErrorsTotal,
        drift_total: fixture.driftTotal,
      })),
    },
    ...(Object.keys(result.artifacts).length > 0
      ? { artifacts: result.artifacts as Record<string, string> }
      : {}),
  };
}

function renderBarSvg(input: {
  title: string;
  unit: string;
  bars: Array<{ id: string; label: string; value: number }>;
  maxValue?: number;
}): string {
  const width = 920;
  const rowHeight = 44;
  const margin = { top: 58, right: 48, bottom: 40, left: 270 };
  const height = margin.top + margin.bottom + input.bars.length * rowHeight;
  const chartWidth = width - margin.left - margin.right;
  const maxValue = input.maxValue ?? Math.max(...input.bars.map((bar) => bar.value), 1);
  const rows = input.bars.map((bar, index) => {
    const y = margin.top + index * rowHeight;
    const barWidth = maxValue === 0 ? 0 : (bar.value / maxValue) * chartWidth;
    return [
      `<text x="${margin.left - 14}" y="${y + 25}" text-anchor="end" font-size="12" fill="#374151">${escapeXml(bar.label)}</text>`,
      `<rect x="${margin.left}" y="${y + 8}" width="${barWidth.toFixed(1)}" height="22" fill="#2563eb"><title>${escapeXml(bar.id)}: ${bar.value}${input.unit}</title></rect>`,
      `<text x="${(margin.left + barWidth + 8).toFixed(1)}" y="${y + 24}" font-size="12" fill="#111827">${bar.value}${input.unit}</text>`,
    ].join("\n");
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${escapeXml(input.title)}</title>`,
    `<desc id="desc">Bar chart for ${escapeXml(input.title)}.</desc>`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="24" y="34" font-size="20" font-weight="700" fill="#111827">${escapeXml(input.title)}</text>`,
    `<line x1="${margin.left}" y1="${margin.top - 8}" x2="${margin.left}" y2="${height - margin.bottom + 4}" stroke="#d1d5db"/>`,
    rows.join("\n"),
    "</svg>",
    "",
  ].join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
