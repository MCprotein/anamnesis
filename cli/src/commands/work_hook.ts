import { findAgentfile, readAgentfile } from "../core/agentfile.js";
import {
	mutateWorkCursorAtomic,
	readWorkCursor,
	updateWorkCursorAtomic,
	type WorkCursor,
	type WorkCursorReconciliationState,
} from "../core/work_cursor.js";
import { readWorkLedger, type WorkLedgerRecord } from "../core/work_ledger.js";
import {
	foldWorkProjection,
	type WorkProjection,
} from "../core/work_projection.js";
import {
	buildWorkBriefingSnapshot,
	emptyWorkCursorReconciliationState,
	evaluateReconciliationDue,
	observeInjectedReconciliation,
	type ReconciliationDeliveryBinding,
	type WorkBriefingSnapshot,
} from "../core/work_reconciliation.js";
import {
	normalizeWorkPromptCapturePolicy,
} from "../core/work_prompt_policy.js";
import { stageWorkPrompt } from "../core/work_prompt_stage.js";
import { resolveWorkStateRoot } from "../core/work_storage.js";
import { sha256 } from "../util/hash.js";
import { statusWork } from "./work.js";

export type WorkHookClient = "codex" | "claude" | "claude-code";

export interface WorkHookInput {
	project_root: string;
	state_root?: string;
	client: WorkHookClient;
	payload: unknown;
	now?: string;
}

export interface WorkHookResult {
	schema_version: "anamnesis.work-hook-result.v1";
	status: "unavailable" | "not_due" | "briefing_due" | "capture_staged";
	reason:
		| "invalid_payload"
		| "missing_stable_id"
		| "cursor_unavailable"
		| "capture_unavailable"
		| "policy_off"
		| "duplicate_boundary"
		| "not_due"
		| "briefing_due"
		| "capture_staged";
	context: string | null;
	cursor_id: string | null;
	boundary_id: string | null;
}

interface ParsedBoundary {
	sessionId: string;
	boundaryStableId: string;
	prompt: string;
}

interface ParsedPostToolBoundary {
	sessionId: string;
	boundaryStableId: string;
	meaningfulBoundaryIds: string[];
}

type PromptCaptureResult =
	| { status: "disabled" }
	| { status: "staged"; context: string }
	| { status: "failed"; context: string };

const MAX_STABLE_ID_LENGTH = 512;
// Prompt injection still uses revision CAS because its expensive projection
// read need not serialize tool hooks. Same-turn action accounting uses the
// lock-scoped cursor mutator below instead.
const MAX_PROMPT_CAS_ATTEMPTS = 65;
// Work ledger and cursor locks are independent. Retry a small number of
// optimistic snapshots and fail open under sustained ledger churn.
const MAX_POST_TOOL_FRESHNESS_ATTEMPTS = 3;
const MAX_HOOK_CONTEXT_CHARACTERS = 8_000;
const MAX_SAME_TURN_CONTEXT_CHARACTERS = 8_000;
const MAX_RECENT_MEANINGFUL_BOUNDARIES = 64;
const LIST_BUDGET = 2_000;
const REQUIREMENT_SUMMARY_BUDGET = 4_000;
const MAX_EXECUTION_PACKET_BYTES = 16_384;

export interface WorkExecutionPacketOptions {
	/** Requirement IDs to include, in source order. Omit to include all. */
	requirement_ids?: readonly string[];
	/** UTF-8 byte budget for the complete packet. */
	max_bytes?: number;
}

/**
 * Render the minimal authoritative Work contract consumed by an executor.
 * This is intentionally separate from the user-facing reconciliation briefing:
 * it contains no delivery, cadence, or retrieval instructions.
 */
export function renderWorkExecutionPacket(
	briefing: WorkBriefingSnapshot,
	requirementIds?: readonly string[],
	maxBytes?: number,
): string;
export function renderWorkExecutionPacket(
	briefing: WorkBriefingSnapshot,
	options?: WorkExecutionPacketOptions,
): string;
export function renderWorkExecutionPacket(
	briefing: WorkBriefingSnapshot,
	selection: readonly string[] | WorkExecutionPacketOptions = {},
	legacyMaxBytes?: number,
): string {
	const options: WorkExecutionPacketOptions = Array.isArray(selection)
		? { requirement_ids: selection, max_bytes: legacyMaxBytes }
		: (selection as WorkExecutionPacketOptions);
	const maxBytes = options.max_bytes ?? MAX_EXECUTION_PACKET_BYTES;
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 256) {
		throw new Error("invalid Work execution packet structural budget");
	}
	const requirements = briefing.requirements;
	const sourceIds = new Set<string>();
	for (const requirement of requirements) {
		if (sourceIds.has(requirement.id)) {
			throw new Error("ambiguous Work execution packet requirement IDs");
		}
		sourceIds.add(requirement.id);
	}
	const selectedIds = options.requirement_ids
		? [...options.requirement_ids]
		: requirements.map((requirement) => requirement.id);
	const selectedIdSet = new Set<string>();
	for (const id of selectedIds) {
		if (typeof id !== "string" || id.length === 0 || selectedIdSet.has(id)) {
			throw new Error(
				"duplicate or invalid Work execution packet requirement ID",
			);
		}
		if (!sourceIds.has(id)) {
			throw new Error("unknown Work execution packet requirement ID");
		}
		selectedIdSet.add(id);
	}
	const selectedRequirements = requirements.filter((requirement) =>
		selectedIdSet.has(requirement.id),
	);
	const packet = {
		schema_version: "anamnesis.work-execution-packet.v1",
		work_id: briefing.work_id,
		contract_revision: briefing.contract_revision,
		contract: {
			completion_contract: briefing.work.completion_contract,
			contract_hash: briefing.contract_hash,
		},
		requirements: selectedRequirements.map(
			(requirement) =>
				`${requirement.id}|${requirement.status}|${JSON.stringify(requirement.summary)}`,
		),
		blocker_ids: uniqueIds([
			...briefing.blockers.requirement_ids,
			...briefing.blockers.conflict_ids,
		]),
		required_gates: [...briefing.configured_required_gates],
		authoritative_completeness:
			selectedRequirements.length === requirements.length,
	};
	const rendered = JSON.stringify(packet);
	if (Buffer.byteLength(rendered, "utf8") > maxBytes) {
		throw new Error("Work execution packet exceeded structural budget");
	}
	return rendered;
}

