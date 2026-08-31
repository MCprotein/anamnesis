// `anamnesis release check` — read-only release readiness gate.
//
// This command composes existing diagnostics instead of inventing a parallel
// health model: status owns drift/continuity, update owns render dry-runs, and
// doctor owns strict wiring/integrity issues.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readAgentfile,
  writeAgentfile,
} from "../core/agentfile.js";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceKindSummary,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";
import type { CodexHookTrustInspection } from "../core/codex_hook_trust.js";
import { doctor, type DoctorIssue, type DoctorResult } from "./doctor.js";
import { init } from "./init.js";
import { status, type StatusResult } from "./status.js";
import { update } from "./update.js";
import {
  summarizePlannedChanges,
  type ChangeSummary,
} from "./upgrade_plan.js";

export type ReleaseCheckStatus = "pass" | "warn" | "fail" | "skip";

export interface ReleaseCheckItem {
  id: string;
  label: string;
  status: ReleaseCheckStatus;
  detail: string;
  next?: string;
}

export interface ReleaseCheckResult {
  projectRoot: string;
  libraryRoot: string;
  generatedAt: string;
  projectName: string;
  ok: boolean;
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
    skip: number;
  };
  statusSummary: StatusResult["summary"];
  updateSummary: ChangeSummary;
  doctorSummary: DoctorResult["summary"];
  checks: ReleaseCheckItem[];
  evidencePath?: string;
}

export interface ReleaseCheckOptions {
  projectRoot: string;
  libraryRoot: string;
  append?: boolean;
  now?: () => Date;
  codexHookTrust?: CodexHookTrustInspection;
}

const HOOK_DOCTOR_CODES = new Set<string>([
  "settings-invalid",
  "codex-config-missing",
  "codex-config-invalid",
  "codex-hook-config-invalid",
  "hook-registration-missing",
  "codex-hook-registration-missing",
  "codex-hook-ownership-warning",
  "codex-hook-trust-unavailable",
  "codex-hook-untrusted",
  "codex-hook-modified",
  "codex-hook-runtime-source-mismatch",
]);

export function releaseCheck(opts: ReleaseCheckOptions): ReleaseCheckResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const libraryRoot = path.resolve(opts.libraryRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const stableNow = () => new Date(generatedAt);

  const st = status({
    projectRoot,
    libraryRoot,
    now: stableNow,
    codexHookTrust: opts.codexHookTrust,
  });
  const dryRun = update({
    projectRoot,
    libraryRoot,
    apply: false,
    allowExecAdapters: true,
    now: stableNow,
  });
  const health = doctor({
    projectRoot,
    libraryRoot,
    now: stableNow,
    codexHookTrust: opts.codexHookTrust,
  });
  const updateSummary = summarizePlannedChanges(dryRun.changes);
  const checks = releaseChecks({
    generatedAt,
    libraryRoot,
    status: st,
    updateSummary,
    doctor: health,
  });
  const summary = summarizeChecks(checks);
  const ok = summary.fail === 0;

  let evidencePath: string | undefined;
  if (opts.append === true) {
    evidencePath = appendEvidenceRecord(
      projectRoot,
      releaseCheckEvidenceRecord({
        generatedAt,
        projectName: st.agentfile.project.name,
        ok,
        summary,
        statusSummary: st.summary,
        updateSummary,
        doctorSummary: health.summary,
        checks,
      }),
    );
  }

  return {
    projectRoot,
    libraryRoot,
    generatedAt,
    projectName: st.agentfile.project.name,
    ok,
    summary,
    statusSummary: st.summary,
    updateSummary,
    doctorSummary: health.summary,
    checks,
    ...(evidencePath ? { evidencePath } : {}),
  };
}

function releaseChecks(input: {
  generatedAt: string;
  libraryRoot: string;
  status: StatusResult;
  updateSummary: ChangeSummary;
  doctor: DoctorResult;
}): ReleaseCheckItem[] {
  return [
    doctorCleanCheck(input.doctor),
    continuityCheck(input.status),
    fragmentSyncCheck(input.status),
    updateDryRunCheck(input.updateSummary),
    manifestDriftCheck(input.status),
    hookRegistrationCheck(input.status, input.doctor.issues),
    runtimeEvidenceCheck(input.status),
    updateApplyEvidenceCheck(input.status),
    sanitizedUpgradeSmokeCheck({
      generatedAt: input.generatedAt,
      libraryRoot: input.libraryRoot,
    }),
  ];
}

