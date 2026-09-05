import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import * as workCursorModule from "../core/work_cursor.js";
import {
	newWorkCursor,
	readWorkCursor,
	updateWorkCursorAtomic,
	writeWorkCursorAtomic,
} from "../core/work_cursor.js";
import { calculateWorkProgress } from "../core/work_projection.js";
import { buildWorkBriefingSnapshot } from "../core/work_reconciliation.js";
import {
	deriveWorkPromptCaptureId,
	readStagedWorkPrompt,
} from "../core/work_prompt_stage.js";
import { resolveWorkStateRoot } from "../core/work_storage.js";
import { sha256 } from "../util/hash.js";
import {
	amendWork,
	createWork,
	statusWork,
	type WorkMutationInput,
} from "./work.js";
import {
	deriveWorkHookCursorId,
	handleWorkPostToolBoundary,
	handleWorkUserPromptSubmit,
	renderWorkExecutionPacket,
	renderWorkBriefingContext,
	type WorkHookClient,
} from "./work_hook.js";

const WORK_HOOK_RETRY_TEST_TIMEOUT_MS = 60_000;

const roots: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function projectRoot(
	preset: "off" | "frequent" = "frequent",
	reviewPreset: "off" | "strict" = "off",
	capture = false,
): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-work-hook-"));
	roots.push(root);
	fs.writeFileSync(
		path.join(root, "Agentfile"),
		YAML.stringify({
			version: 2,
			project: { name: "work-hook-test" },
			tools: ["codex"],
			fragments: [],
			settings: {
				...(capture
					? { work_prompt_capture: { preset: "bounded" } }
					: {}),
				work_policy: {
					reconciliation: { preset },
					review: { preset: reviewPreset },
				},
			},
		}),
	);
	return root;
}

function draft(
	sourceEventId: string,
	classification: "new_unit" | "same_unit" = "new_unit",
	includeSecond = false,
): Buffer {
	return Buffer.from(
		YAML.stringify({
			work: { title: "Hook Work", completion_contract: "Verify it" },
			boundary: {
				state: "accepted",
				classification,
				reason_codes: ["same_deliverable"],
				confidence: "high",
			},
			requirements: [
				{
					id: "req_a",
					summary: "Keep hook delivery safe",
					source_event_ids: ["src_create"],
				},
				...(includeSecond
					? [
							{
								id: "req_b",
								summary: "Observe changed Work",
								source_event_ids: [sourceEventId],
							},
						]
					: []),
			],
			open_conflicts: [],
		}),
	);
}

function mutation(root: string, overrides: Partial<WorkMutationInput> = {}) {
	return {
		project_root: root,
		work_id: "wu_hook",
		event_id: "evt_create",
		occurred_at: "2026-08-13T00:00:00.000Z",
		draft: draft("src_create"),
		source_stdin: {
			event_id: "src_create",
			captured_at: "2026-08-13T00:00:00.000Z",
			client: "codex",
			content_type: "text/plain; charset=utf-8",
			fidelity: "native_exact" as const,
			allocation_status: "allocated",
			body: Buffer.from("fixture source"),
		},
		...overrides,
	};
}

function seed(root: string, client: WorkHookClient, sessionId: string): string {
	const created = createWork(mutation(root));
	const state = resolveWorkStateRoot(root);
	const cursorId = deriveWorkHookCursorId(client, sessionId);
	writeWorkCursorAtomic(
		state.state_root,
		newWorkCursor({
			cursor_id: cursorId,
			client_session_ref: sessionId,
			worktree_fingerprint: state.worktree_fingerprint,
			updated_at: "2026-08-13T00:00:00.000Z",
			truth: {
				work_id: created.projection.work_id,
				revision: created.projection.contract_revision,
				last_event_id: created.projection.last_event_id,
				projection_hash: created.projection.projection_hash,
			},
		}),
		{ expectedCursorRevision: null },
	);
	return cursorId;
}

function codexPayload(sessionId: string, turnId: string, prompt = "continue") {
	return { session_id: sessionId, turn_id: turnId, prompt };
}

function postToolPayload(
	sessionId: string,
	turnId: string,
	toolUseId: string,
	toolName = "apply_patch",
) {
	return {
		session_id: sessionId,
		turn_id: turnId,
		events: [{ tool_name: toolName, tool_use_id: toolUseId }],
	};
}

