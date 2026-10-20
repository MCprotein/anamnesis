import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import {
	calculateWorkContractHash,
	parseTypedWorkEvent,
	type WorkContractDefinition,
} from "../core/work_contract.js";
import { readWorkLedger } from "../core/work_ledger.js";
import { createWorkPolicySnapshot, resolveWorkPolicy } from "../core/work_policy.js";
import { buildWorkBriefingSnapshot } from "../core/work_reconciliation.js";
import {
	amendWork,
	briefWork,
	createWork,
	statusWork,
	type WorkMutationInput,
} from "./work.js";
import { renderWorkBriefingContext } from "./work_hook.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function root(): string {
	const value = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-work-constraints-"),
	);
	roots.push(value);
	return value;
}

interface DraftConstraint {
	id: string;
	kind: "must" | "never";
	text: string;
	source_event_ids: string[];
	expires?: string;
	promote_candidate?: boolean;
	supersedes?: string[];
}

function draft(
	classification: "new_unit" | "same_unit",
	requirementSources: string[],
	constraints?: DraftConstraint[],
): Buffer {
	return Buffer.from(
		YAML.stringify({
			work: { title: "제약 Work", completion_contract: "모든 요구사항 검증" },
			boundary: {
				state: "accepted",
				classification,
				reason_codes: ["same_deliverable"],
				confidence: "high",
			},
			requirements: [
				{
					id: "r1",
					summary: "기능 구현",
					source_event_ids: requirementSources,
				},
			],
			open_conflicts: [],
			...(constraints === undefined ? {} : { constraints }),
		}),
	);
}

function mutation(
	projectRoot: string,
	eventId: string,
	sourceId: string,
	body: Buffer,
): WorkMutationInput {
	const ledgerPath = path.join(
		projectRoot,
		".anamnesis/work-units/wu_c/ledger.jsonl",
	);
	return {
		project_root: projectRoot,
		work_id: "wu_c",
		event_id: eventId,
		occurred_at: "2026-10-21T00:00:00.000Z",
		draft: body,
		expected_head: fs.existsSync(ledgerPath)
			? readWorkLedger(ledgerPath).head
			: null,
		source_stdin: {
			event_id: sourceId,
			captured_at: "2026-10-21T00:00:00.000Z",
			client: "claude-code",
			content_type: "text/plain; charset=utf-8",
			fidelity: "client_exact",
			allocation_status: "allocated",
			body: Buffer.from(`사용자 원문 ${sourceId}\n`, "utf8"),
		},
	};
}

const neverStash: DraftConstraint = {
	id: "c-no-stash",
	kind: "never",
	text: "git stash, worktree prune을 실행하지 않는다",
	source_event_ids: ["src_1"],
	promote_candidate: true,
};