function doctorCleanCheck(doctorResult: DoctorResult): ReleaseCheckItem {
  if (doctorResult.summary.errors > 0) {
    return {
      id: "doctor-clean",
      label: "Doctor clean",
      status: "fail",
      detail:
        `doctor reports ${doctorResult.summary.errors} error(s) and ` +
        `${doctorResult.summary.warnings} warning(s)`,
      next: "Run `anamnesis doctor` and repair every error before release.",
    };
  }
  if (doctorResult.summary.warnings > 0) {
    return {
      id: "doctor-clean",
      label: "Doctor clean",
      status: "warn",
      detail: `doctor reports ${doctorResult.summary.warnings} warning(s)`,
      next: "Review `anamnesis doctor`; release only if each warning is intentional.",
    };
  }
  return {
    id: "doctor-clean",
    label: "Doctor clean",
    status: "pass",
    detail: "doctor reports zero errors and zero warnings",
  };
}

function continuityCheck(st: StatusResult): ReleaseCheckItem {
  return {
    id: "continuity-ready",
    label: "Continuity ready",
    status: st.continuity.ready ? "pass" : "fail",
    detail:
      `status continuity ${st.continuity.passed}/${st.continuity.total}`,
    ...(st.continuity.ready
      ? {}
      : {
          next: "Run `anamnesis status` and repair failing continuity checks.",
        }),
  };
}

function fragmentSyncCheck(st: StatusResult): ReleaseCheckItem {
  const summary = st.summary;
  const blocking =
    summary.fragmentUpdatesAvailable +
    summary.fragmentLibraryMissing +
    summary.partialAdoptions;
  if (blocking > 0) {
    return {
      id: "fragment-sync",
      label: "Fragment sync",
      status: "fail",
      detail:
        `updates=${summary.fragmentUpdatesAvailable}, ` +
        `missing=${summary.fragmentLibraryMissing}, ` +
        `partial=${summary.partialAdoptions}`,
      next: "Run `anamnesis apply --dry-run --allow-exec-adapters`, then apply or repair the listed fragments.",
    };
  }
  const advisory =
    summary.fragmentPinned + summary.suggestedCount + summary.declinedStaleCount;
  if (advisory > 0) {
    return {
      id: "fragment-sync",
      label: "Fragment sync",
      status: "warn",
      detail:
        `pinned=${summary.fragmentPinned}, suggested=${summary.suggestedCount}, ` +
        `stale-declined=${summary.declinedStaleCount}`,
      next: "Confirm pinned fragments and rulebook suggestions are intentional before release.",
    };
  }
  return {
    id: "fragment-sync",
    label: "Fragment sync",
    status: "pass",
    detail: `${summary.fragmentTotal} fragment(s) in sync`,
  };
}

function updateDryRunCheck(summary: ChangeSummary): ReleaseCheckItem {
  const pending =
    summary.create + summary.update + summary.blocked + summary.userModified;
  if (pending > 0) {
    return {
      id: "update-dry-run-clean",
      label: "Update dry-run clean",
      status: "fail",
      detail:
        `create=${summary.create}, update=${summary.update}, ` +
        `blocked=${summary.blocked}, user-modified=${summary.userModified}`,
      next: "Run `anamnesis apply --allow-exec-adapters` or resolve preserved surfaces before release.",
    };
  }
  return {
    id: "update-dry-run-clean",
    label: "Update dry-run clean",
    status: "pass",
    detail: `${summary.noop} managed surface(s) are no-op`,
  };
}

function manifestDriftCheck(st: StatusResult): ReleaseCheckItem {
  const modified = st.summary.entriesUserModified;
  const missing = st.summary.entriesMissing;
  if (modified > 0 || missing > 0) {
    return {
      id: "manifest-drift",
      label: "Manifest drift",
      status: "fail",
      detail:
        `${st.summary.entriesClean} clean, ${modified} modified, ${missing} missing`,
      next: "Run `anamnesis status` and repair or intentionally preserve every drifted managed surface.",
    };
  }
  return {
    id: "manifest-drift",
    label: "Manifest drift",
    status: "pass",
    detail: `${st.summary.entriesClean} tracked managed surface(s) are clean`,
  };
}

