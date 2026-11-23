import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import { WorkDurability } from "../core/work_durability.js";
import { briefWork, createWork, transitionWork } from "./work.js";

vi.mock("node:fs", async (importOriginal) => ({
	...(await importOriginal<typeof fs>()),
}));

const roots: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function countFsyncCalls(): () => number {
	const namespaceSpy = vi.spyOn(fs, "fsyncSync");
	const defaultSpy = vi.spyOn(
		(fs as unknown as { default: typeof fs }).default,
		"fsyncSync",
	);
	return () => namespaceSpy.mock.calls.length + defaultSpy.mock.calls.length;
}

function mutateWork(durability?: WorkDurability): void {
	const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "work-durability-"));
	roots.push(projectRoot);
	fs.writeFileSync(
		path.join(projectRoot, "Agentfile"),
		YAML.stringify({
			version: 2,
			project: { name: "work-durability" },
			tools: ["codex"],
			fragments: [],
			settings: {
				work_policy: {
					reconciliation: { preset: "adaptive" },
					review: { preset: "advisory" },
					delegation: { parallelism: "auto" },
				},
			},
		}),
	);
	const created = createWork({
		project_root: projectRoot,
		...(durability ? { durability } : {}),
		work_id: "wu_durability",
		event_id: "evt_durability_create",
		occurred_at: "2026-08-20T00:00:00.000Z",
		expected_head: null,
		draft: Buffer.from(
			YAML.stringify({
				work: {
					title: "Durability",
					completion_contract: "Record the requirement.",
				},
				boundary: {
					state: "accepted",
					classification: "new_unit",
					reason_codes: ["same_deliverable"],
					confidence: "high",
				},
				requirements: [
					{
						id: "REQ-A",
						summary: "durability requirement",
						source_event_ids: ["src_durability"],
					},
				],
				open_conflicts: [],
			}),
		),
		source_stdin: {
			event_id: "src_durability",
			captured_at: "2026-08-20T00:00:00.000Z",
			client: "codex",
			content_type: "text/plain; charset=utf-8",
			fidelity: "native_exact",
			allocation_status: "allocated",
			body: Buffer.from("durability requirement"),
		},
	});
	transitionWork({
		project_root: projectRoot,
		...(durability ? { durability } : {}),
		work_id: "wu_durability",
		event_id: "evt_durability_verify",
		occurred_at: "2026-08-20T00:00:01.000Z",
		expected_head: created.projection.ledger_head,
		draft: Buffer.from(
			YAML.stringify({
				requirement_id: "REQ-A",
				status: "verified",
				evidence_refs: ["test:REQ-A"],
			}),
		),
	});
	briefWork({
		project_root: projectRoot,
		...(durability ? { durability } : {}),
		work_id: "wu_durability",
		cursor_id: "durability-cursor",
		client_session_ref: "durability-session",
		occurred_at: "2026-08-20T01:00:00.000Z",
	});
}

describe("Work durability", () => {
	it("calls fsync on the default create, transition, and brief path", () => {
		const fsyncCalls = countFsyncCalls();
		mutateWork();
		expect(fsyncCalls()).toBeGreaterThan(0);
	});

	it("calls fsync on the explicit durable path", () => {
		const fsyncCalls = countFsyncCalls();
		mutateWork(WorkDurability.durable);
		expect(fsyncCalls()).toBeGreaterThan(0);
	});

	it("does not call fsync on the ephemeral path", () => {
		const fsyncCalls = countFsyncCalls();
		mutateWork(WorkDurability.ephemeral);
		expect(fsyncCalls()).toBe(0);
	});
});
