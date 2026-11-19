import {
	type AppendWorkLedgerResult,
	readWorkLedger,
	WORK_TYPED_EVENT_KIND_SCHEMA_PAIRS,
	type WorkLedgerEvent,
	type WorkLedgerRecord,
} from "./work_ledger.js";
import type {
	NormalizedDelegationPolicy,
	WorkPolicySnapshot,
} from "./work_policy.js";
import {
	calculateWorkContractHash,
	calculateWorkDelegationContractHash,
	calculateWorkDelegationFailureFingerprint,
	repositoryScopesOverlap,
} from "./work_contract_calculation.js";
import { canonicalJson } from "./work_contract_canonical.js";
import {
	assertContractGraph,
	assertInitialContractGraph,
	assertUniqueIds,
	parseContractDefinition,
} from "./work_contract_graph.js";
import {
	type AppendTypedWorkEventOptions,
	contractPayloadSchema,
	lifecyclePayloadSchema,
	progressPayloadSchema,
	type TypedWorkEvent,
	WORK_EXECUTION_LIMITS,
	type WorkContractDefinition,
	type WorkContractPayload,
	type WorkDelegationOutcomePayload,
	workDelegationOutcomePayloadSchema,
	type WorkDelegationProvider,
	type WorkDelegationWaiverPayload,
	workDelegationWaiverPayloadSchema,
	type WorkParallelismAssessmentPayload,
	workParallelismAssessmentPayloadSchema,
	type WorkParallelLane,
	type WorkRequirementDefinition,
	type WorkReviewAttemptPayload,
	workReviewAttemptPayloadSchema,
	type WorkReviewRequestedPayload,
	workReviewRequestedPayloadSchema,
} from "./work_contract_schema.js";

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
	...Object.keys(WORK_TYPED_EVENT_KIND_SCHEMA_PAIRS),
]);

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
		case "work_review_requested":
			return {
				...event,
				kind: event.kind,
				payload: workReviewRequestedPayloadSchema.parse(event.payload),
			};
		case "work_review_attempt_recorded":
			return {
				...event,
				kind: event.kind,
				payload: workReviewAttemptPayloadSchema.parse(event.payload),
			};
		case "work_parallelism_assessed":
			return {
				...event,
				kind: event.kind,
				payload: workParallelismAssessmentPayloadSchema.parse(event.payload),
			};
		case "work_delegation_outcome_recorded":
			return {
				...event,
				kind: event.kind,
				payload: workDelegationOutcomePayloadSchema.parse(event.payload),
			};
		case "work_delegation_waived":
			return {
				...event,
				kind: event.kind,
				payload: workDelegationWaiverPayloadSchema.parse(event.payload),
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
	if (state.terminal_history) {
		throw new Error(
			"typed Work semantic, progress, and evidence mutation is forbidden after terminal lifecycle history",
		);
	}
	if (parsed.kind === "work_contract_revised") {
		assertContractRevision(parsed.payload, state.revision, state.contract_hash);
		assertContractLineage(
			state.requirements,
			parsed.payload.contract.requirements,
		);
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
		"basis_contract_revision" in parsed.payload &&
		parsed.payload.basis_contract_revision !== state.revision
	) {
		throw new Error("typed Work event basis_contract_revision is stale");
	}
	if (
		"policy_hash" in parsed.payload &&
		parsed.payload.policy_hash !== state.policy_snapshot.policy_hash
	) {
		throw new Error("typed Work event policy_hash is stale");
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
			throw new Error(
				"waived Work requirement transition requires reason, authority, source, and evidence",
			);
		}
		if (parsed.payload.status !== "waived" && parsed.payload.waiver) {
			throw new Error(
				"Work requirement waiver metadata is only valid for waived transitions",
			);
		}
	}
	if (parsed.kind === "work_lifecycle_changed") {
		if (parsed.payload.lifecycle !== "completed") {
			throw new Error("only completed Work lifecycle closure is supported");
		}
		if (
			!state.requirements.some((requirement) =>
				requirement.source_event_ids.includes(parsed.payload.source_event_id),
			)
		) {
			throw new Error(
				"Work close authority source must be referenced by the current contract",
			);
		}
		assertCompletedLifecycleReady(state);
		if (state.terminal_history) {
			throw new Error("terminal Work lifecycle cannot be changed or reopened");
		}
	}
	if (
		parsed.kind === "work_requirement_transitioned" &&
		!state.requirement_ids.has(parsed.payload.requirement_id)
	) {
		throw new Error(
			`unknown typed Work requirement: ${parsed.payload.requirement_id}`,
		);
	}
	assertExecutionEvidenceEvent(records, parsed, state);
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
	validateWorkEventAppend(
		readWorkLedger(options.ledgerPath).records,
		options.event,
	);
	throw new Error(
		"typed Work events require the official source publication API",
	);
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
	requirement_statuses: Map<
		string,
		| "pending"
		| "in_progress"
		| "implemented_unverified"
		| "verified"
		| "blocked"
		| "waived"
	>;
	boundary_state: WorkContractDefinition["boundary"]["state"];
	open_conflicts: Set<string>;
	policy_snapshot: WorkPolicySnapshot;
	terminal_history: boolean;
} | null {
	let state: ReturnType<typeof typedState> = null;
	for (const [index, record] of records.entries()) {
		const expectedSchema =
			WORK_TYPED_EVENT_KIND_SCHEMA_PAIRS[
				record.kind as keyof typeof WORK_TYPED_EVENT_KIND_SCHEMA_PAIRS
			];
		if (
			expectedSchema !== undefined &&
			record.payload.schema_version !== expectedSchema
		) {
			throw new Error(
				`canonical typed Work event ${record.kind} requires its exact schema discriminator`,
			);
		}
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
			if (state.terminal_history)
				throw new Error(
					"typed Work semantic mutation is forbidden after terminal lifecycle history",
				);
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
			state = contractState(parsed.payload, state);
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
					throw new Error(
						"typed Work semantic/progress mutation is forbidden after terminal lifecycle history",
					);
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
					throw new Error(
						"waived Work requirement transition requires reason, authority, source, and evidence",
					);
				if (parsed.payload.status !== "waived" && parsed.payload.waiver)
					throw new Error(
						"Work requirement waiver metadata is only valid for waived transitions",
					);
				state.requirement_statuses.set(
					parsed.payload.requirement_id,
					parsed.payload.status,
				);
			} else {
				if (parsed.payload.lifecycle !== "completed")
					throw new Error("only completed Work lifecycle closure is supported");
				if (
					parsed.payload.basis_contract_revision !== state.revision ||
					parsed.payload.policy_hash !== state.policy_snapshot.policy_hash
				)
					throw new Error("invalid typed Work lifecycle execution basis");
				if (
					!state.requirements.some((requirement) =>
						requirement.source_event_ids.includes(
							parsed.payload.source_event_id,
						),
					)
				)
					throw new Error(
						"Work close authority source must be referenced by the current contract",
					);
				assertCompletedLifecycleReady(state);
				if (state.terminal_history)
					throw new Error(
						"terminal Work lifecycle cannot be changed or reopened",
					);
				state.terminal_history = true;
			}
		} else {
			if (!state)
				throw new Error("typed Work evidence precedes typed work_created");
			if (state.terminal_history)
				throw new Error(
					"typed Work evidence mutation is forbidden after terminal lifecycle history",
				);
			if (
				parsed.payload.work_id !== state.work_id ||
				!("basis_contract_hash" in parsed.payload) ||
				parsed.payload.basis_contract_hash !== state.contract_hash ||
				!("basis_contract_revision" in parsed.payload) ||
				parsed.payload.basis_contract_revision !== state.revision ||
				!("policy_hash" in parsed.payload) ||
				parsed.payload.policy_hash !== state.policy_snapshot.policy_hash
			) {
				throw new Error("invalid typed Work evidence basis");
			}
			assertExecutionEvidenceEvent(records.slice(0, index), parsed, state);
		}
	}
	return state;
}

