import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type ParallelRunner,
	reviewAuditStageIntegrity,
	workParallelAgentBenchmark,
} from "./benchmark_work_parallel_agent.js";
import {
	REQUIREMENTS,
	runner,
	tempRoot,
} from "./benchmark_work_parallel_agent.test-support.js";

describe("real parallel-agent benchmark", () => {
	it("runs child stages concurrently and aggregates four model stages plus two deterministic stages", async () => {
		const root = tempRoot();
		let runnerCalls = 0;
		let disabledReviewerPrompt = "";
		let enabledReviewerPrompt = "";
		let disabledChildPrompt = "";
		let enabledChildPrompt = "";
		const baseRunner = runner();
		const observingRunner: ParallelRunner = async (request) => {
			runnerCalls += 1;
			expect(request.prompt).not.toContain("[parallel-stage:leader-integrate]");
			expect(request.prompt).not.toContain("[parallel-stage:review-audit]");
			if (request.prompt.includes("[parallel-stage:reviewer]")) {
				if (request.cwd.endsWith("-disabled"))
					disabledReviewerPrompt = request.prompt;
				if (request.cwd.endsWith("-enabled"))
					enabledReviewerPrompt = request.prompt;
			}
			if (request.prompt.includes("[parallel-stage:child-a]")) {
				if (request.cwd.endsWith("-enabled"))
					enabledChildPrompt = request.prompt;
				if (request.cwd.endsWith("-disabled"))
					disabledChildPrompt = request.prompt;
			}
			return baseRunner(request);
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			model: "test",
			runner: observingRunner,
			requirements: REQUIREMENTS,
		});
		expect(result.planned_initial_invocations).toBe(24);
		expect(result.actual_invocations).toBe(24);
		expect(runnerCalls).toBe(24);
		expect(result.runs[0]?.disabled.children_overlap_ms).toBeGreaterThan(0);
		expect(result.runs[0]?.enabled.children_overlap_ms).toBeGreaterThan(0);
		expect(result.runs[0]?.disabled.tokens.total_tokens).toBe(40);
		const deterministicStages = result.runs[0]?.disabled.stages.filter(
			(stage) => stage.execution_mode === "deterministic",
		);
		const deterministicFinal = deterministicStages?.find(
			(stage) => stage.stage === "leader-integrate",
		);
		expect(deterministicFinal).toMatchObject({
			execution_mode: "deterministic",
			execution_ok: true,
			token_accounting_complete: true,
			tokens: {
				input_tokens: 0,
				cached_input_tokens: 0,
				output_tokens: 0,
				total_tokens: 0,
			},
		});
		expect(deterministicStages).toHaveLength(2);
		expect(reviewAuditStageIntegrity(result.runs[0]!.disabled.stages)).toBe(
			true,
		);
		const duplicateAuditStages = structuredClone(
			result.runs[0]!.disabled.stages,
		);
		duplicateAuditStages.push(
			structuredClone(
				duplicateAuditStages.find((stage) => stage.stage === "review-audit")!,
			),
		);
		expect(reviewAuditStageIntegrity(duplicateAuditStages)).toBe(false);
		const corruptAuditStages = structuredClone(result.runs[0]!.disabled.stages);
		const corruptAudit = corruptAuditStages.find(
			(stage) => stage.stage === "review-audit",
		)!;
		corruptAudit.tokens.total_tokens = 1;
		expect(reviewAuditStageIntegrity(corruptAuditStages)).toBe(false);
		const malformedAuditStages = structuredClone(
			result.runs[0]!.disabled.stages,
		);
		const malformedAudit = malformedAuditStages.find(
			(stage) => stage.stage === "review-audit",
		)!;
		delete malformedAudit.review_audit_summary!.oracle_digest;
		expect(reviewAuditStageIntegrity(malformedAuditStages)).toBe(false);
		for (const stage of deterministicStages ?? []) {
			expect(stage.elapsed_ms).toBeGreaterThanOrEqual(0);
			expect(stage.input_bytes).toBeGreaterThan(0);
			expect(stage.end_offset_ms).toBeGreaterThanOrEqual(stage.start_offset_ms);
			expect(stage.tokens).toEqual({
				input_tokens: 0,
				cached_input_tokens: 0,
				output_tokens: 0,
				total_tokens: 0,
			});
		}
		expect(result.runs.map((r) => r.order[0])).toEqual([
			"disabled",
			"enabled",
			"disabled",
		]);
		expect(result.harness_validity.ok).toBe(true);
		for (const reviewerPrompt of [
			disabledReviewerPrompt,
			enabledReviewerPrompt,
		]) {
			expect(reviewerPrompt).toContain("<authoritative-truth bytes=");
			expect(reviewerPrompt).toContain("<child-reports bytes=");
			expect(reviewerPrompt).toContain("do not read files or run commands");
			expect(reviewerPrompt).not.toContain("Read CONTEXT.md");
			expect(reviewerPrompt).not.toContain("CHILD_REPORTS.json");
			for (const name of ["authoritative-truth", "child-reports"]) {
				const frame = reviewerPrompt.match(
					new RegExp(
						`<${name} bytes="([0-9]+)">\\n([\\s\\S]+?)\\n<\\/${name}>`,
						"u",
					),
				);
				expect(frame).toBeTruthy();
				expect(Buffer.byteLength(frame![2]!, "utf8")).toBe(Number(frame![1]));
			}
		}
		expect(disabledChildPrompt).toContain("<authoritative-payload bytes=");
		expect(disabledChildPrompt).toContain("# Legacy parallel handoff");
		expect(enabledChildPrompt).toContain("<authoritative-payload bytes=");
		expect(enabledChildPrompt).toContain("anamnesis.work-execution-packet.v1");
		expect(enabledChildPrompt).not.toContain("Read CHILD_A.md");
		const inline = enabledChildPrompt.match(
			/<authoritative-payload bytes="([0-9]+)">\n([\s\S]+?)\n<\/authoritative-payload>/u,
		);
		expect(inline).toBeTruthy();
		expect(Buffer.byteLength(inline![2]!, "utf8")).toBe(Number(inline![1]));
		const packet = JSON.parse(inline![2]!) as { requirements: string[] };
		expect(packet.requirements).toEqual([
			'REQ-A|verified|"sanitized parallel condition 1"',
			'REQ-B|verified|"sanitized parallel condition 2"',
		]);
		expect(result.comparison.verdict).toBe("INCONCLUSIVE");
		expect(result.quality.enabled_ready).toBe(true);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("keeps review audit out of the reviewer model contract", async () => {
		const root = tempRoot();
		let reviewerSchema = "";
		const observingRunner: ParallelRunner = async (request) => {
			if (request.prompt.includes("[parallel-stage:reviewer]")) {
				reviewerSchema = fs.readFileSync(request.outputSchemaPath, "utf8");
			}
			return runner()(request);
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: observingRunner,
			requirements: REQUIREMENTS,
		});
		const schema = JSON.parse(reviewerSchema) as {
			properties: Record<string, unknown>;
		};
		expect(schema.properties).toEqual({ requirements: expect.any(Object) });
		expect(result.runs[0]?.disabled.review_audit_oracle_exact).toBe(true);
		expect(
			result.runs[0]?.disabled.stages.filter(
				(stage) => stage.execution_mode === "deterministic",
			),
		).toHaveLength(2);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("retains process defects when reviewer repair succeeds without excluding the run", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ wrong: true }),
			requirements: REQUIREMENTS,
		});
		expect(result.ok).toBe(true);
		expect(result.summary.disabled.process_perfect_pct).toBe(0);
		expect(result.harness_validity.checks.no_excluded_conditions).toBe(true);
		expect(result.quality.disabled_passes).toBe(3);
		expect(result.quality.enabled_passes).toBe(3);
		expect(result.summary.disabled.final_accuracy_pct).toBe(100);
		expect(result.comparison.verdict).toBe("INCONCLUSIVE");
		expect(
			result.runs[0]?.disabled.stages.find(
				(stage) => stage.stage === "reviewer",
			)?.output_correct,
		).toBe(true);
		fs.rmSync(root, { recursive: true, force: true });
	});
});
