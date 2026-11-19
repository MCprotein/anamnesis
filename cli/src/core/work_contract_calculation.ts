import { sha256 } from "../util/hash.js";
import {
	canonicalJson,
	compareCodeUnits,
	sortedStrings,
} from "./work_contract_canonical.js";
import {
	assertContractGraph,
	parseContractDefinition,
} from "./work_contract_graph.js";
import {
	type ChildContract,
	childContractSchema,
	type RepositoryScope,
	type WorkContractDefinition,
	type WorkDelegationOutcomePayload,
	type WorkParallelLane,
	workParallelLaneSchema,
} from "./work_contract_schema.js";

export function calculateWorkContractHash(
	contract: WorkContractDefinition,
): string {
	const parsed = parseContractDefinition(contract);
	assertContractGraph(parsed.requirements);
	const requirements = parsed.requirements
		.map((item) => ({
			...item,
			source_event_ids: sortedStrings(item.source_event_ids),
			...(item.supersedes
				? { supersedes: sortedStrings(item.supersedes) }
				: {}),
		}))
		.sort((left, right) => compareCodeUnits(left.id, right.id));
	const openConflicts = parsed.open_conflicts
		.map((item) => ({
			...item,
			requirement_ids: sortedStrings(item.requirement_ids),
			source_event_ids: sortedStrings(item.source_event_ids),
		}))
		.sort((left, right) => compareCodeUnits(left.id, right.id));
	return sha256(
		canonicalJson({
			work: parsed.work,
			boundary: {
				...parsed.boundary,
				reason_codes: sortedStrings(parsed.boundary.reason_codes),
			},
			policy: {
				policy: parsed.policy_snapshot.policy,
				policy_hash: parsed.policy_snapshot.policy_hash,
			},
			requirements,
			open_conflicts: openConflicts,
		}),
	);
}

export function repositoryScopesOverlap(
	left: RepositoryScope,
	right: RepositoryScope,
): boolean {
	if (left.kind === "repo" || right.kind === "repo") return true;
	const leftParts = left.path.split("/");
	const rightParts = right.path.split("/");
	const prefix = (parent: readonly string[], child: readonly string[]) =>
		parent.length <= child.length &&
		parent.every((part, index) => part === child[index]);
	if (left.kind === "file" && right.kind === "file")
		return left.path === right.path;
	if (left.kind === "tree" && right.kind === "tree")
		return prefix(leftParts, rightParts) || prefix(rightParts, leftParts);
	return left.kind === "tree"
		? prefix(leftParts, rightParts)
		: prefix(rightParts, leftParts);
}

export function calculateWorkChildContractHash(child: ChildContract): string {
	return sha256(canonicalJson(childContractSchema.parse(child)));
}

export function calculateWorkDelegationContractHash(
	payload: Pick<
		Extract<WorkDelegationOutcomePayload, { outcome: "delegated" }>,
		| "work_id"
		| "basis_contract_revision"
		| "basis_contract_hash"
		| "policy_hash"
		| "assessment_id"
		| "assessment_input_hash"
		| "provider"
		| "child_contracts"
	>,
): string {
	return sha256(
		canonicalJson({
			work_id: payload.work_id,
			basis_contract_revision: payload.basis_contract_revision,
			basis_contract_hash: payload.basis_contract_hash,
			policy_hash: payload.policy_hash,
			assessment_id: payload.assessment_id,
			assessment_input_hash: payload.assessment_input_hash,
			provider: payload.provider,
			child_contract_hashes: payload.child_contracts
				.map(calculateWorkChildContractHash)
				.sort(compareCodeUnits),
		}),
	);
}

export function calculateWorkDelegationFailureFingerprint(
	payload: Pick<
		Extract<
			WorkDelegationOutcomePayload,
			{
				outcome:
					| "authorization_error"
					| "unsupported_authority"
					| "unavailable"
					| "runtime_incompatible";
			}
		>,
		| "work_id"
		| "basis_contract_revision"
		| "basis_contract_hash"
		| "policy_hash"
		| "assessment_id"
		| "assessment_input_hash"
		| "provider"
		| "outcome"
		| "failure_input"
		| "failure_refs"
	>,
	lanes: readonly WorkParallelLane[],
): string {
	return sha256(
		canonicalJson({
			work_id: payload.work_id,
			basis_contract_revision: payload.basis_contract_revision,
			basis_contract_hash: payload.basis_contract_hash,
			policy_hash: payload.policy_hash,
			assessment_id: payload.assessment_id,
			assessment_input_hash: payload.assessment_input_hash,
			selected_provider: payload.provider,
			outcome: payload.outcome,
			failure_input: payload.failure_input,
			failure_refs: [...payload.failure_refs].sort(compareCodeUnits),
			candidate_lane_hashes: lanes
				.map((lane) =>
					sha256(canonicalJson(workParallelLaneSchema.parse(lane))),
				)
				.sort(compareCodeUnits),
		}),
	);
}