function contractState(
	payload: WorkContractPayload,
	previous?: NonNullable<ReturnType<typeof typedState>>,
) {
	const superseded = new Set(
		payload.contract.requirements.flatMap(
			(requirement) => requirement.supersedes ?? [],
		),
	);
	return {
		work_id: payload.work_id,
		revision: payload.contract_revision,
		contract_hash: payload.contract_hash,
		requirement_ids: new Set(
			payload.contract.requirements.map((item) => item.id),
		),
		requirements: payload.contract.requirements.map((item) => ({
			...item,
			source_event_ids: [...item.source_event_ids],
			...(item.supersedes ? { supersedes: [...item.supersedes] } : {}),
		})),
		requirement_statuses: new Map(
			payload.contract.requirements.map((requirement) => [
				requirement.id,
				superseded.has(requirement.id) || requirement.superseded_by
					? ("waived" as const)
					: (previous?.requirement_statuses.get(requirement.id) ??
						("pending" as const)),
			]),
		),
		boundary_state: payload.contract.boundary.state,
		open_conflicts: new Set(
			payload.contract.open_conflicts.map((conflict) => conflict.id),
		),
		policy_snapshot: payload.contract.policy_snapshot,
		terminal_history: previous?.terminal_history ?? false,
	};
}

function assertCompletedLifecycleReady(
	state: NonNullable<ReturnType<typeof typedState>>,
): void {
	const applicableStatuses = [...state.requirement_statuses.values()].filter(
		(status) => status !== "waived",
	);
	if (
		state.boundary_state !== "accepted" ||
		state.open_conflicts.size > 0 ||
		applicableStatuses.length === 0 ||
		applicableStatuses.some((status) => status !== "verified")
	) {
		throw new Error(
			"completed Work lifecycle requires requirements-ready state",
		);
	}
}

