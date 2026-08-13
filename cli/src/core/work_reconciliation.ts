import { isHash, sha256 } from "../util/hash.js";
import type { WorkCursorReconciliationState } from "./work_cursor.js";
import type {
	NormalizedReconciliationPolicy,
	ResolvedWorkPolicy,
	ReviewGateName,
} from "./work_policy.js";
import { validateNormalizedReconciliationPolicy } from "./work_policy.js";
import type {
	ProjectedRequirement,
	WorkLifecycle,
	WorkProjection,
	WorkProjectionProgress,
	WorkRequirementState,
} from "./work_projection.js";
import { calculateWorkProgress } from "./work_projection.js";

export const WORK_BRIEFING_SCHEMA_VERSION =
	"anamnesis.work-briefing.v1" as const;

export interface WorkBriefingDelta {
	added_requirement_ids: string[];
	status_changed: Array<{
		requirement_id: string;
		from: WorkRequirementState;
		to: WorkRequirementState;
	}>;
	superseded: Array<{ requirement_id: string; superseded_by: string }>;
	conflicts_added: string[];
	conflicts_resolved: string[];
}

export interface WorkBriefingSnapshot {
	schema_version: typeof WORK_BRIEFING_SCHEMA_VERSION;
	work_id: string;
	work: {
		title: string | null;
		completion_contract: string | null;
	};
	contract_revision: number;
	contract_hash: string | null;
	policy_hash: string | null;
	lifecycle: WorkLifecycle;
	requirements: Array<{
		id: string;
		summary: string;
		status: WorkRequirementState;
		source_event_ids: string[];
		evidence_refs: string[];
		superseded_by?: string;
	}>;
	requirement_ids_by_status: Record<WorkRequirementState, string[]>;
	requirement_authority: Array<{
		requirement_id: string;
		source_event_ids: string[];
	}>;
	requirement_evidence: Array<{
		requirement_id: string;
		evidence_refs: string[];
	}>;
	superseded_requirements: Array<{
		requirement_id: string;
		superseded_by: string;
	}>;
	conflicts: string[];
	blockers: { requirement_ids: string[]; conflict_ids: string[] };
	progress: WorkProjectionProgress & {
		mode: "count" | "weighted";
		denominator: number;
	};
	configured_required_gates: ReviewGateName[];
	next_requirement_ids: string[];
	baseline_available: boolean;
	delta: WorkBriefingDelta;
	semantic_fingerprint: string;
}

export interface BuildWorkBriefingInput {
	projection: WorkProjection;
	previous_confirmed?: WorkBriefingSnapshot | null;
}

const REQUIREMENT_STATES: readonly WorkRequirementState[] = [
	"pending",
	"in_progress",
	"implemented_unverified",
	"verified",
	"blocked",
	"waived",
];

