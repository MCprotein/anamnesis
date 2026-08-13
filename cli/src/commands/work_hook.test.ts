import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import {
	newWorkCursor,
	readWorkCursor,
	updateWorkCursorAtomic,
	writeWorkCursorAtomic,
} from "../core/work_cursor.js";
import { buildWorkBriefingSnapshot } from "../core/work_reconciliation.js";
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
	handleWorkUserPromptSubmit,
	renderWorkBriefingContext,
	type WorkHookClient,
} from "./work_hook.js";

const roots: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function projectRoot(
	preset: "off" | "frequent" = "frequent",
	reviewPreset: "off" | "strict" = "off",
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

describe("foreground Work UserPromptSubmit hook", () => {
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
		for (const detail of ["compact", "full"] as const) {
			const context = renderWorkBriefingContext(briefing, detail, true);
			expect(context.length).toBeLessThanOrEqual(32_000);
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

function filesUnder(root: string): string[] {
	return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const target = path.join(root, entry.name);
		return entry.isDirectory() ? filesUnder(target) : [target];
	});
}