describe("foreground Work UserPromptSubmit hook", () => {
	it("stages exact decoded prompt bytes and returns only an opaque classification token", () => {
		const root = projectRoot("off", "off", true);
		const prompt = " 앞\r\n한글\0emoji 😀 e\u0301  ";
		const result = handleWorkUserPromptSubmit({
			project_root: root,
			client: "codex",
			payload: codexPayload("capture-session", "capture-turn", prompt),
			now: "2026-08-14T00:00:00.000Z",
		});
		const captureId = deriveWorkPromptCaptureId({
			client: "codex",
			sessionId: "capture-session",
			boundaryId: "capture-turn",
		});
		expect(result).toMatchObject({
			status: "capture_staged",
			reason: "capture_staged",
			context: expect.stringContaining(captureId),
		});
		expect(result.context).not.toContain(prompt);
		expect(result.context).not.toContain(sha256(prompt));
		expect(result.context).toContain("do not infer a Work from the current cursor");
		const staged = readStagedWorkPrompt(
			resolveWorkStateRoot(root).state_root,
			captureId,
		);
		expect(staged?.body).toEqual(Buffer.from(prompt, "utf8"));
		expect(staged?.record.fidelity).toBe("client_exact");
	});

	it("preserves the staged classification obligation when the linked Work is missing", () => {
		const root = projectRoot("frequent", "off", true);
		const sessionId = "missing-work-session";
		seed(root, "codex", sessionId);
		const state = resolveWorkStateRoot(root);
		fs.rmSync(path.join(state.state_root, "work-units", "wu_hook"), {
			recursive: true,
			force: true,
		});

		const result = handleWorkUserPromptSubmit({
			project_root: root,
			client: "codex",
			payload: codexPayload(
				sessionId,
				"missing-work-turn",
				"private missing Work requirement",
			),
			now: "2026-08-14T00:02:00.000Z",
		});
		const captureId = deriveWorkPromptCaptureId({
			client: "codex",
			sessionId,
			boundaryId: "missing-work-turn",
		});

		expect(result).toMatchObject({
			status: "capture_staged",
			reason: "capture_staged",
			context: expect.stringContaining(captureId),
		});
		expect(result.context).toContain("choose exactly one outcome");
		expect(readStagedWorkPrompt(state.state_root, captureId)).toBeDefined();
	});

	it("preserves the staged classification obligation after cursor CAS exhaustion", () => {
		const root = projectRoot("frequent", "off", true);
		const sessionId = "stale-cursor-session";
		seed(root, "codex", sessionId);
		const update = vi
			.spyOn(workCursorModule, "updateWorkCursorAtomic")
			.mockImplementation(() => {
				throw new Error("stale Work cursor write");
			});

		const result = handleWorkUserPromptSubmit({
			project_root: root,
			client: "codex",
			payload: codexPayload(
				sessionId,
				"stale-cursor-turn",
				"private stale cursor requirement",
			),
			now: "2026-08-14T00:03:00.000Z",
		});
		const captureId = deriveWorkPromptCaptureId({
			client: "codex",
			sessionId,
			boundaryId: "stale-cursor-turn",
		});

		expect(update).toHaveBeenCalledTimes(65);
		expect(result).toMatchObject({
			status: "capture_staged",
			reason: "capture_staged",
			context: expect.stringContaining(captureId),
		});
	}, WORK_HOOK_RETRY_TEST_TIMEOUT_MS);

	it("fails closed without exposing prompt-derived data on a stable-boundary collision", () => {
		const root = projectRoot("off", "off", true);
		const firstPrompt = "first private requirement";
		const conflictingPrompt = "different private requirement";
		expect(
			handleWorkUserPromptSubmit({
				project_root: root,
				client: "codex",
				payload: codexPayload(
					"collision-session",
					"collision-turn",
					firstPrompt,
				),
				now: "2026-08-14T00:00:00.000Z",
			}),
		).toMatchObject({ status: "capture_staged" });

		const collision = handleWorkUserPromptSubmit({
			project_root: root,
			client: "codex",
			payload: codexPayload(
				"collision-session",
				"collision-turn",
				conflictingPrompt,
			),
			now: "2026-08-14T00:01:00.000Z",
		});
		expect(collision).toMatchObject({
			status: "unavailable",
			reason: "capture_unavailable",
			context: expect.stringContaining("allocation remains unresolved"),
		});
		expect(collision.context).not.toContain(firstPrompt);
		expect(collision.context).not.toContain(conflictingPrompt);
		expect(collision.context).not.toContain(sha256(firstPrompt));
		expect(collision.context).not.toContain(sha256(conflictingPrompt));
	});

	it("fails open without storing a prompt containing an unpaired UTF-16 surrogate", () => {
		const root = projectRoot("off", "off", true);
		const result = handleWorkUserPromptSubmit({
			project_root: root,
			client: "codex",
			payload: codexPayload("capture-session", "bad-turn", "bad\ud800prompt"),
		});
		expect(result).toMatchObject({
			status: "unavailable",
			reason: "invalid_payload",
			context: null,
		});
		expect(
			fs.existsSync(path.join(root, ".anamnesis/work-prompt-stage")),
		).toBe(false);
	});

	it("uses the reviewed repository capture policy without an environment gate", () => {
		const root = projectRoot("off", "off", true);
		vi.unstubAllEnvs();
		const result = handleWorkUserPromptSubmit({
			project_root: root,
			client: "codex",
			payload: codexPayload("no-consent", "turn-1", "private requirement"),
		});
		expect(result).toMatchObject({
			status: "capture_staged",
			reason: "capture_staged",
			context: expect.stringContaining("Opaque stage token"),
		});
		expect(
			fs.existsSync(path.join(root, ".anamnesis/work-prompt-stage")),
		).toBe(true);
	});

	it("returns bounded onboarding with no cursor and no briefing under an off policy", () => {
		const noCursorRoot = projectRoot();
		expect(
			handleWorkUserPromptSubmit({
				project_root: noCursorRoot,
				client: "codex",
				payload: codexPayload("missing", "turn-1"),
			}),
		).toMatchObject({
			status: "unavailable",
			context: expect.stringContaining(
				deriveWorkHookCursorId("codex", "missing"),
			),
		});

		const offRoot = projectRoot("off");
		expect(
			handleWorkUserPromptSubmit({
				project_root: offRoot,
				client: "codex",
				payload: codexPayload("off-unlinked", "turn-1"),
			}),
		).toMatchObject({ status: "not_due", reason: "policy_off", context: null });
		seed(offRoot, "codex", "off-session");
		expect(
			handleWorkUserPromptSubmit({
				project_root: offRoot,
				client: "codex",
				payload: codexPayload("off-session", "turn-1"),
			}),
		).toMatchObject({ status: "not_due", reason: "policy_off", context: null });
	});

	it("briefs first resume, dedupes retries, and permits unchanged cadence later", () => {
		const root = projectRoot();
		const cursorId = seed(root, "codex", "session-a");
		const first = handleWorkUserPromptSubmit({
			project_root: root,
			client: "codex",
			payload: codexPayload("session-a", "turn-1"),
			now: "2026-08-13T00:00:00.000Z",
		});
		expect(first).toMatchObject({ status: "briefing_due" });
		expect(first.context).toContain("injected_unconfirmed");
		expect(first.context).toContain("visibly brief the requirements");
		expect(
			handleWorkUserPromptSubmit({
				project_root: root,
				client: "codex",
				payload: codexPayload("session-a", "turn-1"),
				now: "2026-08-13T00:00:01.000Z",
			}),
		).toMatchObject({ reason: "duplicate_boundary", context: null });
		expect(
			handleWorkUserPromptSubmit({
				project_root: root,
				client: "codex",
				payload: codexPayload("session-a", "turn-2"),
				now: "2026-08-13T00:04:59.999Z",
			}),
		).toMatchObject({ status: "not_due", context: null });
		expect(
			handleWorkUserPromptSubmit({
				project_root: root,
				client: "codex",
				payload: codexPayload("session-a", "turn-3"),
				now: "2026-08-13T00:05:00.000Z",
			}),
		).toMatchObject({ status: "briefing_due" });
		const cursor = readWorkCursor(
			resolveWorkStateRoot(root).state_root,
			cursorId,
		).cursor;
		expect(cursor?.reconciliation).toMatchObject({
			last_reconciled_head: null,
			last_reconciled_revision: null,
			last_reconciled_at: null,
			confirmed_delivery_fingerprint: null,
			pending_delivery: { fingerprint: expect.any(String) },
			injected_unconfirmed: { boundary_id: expect.any(String) },
		});
	});

	it("never tells the foreground agent to continue a terminal Work", () => {
		const root = projectRoot();
		seed(root, "codex", "terminal-render");
		const status = handleWorkUserPromptSubmit({
			project_root: root,
			client: "codex",
			payload: codexPayload("terminal-render", "turn-1"),
			now: "2026-08-13T00:00:00.000Z",
		});
		expect(status.status).toBe("briefing_due");
		const openContext = status.context ?? "";
		const briefing = buildWorkBriefingSnapshot({
			projection: statusWork({
				project_root: root,
				work_id: "wu_hook",
			}).projection,
		});
		const terminalContext = renderWorkBriefingContext(
			briefing,
			"compact",
			false,
		);
		expect(openContext).toContain("continue the same task");
		expect(terminalContext).toContain("This Work is terminal");
		expect(terminalContext).not.toContain("continue the same task");
	});

	it("keeps default compact briefings sufficient to retrieve and report complete Work truth", () => {
		const root = projectRoot("frequent", "strict");
		seed(root, "codex", "compact-session");
		amendWork(
			mutation(root, {
				event_id: "evt_compact_amend",
				occurred_at: "2026-08-13T00:01:00.000Z",
				expected_head: statusWork({
					project_root: root,
					work_id: "wu_hook",
				}).projection.ledger_head,
				draft: draft("src_compact_amend", "same_unit", true),
				source_stdin: {
					...mutation(root).source_stdin!,
					event_id: "src_compact_amend",
					body: Buffer.from("second compact requirement"),
				},
			}),
		);

		const output = handleWorkUserPromptSubmit({
			project_root: root,
			client: "codex",
			payload: codexPayload("compact-session", "turn-1"),
			now: "2026-08-13T00:01:01.000Z",
		});
		expect(output.status).toBe("briefing_due");
		expect(output.context).toContain(
			"`anamnesis work status --work 'wu_hook' --json`",
		);
		expect(output.context).toContain("Completion contract: Verify it");
		expect(output.context).toContain(
			"Configured required review gates (not proof of satisfaction): completion, planning",
		);
		expect(output.context).toContain("req_b [pending]: Observe changed Work");
		expect(output.context).toContain("Next action: req_a [pending]");
	});

	it("preserves compact invariants and never partially emits oversized full requirements", () => {
		const root = projectRoot();
		seed(root, "codex", "budget-session");
		const status = statusWork({ project_root: root, work_id: "wu_hook" });
		const requirements = Array.from({ length: 100 }, (_, index) => ({
			...status.projection.requirements[0]!,
			id: `req_${index.toString().padStart(3, "0")}`,
			summary: `requirement-${index}-${"가".repeat(500)}`,
			status:
				index % 2 === 0
					? ("implemented_unverified" as const)
					: ("pending" as const),
		}));
		const briefing = buildWorkBriefingSnapshot({
			projection: {
				...status.projection,
				requirements,
				progress: {
					applicable: 100,
					pending: 50,
					in_progress: 0,
					verified: 0,
					implemented_unverified: 50,
					blocked: 0,
					waived: 0,
					percent: 0,
					weighted: false,
					denominator_empty: false,
				},
			},
		});
		const hostileBriefing = {
			...briefing,
			work: {
				...briefing.work,
				completion_contract: "완료-계약-".repeat(2_000),
			},
			blockers: {
				requirement_ids: Array.from(
					{ length: 100 },
					(_, index) => `req_blocker_${index.toString().padStart(3, "0")}`,
				),
				conflict_ids: Array.from(
					{ length: 100 },
					(_, index) => `conflict_${index.toString().padStart(3, "0")}`,
				),
			},
			delta: {
				added_requirement_ids: requirements.map((item) => item.id),
				status_changed: requirements.map((item) => ({
					requirement_id: item.id,
					from: "pending" as const,
					to: "implemented_unverified" as const,
				})),
				superseded: requirements.map((item, index) => ({
					requirement_id: item.id,
					superseded_by: `req_replacement_${index.toString().padStart(3, "0")}`,
				})),
				conflicts_added: Array.from(
					{ length: 100 },
					(_, index) => `conflict_added_${index}`,
				),
				conflicts_resolved: Array.from(
					{ length: 100 },
					(_, index) => `conflict_resolved_${index}`,
				),
			},
		};
		for (const detail of ["compact", "full"] as const) {
			const context = renderWorkBriefingContext(
				hostileBriefing,
				detail,
				true,
			);
			expect(context.length).toBeLessThanOrEqual(8_000);
			expect(context).toContain("Required retrieval:");
			expect(context).toContain("Completion contract:");
			expect(context).toContain("Configured required review gates");
			expect(context).toContain("Next requirement IDs:");
			expect(context).toContain("Next action:");
			expect(context).toContain("Blocker IDs:");
			expect(context).toContain("Complete authoritative pointer:");
			if (detail === "full") {
				expect(context).toContain(
					"Full requirement enumeration unavailable in one hook context",
				);
				expect(context).not.toContain("Current requirements:");
			}
		}
		for (const detail of ["compact", "full"] as const) {
			const context = renderWorkBriefingContext(
				hostileBriefing,
				detail,
				true,
				8_000,
			);
			expect(context.length).toBeLessThanOrEqual(8_000);
			expect(context).toContain("Required retrieval:");
			if (detail === "full") {
				expect(context).not.toContain("Current requirements:");
			}
		}
	});

	it("does not repeat authoritative status retrieval when a full briefing fits", () => {
		const root = projectRoot();
		seed(root, "codex", "full-inline-session");
		const briefing = buildWorkBriefingSnapshot({
			projection: statusWork({
				project_root: root,
				work_id: "wu_hook",
			}).projection,
		});
		const context = renderWorkBriefingContext(briefing, "full", true);

		expect(context).toContain("Authoritative completeness:");
		expect(context).toContain("Current requirements:");
		expect(context).not.toContain("Required retrieval:");
	});

	it("renders a bounded executor packet with source-ordered, JSON-quoted rows", () => {
		const root = projectRoot("frequent", "strict");
		seed(root, "codex", "execution-packet-session");
		const briefing = buildWorkBriefingSnapshot({
			projection: statusWork({ project_root: root, work_id: "wu_hook" })
				.projection,
		});
		const packet = renderWorkExecutionPacket(briefing);
		const parsed = JSON.parse(packet) as {
			schema_version: string;
			requirements: string[];
			authoritative_completeness: boolean;
		};
		expect(parsed.schema_version).toBe("anamnesis.work-execution-packet.v1");
		expect(parsed.requirements).toEqual([
			`req_a|pending|${JSON.stringify("Keep hook delivery safe")}`,
		]);
		expect(parsed.authoritative_completeness).toBe(true);
		expect(packet).not.toContain("Delivery:");
		expect(packet).not.toContain("reconciliation");

		const twoRequirements = {
			...briefing,
			requirements: [
				briefing.requirements[0]!,
				{ ...briefing.requirements[0]!, id: "req_b", summary: "second" },
			],
		};
		const subset = JSON.parse(
			renderWorkExecutionPacket(twoRequirements, ["req_b", "req_a"]),
		) as { requirements: string[]; authoritative_completeness: boolean };
		expect(subset.requirements).toEqual([
			`req_a|pending|${JSON.stringify("Keep hook delivery safe")}`,
			`req_b|pending|${JSON.stringify("second")}`,
		]);
		expect(subset.authoritative_completeness).toBe(true);
	});

	it("fails closed for unknown, duplicate, and ambiguous requirement IDs", () => {
		const root = projectRoot();
		seed(root, "codex", "execution-packet-validation");
		const briefing = buildWorkBriefingSnapshot({
			projection: statusWork({ project_root: root, work_id: "wu_hook" })
				.projection,
		});
		expect(() =>
			renderWorkExecutionPacket(briefing, {
				requirement_ids: ["missing"],
			}),
		).toThrow("unknown");
		expect(() =>
			renderWorkExecutionPacket(briefing, {
				requirement_ids: ["req_a", "req_a"],
			}),
		).toThrow("duplicate");
		expect(() =>
			renderWorkExecutionPacket({
				...briefing,
				requirements: [briefing.requirements[0]!, briefing.requirements[0]!],
			}),
		).toThrow("ambiguous");
	});

	it("preserves hostile Unicode/delimiters and rejects structural budget overflow", () => {
		const root = projectRoot();
		seed(root, "codex", "execution-packet-security");
		const briefing = buildWorkBriefingSnapshot({
			projection: statusWork({ project_root: root, work_id: "wu_hook" })
				.projection,
		});
		const hostile = {
			...briefing,
			requirements: [
				{ ...briefing.requirements[0]!, summary: '한글|"line\\break\n😀' },
			],
		};
		const packet = renderWorkExecutionPacket(hostile);
		const parsed = JSON.parse(packet) as { requirements: string[] };
		expect(parsed.requirements[0]).toBe(
			`req_a|pending|${JSON.stringify('한글|"line\\break\n😀')}`,
		);
		expect(() =>
			renderWorkExecutionPacket(hostile, { max_bytes: 256 }),
		).toThrow("structural budget");
	});

	it("uses fewer UTF-8 bytes than a full user briefing for 24 requirements", () => {
		const root = projectRoot();
		seed(root, "codex", "execution-packet-metrics");
		const status = statusWork({ project_root: root, work_id: "wu_hook" });
		const requirements = Array.from({ length: 24 }, (_, index) => ({
			...status.projection.requirements[0]!,
			id: `req_${index.toString().padStart(2, "0")}`,
			summary: `requirement ${index}: ${"설명 ".repeat(18)}`,
		}));
		const briefing = buildWorkBriefingSnapshot({
			projection: {
				...status.projection,
				requirements,
				progress: calculateWorkProgress(requirements),
			},
		});
		const full = renderWorkBriefingContext(briefing, "full", true, 100_000);
		const packet = renderWorkExecutionPacket(briefing);
		const fullBytes = Buffer.byteLength(full, "utf8");
		const packetBytes = Buffer.byteLength(packet, "utf8");
		expect(packetBytes).toBeLessThan(fullBytes);
		expect(packetBytes).toBeLessThanOrEqual(16_384);
		expect(fullBytes).toBeGreaterThan(packetBytes);
	});

	it("keeps long and multiline requirement summaries lossless or requires retrieval", () => {
		const root = projectRoot();
		seed(root, "codex", "full-lossless-session");
		const briefing = buildWorkBriefingSnapshot({
			projection: statusWork({
				project_root: root,
				work_id: "wu_hook",
			}).projection,
		});
		const prefix = `${"shared context ".repeat(40)}\n`;
		const requirements = [
			{
				...briefing.requirements[0]!,
				id: "req_long_a",
				summary: `${prefix}alpha  tail`,
			},
			{
				...briefing.requirements[0]!,
				id: "req_long_b",
				summary: `${prefix}beta\t tail`,
			},
		];
		const context = renderWorkBriefingContext(
			{
				...briefing,
				requirements,
				next_requirement_ids: [],
				configured_required_gates: ["completion"],
			},
			"full",
			true,
		);

		expect(context).toContain("Authoritative completeness:");
		expect(context).not.toContain("Required retrieval:");
		expect(context).not.toContain("[omitted");
		expect(context).not.toContain("Shared summary prefix:");
		expect(context).toContain(
			`req_long_a|pending|${JSON.stringify(`${prefix}alpha  tail`)}`,
		);
		expect(context).toContain(
			`req_long_b|pending|${JSON.stringify(`${prefix}beta\t tail`)}`,
		);
	});

	it("allows the same fingerprint after the meaningful-action cadence", () => {
		const root = projectRoot();
		const cursorId = seed(root, "codex", "action-session");
		expect(
			handleWorkUserPromptSubmit({
				project_root: root,
				client: "codex",
				payload: codexPayload("action-session", "turn-1"),
				now: "2026-08-13T00:00:00.000Z",
			}).status,
		).toBe("briefing_due");
		const state = resolveWorkStateRoot(root);
		const cursor = readWorkCursor(state.state_root, cursorId).cursor;
		if (!cursor?.reconciliation) throw new Error("expected cursor state");
		updateWorkCursorAtomic(
			state.state_root,
			{
				...cursor,
				reconciliation: {
					...cursor.reconciliation,
					meaningful_actions_since_confirmed: 5,
				},
			},
			{
				work_id: cursor.work_id,
				revision: cursor.observed_revision,
				last_event_id: cursor.last_event_id,
				projection_hash: cursor.projection_hash,
			},
			"2026-08-13T00:00:01.000Z",
		);
		expect(
			handleWorkUserPromptSubmit({
				project_root: root,
				client: "codex",
				payload: codexPayload("action-session", "turn-2"),
				now: "2026-08-13T00:00:02.000Z",
			}).status,
		).toBe("briefing_due");
	});

	it("briefs changed Work before the interval and isolates two sessions", () => {
		const root = projectRoot();
		const cursorA = seed(root, "codex", "session-a");
		const created = createWork(mutation(root));
		const state = resolveWorkStateRoot(root);
		const cursorB = deriveWorkHookCursorId("claude-code", "session-b");
		writeWorkCursorAtomic(
			state.state_root,
			newWorkCursor({
				cursor_id: cursorB,
				client_session_ref: "session-b",
				worktree_fingerprint: state.worktree_fingerprint,
				updated_at: "2026-08-13T00:00:00.000Z",
				truth: {
					work_id: created.projection.work_id,
					revision: created.projection.contract_revision,
					last_event_id: created.projection.last_event_id,
					projection_hash: created.projection.projection_hash,
				},
			}),
			{ expectedCursorRevision: null },
		);
		const firstA = handleWorkUserPromptSubmit({
			project_root: root,
			client: "codex",
			payload: codexPayload("session-a", "turn-1"),
			now: "2026-08-13T00:00:00.000Z",
		});
		const firstB = handleWorkUserPromptSubmit({
			project_root: root,
			client: "claude-code",
			payload: {
				session_id: "session-b",
				prompt_id: "prompt-1",
				prompt: "continue",
			},
			now: "2026-08-13T00:00:00.000Z",
		});
		expect(firstA.status).toBe("briefing_due");
		expect(firstB.status).toBe("briefing_due");
		expect(cursorA).not.toBe(cursorB);

		amendWork(
			mutation(root, {
				event_id: "evt_amend",
				occurred_at: "2026-08-13T00:01:00.000Z",
				expected_head: created.projection.ledger_head,
				draft: draft("src_amend", "same_unit", true),
				source_stdin: {
					...mutation(root).source_stdin!,
					event_id: "src_amend",
					body: Buffer.from("changed source"),
				},
			}),
		);
		expect(
			handleWorkUserPromptSubmit({
				project_root: root,
				client: "codex",
				payload: codexPayload("session-a", "turn-2"),
				now: "2026-08-13T00:01:01.000Z",
			}).status,
		).toBe("briefing_due");
		expect(
			readWorkCursor(state.state_root, cursorB).cursor?.observed_revision,
		).toBe(1);
	});

	it("revalidates Work truth before the prompt cursor CAS", () => {
		const root = projectRoot();
		const sessionId = "prompt-freshness-session";
		const cursorId = seed(root, "codex", sessionId);
		const originalUpdate = workCursorModule.updateWorkCursorAtomic;
		let amended = false;
		vi.spyOn(workCursorModule, "updateWorkCursorAtomic").mockImplementation(
			(stateRoot, cursor, truth, updatedAt, options) => {
				const updated = originalUpdate(
					stateRoot,
					cursor,
					truth,
					updatedAt,
					options,
				);
			if (!amended) {
				amended = true;
				const status = statusWork({ project_root: root, work_id: "wu_hook" });
				amendWork(
					mutation(root, {
						event_id: "evt_prompt_freshness_amend",
						occurred_at: "2026-08-13T00:00:01.000Z",
						expected_head: status.projection.ledger_head,
						draft: draft("src_prompt_freshness_amend", "same_unit", true),
						source_stdin: {
							...mutation(root).source_stdin!,
							event_id: "src_prompt_freshness_amend",
							body: Buffer.from("fresh prompt requirement"),
						},
					}),
				);
			}
				return updated;
			},
		);

		const output = handleWorkUserPromptSubmit({
			project_root: root,
			client: "codex",
			payload: codexPayload(sessionId, "turn-1"),
			now: "2026-08-13T00:00:02.000Z",
		});

		expect(output).toMatchObject({ status: "briefing_due" });
		expect(output.context).toContain("req_b [pending]: Observe changed Work");
		expect(
			readWorkCursor(resolveWorkStateRoot(root).state_root, cursorId).cursor,
		).toMatchObject({
			observed_revision: 2,
			last_event_id: "evt_prompt_freshness_amend",
		});
	});

	it("fails open on malformed IDs and never exposes or persists prompt text", () => {
		const root = projectRoot();
		seed(root, "codex", "safe-session");
		const secret = "PROMPT_SECRET_MUST_NOT_SURVIVE_7f9c";
		const secretHash = sha256(secret);
		const log = vi.spyOn(console, "log");
		const error = vi.spyOn(console, "error");
		for (const [client, payload] of [
			["codex", { session_id: "safe-session", prompt: secret }],
			["claude-code", { session_id: "safe-session", prompt: secret }],
			["codex", { session_id: "bad\n", turn_id: "x", prompt: secret }],
		] as const) {
			const output = handleWorkUserPromptSubmit({
				project_root: root,
				client,
				payload,
			});
			expect(output).toMatchObject({
				status: "unavailable",
				context: null,
				cursor_id: null,
				boundary_id: null,
			});
			expect(JSON.stringify(output)).not.toContain(secret);
			expect(JSON.stringify(output)).not.toContain(secretHash);
		}
		const valid = handleWorkUserPromptSubmit({
			project_root: root,
			client: "codex",
			payload: codexPayload("safe-session", "turn-valid", secret),
			now: "2026-08-13T00:00:00.000Z",
		});
		expect(JSON.stringify(valid)).not.toContain(secret);
		expect(JSON.stringify(valid)).not.toContain(secretHash);
		expect(log).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
		for (const file of filesUnder(root)) {
			expect(fs.readFileSync(file)).not.toContain(secret);
			expect(fs.readFileSync(file, "utf8")).not.toContain(secretHash);
		}
	});
});

