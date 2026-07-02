import { findAgentfile, readAgentfile } from "./agentfile.js";
import type { HandoffLifecycleThresholds } from "./handoff_lifecycle.js";

export interface HandoffRetentionPolicy {
  maxWarmHandoffArchives: number;
  maxColdHandoffAgeDays: number;
  maxHandoffBytes: number;
}

export const DEFAULT_HANDOFF_RETENTION_POLICY: HandoffRetentionPolicy = {
  maxWarmHandoffArchives: 5,
  maxColdHandoffAgeDays: 90,
  maxHandoffBytes: 512 * 1024,
};

export interface ResolveHandoffRetentionPolicyOptions {
  projectRoot: string;
  overrides?: Partial<HandoffRetentionPolicy>;
}

export function resolveHandoffRetentionPolicy(
  opts: ResolveHandoffRetentionPolicyOptions,
): HandoffRetentionPolicy {
  const agentfilePath = findAgentfile(opts.projectRoot);
  const settings = agentfilePath ? readAgentfile(opts.projectRoot).settings : undefined;
  const overrides = opts.overrides ?? {};

  return {
    maxWarmHandoffArchives:
      overrides.maxWarmHandoffArchives ??
      settings?.max_warm_handoff_archives ??
      DEFAULT_HANDOFF_RETENTION_POLICY.maxWarmHandoffArchives,
    maxColdHandoffAgeDays:
      overrides.maxColdHandoffAgeDays ??
      settings?.max_cold_handoff_age_days ??
      DEFAULT_HANDOFF_RETENTION_POLICY.maxColdHandoffAgeDays,
    maxHandoffBytes:
      overrides.maxHandoffBytes ??
      settings?.max_handoff_bytes ??
      DEFAULT_HANDOFF_RETENTION_POLICY.maxHandoffBytes,
  };
}

export function handoffPolicyToLifecycleThresholds(
  policy: HandoffRetentionPolicy,
): HandoffLifecycleThresholds {
  return {
    maxWarmArchives: policy.maxWarmHandoffArchives,
    maxColdAgeDays: policy.maxColdHandoffAgeDays,
    maxTotalBytes: policy.maxHandoffBytes,
  };
}
