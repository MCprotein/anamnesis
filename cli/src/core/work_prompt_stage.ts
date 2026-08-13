import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { sha256 } from "../util/hash.js";
import type { WorkLedgerEvent } from "./work_ledger.js";
import { readWorkLedger, withWorkLedgerLock } from "./work_ledger.js";
import type { NormalizedWorkPromptCapturePolicy } from "./work_prompt_policy.js";
import {
	appendCanonicalTypedWorkEventWithPublishedSource,
	publishAndAppendCanonicalTypedWorkSourceEvent,
	publishWorkSourceEvent,
	readPublishedWorkSourceEvent,
	type WorkCaptureFidelity,
	type WorkStorageOptions,
	withWorkSourceEventLock,
} from "./work_storage.js";

export const WORK_PROMPT_STAGE_SCHEMA_VERSION =
	"anamnesis.work-prompt-stage.v1" as const;
export const WORK_PROMPT_STAGE_OUTCOME_SCHEMA_VERSION =
	"anamnesis.work-prompt-stage-outcome.v1" as const;
export const WORK_PROMPT_STAGE_BINDING_SCHEMA_VERSION =
	"anamnesis.work-prompt-stage-binding.v1" as const;

const verifiedPrivacyBoundaries = new Set<string>();

export interface WorkPromptIdentity {
	client: string;
	sessionId: string;
	boundaryId: string;
}

export interface StageWorkPromptInput extends WorkPromptIdentity {
	projectRoot: string;
	stateRoot: string;
	policy: NormalizedWorkPromptCapturePolicy;
	capturedAt: string;
	contentType: string;
	fidelity: WorkCaptureFidelity;
	body: Buffer;
}

export interface WorkPromptStageRecord {
	schema_version: typeof WORK_PROMPT_STAGE_SCHEMA_VERSION;
	capture_id: string;
	captured_at: string;
	expires_at: string;
	client: string;
	content_type: string;
	fidelity: WorkCaptureFidelity;
	body_hash: string;
	body_bytes: number;
}

export interface StagedWorkPrompt {
	record: WorkPromptStageRecord;
	body: Buffer;
	created: boolean;
}

export type WorkPromptStageOutcomeKind =
	| "discarded"
	| "provisional"
	| "allocated";

interface WorkPromptStageOutcomeBase {
	schema_version: typeof WORK_PROMPT_STAGE_OUTCOME_SCHEMA_VERSION;
	capture_id: string;
	resolved_at: string;
}

export type WorkPromptStageOutcome =
	| (WorkPromptStageOutcomeBase & {
			outcome: "discarded";
			reason: "interruption" | "non_requirement";
	  })
	| (WorkPromptStageOutcomeBase & {
			outcome: "provisional";
			body_hash: string;
			source_event_id: string;
			boundary_state: "provisional" | "needs_user";
			classification: "same_unit" | "new_unit" | "interruption";
			reason_codes: string[];
			question?: string;
			assertion_hash: string;
	  })
	| (WorkPromptStageOutcomeBase & {
			outcome: "allocated";
			body_hash: string;
			source_event_id: string;
			decision: "allocate_same" | "allocate_new";
			work_id: string;
			ledger_event_id: string;
			assertion_hash: string;
	  });

export interface ResolveStagedWorkPromptInput {
	stateRoot: string;
	captureId: string;
	resolvedAt: string;
}

export interface DiscardStagedWorkPromptInput
	extends ResolveStagedWorkPromptInput {
	reason: "interruption" | "non_requirement";
}

export interface RetainStagedWorkPromptProvisionalInput
	extends ResolveStagedWorkPromptInput {
	boundaryState: "provisional" | "needs_user";
	classification: "same_unit" | "new_unit" | "interruption";
	reasonCodes: string[];
	question?: string;
}

export interface AllocateStagedWorkPromptInput
	extends ResolveStagedWorkPromptInput {
	decision: "allocate_same" | "allocate_new";
	workId: string;
	ledgerPath: string;
	ledgerEvent: WorkLedgerEvent;
	expectedHead: string | null;
}

export interface BindRetainedProvisionalPromptInput {
	stateRoot: string;
	captureId: string;
	boundAt: string;
	decision: "allocate_same" | "allocate_new";
	workId: string;
	ledgerPath: string;
	ledgerEvent: WorkLedgerEvent;
	expectedHead: string | null;
}

export interface WorkPromptStageBinding {
	schema_version: typeof WORK_PROMPT_STAGE_BINDING_SCHEMA_VERSION;
	capture_id: string;
	source_event_id: string;
	bound_at: string;
	decision: "allocate_same" | "allocate_new";
	work_id: string;
	ledger_event_id: string;
	assertion_hash: string;
}

export interface WorkPromptStageGcResult {
	removed: string[];
	skipped_locked: string[];
	skipped_indeterminate: string[];
}

export interface WorkPromptStageOptions extends WorkStorageOptions {
	onResolutionPhase?: (
		phase:
			| "resolution-effect-committed"
			| "outcome-persisted"
			| "stage-removed"
			| "binding-work-committed"
			| "binding-persisted",
	) => void;
}

export function deriveWorkPromptCaptureId(
	identity: WorkPromptIdentity,
): string {
	assertIdentityPart(identity.client, "client", 64);
	assertIdentityPart(identity.sessionId, "session ID", 512);
	assertIdentityPart(identity.boundaryId, "boundary ID", 512);
	return `cap_${sha256(Buffer.from(`anamnesis-prompt-capture-v1\0${identity.client}\0${identity.sessionId}\0${identity.boundaryId}`, "utf8")).slice("sha256:".length)}`;
}

export function deriveWorkPromptSourceEventId(captureId: string): string {
	assertCaptureId(captureId);
	return `prompt_${sha256(Buffer.from(`anamnesis-prompt-source-v1\0${captureId}`, "utf8")).slice("sha256:".length)}`;
}