/** Build a deterministic, display-neutral briefing contract from Work truth. */
export function buildWorkBriefingSnapshot(
	input: BuildWorkBriefingInput,
): WorkBriefingSnapshot {
	validateBriefingProjection(input.projection);
	const requirements = sortedRequirements(input.projection.requirements);
	const requirementIdsByStatus = Object.fromEntries(
		REQUIREMENT_STATES.map((status) => [
			status,
			requirements
				.filter((requirement) => requirement.status === status)
				.map((requirement) => requirement.id),
		]),
	) as Record<WorkRequirementState, string[]>;
	const requiredGates = [
		...new Set(input.projection.configured_required_gates),
	].sort(compareCodeUnits);
	const progress = {
		...input.projection.progress,
		mode: input.projection.progress.weighted ? "weighted" : "count",
		denominator: input.projection.progress.weighted
			? (input.projection.progress.applicable_weight ?? 0)
			: input.projection.progress.applicable,
	} as WorkBriefingSnapshot["progress"];
	const base = {
		schema_version: WORK_BRIEFING_SCHEMA_VERSION,
		work_id: input.projection.work_id,
		work: {
			title: input.projection.title,
			completion_contract: input.projection.completion_contract,
		},
		contract_revision: input.projection.contract_revision,
		contract_hash: input.projection.contract_hash,
		policy_hash: input.projection.policy_hash,
		lifecycle: input.projection.lifecycle,
		requirements: requirements.map((requirement) => ({
			id: requirement.id,
			summary: requirement.summary,
			status: requirement.status,
			source_event_ids: sortedUnique(requirement.source_event_ids),
			evidence_refs: sortedUnique(requirement.evidence_refs),
			...(requirement.superseded_by === undefined
				? {}
				: { superseded_by: requirement.superseded_by }),
		})),
		requirement_ids_by_status: requirementIdsByStatus,
		requirement_authority: requirements.map((requirement) => ({
			requirement_id: requirement.id,
			source_event_ids: sortedUnique(requirement.source_event_ids),
		})),
		requirement_evidence: requirements.map((requirement) => ({
			requirement_id: requirement.id,
			evidence_refs: sortedUnique(requirement.evidence_refs),
		})),
		superseded_requirements: requirements
			.filter(
				(
					requirement,
				): requirement is ProjectedRequirement & {
					superseded_by: string;
				} => requirement.superseded_by !== undefined,
			)
			.map((requirement) => ({
				requirement_id: requirement.id,
				superseded_by: requirement.superseded_by,
			})),
		conflicts: sortedUnique(input.projection.conflicts),
		blockers: {
			requirement_ids: requirementIdsByStatus.blocked,
			conflict_ids: sortedUnique(input.projection.conflicts),
		},
		progress,
		configured_required_gates: requiredGates,
		next_requirement_ids: [
			...requirementIdsByStatus.in_progress,
			...requirementIdsByStatus.implemented_unverified,
			...requirementIdsByStatus.pending,
			...requirementIdsByStatus.blocked,
		],
	};
	const semanticFingerprint = fingerprintBriefing(base);
	const previous = validBaseline(input.previous_confirmed, {
		...base,
		semantic_fingerprint: semanticFingerprint,
	});
	return {
		...base,
		baseline_available: previous !== null,
		delta: diffBriefings(previous, {
			...base,
			semantic_fingerprint: semanticFingerprint,
		}),
		semantic_fingerprint: semanticFingerprint,
	};
}

export interface EvaluateReconciliationDueInput {
	policy:
		| Pick<ResolvedWorkPolicy, "reconciliation">
		| {
				reconciliation: NormalizedReconciliationPolicy;
		  };
	lifecycle: WorkLifecycle;
	safe_boundary: boolean;
	trigger: NormalizedReconciliationPolicy["triggers"][number] | null;
	now: string;
	last_confirmed_at: string | null;
	meaningful_actions_since_confirmed: number;
	current_fingerprint: string;
	confirmed_fingerprint: string | null;
	/** Latest confirmed or explicitly unconfirmed delivery observation. */
	last_observed_fingerprint?: string | null;
}

export interface ReconciliationDueDecision {
	due: boolean;
	visible_emission: boolean;
	auto_continue: boolean;
	reasons: Array<"trigger" | "max_silence" | "meaningful_actions">;
}

/** Evaluate cadence only at an injected safe boundary. This function owns no clock. */
export function evaluateReconciliationDue(
	input: EvaluateReconciliationDueInput,
): ReconciliationDueDecision {
	const reconciliation = input.policy.reconciliation;
	validateDueInputs(input);
	if (reconciliation.due_after.max_silence !== null) {
		parseIsoDurationMilliseconds(reconciliation.due_after.max_silence);
	}
	validateTimestamp(input.now, "now");
	if (input.last_confirmed_at !== null) {
		validateTimestamp(input.last_confirmed_at, "last_confirmed_at");
	}
	if (
		!Number.isSafeInteger(input.meaningful_actions_since_confirmed) ||
		input.meaningful_actions_since_confirmed < 0
	) {
		throw new Error(
			"meaningful_actions_since_confirmed must be a non-negative safe integer",
		);
	}
	const comparisonFingerprint =
		input.last_observed_fingerprint === undefined
			? input.confirmed_fingerprint
			: input.last_observed_fingerprint;
	const changed = input.current_fingerprint !== comparisonFingerprint;
	if (reconciliation.preset === "off" || !input.safe_boundary) {
		return {
			due: false,
			visible_emission: false,
			auto_continue: false,
			reasons: [],
		};
	}
	const reasons: ReconciliationDueDecision["reasons"] = [];
	if (
		changed &&
		input.trigger !== null &&
		reconciliation.triggers.includes(input.trigger)
	) {
		reasons.push("trigger");
	}
	const actionThreshold = reconciliation.due_after.meaningful_actions;
	if (
		actionThreshold !== null &&
		input.meaningful_actions_since_confirmed >= actionThreshold
	) {
		reasons.push("meaningful_actions");
	}
	const silence = reconciliation.due_after.max_silence;
	if (silence !== null && input.last_confirmed_at !== null) {
		const elapsed = Math.max(
			0,
			Date.parse(input.now) - Date.parse(input.last_confirmed_at),
		);
		if (elapsed >= parseIsoDurationMilliseconds(silence)) {
			reasons.push("max_silence");
		}
	}
	const due = reasons.length > 0;
	return {
		due,
		visible_emission: due,
		auto_continue: due && input.lifecycle === "open",
		reasons,
	};
}

