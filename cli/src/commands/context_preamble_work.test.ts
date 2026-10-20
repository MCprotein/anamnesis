import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { readWorkLedger } from "../core/work_ledger.js";
import { contextSubagentPreamble } from "./context_resume.js";
import { amendWork, assessWorkDelegation, createWork } from "./work.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

const PRIVATE_PROMPT = "PRIVATE-PROMPT-BODY 사용자 원문";

function contract(
	classification: "new_unit" | "same_unit",
	extraRequirement = false,
): Buffer {
	return Buffer.from(
		YAML.stringify({
			work: { title: "팀 작업", completion_contract: "두 lane 결과 검증" },
			boundary: {
				state: "accepted",
				classification,
				reason_codes: ["same_deliverable"],
				confidence: "high",
			},
			requirements: [
				{ id: "r1", summary: "API 변경", source_event_ids: ["src_1"] },
				{ id: "r2", summary: "문서 변경", source_event_ids: ["src_1"] },
				...(extraRequirement
					? [{ id: "r3", summary: "추가", source_event_ids: ["src_2"] }]
					: []),
			],
			open_conflicts: [],
			constraints: [
				{
					id: "c1",
					kind: "never",
					text: "git stash를 실행하지 않는다",
					source_event_ids: ["src_1"],
					expires: "2026-10-23",
				},
			],
		}),
	);
}

function setup(): { projectRoot: string; head: string } {
	const projectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-preamble-work-"),
	);
	roots.push(projectRoot);
	fs.writeFileSync(
		path.join(projectRoot, "Agentfile"),
		YAML.stringify({
			version: 2,
			project: { name: "preamble-work" },
			tools: ["claude-code"],
			fragments: [],
			settings: { work_policy: { delegation: { parallelism: "auto" } } },
		}),
	);
	fs.writeFileSync(
		path.join(projectRoot, "AGENTS.md"),
		"# p\n\n<!-- anamnesis:region id=teamcity fragment=ci@1 -->\nci\n<!-- /anamnesis:region -->\n\n<!-- anamnesis:region id=rules fragment=team@1 -->\nrules\n<!-- /anamnesis:region -->\n",
	);
	const created = createWork({
		project_root: projectRoot,
		work_id: "wu_p",
		event_id: "evt_1",
		occurred_at: "2026-10-21T00:00:00.000Z",
		expected_head: null,
		draft: contract("new_unit"),
		source_stdin: {
			event_id: "src_1",
			captured_at: "2026-10-21T00:00:00.000Z",
			client: "claude-code",
			content_type: "text/plain; charset=utf-8",
			fidelity: "client_exact",
			allocation_status: "allocated",
			body: Buffer.from(PRIVATE_PROMPT, "utf8"),
		},
	});
	const lanes = [
		{
			lane_id: "lane_api",
			requirement_ids: ["r1"],
			repository_scopes: [{ kind: "tree", path: "src/api", access: "write" }],
			external_effects: [
				{
					resource_kind: "github_pr",
					resource_ref: "repo#new",
					access: "write",
					irreversible: false,
				},
			],
			depends_on: [],
			verification_owner: "leader",
		},
		{
			lane_id: "lane_docs",
			requirement_ids: ["r2"],
			repository_scopes: [{ kind: "tree", path: "docs", access: "write" }],
			external_effects: [],
			depends_on: ["lane_api"],
			verification_owner: "leader",
		},
	];
	const assessed = assessWorkDelegation({
		project_root: projectRoot,
		work_id: "wu_p",
		event_id: "assess_1",
		occurred_at: "2026-10-21T00:01:00.000Z",
		expected_head: created.projection.ledger_head!,
		draft: Buffer.from(
			YAML.stringify({
				execution_inputs: {
					parallelism_inputs: {
						material_scope: {
							repository_scopes: [{ kind: "repo", access: "read" }],
							external_effects: [],
						},
						runtime_capability: {
							assurance: "runtime_attested",
							capability_ref: "capability:test",
							providers: [
								{
									provider: "native_agents",
									availability: "available",
									max_agents: 2,
								},
							],
						},
					},
				},
				assessment_id: "assess_1",
				decision: "parallel",
				lanes,
				selected_provider: "native_agents",
				rationale_codes: ["disjoint_scopes"],
				evidence_refs: ["plan:lanes"],
			}),
		),
	});
	return { projectRoot, head: assessed.projection.ledger_head! };
}

describe("context subagent-preamble --work --lane", () => {
	it("adds constraints, the lane scope, and team rule pointers without prompt bodies", () => {
		const { projectRoot } = setup();
		const result = contextSubagentPreamble({
			projectRoot,
			workId: "wu_p",
			laneId: "lane_docs",
		});
		const text = result.preamble;
		expect(text).toContain("## work_contract");
		expect(text).toContain("- work_id: wu_p");
		expect(text).toContain(
			"- c1 [never] git stash를 실행하지 않는다 (expires: 2026-10-23) (source: src_1)",
		);
		expect(text).toContain("- lane_id: lane_docs (assessment assess_1, decision parallel)");
		expect(text).toContain("  - r2 [pending] 문서 변경");
		expect(text).toContain("  - write tree docs");
		expect(text).toContain("  - (none allowed)");
		expect(text).toContain("- depends_on: lane_api");
		expect(text).toContain("other lanes (do not change their scope): lane_api");
		expect(text).toContain("- AGENTS.md#rules");
		expect(text).not.toContain("AGENTS.md#teamcity");
		expect(text).not.toContain("WARNING");
		expect(text).not.toContain("PRIVATE-PROMPT-BODY");
		expect(result.summary.workConstraints).toBe(1);
		expect(result.work?.lane?.requirements).toEqual([
			{ id: "r2", summary: "문서 변경", status: "pending" },
		]);
	});

	it("warns when the lane was assessed against an older contract revision", () => {
		const { projectRoot, head } = setup();
		amendWork({
			project_root: projectRoot,
			work_id: "wu_p",
			event_id: "evt_2",
			occurred_at: "2026-10-21T00:02:00.000Z",
			expected_head: head,
			draft: contract("same_unit", true),
			source_stdin: {
				event_id: "src_2",
				captured_at: "2026-10-21T00:02:00.000Z",
				client: "claude-code",
				content_type: "text/plain; charset=utf-8",
				fidelity: "client_exact",
				allocation_status: "allocated",
				body: Buffer.from("추가 요청", "utf8"),
			},
		});
		expect(
			readWorkLedger(
				path.join(projectRoot, ".anamnesis/work-units/wu_p/ledger.jsonl"),
			).records,
		).toHaveLength(3);
		const result = contextSubagentPreamble({
			projectRoot,
			workId: "wu_p",
			laneId: "lane_api",
		});
		expect(result.work?.lane?.assessment_stale).toBe(true);
		expect(result.preamble).toContain(
			"WARNING: assessed at contract revision 1, current is 2",
		);
	});

	it("rejects an unknown lane and a lane without a Work", () => {
		const { projectRoot } = setup();
		expect(() =>
			contextSubagentPreamble({ projectRoot, workId: "wu_p", laneId: "nope" }),
		).toThrow(/lane nope is not in assessment assess_1/);
		expect(() =>
			contextSubagentPreamble({ projectRoot, laneId: "lane_api" }),
		).toThrow(/--lane requires --work/);
		const plain = contextSubagentPreamble({ projectRoot });
		expect(plain.work).toBeUndefined();
		expect(plain.preamble).not.toContain("## work_contract");
	});
});
