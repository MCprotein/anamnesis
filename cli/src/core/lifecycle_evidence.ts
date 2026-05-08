import * as path from "node:path";
import type { PlannedChange } from "./applier.js";
import type { Agentfile, Fragment } from "./agentfile.js";
import type { CodexHookSyncResult } from "./codex_native.js";
import {
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceRecord,
} from "./evidence.js";
import type { HookSyncResult } from "./settings.js";

export interface LifecycleChangeSummary {
  create: number;
  update: number;
  noop: number;
  blocked: number;
  user_modified: number;
}

export interface LifecycleSyncSummary {
  total: number;
  create: number;
  noop: number;
}

export type FragmentLifecycleEventType =
  | "installed"
  | "updated"
  | "pinned-blocked"
  | "yanked-invalid"
  | "dependency-blocked";

export interface FragmentLifecycleEvent {
  event: FragmentLifecycleEventType;
  fragment_id: string;
  scope_path: string;
  version?: number;
  from_version?: number;
  to_version?: number;
  pinned?: boolean;
  reason?: string;
}

export function summarizeLifecycleChanges(
  changes: readonly PlannedChange[],
): LifecycleChangeSummary {
  const summary: LifecycleChangeSummary = {
    create: 0,
    update: 0,
    noop: 0,
    blocked: 0,
    user_modified: 0,
  };
  for (const change of changes) {
    if (change.status === "create") summary.create++;
    else if (change.status === "update") summary.update++;
    else if (change.status === "noop") summary.noop++;
    else if (change.status === "blocked") summary.blocked++;
    else if (change.status === "user-modified") summary.user_modified++;
  }
  return summary;
}

export function summarizeLifecycleSyncStatuses(
  results: ReadonlyArray<{ status: string }>,
): LifecycleSyncSummary {
  return {
    total: results.length,
    create: results.filter((result) => result.status === "create").length,
    noop: results.filter((result) => result.status === "noop").length,
  };
}

export function lifecycleChangeDetails(
  changes: readonly PlannedChange[],
): Array<Record<string, unknown>> {
  return changes.map((change) => {
    const target =
      change.target === "region"
        ? `${change.file}#${change.regionId}`
        : change.path;
    return {
      target_type: change.target,
      target,
      fragment_id: change.fragmentId,
      fragment_version: change.fragmentVersion,
      status: change.status,
      ...(change.reason ? { reason: change.reason } : {}),
    };
  });
}

export function hookSyncDetails(
  results: readonly HookSyncResult[],
): Array<Record<string, unknown>> {
  return results.map((result) => ({
    status: result.status,
    event: result.registration.event,
    ...(result.registration.matcher
      ? { matcher: result.registration.matcher }
      : {}),
    command: result.registration.command,
  }));
}

export function codexHookSyncDetails(
  results: readonly CodexHookSyncResult[],
): Array<Record<string, unknown>> {
  return results.map((result) => ({
    status: result.status,
    event: result.registration.event,
    ...(result.registration.matcher
      ? { matcher: result.registration.matcher }
      : {}),
    command: result.registration.command,
  }));
}

export function fragmentLifecycleEvidenceRecord(input: {
  generatedAt: string;
  command: string[];
  projectName: string;
  events: readonly FragmentLifecycleEvent[];
}): RuntimeEvidenceRecord {
  const counts: Record<FragmentLifecycleEventType, number> = {
    installed: 0,
    updated: 0,
    "pinned-blocked": 0,
    "yanked-invalid": 0,
    "dependency-blocked": 0,
  };
  for (const event of input.events) counts[event.event]++;

  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "fragment-lifecycle",
    generated_at: input.generatedAt,
    command: input.command,
    project: { name: input.projectName },
    summary: {
      schema_version: "anamnesis.fragment_lifecycle.v1",
      total: input.events.length,
      counts,
    },
    details: {
      events: input.events.map((event) => ({ ...event })),
    },
  };
}

