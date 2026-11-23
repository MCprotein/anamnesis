import { collectWorkPolicyLayers } from "../core/work_policy_layers.js";
import {
	compareWorkPolicySnapshots,
	createWorkPolicySnapshot,
	resolveWorkPolicy,
	type WorkPolicySnapshotComparison,
} from "../core/work_policy.js";
import type { WorkProjection } from "../core/work_projection.js";
import type { WorkMutationInput } from "./work_types.js";

export function resolveCommandPolicy(
	input: Pick<WorkMutationInput, "project_root">,
) {
	return resolveWorkPolicy(collectWorkPolicyLayers(input.project_root));
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