/**
 * Foreground UserPromptSubmit service. When explicitly enabled, the decoded
 * prompt is staged privately for one token-bound classification decision. Raw
 * text is never returned, logged, or used in a visible identifier.
 */
export function handleWorkUserPromptSubmit(
	input: WorkHookInput,
): WorkHookResult {
	const parsed = parseBoundary(input.client, input.payload);
	if (!parsed.ok) return unavailable(parsed.reason);
	const cursorId = deriveWorkHookCursorId(input.client, parsed.value.sessionId);
	const boundaryId = deriveWorkHookBoundaryId(
		input.client,
		parsed.value.sessionId,
		parsed.value.boundaryStableId,
	);
	let state: ReturnType<typeof resolveWorkStateRoot>;
	try {
		state = resolveWorkStateRoot(input.project_root, input.state_root);
	} catch {
		return unavailable("cursor_unavailable", cursorId, boundaryId);
	}
	const now = input.now ?? new Date().toISOString();
	const capture = stagePromptAtBoundary(
		input,
		state.state_root,
		parsed.value,
		now,
	);
	if (capture.status === "failed") {
		return {
			...unavailable("capture_unavailable", cursorId, boundaryId),
			context: capture.context,
		};
	}
	const captureContext = capture.status === "staged" ? capture.context : null;
	let invalidatedDelivery: {
		boundary_id: string;
		fingerprint: string;
	} | null = null;

	for (let attempt = 0; attempt < MAX_PROMPT_CAS_ATTEMPTS; attempt += 1) {
		let read: ReturnType<typeof readWorkCursor>;
		try {
			read = readWorkCursor(
				state.state_root,
				cursorId,
				undefined,
				state.worktree_fingerprint,
			);
		} catch {
			return withCapture(
				unavailable("cursor_unavailable", cursorId, boundaryId),
				captureContext,
			);
		}
		if (!read.cursor || read.status === "switched") {
			if (!projectReconciliationEnabled(input.project_root)) {
				return withCapture(
					result("not_due", "policy_off", cursorId, boundaryId),
					captureContext,
				);
			}
			return withCapture(
				onboardingUnavailable(cursorId, boundaryId),
				captureContext,
			);
		}
		const cursor = read.cursor;
		const reconciliation =
			cursor.reconciliation ?? emptyWorkCursorReconciliationState();

		try {
			const status = statusWork({
				project_root: input.project_root,
				state_root: input.state_root,
				work_id: cursor.work_id,
			});
			const ledgerRecords = readWorkLedger(status.ledger_path).records;
			const projection = foldWorkProjection(ledgerRecords);
			if (projection.work_id !== cursor.work_id) {
				throw new Error("Work changed while preparing hook context");
			}
			const policy = projection.policy_snapshot?.policy;
			if (!policy) {
				return withCapture(
					unavailable("cursor_unavailable", cursorId, boundaryId),
					captureContext,
				);
			}
			if (policy.reconciliation.preset === "off") {
				return withCapture(
					result("not_due", "policy_off", cursorId, boundaryId),
					captureContext,
				);
			}
			const briefing = buildBriefing(
				status.ledger_path,
				projection,
				cursor,
				ledgerRecords,
			);
			const observation = reconciliation.injected_unconfirmed;
			const observationWasInvalidated: boolean =
				observation !== null &&
				observation !== undefined &&
				invalidatedDelivery !== null &&
				observation.boundary_id === invalidatedDelivery.boundary_id &&
				observation.delivery.fingerprint === invalidatedDelivery.fingerprint;
			const effectiveObservation: WorkCursorReconciliationState["injected_unconfirmed"] =
				observationWasInvalidated ? null : observation;
			if (
				effectiveObservation?.boundary_id === boundaryId &&
				effectiveObservation.delivery.fingerprint === briefing.semantic_fingerprint
			) {
				return withCapture(
					result("not_due", "duplicate_boundary", cursorId, boundaryId),
					captureContext,
				);
			}
			const sameObservedFingerprint =
				effectiveObservation?.delivery.fingerprint ===
				briefing.semantic_fingerprint;
			const actionsAtObservation = sameObservedFingerprint
				? effectiveObservation.meaningful_actions_observed
				: 0;
			const decision = evaluateReconciliationDue({
				policy,
				lifecycle: projection.lifecycle,
				safe_boundary: true,
				trigger: "work_resume",
				now,
				last_confirmed_at: sameObservedFingerprint
					? effectiveObservation.injected_at
					: reconciliation.last_reconciled_at,
				meaningful_actions_since_confirmed: Math.max(
					0,
					reconciliation.meaningful_actions_since_confirmed -
						actionsAtObservation,
				),
				current_fingerprint: briefing.semantic_fingerprint,
				confirmed_fingerprint: reconciliation.confirmed_delivery_fingerprint,
				last_observed_fingerprint:
					effectiveObservation?.delivery.fingerprint ??
					reconciliation.confirmed_delivery_fingerprint,
			});
			if (!decision.due) {
				return withCapture(
					result("not_due", "not_due", cursorId, boundaryId),
					captureContext,
				);
			}
			const delivery = deliveryBinding(briefing, projection);
			const nextReconciliation = observeInjectedReconciliation(reconciliation, {
				delivery,
				injected_at: now,
				boundary_id: boundaryId,
				meaningful_actions_observed:
					reconciliation.meaningful_actions_since_confirmed,
			});
			updateWorkCursorAtomic(
				state.state_root,
				{ ...cursor, reconciliation: nextReconciliation },
				projectionTruth(projection),
				now,
				{ expectedCursorRevision: cursor.cursor_revision ?? 0 },
			);
			if (readWorkLedger(status.ledger_path).head !== projection.ledger_head) {
				invalidatedDelivery = {
					boundary_id: boundaryId,
					fingerprint: briefing.semantic_fingerprint,
				};
				continue;
			}
			const briefingBudget = captureContext
				? Math.max(4_000, MAX_HOOK_CONTEXT_CHARACTERS - captureContext.length - 1)
				: MAX_HOOK_CONTEXT_CHARACTERS;
			return withCapture({
				...result("briefing_due", "briefing_due", cursorId, boundaryId),
				context: renderWorkBriefingContext(
					briefing,
					policy.reconciliation.detail,
					decision.auto_continue,
					briefingBudget,
				),
			}, captureContext);
		} catch (error) {
			if (
				String((error as Error).message).includes("stale Work cursor write")
			) {
				continue;
			}
			return withCapture(
				unavailable("cursor_unavailable", cursorId, boundaryId),
				captureContext,
			);
		}
	}
	return withCapture(
		unavailable("cursor_unavailable", cursorId, boundaryId),
		captureContext,
	);
}