function assertExecutionEvidenceEvent(
	records: readonly WorkLedgerRecord[],
	event: TypedWorkEvent,
	state: NonNullable<ReturnType<typeof typedState>>,
): void {
	switch (event.kind) {
		case "work_review_requested":
			assertReviewRequestMatchesPolicy(event.payload, state.policy_snapshot);
			break;
		case "work_review_attempt_recorded":
			assertReviewAttemptMatchesRequest(
				records,
				event.payload,
				state.policy_snapshot,
			);
			break;
		case "work_parallelism_assessed":
			assertParallelismAssessment(event.payload, state, records);
			break;
		case "work_delegation_outcome_recorded":
			assertDelegationOutcome(records, event.payload, state);
			break;
		case "work_delegation_waived":
			assertDelegationWaiver(records, event.payload, state);
			break;
	}
}

function assertReviewRequestMatchesPolicy(
	payload: WorkReviewRequestedPayload,
	policySnapshot: WorkPolicySnapshot,
): void {
	const gate = policySnapshot.policy.review.gates.find(
		(candidate) => candidate.gate === payload.gate,
	);
	if (!gate) throw new Error(`unknown Work review gate: ${payload.gate}`);
	if (
		canonicalJson(payload.provider_order) !==
			canonicalJson(gate.provider_order) ||
		payload.role_hint !== gate.role_hint ||
		payload.minimum_reviewers !== gate.minimum_reviewers
	) {
		throw new Error(
			"Work review request does not match the frozen gate policy",
		);
	}
}

function typedRecords(records: readonly WorkLedgerRecord[]): TypedWorkEvent[] {
	return records
		.filter((record) => isTypedPayload(record.payload))
		.map((record) => parseTypedWorkEvent(record));
}