export function assertWorkPromptStagePrivacyBoundary(
	projectRoot: string,
	stateRoot: string,
): void {
	const project = fs.realpathSync(projectRoot);
	const state = canonicalMissingPath(stateRoot);
	const boundaryKey = `${project}\0${state}`;
	if (verifiedPrivacyBoundaries.has(boundaryKey)) return;
	const worktree = containingGitWorktree(state);
	if (!worktree) {
		verifiedPrivacyBoundaries.add(boundaryKey);
		return;
	}
	const candidates = [
		path.join(state, "work-prompt-stage", ".privacy-check"),
		path.join(state, "work-inputs", ".privacy-check"),
	];
	try {
		const output = execFileSync(
			"git",
			["-C", worktree, "check-ignore", "--no-index", "--stdin"],
			{
				input: `${candidates.join("\n")}\n`,
				encoding: "utf8",
				stdio: ["pipe", "pipe", "ignore"],
			},
		);
		const ignored = new Set(
			output
				.trim()
				.split(/\r?\n/)
				.filter(Boolean)
				.map((item) => path.resolve(worktree, item)),
		);
		if (!candidates.every((item) => ignored.has(path.resolve(item))))
			throw new Error("incomplete managed ignore coverage");
		verifiedPrivacyBoundaries.add(boundaryKey);
	} catch (error) {
		throw new Error(
			"raw Work prompt storage privacy boundary is not protected by managed ignore rules",
			{ cause: error },
		);
	}
}