export function emptyWorkCursorReconciliationState(): WorkCursorReconciliationState {
	return {
		last_reconciled_head: null,
		last_reconciled_revision: null,
		last_reconciled_at: null,
		meaningful_actions_since_confirmed: 0,
		pending_delivery: null,
		confirmed_delivery_fingerprint: null,
		injected_unconfirmed: null,
	};
}

export function noteMeaningfulReconciliationAction(
	state: WorkCursorReconciliationState,
): WorkCursorReconciliationState {
	if (state.meaningful_actions_since_confirmed >= Number.MAX_SAFE_INTEGER) {
		throw new Error("meaningful action counter overflow");
	}
	return {
		...state,
		meaningful_actions_since_confirmed:
			state.meaningful_actions_since_confirmed + 1,
	};
}

/** Preparing/injecting content records retry intent but never claims delivery. */
export function prepareReconciliationDelivery(
	state: WorkCursorReconciliationState,
	delivery: ReconciliationDeliveryBinding,
): WorkCursorReconciliationState {
	validateDeliveryBinding(delivery);
	return { ...state, pending_delivery: { ...delivery } };
}

export interface ReconciliationDeliveryBinding {
	fingerprint: string;
	ledger_head: string | null;
	contract_revision: number;
	contract_hash: string | null;
	policy_hash: string | null;
}

export interface ConfirmReconciliationDeliveryInput
	extends ReconciliationDeliveryBinding {
	confirmed_at: string;
}

export interface ObserveInjectedReconciliationInput {
	delivery: ReconciliationDeliveryBinding;
	injected_at: string;
	boundary_id: string;
	meaningful_actions_observed: number;
}

/** Record hidden context injection without advancing any confirmed baseline. */
export function observeInjectedReconciliation(
	state: WorkCursorReconciliationState,
	input: ObserveInjectedReconciliationInput,
): WorkCursorReconciliationState {
	validateDeliveryBinding(input.delivery);
	validateTimestamp(input.injected_at, "injected_at");
	if (!isHash(input.boundary_id)) throw new Error("invalid boundary_id");
	if (
		!Number.isSafeInteger(input.meaningful_actions_observed) ||
		input.meaningful_actions_observed < 0
	) {
		throw new Error(
			"meaningful_actions_observed must be a non-negative safe integer",
		);
	}
	return {
		...prepareReconciliationDelivery(state, input.delivery),
		injected_unconfirmed: {
			delivery: { ...input.delivery },
			injected_at: input.injected_at,
			boundary_id: input.boundary_id,
			meaningful_actions_observed: input.meaningful_actions_observed,
		},
	};
}

/** Advance the session-local baseline only after visible delivery is confirmed. */
export function confirmReconciliationDelivery(
	state: WorkCursorReconciliationState,
	input: ConfirmReconciliationDeliveryInput,
): WorkCursorReconciliationState {
	validateDeliveryBinding(input);
	if (!state.pending_delivery || !sameDelivery(state.pending_delivery, input)) {
		throw new Error("cannot confirm an unprepared reconciliation delivery");
	}
	validateTimestamp(input.confirmed_at, "confirmed_at");
	return {
		last_reconciled_head: input.ledger_head,
		last_reconciled_revision: input.contract_revision,
		last_reconciled_at: input.confirmed_at,
		meaningful_actions_since_confirmed: 0,
		pending_delivery: null,
		confirmed_delivery_fingerprint: input.fingerprint,
		injected_unconfirmed: null,
	};
}

