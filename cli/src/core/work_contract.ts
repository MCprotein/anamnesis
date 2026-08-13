import { z } from "zod";

import { isHash, sha256 } from "../util/hash.js";
import {
	type AppendWorkLedgerOptions,
	type AppendWorkLedgerResult,
	type WorkLedgerEvent,
	type WorkLedgerRecord,
	readWorkLedger,
} from "./work_ledger.js";
import {
	validateWorkPolicySnapshot,
	type WorkPolicySnapshot,
} from "./work_policy.js";

export const WORK_CONTRACT_EVENT_SCHEMA_VERSION =
	"anamnesis.work-contract-event.v1" as const;
export const WORK_PROGRESS_EVENT_SCHEMA_VERSION =
	"anamnesis.work-progress-event.v1" as const;
export const WORK_LIFECYCLE_EVENT_SCHEMA_VERSION =
	"anamnesis.work-lifecycle-event.v1" as const;

const nonEmpty = z
	.string()
	.min(1)
	.refine((value) => value.trim().length > 0);
const positiveInteger = z
	.number()
	.int()
	.positive()
	.max(Number.MAX_SAFE_INTEGER);
const hash = z.string().refine(isHash, "invalid hash");
const stringList = z.array(nonEmpty).superRefine((values, context) => {
	const seen = new Set<string>();
	for (const [index, value] of values.entries()) {
		if (seen.has(value)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `duplicate value: ${value}`,
				path: [index],
			});
		}
		seen.add(value);
	}
});

const captureRefShape = {
	source_event_id: nonEmpty.optional(),
	source_envelope_hash: hash.optional(),
	source_object_hash: hash.optional(),
	source_object_path: nonEmpty.optional(),
};

export const workRequirementDefinitionSchema = z
	.object({
		id: nonEmpty,
		summary: nonEmpty,
		source_event_ids: stringList.min(1),
		weight: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER).optional(),
		supersedes: stringList.optional(),
		superseded_by: nonEmpty.optional(),
	})
	.strict();

const workBoundarySchema = z
	.object({
		state: z.enum(["provisional", "needs_user", "accepted"]),
		classification: z.enum(["same_unit", "new_unit", "interruption"]),
		reason_codes: stringList,
		confidence: z.enum(["low", "medium", "high"]),
	})
	.strict();

const openConflictSchema = z
	.object({
		id: nonEmpty,
		summary: nonEmpty,
		requirement_ids: stringList.min(1),
		source_event_ids: stringList.min(1),
	})
	.strict();

const contractDefinitionSchema = z
	.object({
		work: z
			.object({
				id: nonEmpty,
				title: nonEmpty,
				completion_contract: nonEmpty,
			})
			.strict(),
		boundary: workBoundarySchema,
		policy_snapshot: z.unknown(),
		requirements: z.array(workRequirementDefinitionSchema),
		open_conflicts: z.array(openConflictSchema),
	})
	.strict();

const contractPayloadSchema = z
	.object({
		schema_version: z.literal(WORK_CONTRACT_EVENT_SCHEMA_VERSION),
		work_id: nonEmpty,
		contract_revision: positiveInteger,
		previous_contract_revision: positiveInteger.nullable(),
		previous_contract_hash: hash.nullable(),
		contract_hash: hash,
		contract: contractDefinitionSchema,
		...captureRefShape,
	})
	.strict();

const progressPayloadSchema = z
	.object({
		schema_version: z.literal(WORK_PROGRESS_EVENT_SCHEMA_VERSION),
		work_id: nonEmpty,
		requirement_id: nonEmpty,
		basis_contract_hash: hash,
		status: z.enum([
			"pending",
			"in_progress",
			"implemented_unverified",
			"verified",
			"blocked",
			"waived",
		]),
		evidence_refs: stringList,
		waiver: z
			.object({
				reason: nonEmpty,
				authority_ref: nonEmpty,
				source_event_id: nonEmpty,
				evidence_refs: stringList.min(1),
			})
			.strict()
			.optional(),
		...captureRefShape,
	})
	.strict();

const lifecyclePayloadSchema = z
	.object({
		schema_version: z.literal(WORK_LIFECYCLE_EVENT_SCHEMA_VERSION),
		work_id: nonEmpty,
		basis_contract_hash: hash,
		lifecycle: z.enum(["open", "completed", "abandoned", "superseded"]),
		...captureRefShape,
	})
	.strict();