function containingGitWorktree(candidate: string): string | undefined {
	let existing = path.resolve(candidate);
	while (!fs.existsSync(existing)) {
		const parent = path.dirname(existing);
		if (parent === existing) return undefined;
		existing = parent;
	}
	const gitMarker = nearestGitMarker(existing);
	try {
		return fs.realpathSync(
			execFileSync("git", ["-C", existing, "rev-parse", "--show-toplevel"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim(),
		);
	} catch (error) {
		if (gitMarker)
			throw new Error("Git worktree privacy boundary could not be verified", {
				cause: error,
			});
		return undefined;
	}
}

function nearestGitMarker(candidate: string): string | undefined {
	let current = path.resolve(candidate);
	for (;;) {
		const marker = path.join(current, ".git");
		try {
			const stat = fs.lstatSync(marker);
			if (stat.isDirectory() || stat.isFile()) return marker;
			throw new Error("Git worktree marker is not a regular file or directory");
		} catch (error) {
			if (!isErrno(error, "ENOENT")) throw error;
		}
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

export function stageWorkPrompt(
	input: StageWorkPromptInput,
	options: WorkStorageOptions = {},
): StagedWorkPrompt {
	if (!input.policy.enabled || input.policy.preset !== "bounded")
		throw new Error("Work prompt capture policy is off");
	if (!Buffer.isBuffer(input.body))
		throw new Error("staged Work prompt body must be a Buffer");
	if (input.body.length > input.policy.max_entry_bytes)
		throw new Error("Work prompt exceeds max_entry_bytes");
	assertCanonicalTimestamp(input.capturedAt, "capturedAt");
	assertIdentityPart(input.contentType, "content type", 256);
	if (
		!(["native_exact", "client_exact", "agent_observed"] as string[]).includes(
			input.fidelity,
		)
	)
		throw new Error("invalid Work prompt capture fidelity");
	assertWorkPromptStagePrivacyBoundary(input.projectRoot, input.stateRoot);
	const captureId = deriveWorkPromptCaptureId({
		client: input.client,
		sessionId: input.sessionId,
		boundaryId: input.boundaryId,
	});
	const root = secureStageRoot(input.stateRoot);
	return withWorkLedgerLock(budgetLockPath(root), options, () => {
		const sweep = gcStagedWorkPromptsUnlocked(
			root,
			input.policy,
			Date.parse(input.capturedAt),
			options,
		);
		if (sweep.usage_indeterminate)
			throw new Error("Work prompt staging budget is indeterminate");
		return withStageLock(root, captureId, options, () => {
			const existingOutcome = readOutcome(root, captureId, true);
			if (existingOutcome)
				throw new Error(
					`staged Work prompt ${captureId} already resolved as ${existingOutcome.outcome}`,
				);
			const bodyPath = stageBodyPath(root, captureId);
			const recordPath = stageRecordPath(root, captureId);
			const record: WorkPromptStageRecord = {
				schema_version: WORK_PROMPT_STAGE_SCHEMA_VERSION,
				capture_id: captureId,
				captured_at: input.capturedAt,
				expires_at: new Date(
					Date.parse(input.capturedAt) + input.policy.ttl_ms,
				).toISOString(),
				client: input.client,
				content_type: input.contentType,
				fidelity: input.fidelity,
				body_hash: sha256(input.body),
				body_bytes: input.body.length,
			};
			const existing = readStageUnlocked(root, captureId, true);
			if (existing) {
				if (
					!existing.body.equals(input.body) ||
					existing.record.client !== input.client ||
					existing.record.content_type !== input.contentType ||
					existing.record.fidelity !== input.fidelity
				)
					throw new Error(`staged Work prompt ID collision: ${captureId}`);
				return { ...existing, created: false };
			}
			if (
				sweep.usage.entries + 1 > input.policy.max_entries ||
				sweep.usage.bytes + input.body.length > input.policy.max_total_bytes
			)
				throw new Error("Work prompt staging budget exceeded");
			durablePublish(bodyPath, input.body);
			durablePublish(
				recordPath,
				Buffer.from(`${canonicalJson(record)}\n`, "utf8"),
			);
			return { record, body: Buffer.from(input.body), created: true };
		});
	});
}

export function readStagedWorkPrompt(
	stateRoot: string,
	captureId: string,
	options: WorkStorageOptions = {},
): StagedWorkPrompt | undefined {
	const root = secureStageRoot(stateRoot);
	return withStageLock(root, captureId, options, () => {
		const staged = readStageUnlocked(root, captureId, true);
		return staged ? { ...staged, created: false } : undefined;
	});
}

export function discardStagedWorkPrompt(
	input: DiscardStagedWorkPromptInput,
	options: WorkPromptStageOptions = {},
): WorkPromptStageOutcome {
	return resolveStage(
		input.stateRoot,
		input.captureId,
		"discarded",
		input.resolvedAt,
		options,
		{ reason: input.reason },
		() => ({ reason: input.reason }),
	);
}

export function retainStagedWorkPromptProvisional(
	input: RetainStagedWorkPromptProvisionalInput,
	options: WorkPromptStageOptions = {},
): WorkPromptStageOutcome {
	assertReasonCodes(input.reasonCodes);
	if (
		input.boundaryState !== "provisional" &&
		input.boundaryState !== "needs_user"
	)
		throw new Error("invalid provisional prompt boundary state");
	if (
		!(["same_unit", "new_unit", "interruption"] as string[]).includes(
			input.classification,
		)
	)
		throw new Error("invalid provisional prompt classification");
	if (input.question !== undefined)
		assertIdentityPart(input.question, "boundary question", 512);
	const assertion = {
		boundary_state: input.boundaryState,
		classification: input.classification,
		reason_codes: [...input.reasonCodes],
		...(input.question ? { question: input.question } : {}),
	};
	return resolveStage(
		input.stateRoot,
		input.captureId,
		"provisional",
		input.resolvedAt,
		options,
		assertion,
		(stage) => {
			const sourceEventId = deriveWorkPromptSourceEventId(input.captureId);
			publishWorkSourceEvent(
				{
					stateRoot: input.stateRoot,
					eventId: sourceEventId,
					capturedAt: stage.record.captured_at,
					client: stage.record.client,
					contentType: stage.record.content_type,
					fidelity: stage.record.fidelity,
					allocationStatus: "provisional",
					body: stage.body,
				},
				options,
			);
			return {
				source_event_id: sourceEventId,
				...assertion,
				assertion_hash: sha256(Buffer.from(canonicalJson(assertion), "utf8")),
			};
		},
	);
}

export function allocateStagedWorkPromptToTypedWork(
	input: AllocateStagedWorkPromptInput,
	options: WorkPromptStageOptions = {},
): WorkPromptStageOutcome {
	if (input.decision !== "allocate_same" && input.decision !== "allocate_new")
		throw new Error("invalid Work prompt allocation decision");
	assertSafeOpaqueId(input.workId, "work ID");
	if (input.ledgerEvent.payload.work_id !== input.workId)
		throw new Error("allocated Work prompt assertion work ID mismatch");
	const assertion = {
		decision: input.decision,
		work_id: input.workId,
		ledger_event_id: input.ledgerEvent.event_id,
		expected_head: input.expectedHead,
		ledger_event_hash: sha256(
			Buffer.from(canonicalJson(input.ledgerEvent), "utf8"),
		),
	};
	return resolveStage(
		input.stateRoot,
		input.captureId,
		"allocated",
		input.resolvedAt,
		options,
		assertion,
		(stage) => {
			const sourceEventId = deriveWorkPromptSourceEventId(input.captureId);
			const result = publishAndAppendCanonicalTypedWorkSourceEvent(
				{
					source: {
						stateRoot: input.stateRoot,
						eventId: sourceEventId,
						capturedAt: stage.record.captured_at,
						client: stage.record.client,
						contentType: stage.record.content_type,
						fidelity: stage.record.fidelity,
						allocationStatus: "allocated",
						body: stage.body,
					},
					ledgerPath: input.ledgerPath,
					ledgerEvent: input.ledgerEvent,
					expectedHead: input.expectedHead,
				},
				options,
			);
			const workId =
				typeof result.ledger.record.payload.work_id === "string"
					? result.ledger.record.payload.work_id
					: undefined;
			if (workId !== input.workId)
				throw new Error("allocated Work prompt assertion work ID mismatch");
			return {
				source_event_id: sourceEventId,
				decision: input.decision,
				work_id: input.workId,
				ledger_event_id: result.ledger.record.event_id,
				assertion_hash: sha256(Buffer.from(canonicalJson(assertion), "utf8")),
			};
		},
	);
}

export function readWorkPromptStageOutcome(
	stateRoot: string,
	captureId: string,
): WorkPromptStageOutcome | undefined {
	return readOutcome(secureStageRoot(stateRoot), captureId, true);
}

export function bindRetainedProvisionalPromptToTypedWork(
	input: BindRetainedProvisionalPromptInput,
	options: WorkPromptStageOptions = {},
): WorkPromptStageBinding {
	assertCanonicalTimestamp(input.boundAt, "boundAt");
	if (input.decision !== "allocate_same" && input.decision !== "allocate_new")
		throw new Error("invalid Work prompt allocation decision");
	assertSafeOpaqueId(input.workId, "work ID");
	if (input.ledgerEvent.payload.work_id !== input.workId)
		throw new Error("provisional binding assertion work ID mismatch");
	const root = secureStageRoot(input.stateRoot);
	return withStageLock(root, input.captureId, options, () => {
		const outcome = readOutcome(root, input.captureId, false);
		if (!outcome || outcome.outcome !== "provisional")
			throw new Error(
				`staged Work prompt ${input.captureId} has no provisional source outcome`,
			);
		const assertion = {
			decision: input.decision,
			work_id: input.workId,
			ledger_event_id: input.ledgerEvent.event_id,
			expected_head: input.expectedHead,
			ledger_event_hash: sha256(
				Buffer.from(canonicalJson(input.ledgerEvent), "utf8"),
			),
		};
		const prior = readBinding(root, input.captureId, true);
		if (prior) {
			assertBindingRetryMatches(prior, assertion);
			revalidateBinding(input.stateRoot, prior);
			return prior;
		}
		const result = appendCanonicalTypedWorkEventWithPublishedSource(
			{
				stateRoot: input.stateRoot,
				sourceEventId: outcome.source_event_id,
				ledgerPath: input.ledgerPath,
				ledgerEvent: input.ledgerEvent,
				expectedHead: input.expectedHead,
			},
			options,
		);
		options.onResolutionPhase?.("binding-work-committed");
		if (result.ledger.record.payload.work_id !== input.workId)
			throw new Error("provisional binding assertion work ID mismatch");
		const binding: WorkPromptStageBinding = {
			schema_version: WORK_PROMPT_STAGE_BINDING_SCHEMA_VERSION,
			capture_id: input.captureId,
			source_event_id: outcome.source_event_id,
			bound_at: input.boundAt,
			decision: input.decision,
			work_id: input.workId,
			ledger_event_id: result.ledger.record.event_id,
			assertion_hash: sha256(Buffer.from(canonicalJson(assertion), "utf8")),
		};
		if (!isBinding(binding, input.captureId))
			throw new Error("invalid staged Work prompt binding assertion");
		durablePublish(
			stageBindingPath(root, input.captureId),
			Buffer.from(`${canonicalJson(binding)}\n`, "utf8"),
		);
		options.onResolutionPhase?.("binding-persisted");
		return binding;
	});
}

export function readWorkPromptStageBinding(
	stateRoot: string,
	captureId: string,
): WorkPromptStageBinding | undefined {
	return readBinding(secureStageRoot(stateRoot), captureId, true);
}

export function gcStagedWorkPrompts(
	stateRoot: string,
	policy: NormalizedWorkPromptCapturePolicy,
	now = Date.now(),
	options: WorkStorageOptions = {},
): WorkPromptStageGcResult {
	const root = secureStageRoot(stateRoot);
	return withWorkLedgerLock(budgetLockPath(root), options, () =>
		gcStagedWorkPromptsUnlocked(root, policy, now, options).result,
	);
}

interface WorkPromptStageUsage {
	entries: number;
	bytes: number;
}

interface WorkPromptStageEntryUsage extends WorkPromptStageUsage {
	body_present: boolean;
}

interface WorkPromptStageGcSweep {
	result: WorkPromptStageGcResult;
	usage: WorkPromptStageUsage;
	usage_indeterminate: boolean;
}

function gcStagedWorkPromptsUnlocked(
	root: string,
	policy: NormalizedWorkPromptCapturePolicy,
	now: number,
	options: WorkStorageOptions,
): WorkPromptStageGcSweep {
	const result: WorkPromptStageGcResult = {
		removed: [],
		skipped_locked: [],
		skipped_indeterminate: [],
	};
	removeExpiredStageTemps(root, policy, now, options, result);
	const records = listStageIds(root)
		.map((id) => stageGcCandidate(root, id, policy, now))
		.sort((left, right) => {
			const a = left.record
				? Date.parse(left.record.captured_at)
				: (left.mtime ?? Number.POSITIVE_INFINITY);
			const b = right.record
				? Date.parse(right.record.captured_at)
				: (right.mtime ?? Number.POSITIVE_INFINITY);
			return a === b ? compareCodeUnits(left.id, right.id) : a - b;
		});
	const usage: WorkPromptStageUsage = { entries: 0, bytes: 0 };
	let usageIndeterminate = false;
	for (const item of records) {
		if (item.needs_locked_recheck) {
			try {
				withStageLock(root, item.id, { ...options, lockTimeoutMs: 0 }, () => {
					const outcome = readOutcome(root, item.id, true);
					if (outcome) {
						revalidateTerminalOutcome(path.dirname(root), outcome);
						removeStageFiles(root, item.id);
						if (!result.removed.includes(item.id))
							result.removed.push(item.id);
						return;
					}
					const record = safeReadRecordMetadata(root, item.id);
					const mtime = record
						? undefined
						: newestStageFileMtime(root, item.id);
					const expiresAt = record
						? Date.parse(record.expires_at)
						: mtime === undefined
							? Number.NaN
							: mtime + policy.ttl_ms;
					if (!Number.isFinite(expiresAt))
						throw new Error("staged Work prompt expiry is indeterminate");
					if (expiresAt > now) return;
					removeStageFiles(root, item.id);
					if (!result.removed.includes(item.id)) result.removed.push(item.id);
				});
			} catch (error) {
				if (String(error).includes("timed out acquiring source-event lock"))
					result.skipped_locked.push(item.id);
				else result.skipped_indeterminate.push(item.id);
			}
		}
		try {
			const currentUsage = item.needs_locked_recheck
				? stageEntryUsage(root, item.id)
				: item.usage;
			addStageUsage(usage, currentUsage);
		} catch {
			usageIndeterminate = true;
			if (!result.skipped_indeterminate.includes(item.id))
				result.skipped_indeterminate.push(item.id);
		}
	}
	return {
		result,
		usage,
		usage_indeterminate: usageIndeterminate,
	};
}

function stageGcCandidate(
	root: string,
	id: string,
	policy: NormalizedWorkPromptCapturePolicy,
	now: number,
): {
	id: string;
	record: WorkPromptStageRecord | undefined;
	mtime: number | undefined;
	needs_locked_recheck: boolean;
	usage: WorkPromptStageEntryUsage;
} {
	let record: WorkPromptStageRecord | undefined;
	let mtime: number | undefined;
	try {
		record = safeReadRecordMetadata(root, id);
		const usage = stageEntryUsage(root, id);
		mtime = record ? undefined : newestStageFileMtime(root, id);
		const outcomeExists = fs.existsSync(stageOutcomePath(root, id));
		const expiresAt = record
			? Date.parse(record.expires_at)
			: mtime === undefined
				? Number.NaN
				: mtime + policy.ttl_ms;
		return {
			id,
			record,
			mtime,
			needs_locked_recheck:
				outcomeExists ||
				usage.entries === 0 ||
				!usage.body_present ||
				!Number.isFinite(expiresAt) ||
				expiresAt <= now,
			usage,
		};
	} catch {
		return {
			id,
			record,
			mtime,
			needs_locked_recheck: true,
			usage: { entries: 0, bytes: 0, body_present: false },
		};
	}
}

function addStageUsage(
	total: WorkPromptStageUsage,
	entry: WorkPromptStageUsage,
): void {
	total.entries += entry.entries;
	total.bytes += entry.bytes;
	if (!Number.isSafeInteger(total.entries) || !Number.isSafeInteger(total.bytes))
		throw new Error("Work prompt staging usage accounting overflow");
}

function removeExpiredStageTemps(
	root: string,
	policy: NormalizedWorkPromptCapturePolicy,
	now: number,
	options: WorkStorageOptions,
	result: WorkPromptStageGcResult,
): void {
	for (const directoryName of ["bodies", "records"] as const) {
		const directory = path.join(root, directoryName);
		for (const name of fs.readdirSync(directory)) {
			const match = /^\.(cap_[a-f0-9]{64})\.(?:bin|json)\.\d+\.[a-f0-9]+\.tmp$/.exec(
				name,
			);
			if (!match) continue;
			const captureId = match[1];
			const target = path.join(directory, name);
			const stat = fs.lstatSync(target);
			if (stat.isSymbolicLink() || !stat.isFile()) {
				result.skipped_indeterminate.push(captureId);
				continue;
			}
			if (stat.mtimeMs + policy.ttl_ms > now) continue;
			try {
				withStageLock(
					root,
					captureId,
					{ ...options, lockTimeoutMs: 0 },
					() => {
						fs.unlinkSync(target);
						fsyncDirectory(directory);
						if (!result.removed.includes(captureId))
							result.removed.push(captureId);
					},
				);
			} catch (error) {
				if (String(error).includes("timed out acquiring source-event lock"))
					result.skipped_locked.push(captureId);
				else result.skipped_indeterminate.push(captureId);
			}
		}
	}
}

function resolveStage(
	stateRoot: string,
	captureId: string,
	kind: WorkPromptStageOutcomeKind,
	resolvedAt: string,
	options: WorkPromptStageOptions,
	assertion: Record<string, unknown>,
	operation: (stage: StagedWorkPrompt) => Record<string, unknown>,
): WorkPromptStageOutcome {
	assertCanonicalTimestamp(resolvedAt, "resolvedAt");
	const root = secureStageRoot(stateRoot);
	return withStageLock(root, captureId, options, () => {
		const prior = readOutcome(root, captureId, true);
		if (prior) {
			if (prior.outcome !== kind)
				throw new Error(
					`staged Work prompt outcome conflict: ${prior.outcome} != ${kind}`,
				);
			assertOutcomeRetryMatches(prior, assertion);
			revalidateTerminalOutcome(stateRoot, prior);
			removeStageFiles(root, captureId);
			return prior;
		}
		const stage = readStageUnlocked(root, captureId, false)!;
		const extra = operation(stage);
		if (kind !== "discarded")
			options.onResolutionPhase?.("resolution-effect-committed");
		const outcome = {
			schema_version: WORK_PROMPT_STAGE_OUTCOME_SCHEMA_VERSION,
			capture_id: captureId,
			outcome: kind,
			resolved_at: resolvedAt,
			...(kind === "discarded" ? {} : { body_hash: stage.record.body_hash }),
			...extra,
		} as WorkPromptStageOutcome;
		if (!isOutcome(outcome, captureId))
			throw new Error("invalid staged Work prompt terminal assertion");
		durablePublish(
			stageOutcomePath(root, captureId),
			Buffer.from(`${canonicalJson(outcome)}\n`, "utf8"),
		);
		options.onResolutionPhase?.("outcome-persisted");
		removeStageFiles(root, captureId);
		options.onResolutionPhase?.("stage-removed");
		return outcome;
	});
}

function readStageUnlocked(
	root: string,
	captureId: string,
	optional: boolean,
): StagedWorkPrompt | undefined {
	assertCaptureId(captureId);
	const bodyPath = stageBodyPath(root, captureId);
	const recordPath = stageRecordPath(root, captureId);
	const bodyExists = fs.existsSync(bodyPath);
	const recordExists = fs.existsSync(recordPath);
	if (!bodyExists && !recordExists && optional) return undefined;
	if (!bodyExists || !recordExists)
		throw new Error(
			`staged Work prompt ${captureId} is partial or unavailable`,
		);
	const body = readNoFollow(bodyPath);
	const recordBytes = readNoFollow(recordPath);
	const record = JSON.parse(
		recordBytes.toString("utf8"),
	) as WorkPromptStageRecord;
	if (
		!isStageRecord(record, captureId) ||
		!recordBytes.equals(Buffer.from(`${canonicalJson(record)}\n`, "utf8")) ||
		sha256(body) !== record.body_hash ||
		body.length !== record.body_bytes
	)
		throw new Error(
			`staged Work prompt ${captureId} failed integrity validation`,
		);
	return { record, body, created: false };
}

function readOutcome(
	root: string,
	captureId: string,
	optional: boolean,
): WorkPromptStageOutcome | undefined {
	const target = stageOutcomePath(root, captureId);
	if (!fs.existsSync(target) && optional) return undefined;
	const bytes = readNoFollow(target);
	const value = JSON.parse(bytes.toString("utf8")) as WorkPromptStageOutcome;
	if (
		!isOutcome(value, captureId) ||
		!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))
	)
		throw new Error(`staged Work prompt outcome ${captureId} is invalid`);
	return value;
}

function readBinding(
	root: string,
	captureId: string,
	optional: boolean,
): WorkPromptStageBinding | undefined {
	const target = stageBindingPath(root, captureId);
	if (!fs.existsSync(target) && optional) return undefined;
	const bytes = readNoFollow(target);
	const value = JSON.parse(bytes.toString("utf8")) as WorkPromptStageBinding;
	if (
		!isBinding(value, captureId) ||
		!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))
	)
		throw new Error(`staged Work prompt binding ${captureId} is invalid`);
	return value;
}

