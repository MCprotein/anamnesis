import { z } from "zod";
import { sha256 } from "../util/hash.js";
import {
	WORK_TRANSITION_BATCH_SCHEMA_VERSION,
	type WorkTransitionBatchDraft,
} from "./work_command_draft.js";
import type {
	WorkProjection,
	WorkRequirementState,
} from "./work_projection.js";

export const WORK_EVIDENCE_PLAN_SCHEMA_VERSION =
	"anamnesis.work-evidence-plan.v1" as const;

/** Default PR-body marker: `Work-Requirements: r1, r2 — optional note`. */
export const DEFAULT_WORK_EVIDENCE_MARKER = "Work-Requirements";

const MAX_PULL_REQUESTS = 500;
const MAX_EVIDENCE_REF_UTF8_BYTES = 1_024;
const MAX_NOTE_CHARACTERS = 400;

/**
 * The subset of `gh pr list|view --json ...` fields the plan reads. Unknown
 * fields are ignored so callers can pass a wider `--json` field list.
 */
const pullRequestSchema = z
	.object({
		number: z.number().int().positive(),
		url: z.string().url(),
		state: z.enum(["OPEN", "MERGED", "CLOSED"]),
		body: z.string().nullable().optional(),
		headRefOid: z.string().nullable().optional(),
		mergedAt: z.string().nullable().optional(),
		mergeCommit: z
			.object({ oid: z.string() })
			.passthrough()
			.nullable()
			.optional(),
		isDraft: z.boolean().optional(),
	})
	.passthrough();

export type WorkEvidencePullRequest = z.infer<typeof pullRequestSchema>;

export type WorkEvidencePlanSkipReason =
	| "no_marker"
	| "no_requirement"
	| "closed_unmerged"
	| "already_recorded"
	| "already_at_or_beyond"
	| "requirement_blocked"
	| "requirement_waived"
	| "requirement_superseded";

export interface WorkEvidencePlan {
	schema_version: typeof WORK_EVIDENCE_PLAN_SCHEMA_VERSION;
	work_id: string;
	expected_head: string | null;
	contract_revision: number;
	contract_hash: string | null;
	marker: string;
	status_rule: {
		OPEN: "in_progress";
		MERGED: "implemented_unverified";
		CLOSED: "skip";
	};
	batch: WorkTransitionBatchDraft | null;
	skipped: Array<{
		pr: string;
		requirement_id?: string;
		reason: WorkEvidencePlanSkipReason;
	}>;
	unknown_requirement_ids: Array<{ pr: string; id: string }>;
}

export interface BuildWorkEvidencePlanInput {
	projection: WorkProjection;
	/** Every event ID already in the ledger, for idempotent replanning. */
	committed_event_ids: ReadonlySet<string>;
	/** Parsed JSON from `gh pr list --json ...` (array) or `gh pr view` (object). */
	pull_requests: unknown;
	marker?: string;
}

const STATUS_RANK: Record<WorkRequirementState, number> = {
	pending: 0,
	in_progress: 1,
	implemented_unverified: 2,
	verified: 3,
	blocked: -1,
	waived: -1,
};

/**
 * Turn PR state that the caller already fetched into a transition batch
 * draft. The function reads no network and writes nothing. It never claims
 * `verified`: a merged PR is implementation evidence, not verification.
 */