export type WorkRequirementDefinition = z.infer<
	typeof workRequirementDefinitionSchema
>;
export type WorkContractDefinition = Omit<
	z.infer<typeof contractDefinitionSchema>,
	"policy_snapshot"
> & { policy_snapshot: WorkPolicySnapshot };
export type WorkContractPayload = Omit<
	z.infer<typeof contractPayloadSchema>,
	"contract"
> & { contract: WorkContractDefinition };
export type WorkProgressPayload = z.infer<typeof progressPayloadSchema>;
export type WorkLifecyclePayload = z.infer<typeof lifecyclePayloadSchema>;

export type TypedWorkEvent =
	| (Omit<WorkLedgerEvent, "kind" | "payload"> & {
			kind: "work_created" | "work_contract_revised";
			payload: WorkContractPayload;
	  })
	| (Omit<WorkLedgerEvent, "kind" | "payload"> & {
			kind: "work_requirement_transitioned";
			payload: WorkProgressPayload;
	  })
	| (Omit<WorkLedgerEvent, "kind" | "payload"> & {
			kind: "work_lifecycle_changed";
			payload: WorkLifecyclePayload;
	  });

export interface AppendTypedWorkEventOptions
	extends Omit<AppendWorkLedgerOptions, "event"> {
	event: TypedWorkEvent;
}


const LEGACY_SEMANTIC_ALIASES = new Set([
	"contract_revised",
	"work_contract_revised",
	"requirement_added",
	"requirement_recorded",
	"requirement_status_changed",
	"requirement_transitioned",
	"work_requirement_transitioned",
	"requirement_superseded",
	"lifecycle_changed",
	"work_lifecycle_changed",
	"conflict_recorded",
	"conflict_resolved",
]);
const CANONICAL_TYPED_KINDS = new Set([
	"work_created",
	"work_contract_revised",
	"work_requirement_transitioned",
	"work_lifecycle_changed",
]);

export function calculateWorkContractHash(
	contract: WorkContractDefinition,
): string {
	const parsed = parseContractDefinition(contract);
	assertContractGraph(parsed.requirements);
	const requirements = parsed.requirements
		.map((item) => ({
			...item,
			source_event_ids: sortedStrings(item.source_event_ids),
			...(item.supersedes ? { supersedes: sortedStrings(item.supersedes) } : {}),
		}))
		.sort((left, right) => compareCodeUnits(left.id, right.id));
	const openConflicts = parsed.open_conflicts
		.map((item) => ({ ...item, requirement_ids: sortedStrings(item.requirement_ids), source_event_ids: sortedStrings(item.source_event_ids) }))
		.sort((left, right) => compareCodeUnits(left.id, right.id));
	return sha256(
		canonicalJson({
			work: parsed.work,
			boundary: { ...parsed.boundary, reason_codes: sortedStrings(parsed.boundary.reason_codes) },
			policy: {
				policy: parsed.policy_snapshot.policy,
				policy_hash: parsed.policy_snapshot.policy_hash,
			},
			requirements,
			open_conflicts: openConflicts,
		}),
	);
}

export function parseTypedWorkEvent(event: WorkLedgerEvent): TypedWorkEvent {
	switch (event.kind) {
		case "work_created":
		case "work_contract_revised":
			return {
				...event,
				kind: event.kind,
				payload: parseContractPayload(event.payload),
			};
		case "work_requirement_transitioned":
			return {
				...event,
				kind: event.kind,
				payload: progressPayloadSchema.parse(event.payload),
			};
		case "work_lifecycle_changed":
			return {
				...event,
				kind: event.kind,
				payload: lifecyclePayloadSchema.parse(event.payload),
			};
		default:
			throw new Error(`not a typed Work event: ${event.kind}`);
	}
}