function assertReviewAttemptMatchesRequest(
	records: readonly WorkLedgerRecord[],
	payload: WorkReviewAttemptPayload,
	policySnapshot: WorkPolicySnapshot,
): void {
	const events = typedRecords(records);
	let requestIndex = -1;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index]!;
		if (
			event.kind === "work_review_requested" &&
			event.payload.gate === payload.gate
		) {
			requestIndex = index;
			break;
		}
	}
	const request = requestIndex >= 0 ? events[requestIndex] : null;
	if (
		!request ||
		request.kind !== "work_review_requested" ||
		request.payload.activity_id !== payload.activity_id ||
		request.payload.review_input_hash !== payload.review_input_hash
	) {
		throw new Error(
			"Work review attempt targets an unknown or superseded activity",
		);
	}
	const priorAttempts = events
		.slice(requestIndex + 1)
		.filter(
			(
				event,
			): event is Extract<
				TypedWorkEvent,
				{ kind: "work_review_attempt_recorded" }
			> =>
				event.kind === "work_review_attempt_recorded" &&
				event.payload.gate === payload.gate &&
				event.payload.activity_id === payload.activity_id &&
				event.payload.review_input_hash === payload.review_input_hash,
		);
	let providerIndex = 0;
	for (const attempt of priorAttempts) {
		if (
			!["authorization_error", "unsupported_authority", "unavailable"].includes(
				attempt.payload.outcome,
			)
		)
			continue;
		const canFallback = policySnapshot.policy.review.fallback_on.includes(
			attempt.payload.outcome as
				| "authorization_error"
				| "unsupported_authority"
				| "unavailable",
		);
		if (
			!canFallback ||
			request.payload.provider_order[providerIndex + 1] === undefined
		) {
			throw new Error(
				"Work review activity is terminal after provider unavailability; request a new review activity",
			);
		}
		providerIndex += 1;
	}
	const currentProvider = request.payload.provider_order[providerIndex] ?? null;
	if (
		currentProvider !== payload.provider ||
		request.payload.role_hint !== payload.role
	) {
		throw new Error(
			"Work review attempt does not match the requested provider/role",
		);
	}
	if (
		"artifact_refs" in payload &&
		canonicalJson(payload.artifact_refs) !==
			canonicalJson(request.payload.artifact_refs)
	) {
		throw new Error(
			"Work review attempt artifact refs do not match the request",
		);
	}
}