/**
 * Foreground same-turn service for already-sanitized post-tool envelopes.
 * Wrappers must discard tool input, tool response, and transcript content.
 */
export function handleWorkPostToolBoundary(
	input: WorkHookInput,
): WorkHookResult {
	const parsed = parsePostToolBoundary(input.client, input.payload);
	if (!parsed.ok) return unavailable(parsed.reason);
	const cursorId = deriveWorkHookCursorId(input.client, parsed.value.sessionId);
	const aggregateBoundaryId = sha256(
		parsed.value.meaningfulBoundaryIds.join("\0"),
	);
	if (parsed.value.meaningfulBoundaryIds.length === 0) {
		return result("not_due", "not_due", cursorId, aggregateBoundaryId);
	}
	let state: ReturnType<typeof resolveWorkStateRoot>;
	try {
		state = resolveWorkStateRoot(input.project_root, input.state_root);
	} catch {
		return unavailable("cursor_unavailable", cursorId, aggregateBoundaryId);
	}
	const now = input.now ?? new Date().toISOString();

	try {
		const cursorRead = readWorkCursor(state.state_root, cursorId);
		const initialCursor = cursorRead.cursor;
		if (
			!initialCursor ||
			initialCursor.worktree_fingerprint !== state.worktree_fingerprint
		) {
			return unavailable("cursor_unavailable", cursorId, aggregateBoundaryId);
		}
		const initialRecent =
			initialCursor.reconciliation?.recent_meaningful_action_boundary_ids ?? [];
		if (
			parsed.value.meaningfulBoundaryIds.every((id) =>
				initialRecent.includes(id),
			)
		) {
			return result(
				"not_due",
				"duplicate_boundary",
				cursorId,
				aggregateBoundaryId,
			);
		}
		let freshnessAttempts = 0;
		while (freshnessAttempts < MAX_POST_TOOL_FRESHNESS_ATTEMPTS) {
			let reconciliationBeforeWrite: WorkCursorReconciliationState | null = null;
			let candidateLedgerPath: string | null = null;
			let candidateLedgerHead: string | null | undefined;
			const mutation = mutateWorkCursorAtomic(
				state.state_root,
				cursorId,
				(cursor) => {
				if (cursor.worktree_fingerprint !== state.worktree_fingerprint) {
					throw new Error("Work cursor belongs to a different worktree");
				}
				if (cursor.work_id !== initialCursor.work_id) {
					throw new Error("Work cursor changed while preparing hook context");
				}
				const reconciliation =
					cursor.reconciliation ?? emptyWorkCursorReconciliationState();
				const recent =
					reconciliation.recent_meaningful_action_boundary_ids ?? [];
				const novel = parsed.value.meaningfulBoundaryIds.filter(
					(id) => !recent.includes(id),
				);
				if (novel.length === 0) {
					return {
						next_cursor: null,
						result: result(
							"not_due",
							"duplicate_boundary",
							cursorId,
							aggregateBoundaryId,
						),
					};
				}
				const nextCount =
					reconciliation.meaningful_actions_since_confirmed + novel.length;
				if (!Number.isSafeInteger(nextCount)) {
					throw new Error("meaningful action counter overflow");
				}
				const nextRecent = [...recent, ...novel].slice(
					-MAX_RECENT_MEANINGFUL_BOUNDARIES,
				);
				const countedReconciliation: WorkCursorReconciliationState = {
					...reconciliation,
					meaningful_actions_since_confirmed: nextCount,
					recent_meaningful_action_boundary_ids: nextRecent,
				};
				const status = statusWork({
					project_root: input.project_root,
					state_root: input.state_root,
					work_id: cursor.work_id,
				});
				while (freshnessAttempts < MAX_POST_TOOL_FRESHNESS_ATTEMPTS) {
					freshnessAttempts += 1;
					const ledgerRecords = readWorkLedger(status.ledger_path).records;
					const projection = foldWorkProjection(ledgerRecords);
					if (projection.work_id !== cursor.work_id) {
						throw new Error("Work changed while preparing hook context");
					}
					const policy = projection.policy_snapshot?.policy;
					if (!policy) {
						throw new Error("Work policy unavailable");
					}
					if (policy.reconciliation.preset === "off") {
						if (
							readWorkLedger(status.ledger_path).head !== projection.ledger_head
						) {
							continue;
						}
						return {
							next_cursor: null,
							result: result(
								"not_due",
								"policy_off",
								cursorId,
								aggregateBoundaryId,
							),
						};
					}
					const briefing = buildBriefing(
						status.ledger_path,
						projection,
						cursor,
						ledgerRecords,
					);
					let nextReconciliation = countedReconciliation;
					const observation = reconciliation.injected_unconfirmed;
					const sameObservedFingerprint =
						observation?.delivery.fingerprint === briefing.semantic_fingerprint;
					const actionsAtObservation = sameObservedFingerprint
						? observation.meaningful_actions_observed
						: 0;
					const decision = evaluateReconciliationDue({
						policy,
						lifecycle: projection.lifecycle,
						safe_boundary: true,
						trigger: null,
						now,
						last_confirmed_at: sameObservedFingerprint
							? observation.injected_at
							: reconciliation.last_reconciled_at,
						meaningful_actions_since_confirmed: Math.max(
							0,
							nextCount - actionsAtObservation,
						),
						current_fingerprint: briefing.semantic_fingerprint,
						confirmed_fingerprint:
							reconciliation.confirmed_delivery_fingerprint,
						last_observed_fingerprint:
							observation?.delivery.fingerprint ??
							reconciliation.confirmed_delivery_fingerprint,
					});
					const context = decision.due
						? renderWorkBriefingContext(
								briefing,
								policy.reconciliation.detail,
								decision.auto_continue,
								MAX_SAME_TURN_CONTEXT_CHARACTERS,
							)
						: null;
					if (decision.due) {
						nextReconciliation = observeInjectedReconciliation(
							nextReconciliation,
							{
								delivery: deliveryBinding(briefing, projection),
								injected_at: now,
								boundary_id: aggregateBoundaryId,
								meaningful_actions_observed: nextCount,
							},
						);
					}
					const truth = projectionTruth(projection);
					const nextCursor: WorkCursor = {
						...cursor,
						work_id: truth.work_id,
						observed_revision: truth.revision,
						last_event_id: truth.last_event_id,
						projection_hash: truth.projection_hash,
						updated_at: now,
						reconciliation: nextReconciliation,
					};
					const candidate = {
						next_cursor: nextCursor,
						result: decision.due
							? {
									...result(
										"briefing_due",
										"briefing_due",
										cursorId,
										aggregateBoundaryId,
									),
									context,
								}
							: result("not_due", "not_due", cursorId, aggregateBoundaryId),
					};
					if (
						readWorkLedger(status.ledger_path).head !== projection.ledger_head
					) {
						continue;
					}
					reconciliationBeforeWrite = reconciliation;
					candidateLedgerPath = status.ledger_path;
					candidateLedgerHead = projection.ledger_head;
					return candidate;
				}
				throw new Error("Work ledger changed during post-tool reconciliation");
				},
				{ lockTimeoutMs: 30_000, lockRetryMs: 2 },
			);
			if (
				candidateLedgerPath === null ||
				candidateLedgerHead === undefined ||
				readWorkLedger(candidateLedgerPath).head === candidateLedgerHead
			) {
				return mutation.result;
			}
			if (reconciliationBeforeWrite === null) {
				throw new Error("Work ledger changed after cursor mutation");
			}
			const reconciliationToRestore = reconciliationBeforeWrite;
			const invalidatedCursorRevision = mutation.cursor.cursor_revision ?? 0;
			mutateWorkCursorAtomic(
				state.state_root,
				cursorId,
				(cursor) => {
					if ((cursor.cursor_revision ?? 0) !== invalidatedCursorRevision) {
						throw new Error("Work cursor changed after invalidated hook mutation");
					}
					return {
						next_cursor: {
							...cursor,
							reconciliation: reconciliationToRestore,
						},
						result: null,
					};
				},
				{ lockTimeoutMs: 30_000, lockRetryMs: 2 },
			);
		}
		throw new Error("Work ledger freshness retry budget exhausted");
	} catch {
		return unavailable("cursor_unavailable", cursorId, aggregateBoundaryId);
	}
}