export function buildWorkEvidencePlan(
	input: BuildWorkEvidencePlanInput,
): WorkEvidencePlan {
	const marker = (input.marker ?? DEFAULT_WORK_EVIDENCE_MARKER).trim();
	if (marker.length === 0 || marker.length > 64 || /[\r\n:]/u.test(marker))
		throw new Error("evidence marker must be 1-64 characters without ':'");
	const raw = Array.isArray(input.pull_requests)
		? input.pull_requests
		: [input.pull_requests];
	if (raw.length > MAX_PULL_REQUESTS)
		throw new Error(`evidence plan accepts at most ${MAX_PULL_REQUESTS} PRs`);
	const pullRequests = raw.map((item, index) => {
		const parsed = pullRequestSchema.safeParse(item);
		if (!parsed.success)
			throw new Error(
				`PR input ${index} is not gh PR JSON with number, url, and state: ${parsed.error.issues[0]?.message ?? "invalid"}`,
			);
		return parsed.data;
	});
	const requirements = new Map(
		input.projection.requirements.map((item) => [item.id, item]),
	);
	const transitions = new Map<
		string,
		WorkTransitionBatchDraft["transitions"][number]
	>();
	const skipped: WorkEvidencePlan["skipped"] = [];
	const unknown: WorkEvidencePlan["unknown_requirement_ids"] = [];

	for (const pr of [...pullRequests].sort(
		(left, right) =>
			compareCodeUnits(left.url, right.url) || left.number - right.number,
	)) {
		const lines = markerLines(pr.body ?? "", marker);
		if (lines.length === 0) {
			skipped.push({ pr: pr.url, reason: "no_marker" });
			continue;
		}
		if (pr.state === "CLOSED") {
			skipped.push({ pr: pr.url, reason: "closed_unmerged" });
			continue;
		}
		const target: WorkRequirementState =
			pr.state === "MERGED" ? "implemented_unverified" : "in_progress";
		let linked = 0;
		for (const line of lines) {
			for (const id of line.ids) {
				const requirement = requirements.get(id);
				if (!requirement) {
					unknown.push({ pr: pr.url, id });
					continue;
				}
				linked += 1;
				const eventId = planEventId(input.projection.work_id, id, pr);
				if (input.committed_event_ids.has(eventId)) {
					skipped.push({
						pr: pr.url,
						requirement_id: id,
						reason: "already_recorded",
					});
					continue;
				}
				if (requirement.superseded_by !== undefined) {
					skipped.push({
						pr: pr.url,
						requirement_id: id,
						reason: "requirement_superseded",
					});
					continue;
				}
				if (requirement.status === "blocked" || requirement.status === "waived") {
					skipped.push({
						pr: pr.url,
						requirement_id: id,
						reason:
							requirement.status === "blocked"
								? "requirement_blocked"
								: "requirement_waived",
					});
					continue;
				}
				if (STATUS_RANK[requirement.status] >= STATUS_RANK[target]) {
					skipped.push({
						pr: pr.url,
						requirement_id: id,
						reason: "already_at_or_beyond",
					});
					continue;
				}
				const ref = evidenceRef(pr, line.note);
				const existing = transitions.get(id);
				// One requirement appears once per batch: the furthest state
				// wins, and the evidence of every contributing PR is kept.
				if (
					!existing ||
					STATUS_RANK[existing.status as WorkRequirementState] <
						STATUS_RANK[target]
				) {
					transitions.set(id, {
						event_id: eventId,
						requirement_id: id,
						status: target as "in_progress" | "implemented_unverified",
						evidence_refs: uniqueRefs([
							...(existing?.evidence_refs ?? []),
							ref,
						]),
					});
				} else {
					existing.evidence_refs = uniqueRefs([
						...existing.evidence_refs,
						ref,
					]);
				}
			}
		}
		if (linked === 0 && lines.every((line) => line.ids.length === 0))
			skipped.push({ pr: pr.url, reason: "no_requirement" });
	}

	const batchTransitions = [...transitions.values()].sort((left, right) =>
		compareCodeUnits(left.requirement_id, right.requirement_id),
	);
	return {
		schema_version: WORK_EVIDENCE_PLAN_SCHEMA_VERSION,
		work_id: input.projection.work_id,
		expected_head: input.projection.ledger_head,
		contract_revision: input.projection.contract_revision,
		contract_hash: input.projection.contract_hash,
		marker,
		status_rule: {
			OPEN: "in_progress",
			MERGED: "implemented_unverified",
			CLOSED: "skip",
		},
		batch:
			batchTransitions.length === 0
				? null
				: {
						schema_version: WORK_TRANSITION_BATCH_SCHEMA_VERSION,
						work_id: input.projection.work_id,
						transitions: batchTransitions,
					},
		skipped,
		unknown_requirement_ids: unknown,
	};
}

/**
 * Lines of the form `<marker>: <ids> — <note>`. IDs end at the first dash
 * separator (`—`, `–`, or ` - `); `-` alone means "no requirement".
 */
function markerLines(
	body: string,
	marker: string,
): Array<{ ids: string[]; note: string }> {
	const escaped = marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const pattern = new RegExp(`^\\s*(?:[-*]\\s+)?${escaped}\\s*:\\s*(.*)$`, "u");
	const out: Array<{ ids: string[]; note: string }> = [];
	for (const line of body.split(/\r?\n/u)) {
		const match = pattern.exec(line);
		if (!match) continue;
		const rest = (match[1] ?? "").trim();
		const separator = /\s*(?:—|–|\s-\s)\s*/u.exec(rest);
		const head = separator ? rest.slice(0, separator.index) : rest;
		const note = separator
			? rest.slice(separator.index + separator[0].length)
			: "";
		const ids = head
			.split(/[\s,]+/u)
			.map((token) => token.replace(/^`|`$/gu, ""))
			.filter((token) => token.length > 0 && token !== "-");
		out.push({ ids: [...new Set(ids)], note: note.trim() });
	}
	return out;
}

function planEventId(
	workId: string,
	requirementId: string,
	pr: WorkEvidencePullRequest,
): string {
	const digest = sha256(
		[
			"anamnesis-work-evidence-plan-v1",
			workId,
			requirementId,
			pr.url,
			pr.state,
			pr.headRefOid ?? "",
			pr.mergeCommit?.oid ?? "",
		].join("\0"),
	).slice("sha256:".length, "sha256:".length + 24);
	return `evp-${digest}`;
}

function evidenceRef(pr: WorkEvidencePullRequest, note: string): string {
	const parts = [`${pr.url} ${pr.state}${pr.isDraft ? " draft" : ""}`];
	if (pr.headRefOid) parts.push(`head ${pr.headRefOid.slice(0, 12)}`);
	if (pr.state === "MERGED" && pr.mergeCommit?.oid)
		parts.push(`merge ${pr.mergeCommit.oid.slice(0, 12)}`);
	if (pr.state === "MERGED" && pr.mergedAt) parts.push(`at ${pr.mergedAt}`);
	let ref = parts.join(" ");
	const compactNote = note.replace(/\s+/gu, " ").trim();
	if (compactNote.length > 0)
		ref = `${ref}: ${truncateCharacters(compactNote, MAX_NOTE_CHARACTERS)}`;
	return truncateUtf8(ref, MAX_EVIDENCE_REF_UTF8_BYTES);
}

function truncateCharacters(value: string, max: number): string {
	const characters = [...value];
	return characters.length <= max
		? value
		: `${characters.slice(0, max - 1).join("")}…`;
}

function truncateUtf8(value: string, maxBytes: number): string {
	if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
	let out = "";
	for (const character of value) {
		if (Buffer.byteLength(`${out}${character}…`, "utf8") > maxBytes) break;
		out += character;
	}
	return `${out}…`;
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueRefs(values: readonly string[]): string[] {
	return [...new Set(values)];
}