function validBaseline(
	baseline: WorkBriefingSnapshot | null | undefined,
	current: Omit<WorkBriefingSnapshot, "baseline_available" | "delta">,
): WorkBriefingSnapshot | null {
	if (!baseline || baseline.work_id !== current.work_id) return null;
	if (baseline.contract_revision > current.contract_revision) return null;
	if (
		baseline.contract_revision === current.contract_revision &&
		(baseline.contract_hash !== current.contract_hash ||
			baseline.policy_hash !== current.policy_hash)
	) {
		return null;
	}
	try {
		return fingerprintBriefing(baseline) === baseline.semantic_fingerprint
			? baseline
			: null;
	} catch {
		return null;
	}
}

function diffBriefings(
	previous: WorkBriefingSnapshot | null,
	current: Omit<WorkBriefingSnapshot, "baseline_available" | "delta">,
): WorkBriefingDelta {
	if (!previous) {
		return {
			added_requirement_ids: allRequirementIds(current),
			status_changed: [],
			superseded: [...current.superseded_requirements],
			conflicts_added: [...current.conflicts],
			conflicts_resolved: [],
		};
	}
	const previousStatuses = statusMap(previous);
	const currentStatuses = statusMap(current);
	const statusChanged = [...currentStatuses]
		.flatMap(([requirementId, status]) => {
			const from = previousStatuses.get(requirementId);
			return from !== undefined && from !== status
				? [{ requirement_id: requirementId, from, to: status }]
				: [];
		})
		.sort((left, right) =>
			compareCodeUnits(left.requirement_id, right.requirement_id),
		);
	const previousSuperseded = new Map(
		previous.superseded_requirements.map((item) => [
			item.requirement_id,
			item.superseded_by,
		]),
	);
	return {
		added_requirement_ids: [...currentStatuses.keys()]
			.filter((id) => !previousStatuses.has(id))
			.sort(compareCodeUnits),
		status_changed: statusChanged,
		superseded: current.superseded_requirements.filter(
			(item) =>
				previousSuperseded.get(item.requirement_id) !== item.superseded_by,
		),
		conflicts_added: current.conflicts.filter(
			(conflict) => !previous.conflicts.includes(conflict),
		),
		conflicts_resolved: previous.conflicts.filter(
			(conflict) => !current.conflicts.includes(conflict),
		),
	};
}

function fingerprintBriefing(
	value: Pick<
		WorkBriefingSnapshot,
		| "work_id"
		| "work"
		| "contract_revision"
		| "contract_hash"
		| "policy_hash"
		| "lifecycle"
		| "requirements"
		| "requirement_ids_by_status"
		| "requirement_evidence"
		| "superseded_requirements"
		| "conflicts"
		| "progress"
		| "configured_required_gates"
		| "next_requirement_ids"
	>,
): string {
	return sha256(
		canonicalJson({
			work_id: value.work_id,
			work: value.work,
			contract_revision: value.contract_revision,
			contract_hash: value.contract_hash,
			policy_hash: value.policy_hash,
			lifecycle: value.lifecycle,
			requirements: value.requirements.map((requirement) => ({
				id: requirement.id,
				summary: requirement.summary,
				status: requirement.status,
				...(requirement.superseded_by === undefined
					? {}
					: { superseded_by: requirement.superseded_by }),
			})),
			requirement_ids_by_status: value.requirement_ids_by_status,
			requirement_evidence: value.requirement_evidence,
			superseded_requirements: value.superseded_requirements,
			conflicts: value.conflicts,
			progress: value.progress,
			configured_required_gates: value.configured_required_gates,
			next_requirement_ids: value.next_requirement_ids,
		}),
	);
}

function statusMap(
	value: Pick<WorkBriefingSnapshot, "requirement_ids_by_status">,
): Map<string, WorkRequirementState> {
	return new Map(
		REQUIREMENT_STATES.flatMap((status) =>
			value.requirement_ids_by_status[status].map(
				(id) => [id, status] as const,
			),
		),
	);
}

function allRequirementIds(
	value: Pick<WorkBriefingSnapshot, "requirement_ids_by_status">,
): string[] {
	return [...statusMap(value).keys()].sort(compareCodeUnits);
}

