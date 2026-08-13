import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "../util/hash.js";
import {
	calculateWorkContractHash,
	type WorkContractDefinition,
} from "./work_contract.js";
import { appendWorkLedger, type WorkLedgerRecord } from "./work_ledger.js";
import { createWorkPolicySnapshot, resolveWorkPolicy } from "./work_policy.js";
import {
	calculateWorkProgress,
	foldWorkProjection,
	rebuildWorkProjection,
	writeWorkProjectionAtomic,
} from "./work_projection.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function temp(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-projection-"));
	roots.push(root);
	return root;
}

function records(
	events: Array<{ id: string; kind: string; payload: Record<string, unknown> }>,
): WorkLedgerRecord[] {
	let previous: string | null = null;
	return events.map((event, index) => {
		const record = {
			schema_version: "anamnesis.work-ledger.v1" as const,
			event_id: event.id,
			occurred_at: `2026-08-13T00:00:0${index}.000Z`,
			kind: event.kind,
			payload: event.payload,
			previous_hash: previous,
			record_hash: sha256(`record-${index}`),
		};
		previous = record.record_hash;
		return record;
	});
}

describe("Work projection", () => {
	it("rejects unsafe weighted sums", () => {
		expect(calculateWorkProgress([
			{ id: "fraction", summary: "fraction", status: "verified", source_event_ids: [], evidence_refs: ["x"], weight: 0.5, updated_at: "x" },
		]).percent).toBe(100);
		expect(() => calculateWorkProgress([
			{ id: "a", summary: "a", status: "verified", source_event_ids: [], evidence_refs: ["x"], weight: Number.MAX_SAFE_INTEGER, updated_at: "x" },
			{ id: "b", summary: "b", status: "verified", source_event_ids: [], evidence_refs: ["x"], weight: 1, updated_at: "x" },
		])).toThrow(/safe integer/);
	});

	it("rejects non-positive weights at the exported progress boundary", () => {
		for (const weight of [0, -1]) {
			expect(() =>
				calculateWorkProgress([
					{
						id: "bad_weight",
						summary: "bad",
						status: "pending",
						source_event_ids: ["src"],
						evidence_refs: [],
						weight,
						updated_at: "2026-08-13T00:00:00.000Z",
					},
				]),
			).toThrow(/finite and positive/);
		}
	});
	it("folds validated typed contract, policy, progress, and close readiness", () => {
		const definition: WorkContractDefinition = {
			work: { id: "wu_typed", title: "typed", completion_contract: "verified" },
			boundary: {
				state: "accepted",
				classification: "same_unit",
				reason_codes: ["same_completion_contract"],
				confidence: "high",
			},
			policy_snapshot: createWorkPolicySnapshot(
				1,
				resolveWorkPolicy([
					{
						kind: "project",
						source_refs: [{ source: "Agentfile", ref: "settings.work_policy" }],
						config: { review: { preset: "strict" } },
					},
				]),
			),
			requirements: [
				{ id: "req_typed", summary: "typed", source_event_ids: ["src_typed"] },
			],
			open_conflicts: [],
		};
		const contractHash = calculateWorkContractHash(definition);
		const projection = foldWorkProjection(
			records([
				{
					id: "lev_create",
					kind: "work_created",
					payload: {
						schema_version: "anamnesis.work-contract-event.v1",
						work_id: "wu_typed",
						contract_revision: 1,
						previous_contract_revision: null,
						previous_contract_hash: null,
						contract_hash: contractHash,
						contract: definition,
					},
				},
				{
					id: "lev_progress",
					kind: "work_requirement_transitioned",
					payload: {
						schema_version: "anamnesis.work-progress-event.v1",
						work_id: "wu_typed",
						requirement_id: "req_typed",
						basis_contract_hash: contractHash,
						status: "verified",
						evidence_refs: ["test:typed"],
					},
				},
			]),
		);
		expect(projection.contract_hash).toBe(contractHash);
		expect(projection.title).toBe("typed");
		expect(projection.completion_contract).toBe("verified");
		expect(projection.policy_snapshot?.policy_hash).toBe(
			projection.policy_hash,
		);
		expect(projection.configured_required_gates).toEqual([
			"planning",
			"completion",
		]);
		expect(projection.progress).toMatchObject({
			pending: 0,
			in_progress: 0,
			denominator_empty: false,
			percent: 100,
		});
		expect(projection.requirements_ready).toBe(true);
	});

	it.each([
		["provisional", false],
		["needs_user", false],
		["accepted", true],
	] as const)("requires an accepted typed boundary for close readiness: %s", (boundaryState, expected) => {
		const definition: WorkContractDefinition = {
			work: {
				id: `wu_${boundaryState}`,
				title: boundaryState,
				completion_contract: "verified",
			},
			boundary: {
				state: boundaryState,
				classification: "same_unit",
				reason_codes: ["same_completion_contract"],
				confidence: "high",
			},
			policy_snapshot: createWorkPolicySnapshot(1, resolveWorkPolicy([])),
			requirements: [
				{
					id: "req_boundary",
					summary: "boundary",
					source_event_ids: ["src_boundary"],
				},
			],
			open_conflicts: [],
		};
		const contractHash = calculateWorkContractHash(definition);
		const projection = foldWorkProjection(
			records([
				{
					id: "lev_create",
					kind: "work_created",
					payload: {
						schema_version: "anamnesis.work-contract-event.v1",
						work_id: definition.work.id,
						contract_revision: 1,
						previous_contract_revision: null,
						previous_contract_hash: null,
						contract_hash: contractHash,
						contract: definition,
					},
				},
				{
					id: "lev_progress",
					kind: "work_requirement_transitioned",
					payload: {
						schema_version: "anamnesis.work-progress-event.v1",
						work_id: definition.work.id,
						requirement_id: "req_boundary",
						basis_contract_hash: contractHash,
						status: "verified",
						evidence_refs: ["test:boundary"],
					},
				},
			]),
		);

		expect(projection.requirements_ready).toBe(expected);
	});

	it("folds committed records deterministically with reproducible progress", () => {
		const input = records([
			{
				id: "lev_1",
				kind: "work_created",
				payload: { work_id: "wu_one", contract_revision: 1 },
			},
			{
				id: "lev_2",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_1",
					summary: "preserve exact prompt",
					source_event_ids: ["evt_1"],
				},
			},
			{
				id: "lev_3",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_2",
					summary: "verify projection",
					source_event_ids: ["evt_2"],
				},
			},
			{
				id: "lev_4",
				kind: "requirement_status_changed",
				payload: {
					requirement_id: "req_1",
					status: "verified",
					evidence_refs: ["test:one"],
				},
			},
			{
				id: "lev_5",
				kind: "requirement_status_changed",
				payload: { requirement_id: "req_2", status: "implemented_unverified" },
			},
		]);
		const first = foldWorkProjection(input);
		const second = foldWorkProjection(structuredClone(input));
		expect(second).toEqual(first);
		expect(first.progress).toEqual({
			applicable: 2,
			pending: 0,
			in_progress: 0,
			verified: 1,
			implemented_unverified: 1,
			blocked: 0,
			waived: 0,
			percent: 50,
			weighted: false,
			denominator_empty: false,
		});
		expect(first.title).toBeNull();
		expect(first.completion_contract).toBeNull();
		expect(first.ledger_head).toBe(input.at(-1)?.record_hash);
		expect(first.last_event_id).toBe("lev_5");
	});

	it("deduplicates requirement provenance without renumbering 100 earlier requirements", () => {
		const events = [
			{ id: "lev_0", kind: "work_created", payload: { work_id: "wu_long" } },
			...Array.from({ length: 100 }, (_, index) => ({
				id: `lev_${index + 1}`,
				kind: "requirement_added",
				payload: {
					requirement_id: `req_${index + 1}`,
					summary: `requirement ${index + 1}`,
					source_event_ids: [`evt_${index + 1}`],
				},
			})),
			{
				id: "lev_101",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_1",
					summary: "duplicate wording ignored",
					source_event_ids: ["evt_101"],
				},
			},
			{
				id: "lev_102",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_101",
					summary: "later requirement",
					source_event_ids: ["evt_102"],
				},
			},
		];
		const projection = foldWorkProjection(records(events));
		expect(projection.requirements).toHaveLength(101);
		expect(projection.requirements[0]).toMatchObject({
			id: "req_1",
			summary: "requirement 1",
			source_event_ids: ["evt_1", "evt_101"],
		});
		expect(projection.requirements[99]?.id).toBe("req_100");
		expect(projection.requirements[100]?.id).toBe("req_101");
	});

	it("excludes waived requirements and uses weights only when all are explicit", () => {
		const progress = calculateWorkProgress([
			{
				id: "a",
				summary: "a",
				status: "verified",
				source_event_ids: [],
				evidence_refs: [],
				weight: 1,
				updated_at: "x",
			},
			{
				id: "b",
				summary: "b",
				status: "blocked",
				source_event_ids: [],
				evidence_refs: [],
				weight: 3,
				updated_at: "x",
			},
			{
				id: "c",
				summary: "c",
				status: "waived",
				source_event_ids: [],
				evidence_refs: [],
				weight: 10,
				updated_at: "x",
			},
		]);
		expect(progress).toMatchObject({
			applicable: 2,
			verified: 1,
			blocked: 1,
			waived: 1,
			weighted: true,
			applicable_weight: 4,
			verified_weight: 1,
			percent: 25,
		});
	});

	it("fails closed instead of silently truncating bounded projections", () => {
		const input = records([
			{ id: "lev_0", kind: "work_created", payload: { work_id: "wu_one" } },
			{
				id: "lev_1",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_1",
					summary: "one",
					source_event_ids: ["evt_1"],
				},
			},
			{
				id: "lev_2",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_2",
					summary: "two",
					source_event_ids: ["evt_2"],
				},
			},
		]);
		expect(() => foldWorkProjection(input, { maxRequirements: 1 })).toThrow(
			/limit exceeded/,
		);
	});

	it("rebuilds only from a validated newline-committed ledger", () => {
		const root = temp();
		const ledgerPath = path.join(root, "ledger.jsonl");
		const projectionPath = path.join(root, "projection.yaml");
		let head: string | null = null;
		for (const event of [
			{
				event_id: "lev_1",
				occurred_at: "2026-08-13T00:00:00Z",
				kind: "work_created",
				payload: { work_id: "wu_one" },
			},
			{
				event_id: "lev_2",
				occurred_at: "2026-08-13T00:00:01Z",
				kind: "requirement_added",
				payload: {
					requirement_id: "req_1",
					summary: "committed",
					status: "waived",
				},
			},
		]) {
			head = appendWorkLedger({
				ledgerPath,
				event,
				expectedHead: head,
			}).head;
		}
		const projection = rebuildWorkProjection(ledgerPath, projectionPath);
		expect(projection.ledger_head).toBe(head);
		expect(fs.statSync(projectionPath).mode & 0o777).toBe(0o600);
		expect(fs.readFileSync(projectionPath, "utf8")).toContain(
			"summary: committed",
		);

		fs.appendFileSync(ledgerPath, '{"uncommitted":');
		expect(() => rebuildWorkProjection(ledgerPath, projectionPath)).toThrow(
			/uncommitted/,
		);
		expect(fs.readFileSync(projectionPath, "utf8")).toContain(
			"summary: committed",
		);
	});

	it("holds the ledger writer lock through projection publication", () => {
		const root = temp();
		const ledgerPath = path.join(root, "ledger.jsonl");
		const projectionPath = path.join(root, "projection.yaml");
		const first = appendWorkLedger({
			ledgerPath,
			event: {
				event_id: "lev_1",
				occurred_at: "2026-08-13T00:00:00Z",
				kind: "work_created",
				payload: { work_id: "wu_one" },
			},
			expectedHead: null,
		});
		let concurrentError = "";
		const projection = rebuildWorkProjection(
			ledgerPath,
			projectionPath,
			{},
			{
				onProjectionFolded: () => {
					try {
						appendWorkLedger({
							ledgerPath,
							event: {
								event_id: "lev_2",
								occurred_at: "2026-08-13T00:00:01Z",
								kind: "contract_revised",
								payload: { work_id: "wu_one", contract_revision: 2 },
							},
							expectedHead: first.head,
							lockTimeoutMs: 1,
							lockRetryMs: 1,
						});
					} catch (error) {
						concurrentError = (error as Error).message;
					}
				},
			},
		);
		expect(concurrentError).toContain("timed out acquiring work ledger lock");
		expect(projection.ledger_head).toBe(first.head);
		expect(fs.readFileSync(projectionPath, "utf8")).toContain(first.head);
	});

	it("requires exactly one explicit creation before semantic events", () => {
		expect(() =>
			foldWorkProjection(
				records([
					{
						id: "lev_1",
						kind: "requirement_added",
						payload: {
							work_id: "wu_fake",
							requirement_id: "req_1",
							summary: "too early",
							source_event_ids: ["evt_1"],
						},
					},
				]),
			),
		).toThrow(/precedes work_created/);

		expect(() =>
			foldWorkProjection(
				records([
					{
						id: "lev_0",
						kind: "future_event",
						payload: { work_id: "wu_fake" },
					},
				]),
			),
		).toThrow(/requires a committed work_created/);

		expect(() =>
			foldWorkProjection(
				records([
					{ id: "lev_1", kind: "work_created", payload: { work_id: "wu_one" } },
					{ id: "lev_2", kind: "work_created", payload: { work_id: "wu_two" } },
				]),
			),
		).toThrow(/repeated work_created/);
	});

	it("validates bounds and active requirement provenance", () => {
		const created = records([
			{ id: "lev_1", kind: "work_created", payload: { work_id: "wu_one" } },
		]);
		for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
			expect(() =>
				foldWorkProjection(created, { maxRecords: invalid }),
			).toThrow(/positive safe integer/);
		}
		expect(() =>
			foldWorkProjection(
				records([
					{ id: "lev_1", kind: "work_created", payload: { work_id: "wu_one" } },
					{
						id: "lev_2",
						kind: "requirement_added",
						payload: { requirement_id: "req_1", summary: "unprovenanced" },
					},
				]),
			),
		).toThrow(/requires source_event_ids provenance/);
	});

	it("rejects projection directory and final-path symlinks", () => {
		const root = temp();
		const elsewhere = temp();
		const unit = path.join(root, "unit");
		fs.symlinkSync(elsewhere, unit, "dir");
		const projection = foldWorkProjection(
			records([
				{ id: "lev_1", kind: "work_created", payload: { work_id: "wu_one" } },
			]),
		);
		expect(() =>
			writeWorkProjectionAtomic(path.join(unit, "projection.yaml"), projection),
		).toThrow(/symbolic link/);

		fs.unlinkSync(unit);
		fs.mkdirSync(unit);
		const target = path.join(unit, "projection.yaml");
		fs.symlinkSync(path.join(elsewhere, "escaped.yaml"), target);
		expect(() => writeWorkProjectionAtomic(target, projection)).toThrow(
			/symbolic link/,
		);
	});

	it("rejects a symlink in a lexical projection ancestor without touching the victim", () => {
		const root = temp();
		const victim = temp();
		const linked = path.join(root, "linked");
		fs.symlinkSync(victim, linked, "dir");
		const projection = foldWorkProjection(records([
			{ id: "lev_1", kind: "work_created", payload: { work_id: "wu_one" } },
		]));
		expect(() => writeWorkProjectionAtomic(path.join(linked, "nested", "projection.yaml"), projection)).toThrow(/symbolic link/);
		expect(fs.readdirSync(victim)).toHaveLength(0);
	});
});