function hookRegistrationCheck(
  st: StatusResult,
  issues: readonly DoctorIssue[],
): ReleaseCheckItem {
  const hookIssues = issues.filter((issue) =>
    HOOK_DOCTOR_CODES.has(issue.code),
  );
  const codex = st.codexHooks.summary;
  const blocking =
    hookIssues.filter((issue) => issue.severity === "error").length +
    codex.invalid +
    codex.duplicates;
  if (blocking > 0) {
    return {
      id: "hook-registration",
      label: "Hook registration",
      status: "fail",
      detail:
        `doctor hook issues=${hookIssues.length}, codex invalid=${codex.invalid}, ` +
        `duplicates=${codex.duplicates}`,
      next: "Repair hook config or rerun `anamnesis apply --allow-exec-adapters`.",
    };
  }
  if (hookIssues.length > 0 || codex.warnings > 0) {
    return {
      id: "hook-registration",
      label: "Hook registration",
      status: "warn",
      detail:
        `doctor hook issues=${hookIssues.length}, codex warnings=${codex.warnings}`,
      next: "Review hook ownership warnings before release.",
    };
  }
  return {
    id: "hook-registration",
    label: "Hook registration",
    status: "pass",
    detail:
      `codex hooks ${codex.anamnesis}/${codex.total} managed, zero invalid or duplicate registrations`,
  };
}

function runtimeEvidenceCheck(st: StatusResult): ReleaseCheckItem {
  const evidence = st.evidence;
  if (evidence.invalid > 0) {
    return {
      id: "runtime-evidence",
      label: "Runtime evidence",
      status: "fail",
      detail:
        `${evidence.invalid} invalid runtime evidence record(s) in ${evidence.path}`,
      next: "Fix or prune invalid JSONL records before release.",
    };
  }
  if (evidence.total === 0) {
    return {
      id: "runtime-evidence",
      label: "Runtime evidence",
      status: "warn",
      detail: "no runtime evidence records found",
      next: "Run append-style checks such as `anamnesis dogfood check --append` before release.",
    };
  }
  if (evidence.latest_stale === true) {
    return {
      id: "runtime-evidence",
      label: "Runtime evidence",
      status: "warn",
      detail: `latest runtime evidence is stale in ${evidence.path}`,
      next: "Refresh release evidence before publishing.",
    };
  }
  return {
    id: "runtime-evidence",
    label: "Runtime evidence",
    status: "pass",
    detail: `${evidence.total} valid record(s), latest evidence is fresh`,
  };
}

function updateApplyEvidenceCheck(st: StatusResult): ReleaseCheckItem {
  const updateEvidence = evidenceKind(st, "update-apply");
  if (!updateEvidence) {
    return {
      id: "update-apply-evidence",
      label: "Update apply evidence",
      status: "warn",
      detail: "no update-apply evidence record found",
      next: "Run `anamnesis apply --allow-exec-adapters` after project-managed surfaces are current.",
    };
  }
  if (updateEvidence.stale) {
    return {
      id: "update-apply-evidence",
      label: "Update apply evidence",
      status: "warn",
      detail: "latest update-apply evidence is stale",
      next: "Refresh update evidence before release.",
    };
  }
  return {
    id: "update-apply-evidence",
    label: "Update apply evidence",
    status: "pass",
    detail: `${updateEvidence.total} update-apply evidence record(s), latest is fresh`,
  };
}