function projectReconciliationEnabled(projectRoot: string): boolean {
	try {
		if (!findAgentfile(projectRoot)) return false;
		const agentfile = readAgentfile(projectRoot);
		return (
			agentfile.version === 2 &&
			agentfile.settings?.work_policy?.reconciliation?.preset !== undefined &&
			agentfile.settings.work_policy.reconciliation.preset !== "off"
		);
	} catch {
		return false;
	}
}

function stagePromptAtBoundary(
	input: WorkHookInput,
	stateRoot: string,
	boundary: ParsedBoundary,
	capturedAt: string,
): PromptCaptureResult {
	try {
		const agentfilePath = findAgentfile(input.project_root);
		const agentfile = agentfilePath ? readAgentfile(input.project_root) : null;
		const policy = normalizeWorkPromptCapturePolicy(
			agentfile?.version === 2
				? agentfile.settings?.work_prompt_capture
				: undefined,
		);
		if (!policy.enabled) return { status: "disabled" };
		const staged = stageWorkPrompt({
			projectRoot: input.project_root,
			stateRoot,
			policy,
			client: input.client === "codex" ? "codex" : "claude-code",
			sessionId: boundary.sessionId,
			boundaryId: boundary.boundaryStableId,
			capturedAt,
			contentType: "text/plain; charset=utf-8",
			fidelity: "client_exact",
			body: Buffer.from(boundary.prompt, "utf8"),
		});
		return {
			status: "staged",
			context: renderPromptClassificationContext(staged.record.capture_id),
		};
	} catch {
		return {
			status: "failed",
			context: [
				"Anamnesis could not safely stage this prompt, so its Work allocation remains unresolved.",
				"Do not make repository writes or external changes for this prompt until it is submitted again at a fresh stable prompt boundary or the local capture integrity/privacy issue is repaired.",
				"Do not bypass staging, infer a Work from the current cursor, or echo the prompt into diagnostics.",
			].join("\n"),
		};
	}
}