function assertParallelismAssessment(
	payload: WorkParallelismAssessmentPayload,
	state: NonNullable<ReturnType<typeof typedState>>,
	records: readonly WorkLedgerRecord[],
): void {
	const priorAssessments = typedRecords(records).filter(
		(
			event,
		): event is Extract<
			TypedWorkEvent,
			{ kind: "work_parallelism_assessed" }
		> => event.kind === "work_parallelism_assessed",
	);
	if (
		priorAssessments.some(
			(event) =>
				event.payload.assessment_input_hash === payload.assessment_input_hash,
		)
	) {
		throw new Error(
			"Work parallelism reassessment requires a changed canonical input hash",
		);
	}
	const reusedAssessment = typedRecords(records).find(
		(
			event,
		): event is Extract<
			TypedWorkEvent,
			{ kind: "work_parallelism_assessed" }
		> =>
			event.kind === "work_parallelism_assessed" &&
			event.payload.assessment_id === payload.assessment_id,
	);
	if (
		reusedAssessment &&
		reusedAssessment.payload.assessment_input_hash !==
			payload.assessment_input_hash
	) {
		throw new Error(
			"Work assessment_id cannot be reused with changed input hash",
		);
	}
	const policy = state.policy_snapshot.policy.delegation;
	if (
		payload.lanes.length >
		Math.min(policy.max_agents, WORK_EXECUTION_LIMITS.maxChildContracts)
	) {
		throw new Error(
			"Work parallelism assessment exceeds the frozen max_agents policy",
		);
	}
	for (const lane of payload.lanes) {
		for (const requirementId of lane.requirement_ids) {
			if (!state.requirement_ids.has(requirementId)) {
				throw new Error(`unknown Work requirement in lane: ${requirementId}`);
			}
		}
	}
	assertLaneGraph(payload.lanes);
	if (payload.decision === "parallel") {
		if (payload.lanes.length < 2 || payload.selected_provider === null) {
			throw new Error(
				"parallel assessment requires at least two lanes and a provider",
			);
		}
		if (!delegationCandidates(policy).includes(payload.selected_provider)) {
			throw new Error(
				"parallel assessment selected a provider outside frozen policy",
			);
		}
	} else if (payload.selected_provider !== null) {
		throw new Error(
			"solo/not_parallelizable assessment cannot select a provider",
		);
	}
	if (policy.parallelism === "required" && payload.decision === "solo") {
		throw new Error("required parallelism cannot be assessed as plain solo");
	}
	if (
		policy.parallelism === "required" &&
		payload.decision === "not_parallelizable" &&
		!payload.rationale_codes.some((code) =>
			["indivisible", "dependency", "conflict"].some(
				(prefix) => code === prefix || code.startsWith(`${prefix}_`),
			),
		)
	) {
		throw new Error(
			"required not_parallelizable assessment requires an allowed indivisibility rationale",
		);
	}
	if (
		policy.parallelism === "prefer" &&
		payload.decision === "solo" &&
		!payload.rationale_codes.some((code) =>
			["indivisible", "dependency", "conflict", "provider_unavailable"].some(
				(prefix) => code === prefix || code.startsWith(`${prefix}_`),
			),
		)
	) {
		throw new Error(
			"preferred parallelism solo decision requires an allowed rationale",
		);
	}
}

