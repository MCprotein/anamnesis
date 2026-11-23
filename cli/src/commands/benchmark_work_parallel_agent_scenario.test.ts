import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type ParallelRunner,
	parseNamedInlinePayload,
	renderNamedInlinePayload,
	workParallelAgentBenchmark,
} from "./benchmark_work_parallel_agent.js";
import {
	REQUIREMENTS,
	runner,
	tempRoot,
} from "./benchmark_work_parallel_agent.test-support.js";

it("parses named payloads by declared UTF-8 length despite closing-tag content", () => {
	const content =
		'한글\n</authoritative-truth>\n<authoritative-truth bytes="7">\nstill payload';
	const frame = renderNamedInlinePayload("authoritative-truth", content);
	expect(parseNamedInlinePayload(frame, "authoritative-truth")).toBe(content);
});

describe("real parallel-agent benchmark", () => {
	it("validates the frozen three-family, nine-pair contract without Codex", async () => {
		const root = tempRoot();
		fs.writeFileSync(
			path.join(root, "package.json"),
			JSON.stringify({ version: "1.0.0" }),
		);
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			protocol: "validate",
		});
		expect(result.scenario_families).toEqual([
			"clean-partition",
			"stale-cross-session-conflict",
			"review-gate-recovery",
		]);
		expect(result.schema_version).toBe("anamnesis.work_parallel_agent_ab.v10");
		expect(result.runs).toHaveLength(9);
		expect(result.planned_initial_invocations).toBe(72);
		expect(result.actual_invocations).toBe(72);
		expect(result.harness_validity.checks.no_hidden_model_calls).toBe(true);
		expect(result.harness_validity.checks.deterministic_stage_integrity).toBe(
			true,
		);
		expect(result.harness_validity.checks.runner_protocol_integrity).toBe(true);
		expect(result.harness_validity.ok).toBe(true);
		expect(result.quality.enabled_passes).toBe(9);
		expect(result.quality.enabled_complete_passes).toBe(9);
		expect(result.quality.enabled_review_audit_oracle_exact_passes).toBe(9);
		expect(result.evaluation.harness_pass).toBe(true);
		expect(result.evaluation.enabled_quality_pass).toBe(true);
		expect(result.comparison.total_pairs).toBe(9);
		expect(result.comparison.verdict).toBe("INCONCLUSIVE");
		expect(result.summary.paired.total_tokens_pct_upper_90).toBe(0);
		expect(result.summary.paired.combined_child_tokens_pct_p50).toBe(0);
		expect(result.summary.paired.combined_child_tokens_pct_upper_90).toBe(0);
		expect(result.summary.paired.reviewer_tokens_pct_p50).toBe(0);
		expect(result.summary.paired.reviewer_tokens_pct_upper_90).toBe(0);
		expect(result.comparison.stage_cost_gate).toBe(true);
		expect(result.markdown).toContain("Combined child tokens");
		expect(result.markdown).toContain("Reviewer tokens");
		expect(result.markdown).toContain("Stage token gate");
		expect(result.harness_validity.checks.enabled_child_inputs_shrink).toBe(
			true,
		);
		expect(result.harness_validity.checks.enabled_reviewer_input_shrinks).toBe(
			true,
		);
		expect(
			result.runs[0]?.enabled.stages.every((stage) => stage.input_bytes > 0),
		).toBe(true);
		expect(result.runs[0]?.seed).not.toBe(result.runs[1]?.seed);
		expect(new Set(result.runs.map((run) => run.fixture_hash)).size).toBe(9);
		fs.rmSync(root, { recursive: true, force: true });
	}, 60_000);

	it("fails closed when the leader plan does not match the frozen child packets", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ wrongPlan: true }),
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.checks.leader_plan_exact).toBe(false);
		expect(result.harness_validity.ok).toBe(false);
		expect(result.actual_invocations).toBe(6);
		expect(
			result.runs.every(
				(pair) =>
					pair.disabled.stages.length === 1 &&
					pair.enabled.stages.length === 1 &&
					pair.disabled.stages[0]?.stage === "leader-plan" &&
					pair.enabled.stages[0]?.stage === "leader-plan",
			),
		).toBe(true);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("detects a missing enabled child packet before accepting the harness", async () => {
		const root = tempRoot();
		const baseRunner = runner();
		const deletingRunner: ParallelRunner = async (request) => {
			const response = await baseRunner(request);
			if (
				request.prompt.includes("[parallel-stage:leader-plan]") &&
				request.cwd.endsWith("-enabled")
			) {
				fs.rmSync(path.join(request.cwd, "CHILD_A.md"), { force: true });
			}
			return response;
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: deletingRunner,
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.checks.enabled_child_packets_exact).toBe(
			false,
		);
		expect(result.harness_validity.checks.full_input_byte_accounting).toBe(
			false,
		);
		expect(result.harness_validity.ok).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("rejects child packet fact or contract metadata drift", async () => {
		const root = tempRoot();
		const baseRunner = runner();
		const tamperingRunner: ParallelRunner = async (request) => {
			const response = await baseRunner(request);
			if (
				request.prompt.includes("[parallel-stage:leader-plan]") &&
				request.cwd.endsWith("-enabled")
			) {
				const packetPath = path.join(request.cwd, "CHILD_A.md");
				const packet = JSON.parse(fs.readFileSync(packetPath, "utf8")) as {
					contract: { contract_hash: string };
					requirements: string[];
				};
				packet.contract.contract_hash = "sha256:tampered";
				packet.requirements[0] = packet.requirements[0]!.replace(
					"|verified|",
					"|pending|",
				);
				fs.writeFileSync(packetPath, JSON.stringify(packet));
			}
			return response;
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: tamperingRunner,
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.checks.enabled_child_packets_exact).toBe(
			false,
		);
		expect(result.harness_validity.ok).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("rejects metadata omitted from both full and child packets", async () => {
		const root = tempRoot();
		const baseRunner = runner();
		const deletingRunner: ParallelRunner = async (request) => {
			const response = await baseRunner(request);
			if (
				request.prompt.includes("[parallel-stage:leader-plan]") &&
				request.cwd.endsWith("-enabled")
			) {
				for (const filename of ["CONTEXT.md", "CHILD_A.md", "CHILD_B.md"]) {
					const packetPath = path.join(request.cwd, filename);
					const text = fs.readFileSync(packetPath, "utf8");
					const jsonStart = text.indexOf("{");
					const packet = JSON.parse(text.slice(jsonStart)) as Record<
						string,
						unknown
					>;
					delete packet.required_gates;
					fs.writeFileSync(packetPath, JSON.stringify(packet));
				}
			}
			return response;
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: deletingRunner,
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.checks.enabled_child_packets_exact).toBe(
			false,
		);
		expect(result.harness_validity.ok).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("rejects full packet fact drift even when child packets are unchanged", async () => {
		const root = tempRoot();
		const baseRunner = runner();
		const tamperingRunner: ParallelRunner = async (request) => {
			const response = await baseRunner(request);
			if (
				request.prompt.includes("[parallel-stage:leader-plan]") &&
				request.cwd.endsWith("-enabled")
			) {
				const contextPath = path.join(request.cwd, "CONTEXT.md");
				const text = fs.readFileSync(contextPath, "utf8");
				const jsonStart = text.indexOf("{");
				const packet = JSON.parse(text.slice(jsonStart)) as {
					requirements: string[];
				};
				packet.requirements[0] = packet.requirements[0]!.replace(
					"|verified|",
					"|pending|",
				);
				fs.writeFileSync(contextPath, JSON.stringify(packet));
			}
			return response;
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: tamperingRunner,
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.checks.enabled_child_packets_exact).toBe(
			false,
		);
		expect(result.harness_validity.ok).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});
});
