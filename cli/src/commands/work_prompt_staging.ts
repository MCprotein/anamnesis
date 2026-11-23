import { findAgentfile, readAgentfile } from "../core/agentfile.js";
import {
	parseStagedWorkContractDraft,
	parseWorkPromptRetainDraft,
} from "../core/work_command_draft.js";
import {
	calculateWorkContractHash,
	parseTypedWorkEvent,
	type TypedWorkEvent,
	type WorkContractDefinition,
} from "../core/work_contract.js";
import { readWorkLedger } from "../core/work_ledger.js";
import { createWorkPolicySnapshot } from "../core/work_policy.js";
import {
	foldWorkProjection,
	rebuildWorkProjection,
} from "../core/work_projection.js";
import { normalizeWorkPromptCapturePolicy } from "../core/work_prompt_policy.js";
import {
	allocateStagedWorkPromptToTypedWork,
	bindRetainedProvisionalPromptToTypedWork,
	deriveWorkPromptSourceEventId,
	discardStagedWorkPrompt,
	gcStagedWorkPrompts,
	readWorkPromptStageOutcome,
	retainStagedWorkPromptProvisional,
	type WorkPromptStageOutcome,
} from "../core/work_prompt_stage.js";
import { resolveWorkStateRoot } from "../core/work_storage.js";
import { sha256 } from "../util/hash.js";
import { assertSafeId, workLocations } from "./work_command_input.js";
import {
	assertBoundaryClassification,
	assertCurrentSourceReferenced,
	assertIdempotentMutationCandidate,
} from "./work_mutation.js";
import {
	nextRevisionPolicy,
	resolveCommandPolicy,
} from "./work_policy_resolution.js";
import type {
	DiscardStagedWorkPromptInput,
	GcStagedWorkPromptInput,
	GcStagedWorkPromptResult,
	PublicWorkPromptResolutionResult,
	RetainStagedWorkPromptInput,
	StagedWorkAllocationInput,
	WorkPromptResolutionResult,
} from "./work_types.js";

export function publicWorkPromptResolution(
	result: WorkPromptResolutionResult,
): PublicWorkPromptResolutionResult {
	const outcome = result.outcome;
	const publicOutcome: Record<string, unknown> = {
		schema_version: outcome.schema_version,
		capture_id: outcome.capture_id,
		outcome: outcome.outcome,
		resolved_at: outcome.resolved_at,
	};
	if (outcome.outcome === "discarded") publicOutcome.reason = outcome.reason;
	if (outcome.outcome === "provisional") {
		Object.assign(publicOutcome, {
			source_event_id: outcome.source_event_id,
			boundary_state: outcome.boundary_state,
			classification: outcome.classification,
			reason_codes: outcome.reason_codes,
			...(outcome.question === undefined ? {} : { question: outcome.question }),
		});
	}
	if (outcome.outcome === "allocated") {
		Object.assign(publicOutcome, {
			source_event_id: outcome.source_event_id,
			decision: outcome.decision,
			work_id: outcome.work_id,
			ledger_event_id: outcome.ledger_event_id,
		});
	}
	return { ...result, outcome: publicOutcome };
}

export function allocateStagedPromptToNewWork(
	input: StagedWorkAllocationInput,
): WorkPromptResolutionResult {
	return allocateStagedPrompt(input, "allocate_new");
}

export function allocateStagedPromptToSameWork(
	input: StagedWorkAllocationInput,
): WorkPromptResolutionResult {
	return allocateStagedPrompt(input, "allocate_same");
}

export function retainStagedPromptProvisional(
	input: RetainStagedWorkPromptInput,
): WorkPromptResolutionResult {
	const state = resolveWorkStateRoot(input.project_root, input.state_root);
	const draft = parseWorkPromptRetainDraft(input.draft);
	const outcome = retainStagedWorkPromptProvisional({
		stateRoot: state.state_root,
		captureId: input.capture_id,
		resolvedAt: input.resolved_at,
		boundaryState: draft.boundary.state,
		classification: draft.boundary.classification,
		reasonCodes: draft.boundary.reason_codes,
		question: draft.question,
	});
	return {
		schema_version: "anamnesis.work-prompt-resolution.v1",
		capture_id: input.capture_id,
		resolution: "retain_provisional",
		outcome,
		work_id: null,
		ledger_path: null,
		projection_path: null,
		projection: null,
	};
}