function sortedRequirements(
	requirements: readonly ProjectedRequirement[],
): ProjectedRequirement[] {
	return [...requirements].sort((left, right) =>
		compareCodeUnits(left.id, right.id),
	);
}

function sortedUnique(values: readonly string[]): string[] {
	return [...new Set(values)].sort(compareCodeUnits);
}

function parseIsoDurationMilliseconds(value: string): number {
	const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
	if (!match || (!match[1] && !match[2] && !match[3])) {
		throw new Error(`invalid reconciliation duration: ${value}`);
	}
	const milliseconds =
		(Number(match[1] ?? 0) * 3600 +
			Number(match[2] ?? 0) * 60 +
			Number(match[3] ?? 0)) *
		1000;
	if (!Number.isSafeInteger(milliseconds)) {
		throw new Error(`reconciliation duration is too large: ${value}`);
	}
	return milliseconds;
}

function validateTimestamp(value: string, field: string): void {
	const matchesCanonicalShape =
		typeof value === "string" &&
		/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/.test(
			value,
		);
	const parsed = matchesCanonicalShape ? new Date(value) : null;
	const canonical = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
	if (
		!parsed ||
		!Number.isFinite(parsed.getTime()) ||
		parsed.toISOString() !== canonical
	) {
		throw new Error(`invalid ${field}`);
	}
}

const TRIGGERS = new Set<string>([
	"work_resume",
	"contract_revision",
	"compaction_resume",
	"meaningful_milestone",
	"before_work_close",
]);
const LIFECYCLES = new Set<string>([
	"open",
	"completed",
	"abandoned",
	"superseded",
]);
const PRESETS = new Set<string>(["off", "adaptive", "frequent", "custom"]);

function validateDueInputs(input: EvaluateReconciliationDueInput): void {
	if (typeof input.safe_boundary !== "boolean") {
		throw new Error("safe_boundary must be a boolean");
	}
	if (!LIFECYCLES.has(input.lifecycle))
		throw new Error("invalid Work lifecycle");
	if (input.trigger !== null && !TRIGGERS.has(input.trigger)) {
		throw new Error("invalid reconciliation trigger");
	}
	if (!isHash(input.current_fingerprint)) {
		throw new Error("invalid current reconciliation fingerprint");
	}
	if (
		input.confirmed_fingerprint !== null &&
		!isHash(input.confirmed_fingerprint)
	) {
		throw new Error("invalid confirmed reconciliation fingerprint");
	}
	if (
		input.last_observed_fingerprint !== undefined &&
		input.last_observed_fingerprint !== null &&
		!isHash(input.last_observed_fingerprint)
	) {
		throw new Error("invalid observed reconciliation fingerprint");
	}
	const reconciliation = validateNormalizedReconciliationPolicy(
		input.policy.reconciliation,
	);
	if (!PRESETS.has(reconciliation.preset)) {
		throw new Error("invalid reconciliation preset");
	}
	const threshold = reconciliation.due_after?.meaningful_actions;
	if (
		threshold !== null &&
		(!Number.isSafeInteger(threshold) || (threshold as number) <= 0)
	) {
		throw new Error("invalid reconciliation meaningful_actions threshold");
	}
}