export function validateWorkEventAppend(
	records: readonly WorkLedgerRecord[],
	event: WorkLedgerEvent,
): void {
	const mode = ledgerMode(records);
	const typed = isTypedPayload(event.payload);
	if (CANONICAL_TYPED_KINDS.has(event.kind) && !typed) {
		if (event.kind !== "work_created" || mode === "typed") {
			throw new Error(
				`canonical typed Work event ${event.kind} requires its exact schema discriminator`,
			);
		}
	}

	if (
		mode === "typed" &&
		((LEGACY_SEMANTIC_ALIASES.has(event.kind) && !typed) ||
			(event.kind === "work_created" && !typed))
	) {
		throw new Error(
			`legacy semantic mutation ${event.kind} is forbidden after typed work_created`,
		);
	}
	if (mode === "legacy" && typed) {
		throw new Error("typed Work mutations cannot be appended to a legacy Work");
	}
	if (!typed) return;

	const parsed = parseTypedWorkEvent(event);
	const state = typedState(records);
	if (parsed.kind === "work_created") {
		if (mode !== "empty")
			throw new Error("typed work_created requires an empty Work ledger");
		assertContractRevision(parsed.payload, null, null);
		assertInitialContractGraph(parsed.payload.contract.requirements);
		return;
	}
	if (mode !== "typed" || !state) {
		throw new Error("typed Work mutation requires typed work_created");
	}
	if (parsed.payload.work_id !== state.work_id) {
		throw new Error("typed Work event targets a different work ID");
	}
	if (parsed.kind === "work_contract_revised") {
		assertContractRevision(parsed.payload, state.revision, state.contract_hash);
		assertContractLineage(state.requirements, parsed.payload.contract.requirements);
		if (parsed.payload.contract_hash === state.contract_hash) {
			throw new Error("no-op Work contract revision is forbidden");
		}
		return;
	}
	if (
		!("basis_contract_hash" in parsed.payload) ||
		parsed.payload.basis_contract_hash !== state.contract_hash
	) {
		throw new Error("typed Work event basis_contract_hash is stale");
	}
	if (
		parsed.kind === "work_requirement_transitioned" &&
		parsed.payload.status === "verified" &&
		parsed.payload.evidence_refs.length === 0
	) {
		throw new Error("verified Work requirement transition requires evidence");
	}
	if (parsed.kind === "work_requirement_transitioned") {
		if (parsed.payload.status === "waived" && !parsed.payload.waiver) {
			throw new Error("waived Work requirement transition requires reason, authority, source, and evidence");
		}
		if (parsed.payload.status !== "waived" && parsed.payload.waiver) {
			throw new Error("Work requirement waiver metadata is only valid for waived transitions");
		}
	}
	if (parsed.kind === "work_lifecycle_changed") {
		throw new Error("typed Work lifecycle transitions are not supported until closure orchestration is available");
	}
	if (
		parsed.kind === "work_requirement_transitioned" &&
		!state.requirement_ids.has(parsed.payload.requirement_id)
	) {
		throw new Error(
			`unknown typed Work requirement: ${parsed.payload.requirement_id}`,
		);
	}
}

export function validateWorkLedgerSemantics(
	records: readonly WorkLedgerRecord[],
): void {
	const mode = ledgerMode(records);
	if (mode === "typed") {
		typedState(records);
		return;
	}
	if (
		mode === "legacy" &&
		records.some((record) => isTypedPayload(record.payload))
	) {
		throw new Error("typed Work mutations cannot exist on a legacy Work");
	}
}

export function appendTypedWorkEvent(
	options: AppendTypedWorkEventOptions,
): AppendWorkLedgerResult {
	validateWorkEventAppend(readWorkLedger(options.ledgerPath).records, options.event);
	throw new Error("typed Work events require the official source publication API");
}

function parseContractDefinition(value: unknown): WorkContractDefinition {
	const parsed = contractDefinitionSchema.parse(value);
	return {
		...parsed,
		policy_snapshot: validateWorkPolicySnapshot(parsed.policy_snapshot),
	};
}

function parseContractPayload(value: unknown): WorkContractPayload {
	const parsed = contractPayloadSchema.parse(value);
	const contract = parseContractDefinition(parsed.contract);
	if (parsed.work_id !== contract.work.id) {
		throw new Error(
			"Work contract payload work_id does not match contract.work.id",
		);
	}
	if (contract.policy_snapshot.revision !== parsed.contract_revision) {
		throw new Error(
			"Work policy snapshot revision does not match contract revision",
		);
	}
	if (calculateWorkContractHash(contract) !== parsed.contract_hash) {
		throw new Error("Work contract hash mismatch");
	}
	assertUniqueIds(
		contract.requirements.map((item) => item.id),
		"requirement",
	);
	assertUniqueIds(
		contract.open_conflicts.map((item) => item.id),
		"conflict",
	);
	assertContractGraph(contract.requirements);
	return { ...parsed, contract };
}

