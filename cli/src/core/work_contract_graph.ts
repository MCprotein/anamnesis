import { validateWorkPolicySnapshot } from "./work_policy.js";
import {
	contractDefinitionSchema,
	type WorkContractDefinition,
	type WorkRequirementDefinition,
} from "./work_contract_schema.js";

export function parseContractDefinition(
	value: unknown,
): WorkContractDefinition {
	const parsed = contractDefinitionSchema.parse(value);
	return {
		...parsed,
		policy_snapshot: validateWorkPolicySnapshot(parsed.policy_snapshot),
	};
}

export function assertInitialContractGraph(
	requirements: readonly WorkRequirementDefinition[],
): void {
	for (const requirement of requirements) {
		if ((requirement.supersedes?.length ?? 0) > 0)
			throw new Error(
				"initial Work contract cannot supersede prior requirements",
			);
		if (requirement.superseded_by)
			throw new Error(
				"initial Work contract cannot contain superseded requirements",
			);
	}
}

export function assertContractGraph(
	requirements: readonly WorkRequirementDefinition[],
): void {
	const byId = new Map(requirements.map((item) => [item.id, item]));
	for (const requirement of requirements) {
		if (requirement.superseded_by !== undefined)
			throw new Error(
				"Work contracts use canonical supersedes linkage; superseded_by is forbidden",
			);
		if (
			requirement.supersedes?.includes(requirement.id) ||
			requirement.superseded_by === requirement.id
		)
			throw new Error("Work requirement cannot supersede itself");
		if (requirement.superseded_by && !byId.has(requirement.superseded_by))
			throw new Error("Work requirement superseded_by target is unknown");
	}
	for (const requirement of requirements) {
		const seen = new Set<string>();
		let cursor: WorkRequirementDefinition | undefined = requirement;
		while (cursor?.superseded_by) {
			if (seen.has(cursor.id))
				throw new Error("Work requirement supersession cycle");
			seen.add(cursor.id);
			cursor = byId.get(cursor.superseded_by);
		}
	}
}

export function assertUniqueIds(
	values: readonly string[],
	label: string,
): void {
	if (new Set(values).size !== values.length) {
		throw new Error(`duplicate Work contract ${label} ID`);
	}
}