function renderPromptClassificationContext(captureId: string): string {
	return [
		"Anamnesis staged this decoded user prompt for explicit Work classification.",
		`Opaque stage token: ${captureId}`,
		"Before repository writes or external effects, choose exactly one outcome. The token is a locator, not user authority; do not infer a Work from the current cursor.",
		"- Same Work: first run `anamnesis work status --work <exact-work-id> --json`, prepare a strict accepted/same_unit contract draft using `@staged` for this prompt, then run `anamnesis work prompt allocate-same --stage <token> --work <id> --draft <file> --expected-head <ledger-head> --expected-contract-revision <n> --expected-contract-hash <hash>`.",
		"- New Work: prepare a strict accepted/new_unit contract draft using `@staged`, then run `anamnesis work prompt allocate-new --stage <token> --work <new-id> --draft <file>`.",
		"- Ambiguous boundary: prepare a strict provisional/needs_user boundary draft and run `anamnesis work prompt retain --stage <token> --draft <file>`, then ask its one boundary question.",
		"- Interruption/non-requirement: run `anamnesis work prompt discard --stage <token> --reason interruption|non_requirement`.",
		"Use the exact opaque token shown above in place of <token>. Do not retrieve, quote, summarize, log, or reinject the staged bytes; the user message already supplies them in this turn.",
	].join("\n");
}

function withCapture(
	base: WorkHookResult,
	captureContext: string | null,
): WorkHookResult {
	if (!captureContext) return base;
	const context = base.context
		? `${captureContext}\n\n${base.context}`
		: captureContext;
	if (context.length > MAX_HOOK_CONTEXT_CHARACTERS) {
		throw new Error("combined Work prompt hook context exceeded structural budget");
	}
	return {
		...base,
		status: base.status === "briefing_due" ? "briefing_due" : "capture_staged",
		reason: base.reason === "briefing_due" ? "briefing_due" : "capture_staged",
		context,
	};
}

