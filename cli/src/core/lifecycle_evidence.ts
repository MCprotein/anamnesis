import * as path from "node:path";
import type { PlannedChange } from "./applier.js";
import type { CodexHookSyncResult } from "./codex_native.js";
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

export function projectRelativePath(
  projectRoot: string,
  filePath: string,
): string {
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  return relative === "" || relative.startsWith("..") ? filePath : relative;
}
