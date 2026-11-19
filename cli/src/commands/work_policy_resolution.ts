import { findAgentfile, readAgentfile } from "../core/agentfile.js";
import {
	compareWorkPolicySnapshots,
	createWorkPolicySnapshot,
	resolveWorkPolicy,
	type WorkPolicyLayer,
	type WorkPolicySnapshotComparison,
} from "../core/work_policy.js";
import type { WorkProjection } from "../core/work_projection.js";
import type { WorkMutationInput } from "./work_types.js";

export function resolveCommandPolicy(
	input: Pick<WorkMutationInput, "project_root">,
) {
	const layers: WorkPolicyLayer[] = [];
	const agentfilePath = findAgentfile(input.project_root);
	if (agentfilePath) {
		const agentfile = readAgentfile(input.project_root);
		const config =
			agentfile.version === 2 ? agentfile.settings?.work_policy : undefined;
		if (config) {
			layers.push({
				kind: "project",
				config,
				source_refs: [{ source: "agentfile", ref: agentfilePath }],
			});
		}
	}
	return resolveWorkPolicy(layers);
}

export function detectPolicyDrift(
	projectRoot: string,
	projection: WorkProjection,
): WorkPolicySnapshotComparison | null {
	const frozen = projection.policy_snapshot;
	if (!frozen) return null;
	const current = createWorkPolicySnapshot(
		frozen.revision,
		resolveCommandPolicy({ project_root: projectRoot }),
	);
	return compareWorkPolicySnapshots(frozen, current);
}