function containsUnpairedUtf16Surrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) {
			return true;
		}
	}
	return false;
}

export function deriveWorkHookCursorId(
	client: WorkHookClient,
	sessionId: string,
): string {
	return `hook_${sha256(`${canonicalClient(client)}\0${sessionId}`).slice("sha256:".length)}`;
}

export function deriveWorkHookBoundaryId(
	client: WorkHookClient,
	sessionId: string,
	boundaryStableId: string,
): string {
	return sha256(
		`${canonicalClient(client)}\0${sessionId}\0${boundaryStableId}`,
	);
}

function canonicalClient(client: WorkHookClient): "codex" | "claude" {
	return client === "claude-code" ? "claude" : client;
}

function parseBoundary(
	client: WorkHookClient,
	payload: unknown,
):
	| { ok: true; value: ParsedBoundary }
	| { ok: false; reason: "invalid_payload" | "missing_stable_id" } {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return { ok: false, reason: "invalid_payload" };
	}
	const value = payload as Record<string, unknown>;
	if (
		typeof value.prompt !== "string" ||
		containsUnpairedUtf16Surrogate(value.prompt)
	) {
		return { ok: false, reason: "invalid_payload" };
	}
	const sessionId = validStableId(value.session_id);
	const boundaryStableId = validStableId(
		client === "codex" ? value.turn_id : value.prompt_id,
	);
	if (!sessionId || !boundaryStableId) {
		return { ok: false, reason: "missing_stable_id" };
	}
	return {
		ok: true,
		value: { sessionId, boundaryStableId, prompt: value.prompt },
	};
}

function parsePostToolBoundary(
	client: WorkHookClient,
	payload: unknown,
):
	| { ok: true; value: ParsedPostToolBoundary }
	| { ok: false; reason: "invalid_payload" | "missing_stable_id" } {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return { ok: false, reason: "invalid_payload" };
	}
	const value = payload as Record<string, unknown>;
	const sessionId = validStableId(value.session_id);
	const boundaryStableId = validStableId(
		client === "codex" ? value.turn_id : value.prompt_id,
	);
	if (!sessionId || !boundaryStableId) {
		return { ok: false, reason: "missing_stable_id" };
	}
	if (
		!Array.isArray(value.events) ||
		value.events.length === 0 ||
		value.events.length > MAX_RECENT_MEANINGFUL_BOUNDARIES
	) {
		return { ok: false, reason: "invalid_payload" };
	}
	const allowedTools =
		client === "codex"
			? new Set(["Bash", "apply_patch", "Agent"])
			: new Set(["Bash", "Edit", "Write", "NotebookEdit", "Agent"]);
	const meaningfulBoundaryIds: string[] = [];
	for (const event of value.events) {
		if (!event || typeof event !== "object" || Array.isArray(event)) {
			return { ok: false, reason: "invalid_payload" };
		}
		const entry = event as Record<string, unknown>;
		const toolName = validStableId(entry.tool_name);
		const toolUseId = validStableId(entry.tool_use_id);
		if (!toolName || !toolUseId) {
			return { ok: false, reason: "missing_stable_id" };
		}
		if (!allowedTools.has(toolName)) continue;
		meaningfulBoundaryIds.push(
			sha256(
				`${canonicalClient(client)}\0${sessionId}\0${boundaryStableId}\0${toolName}\0${toolUseId}`,
			),
		);
	}
	return {
		ok: true,
		value: {
			sessionId,
			boundaryStableId,
			meaningfulBoundaryIds: uniqueIds(meaningfulBoundaryIds),
		},
	};
}

function validStableId(value: unknown): string | null {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > MAX_STABLE_ID_LENGTH ||
		/[\u0000-\u001f\u007f]/.test(value)
	) {
		return null;
	}
	return value;
}

function buildBriefing(
	ledgerPath: string,
	projection: WorkProjection,
	cursor: WorkCursor,
	ledgerRecords?: WorkLedgerRecord[],
): WorkBriefingSnapshot {
	const records = ledgerRecords ?? readWorkLedger(ledgerPath).records;
	let previousConfirmed: WorkBriefingSnapshot | null = null;
	const baselineHead = cursor.reconciliation?.last_reconciled_head ?? null;
	if (baselineHead) {
		const index = records.findIndex(
			(record) => record.record_hash === baselineHead,
		);
		if (index >= 0) {
			previousConfirmed = buildWorkBriefingSnapshot({
				projection: foldWorkProjection(records.slice(0, index + 1)),
			});
		}
	}
	return buildWorkBriefingSnapshot({
		projection,
		previous_confirmed: previousConfirmed,
	});
}

function deliveryBinding(
	briefing: WorkBriefingSnapshot,
	projection: WorkProjection,
): ReconciliationDeliveryBinding {
	return {
		fingerprint: briefing.semantic_fingerprint,
		ledger_head: projection.ledger_head,
		contract_revision: projection.contract_revision,
		contract_hash: projection.contract_hash,
		policy_hash: projection.policy_hash,
	};
}