function assertInitialContractGraph(
	requirements: readonly WorkRequirementDefinition[],
): void {
	for (const requirement of requirements) {
		if ((requirement.supersedes?.length ?? 0) > 0)
			throw new Error("initial Work contract cannot supersede prior requirements");
		if (requirement.superseded_by)
			throw new Error("initial Work contract cannot contain superseded requirements");
	}
}

function assertContractGraph(requirements: readonly WorkRequirementDefinition[]): void {
	const byId = new Map(requirements.map((item) => [item.id, item]));
	for (const requirement of requirements) {
		if (requirement.superseded_by !== undefined)
			throw new Error("Work contracts use canonical supersedes linkage; superseded_by is forbidden");
		if (requirement.supersedes?.includes(requirement.id) || requirement.superseded_by === requirement.id)
			throw new Error("Work requirement cannot supersede itself");
		if (requirement.superseded_by && !byId.has(requirement.superseded_by))
			throw new Error("Work requirement superseded_by target is unknown");
	}
	for (const requirement of requirements) {
		const seen = new Set<string>();
		let cursor: WorkRequirementDefinition | undefined = requirement;
		while (cursor?.superseded_by) {
			if (seen.has(cursor.id)) throw new Error("Work requirement supersession cycle");
			seen.add(cursor.id);
			cursor = byId.get(cursor.superseded_by);
		}
	}
}

function assertContractRevision(
	payload: WorkContractPayload,
	previousRevision: number | null,
	previousHash: string | null,
): void {
	const expected = previousRevision === null ? 1 : previousRevision + 1;
	if (payload.contract_revision !== expected) {
		throw new Error(`Work contract revision must be exactly ${expected}`);
	}
	if (
		payload.previous_contract_revision !== previousRevision ||
		payload.previous_contract_hash !== previousHash
	) {
		throw new Error(
			"Work contract previous revision/hash precondition mismatch",
		);
	}
}

function typedState(records: readonly WorkLedgerRecord[]): {
	work_id: string;
	revision: number;
	contract_hash: string;
	requirement_ids: Set<string>;
	requirements: WorkRequirementDefinition[];
	terminal_history: boolean;
} | null {
	let state: ReturnType<typeof typedState> = null;
	for (const record of records) {
		if (
			state &&
			LEGACY_SEMANTIC_ALIASES.has(record.kind) &&
			!isTypedPayload(record.payload)
		) {
			throw new Error(
				`legacy semantic mutation ${record.kind} is forbidden after typed work_created`,
			);
		}
		if (!isTypedPayload(record.payload)) continue;
		const parsed = parseTypedWorkEvent(record);
		if (parsed.kind === "work_created") {
			if (state) throw new Error("repeated typed work_created");
			assertContractRevision(parsed.payload, null, null);
			assertInitialContractGraph(parsed.payload.contract.requirements);
			state = contractState(parsed.payload);
		} else if (parsed.kind === "work_contract_revised") {
			if (!state)
				throw new Error("typed contract revision precedes typed work_created");
			assertContractRevision(
				parsed.payload,
				state.revision,
				state.contract_hash,
			);
			if (parsed.payload.contract_hash === state.contract_hash) {
				throw new Error("no-op Work contract revision is forbidden");
			}
			assertContractLineage(
				state.requirements,
				parsed.payload.contract.requirements,
			);
			state = contractState(parsed.payload);
		} else if (
			parsed.kind === "work_requirement_transitioned" ||
			parsed.kind === "work_lifecycle_changed"
		) {
			if (!state)
				throw new Error("typed Work mutation precedes typed work_created");
			if (
				parsed.payload.work_id !== state.work_id ||
				parsed.payload.basis_contract_hash !== state.contract_hash
			) {
				throw new Error("invalid typed Work mutation basis");
			}
			if (parsed.kind === "work_requirement_transitioned") {
				if (state.terminal_history)
					throw new Error("typed Work semantic/progress mutation is forbidden after terminal lifecycle history");
				if (!state.requirement_ids.has(parsed.payload.requirement_id))
					throw new Error("unknown typed Work requirement");
				if (
					parsed.payload.status === "verified" &&
					parsed.payload.evidence_refs.length === 0
				)
					throw new Error(
						"verified Work requirement transition requires evidence",
					);
				if (parsed.payload.status === "waived" && !parsed.payload.waiver)
					throw new Error("waived Work requirement transition requires reason, authority, source, and evidence");
				if (parsed.payload.status !== "waived" && parsed.payload.waiver)
					throw new Error("Work requirement waiver metadata is only valid for waived transitions");
			} else {
				if (parsed.payload.lifecycle !== "open")
					throw new Error("typed Work terminal lifecycle transitions are not supported");
				throw new Error("typed Work lifecycle no-op/reopen transitions are not supported");
			}
		}
	}
	return state;
}