export function installedFragmentEvents(
  agentfile: Agentfile,
): FragmentLifecycleEvent[] {
  return flattenAgentfileFragments(agentfile).map(({ scopePath, fragment }) => ({
    event: "installed",
    fragment_id: fragment.id,
    scope_path: scopePath,
    version: fragment.version,
    pinned: fragment.pinned === true || undefined,
  }));
}

export function updateFragmentEvents(input: {
  before: Agentfile;
  after: Agentfile;
  libraryVersions: Map<string, number>;
  autoDependenciesByScope?: Map<string, Fragment[]>;
  bumpPinned: boolean;
}): FragmentLifecycleEvent[] {
  const before = new Map(
    flattenAgentfileFragments(input.before).map((entry) => [
      fragmentScopeKey(entry.scopePath, entry.fragment.id),
      entry,
    ]),
  );
  const after = new Map(
    flattenAgentfileFragments(input.after).map((entry) => [
      fragmentScopeKey(entry.scopePath, entry.fragment.id),
      entry,
    ]),
  );
  const autoDependencyKeys = new Set<string>();
  for (const [scopePath, fragments] of input.autoDependenciesByScope ?? []) {
    for (const fragment of fragments) {
      autoDependencyKeys.add(fragmentScopeKey(scopePath, fragment.id));
    }
  }

  const events: FragmentLifecycleEvent[] = [];
  for (const [key, afterEntry] of after) {
    const beforeEntry = before.get(key);
    if (!beforeEntry) {
      events.push({
        event: "installed",
        fragment_id: afterEntry.fragment.id,
        scope_path: afterEntry.scopePath,
        version: afterEntry.fragment.version,
        pinned: afterEntry.fragment.pinned === true || undefined,
        reason: autoDependencyKeys.has(key) ? "dependency-auto-include" : undefined,
      });
      continue;
    }
    if (beforeEntry.fragment.version !== afterEntry.fragment.version) {
      events.push({
        event: "updated",
        fragment_id: afterEntry.fragment.id,
        scope_path: afterEntry.scopePath,
        from_version: beforeEntry.fragment.version,
        to_version: afterEntry.fragment.version,
        pinned: afterEntry.fragment.pinned === true || undefined,
      });
    }
  }

  for (const beforeEntry of before.values()) {
    const current = input.libraryVersions.get(beforeEntry.fragment.id);
    if (current === undefined) {
      events.push({
        event: "yanked-invalid",
        fragment_id: beforeEntry.fragment.id,
        scope_path: beforeEntry.scopePath,
        version: beforeEntry.fragment.version,
        pinned: beforeEntry.fragment.pinned === true || undefined,
        reason: "not-found-in-current-library",
      });
      continue;
    }
    if (
      beforeEntry.fragment.pinned === true &&
      !input.bumpPinned &&
      current > beforeEntry.fragment.version
    ) {
      events.push({
        event: "pinned-blocked",
        fragment_id: beforeEntry.fragment.id,
        scope_path: beforeEntry.scopePath,
        from_version: beforeEntry.fragment.version,
        to_version: current,
        pinned: true,
      });
    }
  }

  return events;
}

function flattenAgentfileFragments(
  agentfile: Agentfile,
): Array<{ scopePath: string; fragment: Fragment }> {
  const entries = agentfile.fragments.map((fragment) => ({
    scopePath: ".",
    fragment,
  }));
  for (const scope of agentfile.project.scopes ?? []) {
    for (const fragment of scope.overrides?.fragments_add ?? []) {
      entries.push({ scopePath: scope.path, fragment });
    }
  }
  return entries;
}

function fragmentScopeKey(scopePath: string, fragmentId: string): string {
  return `${scopePath}\0${fragmentId}`;
}

export function projectRelativePath(
  projectRoot: string,
  filePath: string,
): string {
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  return relative === "" || relative.startsWith("..") ? filePath : relative;
}