export function discardStagedPrompt(
	input: DiscardStagedWorkPromptInput,
): WorkPromptResolutionResult {
	const state = resolveWorkStateRoot(input.project_root, input.state_root);
	const outcome = discardStagedWorkPrompt({
		stateRoot: state.state_root,
		captureId: input.capture_id,
		resolvedAt: input.resolved_at,
		reason: input.reason,
	});
	return {
		schema_version: "anamnesis.work-prompt-resolution.v1",
		capture_id: input.capture_id,
		resolution: "discard",
		outcome,
		work_id: null,
		ledger_path: null,
		projection_path: null,
		projection: null,
	};
}

export function gcStagedWorkPromptEntries(
	input: GcStagedWorkPromptInput,
): GcStagedWorkPromptResult {
	const state = resolveWorkStateRoot(input.project_root, input.state_root);
	const agentfilePath = findAgentfile(input.project_root);
	const agentfile = agentfilePath ? readAgentfile(input.project_root) : null;
	const policy = normalizeWorkPromptCapturePolicy(
		agentfile?.version === 2
			? agentfile.settings?.work_prompt_capture
			: undefined,
	);
	const now = input.now === undefined ? Date.now() : Date.parse(input.now);
	if (!Number.isFinite(now))
		throw new Error("invalid Work prompt GC timestamp");
	return {
		schema_version: "anamnesis.work-prompt-gc.v1",
		...gcStagedWorkPrompts(state.state_root, policy, now),
	};
}

