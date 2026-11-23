import { UserWorkPolicyError } from "../core/user_work_policy.js";
import { collectWorkPolicyLayers } from "../core/work_policy_layers.js";
import {
	compareWorkPolicySnapshots,
	createWorkPolicySnapshot,
	type ResolvedWorkPolicy,
	resolveWorkPolicy,
	type WorkPolicySnapshotComparison,
} from "../core/work_policy.js";
import type { WorkProjection } from "../core/work_projection.js";
import type { WorkMutationInput } from "./work_types.js";

export const WorkPolicyDriftState = {
	Current: "current",
	Drifted: "drifted",
	DriftedHeld: "drifted-held",
	DriftedClosed: "drifted-closed",
	NoSnapshot: "no-snapshot",
	UserPolicyInvalid: "user-policy-invalid",
} as const;
export type WorkPolicyDriftState =
	(typeof WorkPolicyDriftState)[keyof typeof WorkPolicyDriftState];

export interface WorkPolicyDriftReport {
	state: WorkPolicyDriftState;
	comparison: WorkPolicySnapshotComparison | null;
	resolve_command: string | null;
}

export function resolveCommandPolicy(
	input: Pick<WorkMutationInput, "project_root">,
) {
	return resolveWorkPolicy(collectWorkPolicyLayers(input.project_root));
}

export function workPolicyDriftResolveCommand(workId: string): string {
	return `anamnesis work amend --work ${workId} --draft <draft.yaml> --expected-head <head> --source-file <source>`;
}

export function inspectPolicyDrift(
	projectRoot: string,
	projection: WorkProjection,
): WorkPolicyDriftReport {
	if (!projection.policy_snapshot) return driftReport(projection, null);
	try {
		return driftReport(
			projection,
			resolveCommandPolicy({ project_root: projectRoot }),
		);
	} catch (error) {
		if (!(error instanceof UserWorkPolicyError)) throw error;
		return {
			state: WorkPolicyDriftState.UserPolicyInvalid,
			comparison: null,
			resolve_command: null,
		};
	}
}

export function driftReport(
	projection: WorkProjection,
	currentPolicy: ResolvedWorkPolicy | null,
): WorkPolicyDriftReport {
	const frozen = projection.policy_snapshot;
	if (!frozen || !currentPolicy)
		return {
			state: WorkPolicyDriftState.NoSnapshot,
			comparison: null,
			resolve_command: null,
		};
	const comparison = compareWorkPolicySnapshots(
		frozen,
		createWorkPolicySnapshot(frozen.revision, currentPolicy),
	);
	const state = !comparison.drifted
		? WorkPolicyDriftState.Current
		: projection.lifecycle !== "open"
			? WorkPolicyDriftState.DriftedClosed
			: lowersRequiredGate(frozen.policy, currentPolicy)
				? WorkPolicyDriftState.DriftedHeld
				: WorkPolicyDriftState.Drifted;
	return {
		state,
		comparison,
		resolve_command:
			state === WorkPolicyDriftState.Drifted
				? workPolicyDriftResolveCommand(projection.work_id)
				: null,
	};
}

export function detectPolicyDrift(
	projectRoot: string,
	projection: WorkProjection,
): WorkPolicySnapshotComparison | null {
	return inspectPolicyDrift(projectRoot, projection).comparison;
}

export function nextRevisionPolicy(
	projectRoot: string,
	prior: ResolvedWorkPolicy,
): ResolvedWorkPolicy {
	let current: ResolvedWorkPolicy;
	try {
		current = resolveCommandPolicy({ project_root: projectRoot });
	} catch (error) {
		if (error instanceof UserWorkPolicyError) return prior;
		throw error;
	}
	return lowersRequiredGate(prior, current) ? prior : current;
}

function lowersRequiredGate(
	prior: ResolvedWorkPolicy,
	current: ResolvedWorkPolicy,
): boolean {
	return prior.review.gates.some(
		(gate) =>
			gate.enforcement === "required" &&
			current.review.gates.find((item) => item.gate === gate.gate)
				?.enforcement !== "required",
	);
}