function validateBriefingProjection(projection: WorkProjection): void {
	if (typeof projection.work_id !== "string" || projection.work_id.trim() === "") {
		throw new Error("invalid briefing Work ID");
	}
	if (
		!Number.isSafeInteger(projection.contract_revision) ||
		projection.contract_revision < 0
	) {
		throw new Error("invalid briefing contract revision");
	}
	for (const [field, value] of [
		["contract hash", projection.contract_hash],
		["policy hash", projection.policy_hash],
	] as const) {
		if (value !== null && !isHash(value)) throw new Error(`invalid briefing ${field}`);
	}
	if (!LIFECYCLES.has(projection.lifecycle)) {
		throw new Error("invalid briefing lifecycle");
	}
	for (const [field, value] of [
		["title", projection.title],
		["completion contract", projection.completion_contract],
	] as const) {
		if (value !== null && (typeof value !== "string" || value.trim() === "")) {
			throw new Error(`invalid briefing Work ${field}`);
		}
	}
	if (
		projection.configured_required_gates.some(
			(gate) => gate !== "planning" && gate !== "completion",
		)
	) {
		throw new Error("invalid briefing review gate");
	}
	const states = new Set<string>(REQUIREMENT_STATES);
	const requirementIds = new Set<string>();
	for (const requirement of projection.requirements) {
		if (typeof requirement.id !== "string" || requirement.id.trim() === "")
			throw new Error("invalid briefing requirement ID");
		if (requirementIds.has(requirement.id))
			throw new Error("duplicate briefing requirement ID");
		requirementIds.add(requirement.id);
		if (
			typeof requirement.summary !== "string" ||
			requirement.summary.trim() === ""
		) {
			throw new Error("invalid briefing requirement summary");
		}
		if (!states.has(requirement.status))
			throw new Error("invalid briefing requirement status");
		if (
			!Array.isArray(requirement.source_event_ids) ||
			!requirement.source_event_ids.every((item) => typeof item === "string") ||
			!Array.isArray(requirement.evidence_refs) ||
			!requirement.evidence_refs.every((item) => typeof item === "string")
		) {
			throw new Error("invalid briefing requirement references");
		}
		if (
			requirement.weight !== undefined &&
			(!Number.isFinite(requirement.weight) ||
				requirement.weight <= 0 ||
				requirement.weight > Number.MAX_SAFE_INTEGER)
		) {
			throw new Error("invalid briefing requirement weight");
		}
	}
	for (const conflict of projection.conflicts) {
		if (typeof conflict !== "string" || conflict.trim() === "")
			throw new Error("invalid briefing conflict ID");
	}
	const progress = projection.progress;
	for (const field of [
		"applicable",
		"pending",
		"in_progress",
		"verified",
		"implemented_unverified",
		"blocked",
		"waived",
	] as const) {
		if (!Number.isSafeInteger(progress[field]) || progress[field] < 0)
			throw new Error(`invalid briefing progress ${field}`);
	}
	if (
		!Number.isFinite(progress.percent) ||
		progress.percent < 0 ||
		progress.percent > 100 ||
		typeof progress.weighted !== "boolean" ||
		typeof progress.denominator_empty !== "boolean"
	) {
		throw new Error("invalid briefing progress");
	}
	for (const [field, value] of [
		["verified_weight", progress.verified_weight],
		["applicable_weight", progress.applicable_weight],
	] as const) {
		if (
			value !== undefined &&
			(!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
		) {
			throw new Error(`invalid briefing progress ${field}`);
		}
	}
	const derivedProgress = calculateWorkProgress(projection.requirements);
	if (canonicalJson(derivedProgress) !== canonicalJson(progress)) {
		throw new Error("briefing progress does not match requirement states");
	}
}

function validateDeliveryBinding(
	delivery: ReconciliationDeliveryBinding,
): void {
	if (!isHash(delivery.fingerprint)) {
		throw new Error("invalid briefing fingerprint");
	}
	for (const [field, value] of [
		["ledger head", delivery.ledger_head],
		["contract hash", delivery.contract_hash],
		["policy hash", delivery.policy_hash],
	] as const) {
		if (value !== null && !isHash(value)) {
			throw new Error(`invalid reconciliation ${field}`);
		}
	}
	if (
		!Number.isSafeInteger(delivery.contract_revision) ||
		delivery.contract_revision < 0
	) {
		throw new Error("contract_revision must be a non-negative safe integer");
	}
}

function sameDelivery(
	left: ReconciliationDeliveryBinding,
	right: ReconciliationDeliveryBinding,
): boolean {
	return (
		left.fingerprint === right.fingerprint &&
		left.ledger_head === right.ledger_head &&
		left.contract_revision === right.contract_revision &&
		left.contract_hash === right.contract_hash &&
		left.policy_hash === right.policy_hash
	);
}

function canonicalJson(value: unknown): string {
	if (typeof value === "number" && !Number.isFinite(value)) {
		throw new Error("non-finite briefing number");
	}
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([left], [right]) => compareCodeUnits(left, right))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
		.join(",")}}`;
}

function compareCodeUnits(left: string, right: string): number {
	const limit = Math.min(left.length, right.length);
	for (let index = 0; index < limit; index += 1) {
		const difference = left.charCodeAt(index) - right.charCodeAt(index);
		if (difference !== 0) return difference;
	}
	return left.length - right.length;
}
