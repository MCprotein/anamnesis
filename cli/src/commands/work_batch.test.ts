import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { buildWorkEvidencePlan } from "../core/work_evidence_plan.js";
import { readWorkLedger } from "../core/work_ledger.js";
import { appendCanonicalTypedWorkProgressEvents } from "../core/work_storage.js";
import {
	createWork,
	planWorkEvidence,
	statusWork,
	transitionWork,
	transitionWorkBatch,
} from "./work.js";

const roots: string[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const tsxCli = path.join(repositoryRoot, "node_modules/tsx/dist/cli.mjs");
const anamnesisCli = path.join(repositoryRoot, "cli/src/index.ts");

afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function root(): string {
	const value = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-work-batch-"));
	roots.push(value);
	return value;
}

const ledgerFor = (projectRoot: string) =>
	path.join(projectRoot, ".anamnesis/work-units/wu_b/ledger.jsonl");

function created(projectRoot: string): string {
	createWork({
		project_root: projectRoot,
		work_id: "wu_b",
		event_id: "evt_create",
		occurred_at: "2026-10-21T00:00:00.000Z",
		expected_head: null,
		draft: Buffer.from(
			YAML.stringify({
				work: { title: "batch", completion_contract: "all verified" },
				boundary: {
					state: "accepted",
					classification: "new_unit",
					reason_codes: ["explicit_user_requirement"],
					confidence: "high",
				},
				requirements: ["r1", "r2", "r3"].map((id) => ({
					id,
					summary: `requirement ${id}`,
					source_event_ids: ["src_1"],
				})),
				open_conflicts: [],
			}),
		),
		source_stdin: {
			event_id: "src_1",
			captured_at: "2026-10-21T00:00:00.000Z",
			client: "claude-code",
			content_type: "text/plain; charset=utf-8",
			fidelity: "client_exact",
			allocation_status: "allocated",
			body: Buffer.from("세 가지를 해 줘\n", "utf8"),
		},
	});
	return readWorkLedger(ledgerFor(projectRoot)).head!;
}

function batch(
	transitions: Array<{
		event_id: string;
		requirement_id: string;
		status: string;
		evidence_refs: string[];
	}>,
): Buffer {
	return Buffer.from(
		YAML.stringify({
			schema_version: "anamnesis.work-transition-batch.v1",
			work_id: "wu_b",
			transitions,
		}),
	);
}

describe("work transition --batch", () => {
	it("appends every transition under one expected head and chains the records", () => {
		const projectRoot = root();
		const head = created(projectRoot);
		const result = transitionWorkBatch({
			project_root: projectRoot,
			work_id: "wu_b",
			occurred_at: "2026-10-21T00:01:00.000Z",
			expected_head: head,
			draft: batch([
				{ event_id: "t1", requirement_id: "r1", status: "verified", evidence_refs: ["test:r1"] },
				{ event_id: "t2", requirement_id: "r2", status: "in_progress", evidence_refs: [] },
			]),
		});
		expect(result.appended_count).toBe(2);
		expect(result.idempotent_count).toBe(0);
		const records = readWorkLedger(ledgerFor(projectRoot)).records;
		expect(records.map((item) => item.event_id)).toEqual([
			"evt_create",
			"t1",
			"t2",
		]);
		expect(records[2]!.previous_hash).toBe(records[1]!.record_hash);
		expect(result.ledger_head).toBe(records[2]!.record_hash);
		expect(result.projection.progress).toMatchObject({
			verified: 1,
			in_progress: 1,
			pending: 1,
		});

		const retry = transitionWorkBatch({
			project_root: projectRoot,
			work_id: "wu_b",
			occurred_at: "2026-10-21T00:01:00.000Z",
			expected_head: head,
			draft: batch([
				{ event_id: "t1", requirement_id: "r1", status: "verified", evidence_refs: ["test:r1"] },
				{ event_id: "t2", requirement_id: "r2", status: "in_progress", evidence_refs: [] },
			]),
		});
		expect(retry).toMatchObject({ appended_count: 0, idempotent_count: 2 });
		expect(readWorkLedger(ledgerFor(projectRoot)).records).toHaveLength(3);
	});

	it("rejects the whole batch when one transition is invalid", () => {
		const projectRoot = root();
		const head = created(projectRoot);
		expect(() =>
			transitionWorkBatch({
				project_root: projectRoot,
				work_id: "wu_b",
				occurred_at: "2026-10-21T00:01:00.000Z",
				expected_head: head,
				draft: batch([
					{ event_id: "t1", requirement_id: "r1", status: "verified", evidence_refs: ["test:r1"] },
					{ event_id: "t2", requirement_id: "r_missing", status: "in_progress", evidence_refs: [] },
				]),
			}),
		).toThrow(/unknown typed Work requirement: r_missing/);
		expect(() =>
			transitionWorkBatch({
				project_root: projectRoot,
				work_id: "wu_b",
				occurred_at: "2026-10-21T00:01:00.000Z",
				expected_head: head,
				draft: batch([
					{ event_id: "t1", requirement_id: "r1", status: "verified", evidence_refs: [] },
				]),
			}),
		).toThrow(/requires evidence: r1/);
		expect(() =>
			transitionWorkBatch({
				project_root: projectRoot,
				work_id: "wu_b",
				occurred_at: "2026-10-21T00:01:00.000Z",
				expected_head: head,
				draft: batch([
					{ event_id: "t1", requirement_id: "r1", status: "waived", evidence_refs: ["x"] },
				]),
			}),
		).toThrow();
		expect(() =>
			transitionWorkBatch({
				project_root: projectRoot,
				work_id: "wu_b",
				occurred_at: "2026-10-21T00:01:00.000Z",
				expected_head: head,
				draft: batch([
					{ event_id: "t1", requirement_id: "r1", status: "in_progress", evidence_refs: [] },
					{ event_id: "t2", requirement_id: "r1", status: "verified", evidence_refs: ["x"] },
				]),
			}),
		).toThrow(/requirement appears twice/);
		expect(readWorkLedger(ledgerFor(projectRoot)).records).toHaveLength(1);
	});

	it("fails on a stale expected head after another session appended", () => {
		const projectRoot = root();
		const head = created(projectRoot);
		transitionWork({
			project_root: projectRoot,
			work_id: "wu_b",
			event_id: "t_other",
			occurred_at: "2026-10-21T00:00:30.000Z",
			expected_head: head,
			draft: Buffer.from(
				YAML.stringify({
					requirement_id: "r3",
					status: "in_progress",
					evidence_refs: [],
				}),
			),
		});
		expect(() =>
			transitionWorkBatch({
				project_root: projectRoot,
				work_id: "wu_b",
				occurred_at: "2026-10-21T00:01:00.000Z",
				expected_head: head,
				draft: batch([
					{ event_id: "t1", requirement_id: "r1", status: "in_progress", evidence_refs: [] },
				]),
			}),
		).toThrow(/work ledger head conflict/);
		expect(readWorkLedger(ledgerFor(projectRoot)).records).toHaveLength(2);
	});

	it("finishes a batch whose committed prefix survived a crash", () => {
		const projectRoot = root();
		const head = created(projectRoot);
		const draft = batch([
			{ event_id: "t1", requirement_id: "r1", status: "in_progress", evidence_refs: [] },
			{ event_id: "t2", requirement_id: "r2", status: "in_progress", evidence_refs: [] },
		]);
		// Simulate the crash: only the first event of the batch is committed.
		transitionWork({
			project_root: projectRoot,
			work_id: "wu_b",
			event_id: "t1",
			occurred_at: "2026-10-21T00:01:00.000Z",
			expected_head: head,
			draft: Buffer.from(
				YAML.stringify({
					requirement_id: "r1",
					status: "in_progress",
					evidence_refs: [],
				}),
			),
		});
		const result = transitionWorkBatch({
			project_root: projectRoot,
			work_id: "wu_b",
			occurred_at: "2026-10-21T00:01:00.000Z",
			expected_head: head,
			draft,
		});
		expect(result).toMatchObject({ appended_count: 1, idempotent_count: 1 });
		expect(
			readWorkLedger(ledgerFor(projectRoot)).records.map((item) => item.event_id),
		).toEqual(["evt_create", "t1", "t2"]);
	});

	it("keeps the storage boundary closed to source-bearing and mixed-Work batches", () => {
		const projectRoot = root();
		const head = created(projectRoot);
		const status = statusWork({ project_root: projectRoot, work_id: "wu_b" });
		const event = (id: string, workId: string, extra = {}) => ({
			event_id: id,
			occurred_at: "2026-10-21T00:01:00.000Z",
			kind: "work_requirement_transitioned",
			payload: {
				schema_version: "anamnesis.work-progress-event.v1",
				work_id: workId,
				requirement_id: "r1",
				basis_contract_hash: status.projection.contract_hash!,
				status: "in_progress",
				evidence_refs: [],
				...extra,
			},
		});
		const stateRoot = path.join(fs.realpathSync(projectRoot), ".anamnesis");
		expect(() =>
			appendCanonicalTypedWorkProgressEvents({
				stateRoot,
				ledgerPath: ledgerFor(projectRoot),
				ledgerEvents: [event("a", "wu_b"), event("b", "wu_other")],
				expectedHead: head,
			}),
		).toThrow(/exactly one Work/);
		expect(() =>
			appendCanonicalTypedWorkProgressEvents({
				stateRoot,
				ledgerPath: ledgerFor(projectRoot),
				ledgerEvents: [event("a", "wu_b", { source_event_id: "src_1" })],
				expectedHead: head,
			}),
		).toThrow(/source references/);
	});
});

describe("work evidence plan", () => {
	const pr = (overrides: Record<string, unknown>) => ({
		number: 7,
		url: "https://github.com/example/repo/pull/7",
		state: "OPEN",
		isDraft: false,
		headRefOid: "0123456789abcdef0123",
		body: "## 검증\nWork-Requirements: r1, r2 — 운영 반영 뒤 확인\n",
		...overrides,
	});

	it("maps open and merged PRs to transitions without claiming verified", () => {
		const projectRoot = root();
		created(projectRoot);
		const plan = planWorkEvidence({
			project_root: projectRoot,
			work_id: "wu_b",
			pull_requests_json: Buffer.from(
				JSON.stringify([
					pr({}),
					pr({
						number: 8,
						url: "https://github.com/example/repo/pull/8",
						state: "MERGED",
						mergedAt: "2026-10-21T00:00:10Z",
						mergeCommit: { oid: "fedcba9876543210fedc" },
						body: "Work-Requirements: r2 r_unknown",
					}),
					pr({
						number: 9,
						url: "https://github.com/example/repo/pull/9",
						state: "CLOSED",
					}),
					pr({
						number: 10,
						url: "https://github.com/example/repo/pull/10",
						body: "no marker here",
					}),
					pr({
						number: 11,
						url: "https://github.com/example/repo/pull/11",
						body: "Work-Requirements: - — hotfix",
					}),
				]),
			),
		});
		expect(plan.batch?.transitions.map((item) => [item.requirement_id, item.status])).toEqual([
			["r1", "in_progress"],
			["r2", "implemented_unverified"],
		]);
		const r2 = plan.batch!.transitions[1]!;
		expect(r2.evidence_refs).toEqual([
			"https://github.com/example/repo/pull/7 OPEN head 0123456789ab: 운영 반영 뒤 확인",
			"https://github.com/example/repo/pull/8 MERGED head 0123456789ab merge fedcba987654 at 2026-10-21T00:00:10Z",
		]);
		expect(plan.unknown_requirement_ids).toEqual([
			{ pr: "https://github.com/example/repo/pull/8", id: "r_unknown" },
		]);
		expect(plan.skipped.map((item) => item.reason).sort()).toEqual([
			"closed_unmerged",
			"no_marker",
			"no_requirement",
		]);
		expect(plan.expected_head).toBe(readWorkLedger(ledgerFor(projectRoot)).head);
	});

	it("is idempotent across polls and never downgrades a requirement", () => {
		const projectRoot = root();
		const head = created(projectRoot);
		const input = Buffer.from(JSON.stringify(pr({ body: "Work-Requirements: r1" })));
		const first = planWorkEvidence({
			project_root: projectRoot,
			work_id: "wu_b",
			pull_requests_json: input,
		});
		transitionWorkBatch({
			project_root: projectRoot,
			work_id: "wu_b",
			occurred_at: "2026-10-21T00:02:00.000Z",
			expected_head: head,
			draft: Buffer.from(JSON.stringify(first.batch)),
		});
		const second = planWorkEvidence({
			project_root: projectRoot,
			work_id: "wu_b",
			pull_requests_json: input,
		});
		expect(second.batch).toBeNull();
		expect(second.skipped).toEqual([
			{
				pr: "https://github.com/example/repo/pull/7",
				requirement_id: "r1",
				reason: "already_recorded",
			},
		]);
		const projection = statusWork({
			project_root: projectRoot,
			work_id: "wu_b",
		}).projection;
		const verifiedProjection = {
			...projection,
			requirements: projection.requirements.map((item) =>
				item.id === "r1" ? { ...item, status: "verified" as const } : item,
			),
		};
		const downgrade = buildWorkEvidencePlan({
			projection: verifiedProjection,
			committed_event_ids: new Set(),
			pull_requests: pr({ state: "MERGED", body: "Work-Requirements: r1" }),
		});
		expect(downgrade.batch).toBeNull();
		expect(downgrade.skipped[0]?.reason).toBe("already_at_or_beyond");
	});

	it("reads a custom marker and rejects input that is not gh PR JSON", () => {
		const projectRoot = root();
		created(projectRoot);
		const plan = planWorkEvidence({
			project_root: projectRoot,
			work_id: "wu_b",
			marker: "검증",
			pull_requests_json: Buffer.from(
				JSON.stringify(pr({ body: "검증: r3 — 운영 확인" })),
			),
		});
		expect(plan.batch?.transitions[0]?.requirement_id).toBe("r3");
		expect(() =>
			planWorkEvidence({
				project_root: projectRoot,
				work_id: "wu_b",
				pull_requests_json: Buffer.from(JSON.stringify([{ title: "x" }])),
			}),
		).toThrow(/gh PR JSON/);
	});

	it("runs plan -> batch through the CLI", () => {
		const projectRoot = root();
		const head = created(projectRoot);
		fs.writeFileSync(
			path.join(projectRoot, "prs.json"),
			JSON.stringify([pr({ body: "Work-Requirements: r1, r2" })]),
		);
		const run = (args: string[]) =>
			spawnSync(
				process.execPath,
				[tsxCli, anamnesisCli, "work", ...args, "--project-root", projectRoot],
				{ cwd: repositoryRoot, encoding: "utf8", env: { ...process.env } },
			);
		const plan = run([
			"evidence",
			"plan",
			"--work",
			"wu_b",
			"--input",
			"prs.json",
			"--output",
			"batch.json",
			"--json",
		]);
		expect(plan.status, plan.stderr).toBe(0);
		expect(JSON.parse(plan.stdout).expected_head).toBe(head);
		const applied = run([
			"transition",
			"--work",
			"wu_b",
			"--batch",
			"batch.json",
			"--expected-head",
			head,
			"--occurred-at",
			"2026-10-21T00:03:00.000Z",
			"--json",
		]);
		expect(applied.status, applied.stderr).toBe(0);
		expect(JSON.parse(applied.stdout)).toMatchObject({
			appended_count: 2,
			idempotent_count: 0,
		});
		const misuse = run([
			"transition",
			"--work",
			"wu_b",
			"--batch",
			"batch.json",
			"--draft",
			"x.yaml",
			"--expected-head",
			head,
			"--occurred-at",
			"2026-10-21T00:03:00.000Z",
		]);
		expect(misuse.status).not.toBe(0);
		expect(misuse.stderr).toContain("does not accept --draft");
	});
});
