import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";

import { readWorkCursor } from "../core/work_cursor.js";
import { deriveWorkPromptCaptureId } from "../core/work_prompt_stage.js";
import { resolveWorkStateRoot } from "../core/work_storage.js";
import { deriveWorkHookCursorId } from "./work_hook.js";

const roots: string[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const tsxCli = path.join(repositoryRoot, "node_modules/tsx/dist/cli.mjs");
const anamnesisCli = path.join(repositoryRoot, "cli/src/index.ts");

afterEach(() => {
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function project(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-work-cli-"));
	roots.push(root);
	return root;
}

function writeDraft(root: string, sourceEventId: string): void {
	writeNamedDraft(root, "draft.yaml", sourceEventId, "CLI continuity");
}

function writeNamedDraft(
	root: string,
	name: string,
	sourceEventId: string,
	title: string,
	classification: "new_unit" | "same_unit" = "new_unit",
): void {
	fs.writeFileSync(
		path.join(root, name),
		YAML.stringify({
			work: {
				title,
				completion_contract: "All exact requirements verified",
			},
			boundary: {
				state: "accepted",
				classification,
				reason_codes: ["same_deliverable"],
				confidence: "high",
			},
			requirements: [
				{
					id: "req_raw",
					summary: "원문을 그대로 보존 🚀",
					source_event_ids: [sourceEventId],
				},
			],
			open_conflicts: [],
		}),
	);
}

function run(root: string, args: string[], input?: Buffer) {
	return spawnSync(
		process.execPath,
		[tsxCli, anamnesisCli, "work", ...args, "--project-root", root],
		{
			cwd: repositoryRoot,
			input,
			encoding: "utf8",
			env: { ...process.env, ANAMNESIS_WORK_PROMPT_CAPTURE: "1" },
		},
	);
}

function runAsync(root: string, args: string[], input: Buffer) {
	return new Promise<{ code: number | null; stdout: string; stderr: string }>(
		(resolve) => {
			const child = spawn(
				process.execPath,
				[tsxCli, anamnesisCli, "work", ...args, "--project-root", root],
				{
					cwd: repositoryRoot,
					stdio: ["pipe", "pipe", "pipe"],
					env: { ...process.env, ANAMNESIS_WORK_PROMPT_CAPTURE: "1" },
				},
			);
			let stdout = "";
			let stderr = "";
			child.stdout.setEncoding("utf8");
			child.stderr.setEncoding("utf8");
			child.stdout.on("data", (chunk: string) => (stdout += chunk));
			child.stderr.on("data", (chunk: string) => (stderr += chunk));
			child.once("exit", (code) => resolve({ code, stdout, stderr }));
			child.stdin.end(input);
		},
	);
}

describe("anamnesis work CLI", () => {
	it("stages UserPromptSubmit and allocates it through the explicit prompt command", () => {
		const root = project();
		fs.writeFileSync(
			path.join(root, "Agentfile"),
			YAML.stringify({
				version: 2,
				project: { name: "prompt-stage-cli" },
				tools: ["codex"],
				fragments: [],
				settings: { work_prompt_capture: { preset: "bounded" } },
			}),
		);
		const raw = "CLI staged prompt\r\n한글 😀\0tail";
		const hook = run(
			root,
			["hook-user-prompt", "--client", "codex"],
			Buffer.from(
				JSON.stringify({
					session_id: "stage-cli-session",
					turn_id: "stage-cli-turn",
					prompt: raw,
				}),
			),
		);
		expect(hook.status, hook.stderr).toBe(0);
		expect(hook.stdout).not.toContain(raw);
		const captureId = deriveWorkPromptCaptureId({
			client: "codex",
			sessionId: "stage-cli-session",
			boundaryId: "stage-cli-turn",
		});
		expect(hook.stdout).toContain(captureId);
		writeNamedDraft(root, "staged.yaml", "@staged", "Staged CLI Work");
		const allocated = run(root, [
			"prompt",
			"allocate-new",
			"--stage",
			captureId,
			"--work",
			"wu_stage_cli",
			"--draft",
			"staged.yaml",
			"--occurred-at",
			"2026-08-14T00:01:00.000Z",
			"--json",
		]);
		expect(allocated.status, allocated.stderr).toBe(0);
		const result = JSON.parse(allocated.stdout);
		expect(allocated.stdout).not.toContain("body_hash");
		expect(allocated.stdout).not.toContain("assertion_hash");
		expect(result).toMatchObject({
			schema_version: "anamnesis.work-prompt-resolution.v1",
			resolution: "allocate_new",
			work_id: "wu_stage_cli",
		});
		expect(
			fs.readFileSync(
				path.join(
					root,
					".anamnesis/work-inputs/objects",
					`${result.outcome.source_event_id}.txt`,
				),
			),
		).toEqual(Buffer.from(raw, "utf8"));

		const unresolved = run(
			root,
			["hook-user-prompt", "--client", "codex"],
			Buffer.from(
				JSON.stringify({
					session_id: "stage-cli-session",
					turn_id: "stage-cli-unresolved",
					prompt: "expire this private stage",
				}),
			),
		);
		expect(unresolved.status, unresolved.stderr).toBe(0);
		const unresolvedCaptureId = deriveWorkPromptCaptureId({
			client: "codex",
			sessionId: "stage-cli-session",
			boundaryId: "stage-cli-unresolved",
		});
		const gc = run(root, [
			"prompt",
			"gc",
			"--now",
			"2099-01-01T00:00:00.000Z",
			"--json",
		]);
		expect(gc.status, gc.stderr).toBe(0);
		expect(JSON.parse(gc.stdout).removed).toContain(unresolvedCaptureId);
	}, 20_000);

	it("fails open on invalid hook input and emits bounded session onboarding", () => {
		const root = project();
		const invalid = run(
			root,
			["hook-user-prompt", "--client", "codex"],
			Buffer.from("not-json"),
		);
		expect(invalid.status, invalid.stderr).toBe(0);
		expect(invalid.stdout).toBe("");

		const missingStableId = run(
			root,
			["hook-user-prompt", "--client", "codex"],
			Buffer.from(JSON.stringify({ session_id: "session-hook", prompt: "secret" })),
		);
		expect(missingStableId.status, missingStableId.stderr).toBe(0);
		expect(missingStableId.stdout).toBe("");
		fs.writeFileSync(
			path.join(root, "Agentfile"),
			YAML.stringify({
				version: 2,
				project: { name: "hook-onboarding" },
				tools: ["codex"],
				fragments: [],
				settings: {
					work_policy: { reconciliation: { preset: "frequent" } },
				},
			}),
		);

		const onboarding = run(
			root,
			["hook-user-prompt", "--client", "codex"],
			Buffer.from(
				JSON.stringify({
					session_id: "session-hook",
					turn_id: "turn-1",
					prompt: "PROMPT_MUST_NOT_APPEAR",
				}),
			),
		);
		expect(onboarding.status, onboarding.stderr).toBe(0);
		expect(onboarding.stdout).toContain(
			deriveWorkHookCursorId("codex", "session-hook"),
		);
		expect(onboarding.stdout).not.toContain("PROMPT_MUST_NOT_APPEAR");
	});

	it("runs create -> JSON brief pending -> explicit confirm with exact stdin bytes", () => {
		const root = project();
		writeDraft(root, "src_cli");
		const raw = Buffer.from("첫 줄\r\n둘째 줄 🚀\r\n", "utf8");
		const created = run(
			root,
			[
				"create",
				"--work",
				"wu_cli",
				"--event-id",
				"evt_create",
				"--source-event-id",
				"src_cli",
				"--occurred-at",
				"2026-08-13T13:00:00.000Z",
				"--draft",
				"draft.yaml",
				"--source-stdin",
				"--json",
			],
			raw,
		);
		expect(created.status, created.stderr).toBe(0);
		expect(created.stderr).toBe("");
		expect(JSON.parse(created.stdout).schema_version).toBe(
			"anamnesis.work-command-result.v1",
		);
		expect(
			fs.readFileSync(
				path.join(root, ".anamnesis/work-inputs/objects/src_cli.txt"),
			),
		).toEqual(raw);

		const briefing = run(root, [
			"brief",
			"--work",
			"wu_cli",
			"--session",
			"session_one",
			"--occurred-at",
			"2026-08-13T13:01:00.000Z",
			"--json",
		]);
		expect(briefing.status, briefing.stderr).toBe(0);
		expect(briefing.stderr).toBe("");
		const prepared = JSON.parse(briefing.stdout);
		expect(prepared.delivery_state).toBe("pending");
		expect(prepared.sections[1].values).toContain(
			"req_raw: 원문을 그대로 보존 🚀 [pending]",
		);
		const stateRoot = resolveWorkStateRoot(root).state_root;
		expect(
			readWorkCursor(stateRoot, "session_one").cursor?.reconciliation
				?.last_reconciled_head,
		).toBeNull();

		const confirmed = run(root, [
			"confirm",
			"--work",
			"wu_cli",
			"--session",
			"session_one",
			"--delivery-token",
			prepared.delivery_token,
			"--occurred-at",
			"2026-08-13T13:01:01.000Z",
			"--json",
		]);
		expect(confirmed.status, confirmed.stderr).toBe(0);
		expect(JSON.parse(confirmed.stdout).schema_version).toBe(
			"anamnesis.work-brief-confirmation.v1",
		);
		expect(
			readWorkCursor(stateRoot, "session_one").cursor?.reconciliation
				?.last_reconciled_head,
		).toBe(prepared.delivery.ledger_head);
	}, 15_000);

	it("keeps JSON stdout clean and reports invalid source selection on stderr", () => {
		const root = project();
		writeDraft(root, "src_cli");
		const result = run(root, [
			"create",
			"--work",
			"wu_cli",
			"--event-id",
			"evt_create",
			"--source-event-id",
			"src_cli",
			"--occurred-at",
			"2026-08-13T13:00:00.000Z",
			"--draft",
			"draft.yaml",
			"--json",
		]);
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain(
			"exactly one of --source-file or --source-stdin is required",
		);
	});

	it("records evidence-only progress without manufacturing a user source", () => {
		const root = project();
		writeDraft(root, "src_progress");
		expect(
			run(
				root,
				[
					"create",
					"--work",
					"wu_progress",
					"--event-id",
					"evt_create",
					"--source-event-id",
					"src_progress",
					"--occurred-at",
					"2026-08-13T13:10:00.000Z",
					"--draft",
					"draft.yaml",
					"--source-stdin",
					"--json",
				],
				Buffer.from("user requirement"),
			).status,
		).toBe(0);
		fs.writeFileSync(
			path.join(root, "transition.yaml"),
			YAML.stringify({
				requirement_id: "req_raw",
				status: "verified",
				evidence_refs: ["test:cli"],
			}),
		);
		const transitioned = run(root, [
			"transition",
			"--work",
			"wu_progress",
			"--event-id",
			"evt_verify",
			"--occurred-at",
			"2026-08-13T13:11:00.000Z",
			"--draft",
			"transition.yaml",
			"--json",
		]);
		expect(transitioned.status, transitioned.stderr).toBe(0);
		const result = JSON.parse(transitioned.stdout);
		expect(result.allocation).toBeNull();
		expect(result.projection.progress.percent).toBe(100);
		expect(
			fs.existsSync(
				path.join(root, ".anamnesis/work-inputs/objects/evt_verify.txt"),
			),
		).toBe(false);
	});

	it("keeps session cursors independent and requires an explicit Work switch", () => {
		const root = project();
		writeDraft(root, "src_one");
		const createOne = run(
			root,
			[
				"create",
				"--work",
				"wu_one",
				"--event-id",
				"evt_one",
				"--source-event-id",
				"src_one",
				"--occurred-at",
				"2026-08-13T14:00:00.000Z",
				"--draft",
				"draft.yaml",
				"--source-stdin",
				"--json",
			],
			Buffer.from("first Work"),
		);
		expect(createOne.status, createOne.stderr).toBe(0);

		for (const session of ["session_a", "session_b"]) {
			const brief = run(root, [
				"brief",
				"--work",
				"wu_one",
				"--session",
				session,
				"--occurred-at",
				"2026-08-13T14:01:00.000Z",
				"--json",
			]);
			expect(brief.status, brief.stderr).toBe(0);
		}
		const stateRoot = resolveWorkStateRoot(root).state_root;
		expect(readWorkCursor(stateRoot, "session_a").cursor?.work_id).toBe(
			"wu_one",
		);
		expect(readWorkCursor(stateRoot, "session_b").cursor?.work_id).toBe(
			"wu_one",
		);

		writeNamedDraft(root, "draft-two.yaml", "src_two", "Second Work");
		const createTwo = run(
			root,
			[
				"create",
				"--work",
				"wu_two",
				"--event-id",
				"evt_two",
				"--source-event-id",
				"src_two",
				"--occurred-at",
				"2026-08-13T14:02:00.000Z",
				"--draft",
				"draft-two.yaml",
				"--source-stdin",
				"--json",
			],
			Buffer.from("second Work"),
		);
		expect(createTwo.status, createTwo.stderr).toBe(0);

		const accidental = run(root, [
			"brief",
			"--work",
			"wu_two",
			"--session",
			"session_a",
			"--occurred-at",
			"2026-08-13T14:03:00.000Z",
			"--json",
		]);
		expect(accidental.status).toBe(1);
		expect(accidental.stderr).toContain("switch it explicitly");

		const switched = run(root, [
			"switch",
			"--work",
			"wu_two",
			"--session",
			"session_a",
			"--occurred-at",
			"2026-08-13T14:04:00.000Z",
			"--json",
		]);
		expect(switched.status, switched.stderr).toBe(0);
		const switchedCursor = readWorkCursor(stateRoot, "session_a").cursor;
		expect(switchedCursor?.work_id).toBe("wu_two");
		expect(switchedCursor?.reconciliation?.pending_delivery).toBeNull();
		expect(switchedCursor?.reconciliation?.last_reconciled_head).toBeNull();
		expect(readWorkCursor(stateRoot, "session_b").cursor?.work_id).toBe(
			"wu_one",
		);
	}, 10_000);

	it("leaves briefing delivery pending when stdout closes before presentation", async () => {
		const root = project();
		writeDraft(root, "src_epipe");
		const created = run(
			root,
			[
				"create",
				"--work",
				"wu_epipe",
				"--event-id",
				"evt_epipe",
				"--source-event-id",
				"src_epipe",
				"--occurred-at",
				"2026-08-13T15:00:00.000Z",
				"--draft",
				"draft.yaml",
				"--source-stdin",
				"--json",
			],
			Buffer.from("EPIPE source"),
		);
		expect(created.status, created.stderr).toBe(0);

		const child = spawn(
			process.execPath,
			[
				tsxCli,
				anamnesisCli,
				"work",
				"brief",
				"--work",
				"wu_epipe",
				"--session",
				"session_epipe",
				"--occurred-at",
				"2026-08-13T15:01:00.000Z",
				"--project-root",
				root,
			],
			{ cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
		);
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.stdout.destroy();
		const exitCode = await new Promise<number | null>((resolve) => {
			child.once("exit", resolve);
		});
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("EPIPE");

		const cursor = readWorkCursor(
			resolveWorkStateRoot(root).state_root,
			"session_epipe",
		).cursor;
		expect(cursor?.reconciliation?.pending_delivery).not.toBeNull();
		expect(cursor?.reconciliation?.last_reconciled_head).toBeNull();
	});

	it("deduplicates identical concurrent post-tool hooks without losing distinct actions", async () => {
		const root = project();
		fs.writeFileSync(
			path.join(root, "Agentfile"),
			YAML.stringify({
				version: 2,
				project: { name: "post-tool-concurrency" },
				tools: ["codex"],
				fragments: [],
				settings: {
					work_policy: { reconciliation: { preset: "frequent" } },
				},
			}),
		);
		writeDraft(root, "src_concurrent");
		expect(
			run(
				root,
				[
					"create",
					"--work",
					"wu_concurrent",
					"--event-id",
					"evt_concurrent",
					"--source-event-id",
					"src_concurrent",
					"--occurred-at",
					"2026-08-13T16:00:00.000Z",
					"--draft",
					"draft.yaml",
					"--source-stdin",
				],
				Buffer.from("concurrency source"),
			).status,
		).toBe(0);
		const cursorId = deriveWorkHookCursorId("codex", "concurrent-session");
		expect(
			run(root, [
				"switch",
				"--work",
				"wu_concurrent",
				"--session",
				cursorId,
				"--occurred-at",
				"2026-08-13T16:00:01.000Z",
			]).status,
		).toBe(0);
		const envelope = (toolUseId: string) =>
			Buffer.from(
				JSON.stringify({
					session_id: "concurrent-session",
					turn_id: "turn-1",
					events: [{ tool_name: "apply_patch", tool_use_id: toolUseId }],
				}),
			);
		const args = [
			"hook-post-tool-use",
			"--client",
			"codex",
			"--occurred-at",
			"2026-08-13T16:00:02.000Z",
			"--json",
		];
		const identical = await Promise.all([
			runAsync(root, args, envelope("same-tool")),
			runAsync(root, args, envelope("same-tool")),
		]);
		expect(identical.every((result) => result.code === 0)).toBe(true);
		expect(
			readWorkCursor(resolveWorkStateRoot(root).state_root, cursorId).cursor
				?.reconciliation?.meaningful_actions_since_confirmed,
		).toBe(1);

		const distinct = await Promise.all([
			runAsync(root, args, envelope("distinct-a")),
			runAsync(root, args, envelope("distinct-b")),
		]);
		expect(distinct.every((result) => result.code === 0)).toBe(true);
		expect(
			readWorkCursor(resolveWorkStateRoot(root).state_root, cursorId).cursor
				?.reconciliation?.meaningful_actions_since_confirmed,
		).toBe(3);

		const fanout = await Promise.all(
			Array.from({ length: 64 }, (_, index) =>
				runAsync(root, args, envelope(`fanout-${index}`)),
			),
		);
		expect(fanout.every((result) => result.code === 0)).toBe(true);
		const fanoutResults = fanout.map((result) => JSON.parse(result.stdout));
		expect(
			fanoutResults.some(
				(result) =>
					result.status === "unavailable" &&
					result.reason === "cursor_unavailable",
			),
		).toBe(false);
		const finalReconciliation = readWorkCursor(
			resolveWorkStateRoot(root).state_root,
			cursorId,
		).cursor?.reconciliation;
		expect(finalReconciliation?.meaningful_actions_since_confirmed).toBe(67);
		expect(finalReconciliation?.recent_meaningful_action_boundary_ids).toHaveLength(
			64,
		);
	}, 60_000);
});