function sanitizedUpgradeSmokeCheck(input: {
  generatedAt: string;
  libraryRoot: string;
}): ReleaseCheckItem {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "anamnesis-release-upgrade-smoke-"),
  );
  const stableNow = () => new Date(input.generatedAt);

  try {
    const oldLibraryRoot = path.join(tempRoot, "old-library");
    const projectRoot = path.join(tempRoot, "old-project");
    fs.mkdirSync(projectRoot, { recursive: true });
    writeSanitizedOldLibrary(oldLibraryRoot);

    init({
      projectRoot,
      libraryRoot: oldLibraryRoot,
      dryRun: false,
      allowExecAdapters: false,
      noBootstrap: true,
      noContextBootstrap: true,
      tools: ["claude-code"],
      projectName: "release-upgrade-smoke",
      now: stableNow,
    });
    const oldAgentfile = readAgentfile(projectRoot);
    writeAgentfile(projectRoot, {
      ...oldAgentfile,
      settings: undefined,
    });

    const applied = update({
      projectRoot,
      libraryRoot: input.libraryRoot,
      apply: true,
      allowExecAdapters: true,
      now: stableNow,
    });
    const postStatus = status({
      projectRoot,
      libraryRoot: input.libraryRoot,
      now: stableNow,
    });
    const postDryRun = update({
      projectRoot,
      libraryRoot: input.libraryRoot,
      apply: false,
      allowExecAdapters: true,
      now: stableNow,
    });
    const postDryRunSummary = summarizePlannedChanges(postDryRun.changes);
    const postDoctor = doctor({
      projectRoot,
      libraryRoot: input.libraryRoot,
      now: stableNow,
    });
    const pending =
      postDryRunSummary.create +
      postDryRunSummary.update +
      postDryRunSummary.blocked +
      postDryRunSummary.userModified;
    const changed = summarizePlannedChanges(applied.changes);
    const blocking =
      postDoctor.summary.errors +
      postDoctor.summary.warnings +
      postStatus.summary.fragmentUpdatesAvailable +
      postStatus.summary.fragmentLibraryMissing +
      postStatus.summary.entriesUserModified +
      postStatus.summary.entriesMissing +
      postStatus.summary.partialAdoptions +
      pending;

    if (blocking > 0) {
      return {
        id: "sanitized-upgrade-smoke",
        label: "Sanitized upgrade smoke",
        status: "fail",
        detail:
          `doctor=${postDoctor.summary.errors}/${postDoctor.summary.warnings}, ` +
          `updates=${postStatus.summary.fragmentUpdatesAvailable}, ` +
          `drift=${postStatus.summary.entriesUserModified}/${postStatus.summary.entriesMissing}, ` +
          `partial=${postStatus.summary.partialAdoptions}, pending=${pending}`,
        next: "Reproduce with a sanitized old-project fixture and repair the upgrade path before release.",
      };
    }

    return {
      id: "sanitized-upgrade-smoke",
      label: "Sanitized upgrade smoke",
      status: "pass",
      detail:
        `old base@1 fixture upgraded; applied create=${changed.create}, ` +
        `update=${changed.update}, noop=${changed.noop}; doctor clean; dry-run pending=0`,
    };
  } catch (e) {
    return {
      id: "sanitized-upgrade-smoke",
      label: "Sanitized upgrade smoke",
      status: "fail",
      detail: (e as Error).message,
      next: "Fix the sanitized old-project upgrade path before release.",
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeSanitizedOldLibrary(libraryRoot: string): void {
  const baseDir = path.join(libraryRoot, "base");
  fs.mkdirSync(path.join(baseDir, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(baseDir, "fragment.yaml"),
    `id: base
version: 1
capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: anamnesis-base
  - type: ontology
    source: content/ontology.snippet.yaml
`,
  );
  fs.writeFileSync(
    path.join(baseDir, "content", "agents.snippet.md"),
    `## anamnesis baseline

Old sanitized release fixture.
`,
  );
  fs.writeFileSync(
    path.join(baseDir, "content", "ontology.snippet.yaml"),
    `schema_version: "anamnesis.static.v1"
fragment: "base"
entities:
  - id: "old-release-fixture"
    kind: "project"
    name: "old release fixture"
`,
  );
  fs.writeFileSync(path.join(libraryRoot, "rulebook.md"), "");
}

function summarizeChecks(checks: readonly ReleaseCheckItem[]): ReleaseCheckResult["summary"] {
  return {
    total: checks.length,
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
    skip: checks.filter((check) => check.status === "skip").length,
  };
}

function evidenceKind(
  st: StatusResult,
  kind: RuntimeEvidenceKindSummary["kind"],
): RuntimeEvidenceKindSummary | undefined {
  return st.evidence.byKind.find((entry) => entry.kind === kind);
}

function releaseCheckEvidenceRecord(input: {
  generatedAt: string;
  projectName: string;
  ok: boolean;
  summary: ReleaseCheckResult["summary"];
  statusSummary: StatusResult["summary"];
  updateSummary: ChangeSummary;
  doctorSummary: DoctorResult["summary"];
  checks: readonly ReleaseCheckItem[];
}): RuntimeEvidenceRecord {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "release-check",
    generated_at: input.generatedAt,
    command: ["anamnesis", "release", "check"],
    project: { name: input.projectName },
    summary: {
      ok: input.ok,
      pass: input.summary.pass,
      warn: input.summary.warn,
      fail: input.summary.fail,
      skip: input.summary.skip,
      update_dry_run: {
        create: input.updateSummary.create,
        update: input.updateSummary.update,
        blocked: input.updateSummary.blocked,
        user_modified: input.updateSummary.userModified,
      },
      doctor: {
        errors: input.doctorSummary.errors,
        warnings: input.doctorSummary.warnings,
        info: input.doctorSummary.info,
      },
      drift: {
        clean: input.statusSummary.entriesClean,
        modified: input.statusSummary.entriesUserModified,
        missing: input.statusSummary.entriesMissing,
      },
    },
    details: {
      checks: input.checks.map((check) => ({
        id: check.id,
        label: check.label,
        status: check.status,
        detail: check.detail,
        ...(check.next ? { next: check.next } : {}),
      })),
    },
  };
}