describe("same-turn Work post-tool hook", () => {
	it("rejects a boundary when the cursor switches Work before lock acquisition", () => {
		const root = projectRoot();
		const sessionId = "post-switch-session";
		const cursorId = seed(root, "codex", sessionId);
		const switchedWork = createWork(
			mutation(root, {
				work_id: "wu_switched",
				event_id: "evt_switched_create",
			}),
		);
		const originalMutate = workCursorModule.mutateWorkCursorAtomic;
		let switched = false;
		vi.spyOn(workCursorModule, "mutateWorkCursorAtomic").mockImplementation(
			(stateRoot, targetCursorId, mutator, options) => {
				if (!switched) {
					switched = true;
					const cursor = readWorkCursor(stateRoot, targetCursorId).cursor;
					if (!cursor) throw new Error("expected cursor before switch");
					updateWorkCursorAtomic(
						stateRoot,
						cursor,
						{
							work_id: switchedWork.projection.work_id,
							revision: switchedWork.projection.contract_revision,
							last_event_id: switchedWork.projection.last_event_id,
							projection_hash: switchedWork.projection.projection_hash,
						},
						"2026-08-13T00:00:01.000Z",
						{ expectedCursorRevision: cursor.cursor_revision ?? 0 },
					);
				}
				return originalMutate(stateRoot, targetCursorId, mutator, options);
			},
		);

		const output = handleWorkPostToolBoundary({
			project_root: root,
			client: "codex",
			payload: postToolPayload(sessionId, "turn-1", "tool-1"),
			now: "2026-08-13T00:00:02.000Z",
		});

		expect(output).toMatchObject({
			status: "unavailable",
			reason: "cursor_unavailable",
			context: null,
		});
		expect(
			readWorkCursor(resolveWorkStateRoot(root).state_root, cursorId).cursor,
		).toMatchObject({
			work_id: "wu_switched",
			reconciliation: { meaningful_actions_since_confirmed: 0 },
		});
	});

	it("re-reads Work truth after acquiring the cursor lock", () => {
		const root = projectRoot();
		const sessionId = "post-freshness-session";
		const cursorId = seed(root, "codex", sessionId);
		const originalMutate = workCursorModule.mutateWorkCursorAtomic;
		let amended = false;
		vi.spyOn(workCursorModule, "mutateWorkCursorAtomic").mockImplementation(
			(stateRoot, targetCursorId, mutator, options) => {
				if (!amended) {
					amended = true;
					const current = statusWork({
						project_root: root,
						work_id: "wu_hook",
					});
					amendWork(
						mutation(root, {
							event_id: "evt_post_freshness_amend",
							occurred_at: "2026-08-13T00:00:01.000Z",
							expected_head: current.projection.ledger_head,
							draft: draft("src_post_freshness_amend", "same_unit", true),
							source_stdin: {
								...mutation(root).source_stdin!,
								event_id: "src_post_freshness_amend",
								body: Buffer.from("fresh post-tool requirement"),
							},
						}),
					);
				}
				return originalMutate(stateRoot, targetCursorId, mutator, options);
			},
		);

		const output = handleWorkPostToolBoundary({
			project_root: root,
			client: "codex",
			payload: {
				...postToolPayload(sessionId, "turn-1", "tool-1"),
				events: Array.from({ length: 5 }, (_, index) => ({
					tool_name: "apply_patch",
					tool_use_id: `tool-${index + 1}`,
				})),
			},
			now: "2026-08-13T00:00:02.000Z",
		});

		expect(output).toMatchObject({ status: "briefing_due" });
		expect(output.context).toContain("req_b [pending]: Observe changed Work");
		expect(
			readWorkCursor(resolveWorkStateRoot(root).state_root, cursorId).cursor,
		).toMatchObject({
			observed_revision: 2,
			last_event_id: "evt_post_freshness_amend",
		});
	});

	it("counts each stable meaningful boundary once and briefs on the fifth action", () => {
		const root = projectRoot();
		const cursorId = seed(root, "codex", "post-session");
		for (let index = 1; index <= 4; index += 1) {
			expect(
				handleWorkPostToolBoundary({
					project_root: root,
					client: "codex",
					payload: postToolPayload("post-session", "turn-1", `tool-${index}`),
					now: `2026-08-13T00:00:0${index}.000Z`,
				}),
			).toMatchObject({ status: "not_due", context: null });
		}
		const fifth = handleWorkPostToolBoundary({
			project_root: root,
			client: "codex",
			payload: postToolPayload("post-session", "turn-1", "tool-5"),
			now: "2026-08-13T00:00:05.000Z",
		});
		expect(fifth).toMatchObject({ status: "briefing_due" });
		expect(fifth.context?.length).toBeLessThanOrEqual(8_000);
		expect(fifth.context).toContain("Required retrieval:");

		const duplicate = handleWorkPostToolBoundary({
			project_root: root,
			client: "codex",
			payload: postToolPayload("post-session", "turn-1", "tool-5"),
			now: "2026-08-13T00:00:06.000Z",
		});
		expect(duplicate).toMatchObject({
			status: "not_due",
			reason: "duplicate_boundary",
		});
		const state = readWorkCursor(
			resolveWorkStateRoot(root).state_root,
			cursorId,
		).cursor?.reconciliation;
		expect(state?.meaningful_actions_since_confirmed).toBe(5);
		expect(state?.recent_meaningful_action_boundary_ids).toHaveLength(5);
		expect(state?.injected_unconfirmed).not.toBeNull();
	});

	it("counts distinct batch events, ignores forbidden tools, and has no first-tool resume trigger", () => {
		const root = projectRoot();
		const cursorId = seed(root, "claude-code", "claude-post");
		const first = handleWorkPostToolBoundary({
			project_root: root,
			client: "claude-code",
			payload: {
				session_id: "claude-post",
				prompt_id: "prompt-1",
				events: [
					{ tool_name: "Edit", tool_use_id: "edit-1" },
					{ tool_name: "Write", tool_use_id: "write-1" },
					{ tool_name: "Read", tool_use_id: "read-1" },
				],
			},
			now: "2026-08-13T00:00:01.000Z",
		});
		expect(first).toMatchObject({ status: "not_due", reason: "not_due" });
		expect(
			readWorkCursor(resolveWorkStateRoot(root).state_root, cursorId).cursor
				?.reconciliation,
		).toMatchObject({ meaningful_actions_since_confirmed: 2 });
	});

	it("uses max silence after an unconfirmed prompt injection and never retains secrets", () => {
		const root = projectRoot();
		seed(root, "codex", "silence-session");
		expect(
			handleWorkUserPromptSubmit({
				project_root: root,
				client: "codex",
				payload: codexPayload("silence-session", "turn-1"),
				now: "2026-08-13T00:00:00.000Z",
			}).status,
		).toBe("briefing_due");
		const secret = "POST_TOOL_SECRET_91f1";
		const due = handleWorkPostToolBoundary({
			project_root: root,
			client: "codex",
			payload: {
				...postToolPayload("silence-session", "turn-1", "tool-secret"),
				tool_input: secret,
				tool_response: secret,
				transcript_path: secret,
			},
			now: "2026-08-13T00:05:00.000Z",
		});
		expect(due.status).toBe("briefing_due");
		expect(JSON.stringify(due)).not.toContain(secret);
		expect(
			fs.readFileSync(
				path.join(
					resolveWorkStateRoot(root).state_root,
					"work-cursors",
					`${deriveWorkHookCursorId("codex", "silence-session")}.yaml`,
				),
				"utf8",
			),
		).not.toContain(secret);
	});

	it("fails open for missing stable IDs and does not onboard an unlinked session", () => {
		const root = projectRoot();
		expect(
			handleWorkPostToolBoundary({
				project_root: root,
				client: "codex",
				payload: { session_id: "x", events: [] },
			}),
		).toMatchObject({ status: "unavailable", context: null });
		expect(
			handleWorkPostToolBoundary({
				project_root: root,
				client: "codex",
				payload: postToolPayload("unlinked", "turn-1", "tool-1"),
			}),
		).toMatchObject({
			status: "unavailable",
			reason: "cursor_unavailable",
			context: null,
		});
	});
});

function filesUnder(root: string): string[] {
	return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const target = path.join(root, entry.name);
		return entry.isDirectory() ? filesUnder(target) : [target];
	});
}