export function renderWorkBriefingContext(
	briefing: WorkBriefingSnapshot,
	detail: "compact" | "full",
	autoContinue: boolean,
	maxCharacters = MAX_HOOK_CONTEXT_CHARACTERS,
): string {
	if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 4_000) {
		throw new Error("invalid Work hook context structural budget");
	}
	const counts = briefing.requirement_ids_by_status;
	const changedRequirementIds = uniqueIds([
		...briefing.delta.added_requirement_ids,
		...briefing.delta.status_changed.map((change) => change.requirement_id),
		...briefing.delta.superseded.map((change) => change.requirement_id),
	]);
	const changedRequirements = briefing.requirements.filter((requirement) =>
		changedRequirementIds.includes(requirement.id),
	);
	const atRiskRequirements = briefing.requirements.filter((requirement) =>
		["blocked", "implemented_unverified"].includes(requirement.status),
	);
	const nextRequirement = briefing.requirements.find(
		(requirement) => requirement.id === briefing.next_requirement_ids[0],
	);
	const sharedSummaryPrefix = commonPrefix(
		briefing.requirements.map((requirement) => requirement.summary),
	);
	const factoredSummaryPrefix =
		briefing.configured_required_gates.length === 0 &&
		sharedSummaryPrefix.length >= 16
			? sharedSummaryPrefix
			: "";
	const fullBlock =
		detail === "full"
			? [
					"Current requirements:",
					...(factoredSummaryPrefix
						? [`Shared summary prefix: ${JSON.stringify(factoredSummaryPrefix)}`]
						: []),
					...briefing.requirements.map(
						(requirement) =>
							`${requirement.id}|${requirement.status}|${JSON.stringify(requirement.summary.slice(factoredSummaryPrefix.length))}`,
					),
				].join("\n")
			: null;
	// The mandatory skeleton is deliberately capped field-by-field. Optional
	// detail then consumes the one remaining shared budget; nothing is blindly
	// sliced after assembly.
	const lines = [
		`Anamnesis Work briefing: ${boundedSemanticField(briefing.work.title ?? briefing.work_id, 512)} (${boundedSemanticField(briefing.work_id, 128)}; r${briefing.contract_revision}; ${briefing.lifecycle}).`,
		"Delivery: injected_unconfirmed (not visible).",
		autoContinue
			? "Action: visibly brief the requirements, done/remaining/blockers/progress; then continue the same task."
			: "Visibly brief the requirements, done, remaining, blockers, and progress. This Work is terminal; do not continue or restart it automatically.",
		fullBlock === null
			? `Required retrieval: run ${shellCommandForStatus(boundedSemanticField(briefing.work_id, 128))} before the visible briefing; compact context never replaces the complete projection.`
			: "Authoritative completeness: all current requirements follow; no retrieval needed.",
		`Completion contract: ${boundedSemanticField(briefing.work.completion_contract ?? "not recorded", 700)}`,
		`Progress: ${briefing.progress.percent}% (${briefing.progress.verified}/${briefing.progress.denominator} verified/applicable)`,
		...(briefing.baseline_available || fullBlock === null
			? [
					briefing.baseline_available
						? `Contract delta: added=${boundedIds(briefing.delta.added_requirement_ids, 250)}; status_changed=${boundedStatusChanges(briefing.delta.status_changed, 250)}; superseded=${boundedSuperseded(briefing.delta.superseded, 250)}; conflicts_added=${boundedIds(briefing.delta.conflicts_added, 250)}; conflicts_resolved=${boundedIds(briefing.delta.conflicts_resolved, 250)}`
						: "Contract delta: no confirmed baseline; current state is authoritative.",
				]
			: []),
		`Configured required review gates (not proof of satisfaction): ${boundedIds(briefing.configured_required_gates, 400)}`,
		...(fullBlock !== null && !briefing.baseline_available
			? []
			: [`Changed requirements: ${boundedRequirements(changedRequirements, 500)}`]),
		...(atRiskRequirements.length === 0
			? []
			: [`At-risk requirements: ${boundedRequirements(atRiskRequirements, 500)}`]),
		...(briefing.next_requirement_ids.length === 0
			? []
			: [`Next requirement IDs: ${boundedIds(briefing.next_requirement_ids, 500)}`]),
		`Next action: ${nextRequirement ? formatRequirement(nextRequirement, 128, 640) : autoContinue ? "reconcile completion contract and gates" : "none; report terminal state"}`,
		`Blocker IDs: ${boundedIds([...briefing.blockers.requirement_ids, ...briefing.blockers.conflict_ids], 650)}`,
		`Complete authoritative pointer: Work ${boundedSemanticField(briefing.work_id, 128)}.`,
	];
	const appendOptional = (line: string): boolean => {
		const used = lines.reduce((total, item) => total + item.length + 1, 0);
		if (used + line.length + 1 > maxCharacters) return false;
		lines.push(line);
		return true;
	};

	const optionalLines =
		fullBlock === null
			? [
					`Counts: pending=${counts.pending.length}, in_progress=${counts.in_progress.length}, implemented_unverified=${counts.implemented_unverified.length}, verified=${counts.verified.length}, blocked=${counts.blocked.length}, waived=${counts.waived.length}`,
				]
			: [];
	if (fullBlock !== null) {
		if (appendOptional(fullBlock)) {
			// Full is deliberately one atomic block: never a partial enumeration.
		} else {
			const retrievalIndex = 3;
			lines[retrievalIndex] =
				`Required retrieval: run ${shellCommandForStatus(boundedSemanticField(briefing.work_id, 128))} before the visible briefing; the complete projection did not fit in this hook context.`;
			appendOptional(
				`Full requirement enumeration unavailable in one hook context (${briefing.requirements.length} requirements, ${fullBlock.length} characters). The required authoritative status retrieval above remains mandatory.`,
			);
		}
	}
	for (const line of optionalLines) appendOptional(line);
	return lines.join("\n");
}