function assertDelegationOutcome(
	records: readonly WorkLedgerRecord[],
	payload: WorkDelegationOutcomePayload,
	state: NonNullable<ReturnType<typeof typedState>>,
): void {
	const assessment = typedRecords(records)
		.reverse()
		.find(
			(
				event,
			): event is Extract<
				TypedWorkEvent,
				{ kind: "work_parallelism_assessed" }
			> => event.kind === "work_parallelism_assessed",
		);
	if (
		!assessment ||
		assessment.payload.assessment_id !== payload.assessment_id ||
		assessment.payload.assessment_input_hash !== payload.assessment_input_hash
	) {
		throw new Error(
			"Work delegation outcome targets an unknown or stale assessment",
		);
	}
	const policy = state.policy_snapshot.policy.delegation;
	const candidates = delegationCandidates(policy);
	const priorOutcomes = typedRecords(records).filter(
		(
			event,
		): event is Extract<
			TypedWorkEvent,
			{ kind: "work_delegation_outcome_recorded" }
		> =>
			event.kind === "work_delegation_outcome_recorded" &&
			event.payload.assessment_id === payload.assessment_id &&
			event.payload.assessment_input_hash === payload.assessment_input_hash,
	);
	if (
		typedRecords(records).some(
			(event) =>
				event.kind === "work_delegation_waived" &&
				event.payload.assessment_id === payload.assessment_id &&
				event.payload.assessment_input_hash === payload.assessment_input_hash,
		)
	) {
		throw new Error("Work delegation assessment is terminal after a waiver");
	}
	if (
		priorOutcomes.some(
			(event) =>
				event.payload.outcome === "results_recorded" ||
				(event.payload.outcome === "delegated" &&
					payload.outcome !== "results_recorded"),
		)
	) {
		throw new Error(
			"Work delegation assessment already has a terminal recorded outcome",
		);
	}
	if (
		"failure_fingerprint" in payload &&
		priorOutcomes.some(
			(event) =>
				"failure_fingerprint" in event.payload &&
				event.payload.failure_fingerprint === payload.failure_fingerprint,
		)
	) {
		throw new Error("duplicate Work delegation failure fingerprint");
	}
	let currentProvider = assessment.payload.selected_provider;
	for (const outcome of priorOutcomes) {
		if (
			![
				"authorization_error",
				"unsupported_authority",
				"unavailable",
				"runtime_incompatible",
			].includes(outcome.payload.outcome)
		)
			continue;
		if (policy.unavailable !== "fallback") {
			throw new Error(
				"Work delegation assessment is terminal after provider unavailability",
			);
		}
		const currentIndex = candidates.indexOf(currentProvider!);
		currentProvider =
			currentIndex < 0 ? null : (candidates[currentIndex + 1] ?? null);
		if (currentProvider === null) {
			throw new Error(
				"Work delegation assessment is terminal after provider exhaustion",
			);
		}
	}
	if (currentProvider !== payload.provider) {
		throw new Error(
			"Work delegation outcome provider is outside frozen policy",
		);
	}
	if (
		payload.outcome === "delegated" &&
		payload.delegation_contract_hash !==
			calculateWorkDelegationContractHash(payload)
	) {
		throw new Error("Work delegation contract hash mismatch");
	}
	if (
		[
			"authorization_error",
			"unsupported_authority",
			"unavailable",
			"runtime_incompatible",
		].includes(payload.outcome) &&
		"failure_fingerprint" in payload &&
		payload.failure_fingerprint !==
			calculateWorkDelegationFailureFingerprint(
				payload,
				assessment.payload.lanes,
			)
	) {
		throw new Error("Work delegation failure fingerprint mismatch");
	}
	if (payload.outcome === "delegated") {
		if (assessment.payload.decision !== "parallel") {
			throw new Error("delegated outcome requires a parallel assessment");
		}
		if (
			payload.child_contracts.length >
			state.policy_snapshot.policy.delegation.max_agents
		) {
			throw new Error("delegated child contracts exceed frozen max_agents");
		}
		const lanes = new Map(
			assessment.payload.lanes.map((lane) => [lane.lane_id, lane]),
		);
		if (payload.child_contracts.length !== lanes.size) {
			throw new Error(
				"delegated child contracts must cover every assessed lane",
			);
		}
		for (const child of payload.child_contracts) {
			const lane = lanes.get(child.lane_id);
			if (!lane)
				throw new Error(
					`delegated child contract has unknown lane: ${child.lane_id}`,
				);
			if (
				child.work_id !== state.work_id ||
				child.basis_contract_revision !== state.revision
			) {
				throw new Error(
					"delegated child contract targets a different Work basis",
				);
			}
			if (
				canonicalJson(child.requirement_ids) !==
					canonicalJson(lane.requirement_ids) ||
				canonicalJson(child.repository_scopes) !==
					canonicalJson(lane.repository_scopes) ||
				canonicalJson(child.external_effects) !==
					canonicalJson(lane.external_effects)
			) {
				throw new Error(
					"delegated child contract expands or changes its assessed lane",
				);
			}
		}
	}
	if (payload.outcome === "results_recorded") {
		const delegated = typedRecords(records)
			.reverse()
			.find(
				(
					event,
				): event is Extract<
					TypedWorkEvent,
					{ kind: "work_delegation_outcome_recorded" }
				> =>
					event.kind === "work_delegation_outcome_recorded" &&
					event.payload.outcome === "delegated" &&
					event.payload.assessment_id === payload.assessment_id &&
					event.payload.assessment_input_hash ===
						payload.assessment_input_hash &&
					event.payload.provider === payload.provider,
			);
		if (
			!delegated ||
			delegated.payload.outcome !== "delegated" ||
			delegated.payload.delegation_contract_hash !==
				payload.delegation_contract_hash
		) {
			throw new Error(
				"delegation results require the exact prior contract hash",
			);
		}
	}
}

