import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";

import { readWorkCursor } from "../core/work_cursor.js";
import { resolveWorkStateRoot } from "../core/work_storage.js";

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
		{ cwd: repositoryRoot, input, encoding: "utf8" },
	);
}

describe("anamnesis work CLI", () => {
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
	});

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
	});

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
});