function boundedIds(ids: readonly string[], budget = LIST_BUDGET): string {
	return boundedList(ids, budget, (id) => id);
}

function boundedStatusChanges(
	changes: WorkBriefingSnapshot["delta"]["status_changed"],
	budget = LIST_BUDGET,
): string {
	return boundedList(
		changes,
		budget,
		(change) => `${change.requirement_id}:${change.from}->${change.to}`,
	);
}

function boundedSuperseded(
	changes: WorkBriefingSnapshot["delta"]["superseded"],
	budget = LIST_BUDGET,
): string {
	return boundedList(
		changes,
		budget,
		(change) => `${change.requirement_id}->${change.superseded_by}`,
	);
}

function boundedRequirements(
	requirements: WorkBriefingSnapshot["requirements"],
	budget = REQUIREMENT_SUMMARY_BUDGET,
): string {
	return boundedList(requirements, budget, formatRequirement, " | ");
}

function uniqueIds(ids: readonly string[]): string[] {
	return [...new Set(ids)];
}

function boundedSemanticField(value: string, maxLength: number): string {
	const compact = value.replace(/\s+/gu, " ").trim();
	return compact.length <= maxLength
		? compact
		: `[omitted ${compact.length}-character value; retrieve authoritative status]`;
}

function commonPrefix(values: readonly string[]): string {
	if (values.length < 2) return "";
	let prefix = values[0] ?? "";
	for (const value of values.slice(1)) {
		let index = 0;
		const limit = Math.min(prefix.length, value.length);
		while (index < limit && prefix[index] === value[index]) index += 1;
		if (index > 0 && isHighSurrogate(prefix.charCodeAt(index - 1))) index -= 1;
		prefix = prefix.slice(0, index);
		if (prefix.length < 16) return "";
	}
	return prefix;
}

function isHighSurrogate(codeUnit: number): boolean {
	return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function formatRequirement(
	requirement: WorkBriefingSnapshot["requirements"][number],
	idLength = 256,
	summaryLength = 512,
): string {
	return `${boundedSemanticField(requirement.id, idLength)} [${requirement.status}]: ${boundedSemanticField(requirement.summary, summaryLength)}`;
}

function boundedList<T>(
	items: readonly T[],
	budget: number,
	format: (item: T) => string,
	separator = ", ",
): string {
	if (items.length === 0) return "none";
	const shown: string[] = [];
	let used = 0;
	for (const item of items) {
		const formatted = format(item);
		const addition =
			(shown.length === 0 ? 0 : separator.length) + formatted.length;
		if (used + addition > budget) break;
		shown.push(formatted);
		used += addition;
	}
	const omitted = items.length - shown.length;
	const suffix =
		omitted === 0
			? ""
			: `${shown.length === 0 ? "" : separator}… +${omitted} omitted; retrieve authoritative status`;
	return `${shown.join(separator)}${suffix}`;
}

function shellCommandForStatus(workId: string): string {
	return `\`anamnesis work status --work ${shellQuote(workId)} --json\``;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function projectionTruth(projection: WorkProjection) {
	return {
		work_id: projection.work_id,
		revision: projection.contract_revision,
		last_event_id: projection.last_event_id,
		projection_hash: projection.projection_hash,
	};
}

function unavailable(
	reason: WorkHookResult["reason"],
	cursorId: string | null = null,
	boundaryId: string | null = null,
): WorkHookResult {
	return result("unavailable", reason, cursorId, boundaryId);
}

function onboardingUnavailable(
	cursorId: string,
	boundaryId: string,
): WorkHookResult {
	return {
		...unavailable("cursor_unavailable", cursorId, boundaryId),
		context: [
			"Anamnesis Work briefing is unavailable because this foreground session has no linked Work cursor.",
			"If a current Work exists, resume it and run:",
			`anamnesis work switch --work <id> --session ${cursorId}`,
			"Then continue the current task. Do not infer or switch a global Work.",
		].join("\n"),
	};
}

function result(
	status: WorkHookResult["status"],
	reason: WorkHookResult["reason"],
	cursorId: string | null,
	boundaryId: string | null,
): WorkHookResult {
	return {
		schema_version: "anamnesis.work-hook-result.v1",
		status,
		reason,
		context: null,
		cursor_id: cursorId,
		boundary_id: boundaryId,
	};
}