function assertDelegationWaiver(
	records: readonly WorkLedgerRecord[],
	payload: WorkDelegationWaiverPayload,
	state: NonNullable<ReturnType<typeof typedState>>,
): void {
	const latestAssessment = typedRecords(records)
		.reverse()
		.find(
			(
				event,
			): event is Extract<
				TypedWorkEvent,
				{ kind: "work_parallelism_assessed" }
			> => event.kind === "work_parallelism_assessed",
		);
	if (
		!latestAssessment ||
		latestAssessment.payload.assessment_id !== payload.assessment_id ||
		latestAssessment.payload.assessment_input_hash !==
			payload.assessment_input_hash
	) {
		throw new Error("Work delegation waiver requires the current assessment");
	}
	const outcomes = typedRecords(records).filter(
		(
			event,
		): event is Extract<
			TypedWorkEvent,
			{ kind: "work_delegation_outcome_recorded" }
		> =>
			event.kind === "work_delegation_outcome_recorded" &&
			event.payload.assessment_id === payload.assessment_id &&
			event.payload.assessment_input_hash === payload.assessment_input_hash,
	);
	if (
		outcomes.some(
			(event) =>
				event.payload.outcome === "delegated" ||
				event.payload.outcome === "results_recorded",
		)
	) {
		throw new Error(
			"Work delegation waiver cannot overwrite delegated or completed evidence",
		);
	}
	const policy = state.policy_snapshot.policy.delegation;
	const candidates = delegationCandidates(policy);
	let provider = latestAssessment.payload.selected_provider;
	for (const outcome of outcomes) {
		if (
			![
				"authorization_error",
				"unsupported_authority",
				"unavailable",
				"runtime_incompatible",
			].includes(outcome.payload.outcome)
		)
			continue;
		if (policy.unavailable !== "fallback") {
			throw new Error(
				"Work delegation waiver cannot overwrite a terminal unavailable outcome",
			);
		}
		const index = candidates.indexOf(provider!);
		provider = index < 0 ? null : (candidates[index + 1] ?? null);
		if (provider === null) {
			throw new Error(
				"Work delegation waiver cannot overwrite provider exhaustion",
			);
		}
	}
}

function assertLaneGraph(lanes: readonly WorkParallelLane[]): void {
	const byId = new Map(lanes.map((lane) => [lane.lane_id, lane]));
	for (const lane of lanes) {
		for (const dependency of lane.depends_on) {
			if (dependency === lane.lane_id || !byId.has(dependency)) {
				throw new Error(`invalid Work lane dependency: ${dependency}`);
			}
		}
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string) => {
		if (visiting.has(id)) throw new Error("Work lane dependency cycle");
		if (visited.has(id)) return;
		visiting.add(id);
		for (const dependency of byId.get(id)!.depends_on) visit(dependency);
		visiting.delete(id);
		visited.add(id);
	};
	for (const lane of lanes) visit(lane.lane_id);
	const ordered = (left: string, right: string): boolean => {
		const pending = [...(byId.get(left)?.depends_on ?? [])];
		const seen = new Set<string>();
		while (pending.length > 0) {
			const current = pending.pop()!;
			if (current === right) return true;
			if (seen.has(current)) continue;
			seen.add(current);
			pending.push(...(byId.get(current)?.depends_on ?? []));
		}
		return false;
	};
	for (let leftIndex = 0; leftIndex < lanes.length; leftIndex += 1) {
		for (
			let rightIndex = leftIndex + 1;
			rightIndex < lanes.length;
			rightIndex += 1
		) {
			const left = lanes[leftIndex]!;
			const right = lanes[rightIndex]!;
			if (
				ordered(left.lane_id, right.lane_id) ||
				ordered(right.lane_id, left.lane_id)
			)
				continue;
			if (lanesConflict(left, right)) {
				throw new Error(
					`unsafe unordered Work lanes: ${left.lane_id}, ${right.lane_id}`,
				);
			}
		}
	}
}