function isStageRecord(value: WorkPromptStageRecord, id: string): boolean {
	return (
		value?.schema_version === WORK_PROMPT_STAGE_SCHEMA_VERSION &&
		value.capture_id === id &&
		isCanonicalTimestamp(value.captured_at) &&
		isCanonicalTimestamp(value.expires_at) &&
		typeof value.client === "string" &&
		typeof value.content_type === "string" &&
		["native_exact", "client_exact", "agent_observed"].includes(
			value.fidelity,
		) &&
		/^sha256:[a-f0-9]{64}$/.test(value.body_hash) &&
		Number.isSafeInteger(value.body_bytes) &&
		value.body_bytes >= 0 &&
		value.body_bytes <= 8 * 1024 * 1024 &&
		exactKeys(value, [
			"body_bytes",
			"body_hash",
			"capture_id",
			"captured_at",
			"client",
			"content_type",
			"expires_at",
			"fidelity",
			"schema_version",
		])
	);
}
function isOutcome(value: WorkPromptStageOutcome, id: string): boolean {
	if (
		value?.schema_version !== WORK_PROMPT_STAGE_OUTCOME_SCHEMA_VERSION ||
		value.capture_id !== id ||
		!["discarded", "provisional", "allocated"].includes(value.outcome) ||
		!isCanonicalTimestamp(value.resolved_at)
	)
		return false;
	if (value.outcome === "discarded")
		return (
			["interruption", "non_requirement"].includes(value.reason) &&
			exactKeys(value, [
				"capture_id",
				"outcome",
				"reason",
				"resolved_at",
				"schema_version",
			])
		);
	if (
		!/^sha256:[a-f0-9]{64}$/.test(value.body_hash ?? "") ||
		!isSafeOpaqueId(value.source_event_id) ||
		!/^sha256:[a-f0-9]{64}$/.test(value.assertion_hash)
	)
		return false;
	if (value.outcome === "provisional") {
		const keys = [
			"assertion_hash",
			"body_hash",
			"boundary_state",
			"capture_id",
			"classification",
			"outcome",
			"reason_codes",
			"resolved_at",
			"schema_version",
			"source_event_id",
			...(value.question === undefined ? [] : ["question"]),
		];
		return (
			["provisional", "needs_user"].includes(value.boundary_state) &&
			["same_unit", "new_unit", "interruption"].includes(
				value.classification,
			) &&
			Array.isArray(value.reason_codes) &&
			value.reason_codes.every((item) => typeof item === "string") &&
			(value.question === undefined || typeof value.question === "string") &&
			exactKeys(value, keys)
		);
	}
	return (
		["allocate_same", "allocate_new"].includes(value.decision) &&
		isSafeOpaqueId(value.work_id) &&
		isSafeOpaqueId(value.ledger_event_id) &&
		exactKeys(value, [
			"assertion_hash",
			"body_hash",
			"capture_id",
			"decision",
			"ledger_event_id",
			"outcome",
			"resolved_at",
			"schema_version",
			"source_event_id",
			"work_id",
		])
	);
}
function isBinding(value: WorkPromptStageBinding, id: string): boolean {
	return (
		value?.schema_version === WORK_PROMPT_STAGE_BINDING_SCHEMA_VERSION &&
		value.capture_id === id &&
		isSafeOpaqueId(value.source_event_id) &&
		isCanonicalTimestamp(value.bound_at) &&
		["allocate_same", "allocate_new"].includes(value.decision) &&
		isSafeOpaqueId(value.work_id) &&
		isSafeOpaqueId(value.ledger_event_id) &&
		/^sha256:[a-f0-9]{64}$/.test(value.assertion_hash) &&
		exactKeys(value, [
			"assertion_hash",
			"bound_at",
			"capture_id",
			"decision",
			"ledger_event_id",
			"schema_version",
			"source_event_id",
			"work_id",
		])
	);
}
function withStageLock<T>(
	root: string,
	id: string,
	options: WorkStorageOptions,
	operation: () => T,
): T {
	assertCaptureId(id);
	return withWorkSourceEventLock(
		path.join(root, ".locks", id),
		options,
		operation,
	);
}
function budgetLockPath(root: string): string {
	return path.join(root, ".budget");
}
function stageBodyPath(root: string, id: string): string {
	return safeChild(root, "bodies", `${id}.bin`);
}
function stageRecordPath(root: string, id: string): string {
	return safeChild(root, "records", `${id}.json`);
}
function stageOutcomePath(root: string, id: string): string {
	return safeChild(root, "outcomes", `${id}.json`);
}
function stageBindingPath(root: string, id: string): string {
	return safeChild(root, "bindings", `${id}.json`);
}
function listStageIds(root: string): string[] {
	const ids = new Set<string>();
	for (const [directoryName, extension] of [
		["records", ".json"],
		["bodies", ".bin"],
	] as const) {
		const directory = path.join(root, directoryName);
		if (!fs.existsSync(directory)) continue;
		const entries = fs.readdirSync(directory);
		if (entries.length > 4096)
			throw new Error("Work prompt staging file bound exceeded");
		for (const name of entries) {
			if (!name.endsWith(extension)) continue;
			const id = name.slice(0, -extension.length);
			if (/^cap_[a-f0-9]{64}$/.test(id)) ids.add(id);
		}
	}
	if (ids.size > 4096)
		throw new Error("Work prompt staging entry bound exceeded");
	return [...ids].sort(compareCodeUnits);
}
function safeReadRecordMetadata(
	root: string,
	id: string,
): WorkPromptStageRecord | undefined {
	try {
		const recordPath = stageRecordPath(root, id);
		if (!fs.existsSync(recordPath)) return undefined;
		const bytes = readNoFollow(recordPath);
		const record = JSON.parse(bytes.toString("utf8")) as WorkPromptStageRecord;
		if (
			!isStageRecord(record, id) ||
			!bytes.equals(Buffer.from(`${canonicalJson(record)}\n`, "utf8"))
		)
			return undefined;
		return record;
	} catch {
		return undefined;
	}
}
function stageEntryUsage(root: string, id: string): WorkPromptStageEntryUsage {
	let exists = false;
	let bytes = 0;
	let bodyPresent = false;
	for (const [target, body] of [
		[stageBodyPath(root, id), true],
		[stageRecordPath(root, id), false],
	] as const) {
		let stat: fs.Stats;
		try {
			stat = fs.lstatSync(target);
		} catch (error) {
			if (isErrno(error, "ENOENT")) continue;
			throw error;
		}
		if (stat.isSymbolicLink() || !stat.isFile())
			throw new Error(`staged Work prompt ${id} path is not a regular file`);
		exists = true;
		if (body) {
			bodyPresent = true;
			bytes = stat.size;
		}
	}
	return { entries: exists ? 1 : 0, bytes, body_present: bodyPresent };
}
function newestStageFileMtime(root: string, id: string): number | undefined {
	let newest: number | undefined;
	for (const target of [stageBodyPath(root, id), stageRecordPath(root, id)]) {
		if (!fs.existsSync(target)) continue;
		const stat = fs.lstatSync(target);
		if (stat.isSymbolicLink() || !stat.isFile())
			throw new Error(`staged Work prompt ${id} path is not a regular file`);
		newest = newest === undefined ? stat.mtimeMs : Math.max(newest, stat.mtimeMs);
	}
	return newest;
}
function removeStageFiles(root: string, id: string): void {
	for (const target of [stageBodyPath(root, id), stageRecordPath(root, id)]) {
		try {
			fs.unlinkSync(target);
			fsyncDirectory(path.dirname(target));
		} catch (error) {
			if (!isErrno(error, "ENOENT")) throw error;
		}
	}
}
function secureStageRoot(stateRoot: string): string {
	const state = canonicalMissingPath(stateRoot);
	ensurePrivateDirectories(state);
	assertNoSymlink(state, false);
	const root = path.join(state, "work-prompt-stage");
	ensurePrivateDirectories(root);
	for (const child of ["bodies", "records", "outcomes", "bindings", ".locks"])
		ensurePrivateDirectories(path.join(root, child));
	return root;
}
function safeChild(root: string, directory: string, name: string): string {
	const target = path.join(root, directory, name);
	assertNoSymlink(target, true);
	return target;
}
function assertCaptureId(id: string): void {
	if (!/^cap_[a-f0-9]{64}$/.test(id))
		throw new Error(`invalid Work prompt capture ID: ${id}`);
}
function isSafeOpaqueId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
	);
}
function assertSafeOpaqueId(
	value: unknown,
	label: string,
): asserts value is string {
	if (!isSafeOpaqueId(value)) throw new Error(`invalid ${label}`);
}
function durablePublish(destination: string, bytes: Buffer): void {
	ensurePrivateDirectories(path.dirname(destination));
	assertNoSymlink(destination, true);
	if (fs.existsSync(destination)) {
		if (!readNoFollow(destination).equals(bytes))
			throw new Error(`immutable staged Work prompt collision: ${destination}`);
		fs.chmodSync(destination, 0o600);
		return;
	}
	const temporary = path.join(
		path.dirname(destination),
		`.${path.basename(destination)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`,
	);
	let fd: number | undefined;
	try {
		fd = fs.openSync(
			temporary,
			fs.constants.O_WRONLY |
				fs.constants.O_CREAT |
				fs.constants.O_EXCL |
				noFollowFlag(),
			0o600,
		);
		fs.writeFileSync(fd, bytes);
		fs.fsyncSync(fd);
		fs.closeSync(fd);
		fd = undefined;
		fs.renameSync(temporary, destination);
		fsyncDirectory(path.dirname(destination));
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
		try {
			fs.unlinkSync(temporary);
		} catch (error) {
			if (!isErrno(error, "ENOENT")) throw error;
		}
	}
}
function readNoFollow(target: string): Buffer {
	assertNoSymlink(target, false);
	const fd = fs.openSync(target, fs.constants.O_RDONLY | noFollowFlag());
	try {
		if (!fs.fstatSync(fd).isFile())
			throw new Error(`managed Work prompt path is not regular: ${target}`);
		return fs.readFileSync(fd);
	} finally {
		fs.closeSync(fd);
	}
}
function ensurePrivateDirectories(directory: string): void {
	const missing: string[] = [];
	let current = path.resolve(directory);
	while (!fs.existsSync(current)) {
		missing.push(path.basename(current));
		current = path.dirname(current);
	}
	current = fs.realpathSync(current);
	assertNoSymlink(current, false);
	for (const item of missing.reverse()) {
		current = path.join(current, item);
		fs.mkdirSync(current, 0o700);
	}
	fs.chmodSync(current, 0o700);
}
function assertNoSymlink(target: string, allowMissing: boolean): void {
	const absolute = path.resolve(target);
	const parsed = path.parse(absolute);
	let current = parsed.root;
	for (const part of absolute
		.slice(parsed.root.length)
		.split(path.sep)
		.filter(Boolean)) {
		current = path.join(current, part);
		try {
			if (fs.lstatSync(current).isSymbolicLink())
				throw new Error(
					`managed Work prompt path contains a symbolic link: ${current}`,
				);
		} catch (error) {
			if (allowMissing && isErrno(error, "ENOENT")) return;
			throw error;
		}
	}
}
function fsyncDirectory(directory: string): void {
	const fd = fs.openSync(directory, fs.constants.O_RDONLY | noFollowFlag());
	try {
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
}
function noFollowFlag(): number {
	return fs.constants.O_NOFOLLOW ?? 0;
}
function isErrno(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === code
	);
}
function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
function canonicalJson(value: unknown): string {
	if (value === null || typeof value === "boolean" || typeof value === "string")
		return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("non-finite JSON number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => compareCodeUnits(a, b))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
			.join(",")}}`;
	throw new Error(`unsupported JSON value: ${typeof value}`);
}
function canonicalMissingPath(candidate: string): string {
	const missing: string[] = [];
	let current = path.resolve(candidate);
	while (!fs.existsSync(current)) {
		missing.push(path.basename(current));
		current = path.dirname(current);
	}
	return path.join(fs.realpathSync(current), ...missing.reverse());
}
function exactKeys(value: object, keys: string[]): boolean {
	return (
		canonicalJson(Object.keys(value).sort(compareCodeUnits)) ===
		canonicalJson([...keys].sort(compareCodeUnits))
	);
}
function assertIdentityPart(value: string, label: string, max: number): void {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > max ||
		/[\u0000-\u001f\u007f]/u.test(value)
	)
		throw new Error(`invalid prompt ${label}`);
}
function isCanonicalTimestamp(value: string): boolean {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function assertCanonicalTimestamp(value: string, label: string): void {
	if (!isCanonicalTimestamp(value))
		throw new Error(`invalid canonical ${label} timestamp`);
}
function revalidateTerminalOutcome(
	stateRoot: string,
	outcome: WorkPromptStageOutcome,
): void {
	if (outcome.outcome === "discarded") return;
	const source = readPublishedWorkSourceEvent(
		stateRoot,
		outcome.source_event_id!,
	);
	const expectedStatus =
		outcome.outcome === "provisional" ? "provisional" : "allocated";
	if (source.envelope.allocation_status !== expectedStatus)
		throw new Error("staged Work prompt terminal source status mismatch");
	if (source.envelope.object_hash !== outcome.body_hash)
		throw new Error("staged Work prompt terminal source integrity mismatch");
	if (outcome.outcome === "allocated") {
		const ledgerPath = path.join(
			stateRoot,
			"work-units",
			outcome.work_id!,
			"ledger.jsonl",
		);
		const record = readWorkLedger(ledgerPath).records.find(
			(item) => item.event_id === outcome.ledger_event_id,
		);
		if (!record || record.payload.source_event_id !== outcome.source_event_id)
			throw new Error("staged Work prompt terminal ledger integrity mismatch");
	}
}
function assertReasonCodes(values: string[]): void {
	if (
		!Array.isArray(values) ||
		values.length === 0 ||
		values.length > 32 ||
		values.some(
			(item) =>
				typeof item !== "string" ||
				item.length === 0 ||
				item.length > 128 ||
				/[\u0000-\u001f\u007f]/u.test(item),
		) ||
		new Set(values).size !== values.length
	)
		throw new Error("invalid prompt boundary reason codes");
}
function assertOutcomeRetryMatches(
	outcome: WorkPromptStageOutcome,
	assertion: Record<string, unknown>,
): void {
	let actual: Record<string, unknown>;
	if (outcome.outcome === "discarded") actual = { reason: outcome.reason };
	else if (outcome.outcome === "provisional")
		actual = {
			boundary_state: outcome.boundary_state,
			classification: outcome.classification,
			reason_codes: outcome.reason_codes,
			...(outcome.question ? { question: outcome.question } : {}),
		};
	else
		actual = {
			decision: outcome.decision,
			work_id: outcome.work_id,
			ledger_event_id: outcome.ledger_event_id,
			expected_head: assertion.expected_head,
			ledger_event_hash: assertion.ledger_event_hash,
		};
	if (canonicalJson(actual) !== canonicalJson(assertion))
		throw new Error("staged Work prompt terminal assertion conflict");
	if (
		outcome.outcome !== "discarded" &&
		sha256(Buffer.from(canonicalJson(assertion), "utf8")) !==
			outcome.assertion_hash
	)
		throw new Error("staged Work prompt terminal assertion integrity mismatch");
}
function assertBindingRetryMatches(
	binding: WorkPromptStageBinding,
	assertion: Record<string, unknown>,
): void {
	const actual = {
		decision: binding.decision,
		work_id: binding.work_id,
		ledger_event_id: binding.ledger_event_id,
		expected_head: assertion.expected_head,
		ledger_event_hash: assertion.ledger_event_hash,
	};
	if (
		canonicalJson(actual) !== canonicalJson(assertion) ||
		sha256(Buffer.from(canonicalJson(assertion), "utf8")) !==
			binding.assertion_hash
	)
		throw new Error("staged Work prompt binding assertion conflict");
}
function revalidateBinding(
	stateRoot: string,
	binding: WorkPromptStageBinding,
): void {
	const source = readPublishedWorkSourceEvent(
		stateRoot,
		binding.source_event_id,
	);
	if (source.envelope.allocation_status !== "provisional")
		throw new Error("staged Work prompt binding source status mismatch");
	const ledgerPath = path.join(
		stateRoot,
		"work-units",
		binding.work_id,
		"ledger.jsonl",
	);
	const record = readWorkLedger(ledgerPath).records.find(
		(item) => item.event_id === binding.ledger_event_id,
	);
	if (!record || record.payload.source_event_id !== binding.source_event_id)
		throw new Error("staged Work prompt binding ledger integrity mismatch");
}