function allocateStagedPrompt(
	input: StagedWorkAllocationInput,
	decision: "allocate_same" | "allocate_new",
): WorkPromptResolutionResult {
	assertSafeId(input.work_id, "work ID");
	const locations = workLocations(input);
	let ledger = readWorkLedger(locations.ledgerPath);
	const sourceEventId = deriveWorkPromptSourceEventId(input.capture_id);
	const draft = parseStagedWorkContractDraft(input.draft, sourceEventId);
	assertBoundaryClassification(
		draft,
		decision === "allocate_new" ? "new_unit" : "same_unit",
		decision === "allocate_new" ? "create" : "amend",
	);
	assertCurrentSourceReferenced(draft, sourceEventId);

	const eventId = stagedAllocationEventId(
		input.capture_id,
		decision,
		input.work_id,
	);
	const existing = ledger.records.find((record) => record.event_id === eventId);
	if (
		decision === "allocate_new" &&
		(input.expected_head !== null ||
			input.expected_contract_revision !== null ||
			input.expected_contract_hash !== null)
	) {
		throw new Error(
			"allocate-new requires null expected contract and ledger authority",
		);
	}
	let revision: number;
	let previousRevision: number | null;
	let previousHash: string | null;
	let policy: ReturnType<typeof createWorkPolicySnapshot>;
	let occurredAt = input.occurred_at;

	if (existing) {
		if (
			(decision === "allocate_new" && existing.kind !== "work_created") ||
			(decision === "allocate_same" &&
				existing.kind !== "work_contract_revised")
		) {
			throw new Error(`work ledger event ID collision: ${eventId}`);
		}
		const parsed = parseTypedWorkEvent(existing);
		if (
			parsed.kind !== "work_created" &&
			parsed.kind !== "work_contract_revised"
		) {
			throw new Error(`invalid stored staged Work allocation: ${eventId}`);
		}
		revision = parsed.payload.contract_revision;
		previousRevision = parsed.payload.previous_contract_revision;
		previousHash = parsed.payload.previous_contract_hash;
		policy = parsed.payload.contract.policy_snapshot;
		occurredAt = existing.occurred_at;
	} else if (decision === "allocate_new") {
		if (
			ledger.records.length !== 0 ||
			input.expected_head !== null ||
			input.expected_contract_revision !== null ||
			input.expected_contract_hash !== null
		) {
			throw new Error(
				"allocate-new requires an empty Work and null expected contract/head",
			);
		}
		revision = 1;
		previousRevision = null;
		previousHash = null;
		policy = createWorkPolicySnapshot(1, resolveCommandPolicy(input));
	} else {
		if (
			input.expected_head === null ||
			input.expected_contract_revision === null ||
			input.expected_contract_hash === null
		) {
			throw new Error(
				"allocate-same requires exact expected head, contract revision, and contract hash",
			);
		}
		if (ledger.head !== input.expected_head) {
			throw new Error("staged Work allocation observed a stale ledger head");
		}
		const projection = foldWorkProjection(ledger.records);
		if (
			projection.work_id !== input.work_id ||
			projection.contract_revision !== input.expected_contract_revision ||
			projection.contract_hash !== input.expected_contract_hash ||
			!projection.policy_snapshot
		) {
			throw new Error(
				"staged Work allocation observed stale Work contract truth",
			);
		}
		revision = projection.contract_revision + 1;
		previousRevision = projection.contract_revision;
		previousHash = projection.contract_hash;
		policy = createWorkPolicySnapshot(
			revision,
			nextRevisionPolicy(input.project_root, projection.policy_snapshot.policy),
		);
	}

	if (decision === "allocate_same") {
		if (
			input.expected_head !== (existing?.previous_hash ?? ledger.head) ||
			input.expected_contract_revision !== previousRevision ||
			input.expected_contract_hash !== previousHash
		) {
			throw new Error(
				"staged Work allocation assertion does not match prior contract",
			);
		}
	}
	const contract: WorkContractDefinition = {
		...draft,
		work: { id: input.work_id, ...draft.work },
		policy_snapshot: policy,
	};
	const event: TypedWorkEvent = {
		event_id: eventId,
		occurred_at: occurredAt,
		kind:
			decision === "allocate_new" ? "work_created" : "work_contract_revised",
		payload: {
			schema_version: "anamnesis.work-contract-event.v1",
			work_id: input.work_id,
			contract_revision: revision,
			previous_contract_revision: previousRevision,
			previous_contract_hash: previousHash,
			contract_hash: calculateWorkContractHash(contract),
			contract,
			source_event_id: sourceEventId,
		},
	};
	if (existing) {
		assertIdempotentMutationCandidate(existing, event, sourceEventId);
		ledger = readWorkLedger(locations.ledgerPath);
	}
	const commitExpectedHead = existing ? existing.previous_hash : ledger.head;
	const priorOutcome = readWorkPromptStageOutcome(
		locations.stateRoot,
		input.capture_id,
	);
	let outcome: WorkPromptStageOutcome;
	if (priorOutcome?.outcome === "provisional") {
		bindRetainedProvisionalPromptToTypedWork({
			stateRoot: locations.stateRoot,
			captureId: input.capture_id,
			boundAt: input.occurred_at,
			decision,
			workId: input.work_id,
			ledgerPath: locations.ledgerPath,
			ledgerEvent: event,
			expectedHead: commitExpectedHead,
		});
		outcome = priorOutcome;
	} else {
		outcome = allocateStagedWorkPromptToTypedWork({
			stateRoot: locations.stateRoot,
			captureId: input.capture_id,
			resolvedAt: input.occurred_at,
			decision,
			workId: input.work_id,
			ledgerPath: locations.ledgerPath,
			ledgerEvent: event,
			expectedHead: commitExpectedHead,
		});
	}
	const projection = rebuildWorkProjection(
		locations.ledgerPath,
		locations.projectionPath,
	);
	return {
		schema_version: "anamnesis.work-prompt-resolution.v1",
		capture_id: input.capture_id,
		resolution: decision,
		outcome,
		work_id: input.work_id,
		ledger_path: locations.ledgerPath,
		projection_path: locations.projectionPath,
		projection,
	};
}

function stagedAllocationEventId(
	captureId: string,
	decision: "allocate_same" | "allocate_new",
	workId: string,
): string {
	return `prompt_alloc_${sha256(`anamnesis-prompt-allocation-v1\0${captureId}\0${decision}\0${workId}`).slice("sha256:".length)}`;
}