function lanesConflict(
	left: WorkParallelLane,
	right: WorkParallelLane,
): boolean {
	for (const leftScope of left.repository_scopes) {
		for (const rightScope of right.repository_scopes) {
			if (
				(leftScope.access === "write" || rightScope.access === "write") &&
				repositoryScopesOverlap(leftScope, rightScope)
			)
				return true;
		}
	}
	for (const leftEffect of left.external_effects) {
		for (const rightEffect of right.external_effects) {
			if (
				leftEffect.resource_kind === rightEffect.resource_kind &&
				leftEffect.resource_ref === rightEffect.resource_ref &&
				(leftEffect.access === "write" ||
					rightEffect.access === "write" ||
					leftEffect.irreversible ||
					rightEffect.irreversible)
			)
				return true;
		}
	}
	return false;
}

function delegationCandidates(
	policy: NormalizedDelegationPolicy,
): WorkDelegationProvider[] {
	const required =
		policy.native_agents === "required"
			? "native_agents"
			: policy.tmux_team === "required"
				? "tmux_team"
				: null;
	if (required) return [required];
	return policy.fallback_order.filter(
		(provider) =>
			(provider === "native_agents"
				? policy.native_agents
				: policy.tmux_team) !== "never",
	);
}

function assertContractLineage(
	previous: readonly WorkRequirementDefinition[],
	next: readonly WorkRequirementDefinition[],
): void {
	const previousById = new Map(previous.map((item) => [item.id, item]));
	const nextById = new Map(next.map((item) => [item.id, item]));
	const previouslySuperseded = new Set(
		previous.flatMap((item) => item.supersedes ?? []),
	);
	const supersedingOwner = new Map<string, string>();
	for (const [id, before] of previousById) {
		const after = nextById.get(id);
		if (!after)
			throw new Error(`Work contract revision removed requirement ${id}`);
		if (
			before.summary !== after.summary ||
			before.weight !== after.weight ||
			before.superseded_by !== after.superseded_by ||
			canonicalJson(before.supersedes ?? []) !==
				canonicalJson(after.supersedes ?? [])
		) {
			throw new Error(
				`Work requirement ${id} semantic definition is immutable`,
			);
		}
		const sources = new Set(after.source_event_ids);
		if (!before.source_event_ids.every((source) => sources.has(source)))
			throw new Error(
				`Work requirement ${id} source_event_ids are append-only`,
			);
	}
	for (const requirement of next) {
		for (const target of requirement.supersedes ?? []) {
			if (target === requirement.id)
				throw new Error("Work requirement cannot supersede itself");
			if (!previousById.has(target))
				throw new Error(
					`Work requirement supersedes unknown prior requirement ${target}`,
				);
			const existingOwner = supersedingOwner.get(target);
			if (existingOwner && existingOwner !== requirement.id)
				throw new Error(
					`Work requirement ${target} has multiple superseding requirements`,
				);
			supersedingOwner.set(target, requirement.id);
			if (!previousById.has(requirement.id) && previouslySuperseded.has(target))
				throw new Error(`Work requirement ${target} is already superseded`);
		}
	}
	for (const requirement of next) {
		const seen = new Set<string>();
		let cursor: WorkRequirementDefinition | undefined = requirement;
		while (cursor?.superseded_by) {
			if (seen.has(cursor.id))
				throw new Error("Work requirement supersession cycle");
			seen.add(cursor.id);
			cursor = nextById.get(cursor.superseded_by);
			if (!cursor)
				throw new Error(`Work requirement superseded_by target is unknown`);
		}
	}
}

function ledgerMode(
	records: readonly WorkLedgerRecord[],
): "empty" | "legacy" | "typed" {
	const created = records.find((record) => record.kind === "work_created");
	if (!created) return records.length === 0 ? "empty" : "legacy";
	return isTypedPayload(created.payload) ? "typed" : "legacy";
}

function isTypedPayload(payload: Record<string, unknown>): boolean {
	return Object.values(WORK_TYPED_EVENT_KIND_SCHEMA_PAIRS).includes(
		payload.schema_version as never,
	);
}