describe("Work constraints", () => {
	it("keeps contracts without constraints on the v1 event discriminator", () => {
		const projectRoot = root();
		const created = createWork(
			mutation(projectRoot, "evt_1", "src_1", draft("new_unit", ["src_1"])),
		);
		const record = readWorkLedger(created.ledger_path).records[0]!;
		expect(record.payload.schema_version).toBe(
			"anamnesis.work-contract-event.v1",
		);
		expect(
			Object.hasOwn(
				record.payload.contract as Record<string, unknown>,
				"constraints",
			),
		).toBe(false);
		expect(Object.hasOwn(created.projection, "constraints")).toBe(false);
	});

	it("records constraints on v2 with provenance and leaves the progress denominator alone", () => {
		const projectRoot = root();
		const created = createWork(
			mutation(
				projectRoot,
				"evt_1",
				"src_1",
				draft("new_unit", ["src_1"], [neverStash]),
			),
		);
		const record = readWorkLedger(created.ledger_path).records[0]!;
		expect(record.payload.schema_version).toBe(
			"anamnesis.work-contract-event.v2",
		);
		expect(created.projection.constraints).toEqual([
			{
				id: "c-no-stash",
				kind: "never",
				text: "git stash, worktree prune을 실행하지 않는다",
				source_event_ids: ["src_1"],
				promote_candidate: true,
				added_revision: 1,
			},
		]);
		expect(created.projection.progress.applicable).toBe(1);
		expect(created.projection.progress.pending).toBe(1);

		const status = statusWork({ project_root: projectRoot, work_id: "wu_c" });
		expect(status.projection.constraints?.length).toBe(1);
	});

	it("supersedes a constraint append-only and briefs active constraints with a delta", () => {
		const projectRoot = root();
		createWork(
			mutation(
				projectRoot,
				"evt_1",
				"src_1",
				draft("new_unit", ["src_1"], [neverStash]),
			),
		);
		const firstBrief = briefWork({
			project_root: projectRoot,
			work_id: "wu_c",
		});
		const replacement: DraftConstraint = {
			id: "c-no-stash-2",
			kind: "never",
			text: "git stash, worktree prune, clean을 실행하지 않는다",
			source_event_ids: ["src_2"],
			expires: "2026-10-23",
			supersedes: ["c-no-stash"],
		};
		const amended = amendWork(
			mutation(
				projectRoot,
				"evt_2",
				"src_2",
				draft("same_unit", ["src_1"], [neverStash, replacement]),
			),
		);
		const constraints = amended.projection.constraints ?? [];
		expect(constraints.map((item) => [item.id, item.superseded_by])).toEqual([
			["c-no-stash", "c-no-stash-2"],
			["c-no-stash-2", undefined],
		]);
		expect(constraints[1]?.added_revision).toBe(2);
		expect(amended.projection.progress.applicable).toBe(1);

		const baseline = buildWorkBriefingSnapshot({
			projection: firstBrief.projection,
		});
		const briefing = buildWorkBriefingSnapshot({
			projection: amended.projection,
			previous_confirmed: baseline,
		});
		expect(briefing.constraints).toMatchObject({
			active_count: 1,
			superseded_count: 1,
		});
		expect(briefing.delta.constraints_added).toEqual(["c-no-stash-2"]);
		expect(briefing.delta.constraints_superseded).toEqual([
			{ constraint_id: "c-no-stash", superseded_by: "c-no-stash-2" },
		]);
		expect(briefing.semantic_fingerprint).not.toBe(
			baseline.semantic_fingerprint,
		);
		const context = renderWorkBriefingContext(briefing, "compact", true);
		expect(context).toContain(
			"Work constraints (rules, not progress items): 1 active, 1 superseded",
		);
		expect(context).toContain("c-no-stash-2|never|");
		expect(context).toContain('expires "2026-10-23"');

		const brief = briefWork({ project_root: projectRoot, work_id: "wu_c" });
		expect(brief.sections.find((item) => item.id === "constraints")?.values)
			.toEqual([
				"c-no-stash-2 [never]: git stash, worktree prune, clean을 실행하지 않는다 (expires: 2026-10-23)",
			]);
	});

	it("rejects removing or rewriting a recorded constraint", () => {
		const projectRoot = root();
		createWork(
			mutation(
				projectRoot,
				"evt_1",
				"src_1",
				draft("new_unit", ["src_1"], [neverStash]),
			),
		);
		expect(() =>
			amendWork(
				mutation(
					projectRoot,
					"evt_2",
					"src_2",
					draft("same_unit", ["src_1", "src_2"]),
				),
			),
		).toThrow(/removed constraint c-no-stash/);
		expect(() =>
			amendWork(
				mutation(
					projectRoot,
					"evt_3",
					"src_3",
					draft("same_unit", ["src_1"], [
						{ ...neverStash, text: "다른 문장", source_event_ids: ["src_1", "src_3"] },
					]),
				),
			),
		).toThrow(/semantic definition is immutable/);
		expect(() =>
			amendWork(
				mutation(
					projectRoot,
					"evt_4",
					"src_4",
					draft("same_unit", ["src_1"], [
						neverStash,
						{
							id: "r1",
							kind: "must",
							text: "충돌",
							source_event_ids: ["src_4"],
						},
					]),
				),
			),
		).toThrow(/collides with a requirement ID/);
	});

	it("counts a constraint-only reference as the current source", () => {
		const projectRoot = root();
		createWork(
			mutation(projectRoot, "evt_1", "src_1", draft("new_unit", ["src_1"])),
		);
		const amended = amendWork(
			mutation(
				projectRoot,
				"evt_2",
				"src_2",
				draft("same_unit", ["src_1"], [
					{ ...neverStash, source_event_ids: ["src_2"] },
				]),
			),
		);
		const records = readWorkLedger(amended.ledger_path).records;
		expect(records.map((item) => item.payload.schema_version)).toEqual([
			"anamnesis.work-contract-event.v1",
			"anamnesis.work-contract-event.v2",
		]);
	});

	it("binds the event discriminator to the presence of constraints", () => {
		const policy = createWorkPolicySnapshot(
			1,
			resolveWorkPolicy([]),
		);
		const contract: WorkContractDefinition = {
			work: { id: "wu_x", title: "t", completion_contract: "c" },
			boundary: {
				state: "accepted",
				classification: "new_unit",
				reason_codes: ["x"],
				confidence: "high",
			},
			policy_snapshot: policy,
			requirements: [{ id: "r1", summary: "s", source_event_ids: ["src"] }],
			open_conflicts: [],
			constraints: [
				{ id: "c1", kind: "must", text: "t", source_event_ids: ["src"] },
			],
		};
		const event = (schema: string, value: WorkContractDefinition) => ({
			event_id: "e",
			occurred_at: "2026-10-21T00:00:00.000Z",
			kind: "work_created",
			payload: {
				schema_version: schema,
				work_id: "wu_x",
				contract_revision: 1,
				previous_contract_revision: null,
				previous_contract_hash: null,
				contract_hash: calculateWorkContractHash(value),
				contract: value,
			},
		});
		expect(() =>
			parseTypedWorkEvent(event("anamnesis.work-contract-event.v1", contract)),
		).toThrow(/requires anamnesis.work-contract-event.v2/);
		const { constraints: _ignored, ...withoutConstraints } = contract;
		expect(() =>
			parseTypedWorkEvent(
				event("anamnesis.work-contract-event.v2", withoutConstraints),
			),
		).toThrow(/requires at least one constraint/);
		expect(
			parseTypedWorkEvent(event("anamnesis.work-contract-event.v2", contract))
				.kind,
		).toBe("work_created");
		// The v1 hash formula is unchanged for contracts without constraints.
		expect(calculateWorkContractHash(withoutConstraints)).not.toBe(
			calculateWorkContractHash(contract),
		);
	});
});