function contractState(payload: WorkContractPayload) {
	return {
		work_id: payload.work_id,
		revision: payload.contract_revision,
		contract_hash: payload.contract_hash,
		requirement_ids: new Set(
			payload.contract.requirements.map((item) => item.id),
		),
		requirements: payload.contract.requirements.map((item) => ({ ...item, source_event_ids: [...item.source_event_ids], ...(item.supersedes ? { supersedes: [...item.supersedes] } : {}) })),
		terminal_history: false,
	};
}

function assertContractLineage(
	previous: readonly WorkRequirementDefinition[],
	next: readonly WorkRequirementDefinition[],
): void {
	const previousById = new Map(previous.map((item) => [item.id, item]));
	const nextById = new Map(next.map((item) => [item.id, item]));
	const previouslySuperseded = new Set(previous.flatMap((item) => item.supersedes ?? []));
	const supersedingOwner = new Map<string, string>();
	for (const [id, before] of previousById) {
		const after = nextById.get(id);
		if (!after) throw new Error(`Work contract revision removed requirement ${id}`);
		if (before.summary !== after.summary || before.weight !== after.weight || before.superseded_by !== after.superseded_by || canonicalJson(before.supersedes ?? []) !== canonicalJson(after.supersedes ?? [])) {
			throw new Error(`Work requirement ${id} semantic definition is immutable`);
		}
		const sources = new Set(after.source_event_ids);
		if (!before.source_event_ids.every((source) => sources.has(source)))
			throw new Error(`Work requirement ${id} source_event_ids are append-only`);
	}
	for (const requirement of next) {
		for (const target of requirement.supersedes ?? []) {
			if (target === requirement.id) throw new Error("Work requirement cannot supersede itself");
			if (!previousById.has(target)) throw new Error(`Work requirement supersedes unknown prior requirement ${target}`);
			const existingOwner = supersedingOwner.get(target);
			if (existingOwner && existingOwner !== requirement.id)
				throw new Error(`Work requirement ${target} has multiple superseding requirements`);
			supersedingOwner.set(target, requirement.id);
			if (!previousById.has(requirement.id) && previouslySuperseded.has(target))
				throw new Error(`Work requirement ${target} is already superseded`);
		}
	}
	for (const requirement of next) {
		const seen = new Set<string>();
		let cursor: WorkRequirementDefinition | undefined = requirement;
		while (cursor?.superseded_by) {
			if (seen.has(cursor.id)) throw new Error("Work requirement supersession cycle");
			seen.add(cursor.id);
			cursor = nextById.get(cursor.superseded_by);
			if (!cursor) throw new Error(`Work requirement superseded_by target is unknown`);
		}
	}
}

function compareCodeUnits(left: string, right: string): number {
	const limit = Math.min(left.length, right.length);
	for (let index = 0; index < limit; index += 1) {
		const difference = left.charCodeAt(index) - right.charCodeAt(index);
		if (difference !== 0) return difference;
	}
	return left.length - right.length;
}

function sortedStrings(values: readonly string[]): string[] {
	return [...values].sort(compareCodeUnits);
}

function ledgerMode(
	records: readonly WorkLedgerRecord[],
): "empty" | "legacy" | "typed" {
	const created = records.find((record) => record.kind === "work_created");
	if (!created) return records.length === 0 ? "empty" : "legacy";
	return isTypedPayload(created.payload) ? "typed" : "legacy";
}

function isTypedPayload(payload: Record<string, unknown>): boolean {
	return [
		WORK_CONTRACT_EVENT_SCHEMA_VERSION,
		WORK_PROGRESS_EVENT_SCHEMA_VERSION,
		WORK_LIFECYCLE_EVENT_SCHEMA_VERSION,
	].includes(payload.schema_version as never);
}

function assertUniqueIds(values: readonly string[], label: string): void {
	if (new Set(values).size !== values.length) {
		throw new Error(`duplicate Work contract ${label} ID`);
	}
}

function canonicalJson(value: unknown): string {
	if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite JSON number");
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
		.join(",")}}`;
}
