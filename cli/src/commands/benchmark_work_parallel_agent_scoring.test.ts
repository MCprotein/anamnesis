import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
	auditParallelReviewConsistency,
	countFinalRequirementDefects,
	type ParallelRunner,
	workParallelAgentBenchmark,
} from "./benchmark_work_parallel_agent.js";
import {
	REQUIREMENTS,
	runner,
	tempRoot,
} from "./benchmark_work_parallel_agent.test-support.js";

describe("parallel review audit", () => {
	const cleanChildA = REQUIREMENTS.slice(0, 2);
	const cleanChildB = REQUIREMENTS.slice(2);
	const emptyIssues = {
		missingIds: [],
		duplicateIds: [],
		unexpectedIds: [],
		misassignedIds: [],
		statusMismatchIds: [],
		summaryMismatchIds: [],
		malformedRows: 0,
		orderOk: true,
	};
	const cases: Array<{
		name: string;
		childA: unknown;
		childB: unknown;
		expected: Partial<typeof emptyIssues>;
	}> = [
		{ name: "clean", childA: cleanChildA, childB: cleanChildB, expected: {} },
		{
			name: "omission",
			childA: [cleanChildA[0]],
			childB: cleanChildB,
			expected: { missingIds: ["REQ-B"], orderOk: false },
		},
		{
			name: "duplicate",
			childA: [cleanChildA[0], cleanChildA[0], cleanChildA[1]],
			childB: cleanChildB,
			expected: { duplicateIds: ["REQ-A"], orderOk: false },
		},
		{
			name: "unexpected",
			childA: [
				...cleanChildA,
				{ id: "REQ-X", status: "pending", summary: "unexpected" },
			],
			childB: cleanChildB,
			expected: { unexpectedIds: ["REQ-X"], orderOk: false },
		},
		{
			name: "misassignment",
			childA: [cleanChildA[0]],
			childB: [cleanChildA[1], ...cleanChildB],
			expected: { misassignedIds: ["REQ-B"], orderOk: false },
		},
		{
			name: "status mismatch",
			childA: [{ ...cleanChildA[0], status: "pending" }, cleanChildA[1]],
			childB: cleanChildB,
			expected: { statusMismatchIds: ["REQ-A"] },
		},
		{
			name: "summary mismatch",
			childA: [cleanChildA[0], { ...cleanChildA[1], summary: "stale" }],
			childB: cleanChildB,
			expected: { summaryMismatchIds: ["REQ-B"] },
		},
		{
			name: "malformed row",
			childA: [...cleanChildA, null],
			childB: cleanChildB,
			expected: { malformedRows: 1 },
		},
		{
			name: "wrong order",
			childA: [cleanChildA[1], cleanChildA[0]],
			childB: cleanChildB,
			expected: { orderOk: false },
		},
		...([null, "not-an-array", undefined] as unknown[]).map(
			(childA, index) => ({
				name: ["null container", "scalar container", "missing container"][
					index
				]!,
				childA,
				childB: cleanChildB,
				expected: {
					missingIds: ["REQ-A", "REQ-B"],
					malformedRows: 1,
					orderOk: false,
				},
			}),
		),
	];

	for (const testCase of cases) {
		it(`detects ${testCase.name} without mutating inputs`, () => {
			const input = {
				reviewerRequirements: structuredClone(REQUIREMENTS),
				childA: structuredClone(testCase.childA),
				childB: structuredClone(testCase.childB),
				childAAssignment: ["REQ-A", "REQ-B"],
				childBAssignment: ["REQ-C", "REQ-D"],
			};
			const before = JSON.stringify(input);
			const result = auditParallelReviewConsistency(input);
			expect(result).toEqual({
				verdict: testCase.name === "clean" ? "accept" : "repair",
				...emptyIssues,
				...testCase.expected,
			});
			expect(JSON.stringify(input)).toBe(before);
		});
	}
});

describe("real parallel-agent benchmark", () => {
	it("counts every missing expected requirement as a final defect", () => {
		expect(
			countFinalRequirementDefects({
				expectedRequirements: 48,
				exactRequirements: 1,
				unexpectedRows: 0,
				duplicateIds: 0,
			}),
		).toBe(47);
		expect(
			countFinalRequirementDefects({
				expectedRequirements: 4,
				exactRequirements: 3,
				unexpectedRows: 2,
				duplicateIds: 1,
			}),
		).toBe(4);
	});

	it("rejects null, scalar, and nested-array rows at every scored stage", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ malformedOutputRows: true }),
			requirements: REQUIREMENTS,
		});
		const first = result.runs[0]!.disabled;
		for (const stageName of ["child-a", "reviewer", "leader-integrate"]) {
			const stage = first.stages.find((record) => record.stage === stageName);
			expect(stage?.output_correct).toBe(false);
			expect(stage?.malformed_requirement_rows).toBe(3);
			expect(stage?.unexpected_requirement_rows).toBe(3);
		}
		expect(
			first.stages.find((stage) => stage.stage === "leader-integrate")
				?.execution_mode,
		).toBe("deterministic");
		expect(result.quality.disabled_passes).toBe(0);
		expect(result.quality.enabled_passes).toBe(0);
		fs.rmSync(root, { recursive: true, force: true });
	}, 10_000);

	it.each(["null", "scalar", "missing"] as const)(
		"preserves non-array child containers as malformed process defects: %s",
		async (childAContainer) => {
			const root = tempRoot();
			const result = await workParallelAgentBenchmark({
				projectRoot: root,
				runs: 3,
				runner: runner({ childAContainer }),
				requirements: REQUIREMENTS,
			});
			const first = result.runs[0]!.disabled;
			const child = first.stages.find((stage) => stage.stage === "child-a");
			const audit = first.stages.find(
				(stage) => stage.stage === "review-audit",
			);
			expect(child?.malformed_requirement_rows).toBe(1);
			expect(child?.output_correct).toBe(false);
			expect(audit?.review_audit_summary).toMatchObject({
				verdict: "repair",
				malformed_rows: 1,
				order_ok: false,
			});
			expect(first.review_audit_oracle_exact).toBe(true);
			expect(first.product_pass).toBe(true);
			expect(result.summary.disabled.process_perfect_pct).toBe(0);
			fs.rmSync(root, { recursive: true, force: true });
		},
		15_000,
	);

	it("scores disabled reviewer omissions without invalidating the harness", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ reviewerWrongDisabledIterations: [1, 2] }),
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.ok).toBe(true);
		expect(result.comparison.verdict).toBe("PASS_DIRECTIONAL");
		expect(result.quality.enabled_ready).toBe(true);
		expect(result.quality.disabled_review_audit_oracle_exact_passes).toBe(1);
		expect(result.quality.enabled_review_audit_oracle_exact_passes).toBe(3);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("scores a disabled invalid reviewer envelope as product failure", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ invalidReviewerEnvelopeCondition: "disabled" }),
			requirements: REQUIREMENTS,
		});
		const reviewer = result.runs[0]!.disabled.stages.find(
			(stage) => stage.stage === "reviewer",
		)!;
		expect(reviewer.execution_ok).toBe(true);
		expect(reviewer.runner_protocol_valid).toBe(true);
		expect(reviewer.output_schema_valid).toBe(false);
		expect(reviewer.output_correct).toBe(false);
		expect(result.harness_validity.ok).toBe(true);
		expect(result.quality.disabled_passes).toBe(0);
		expect(result.quality.enabled_ready).toBe(true);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("invalidates the harness for malformed runner JSONL", async () => {
		const root = tempRoot();
		const baseRunner = runner();
		const malformedJsonlRunner: ParallelRunner = async (request) => {
			const response = await baseRunner(request);
			return request.cwd.endsWith("-disabled") &&
				request.prompt.includes("[parallel-stage:reviewer]")
				? { ...response, stdout: `not-json\n${response.stdout}` }
				: response;
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: malformedJsonlRunner,
			requirements: REQUIREMENTS,
		});
		const reviewer = result.runs[0]!.disabled.stages.find(
			(stage) => stage.stage === "reviewer",
		)!;
		expect(reviewer.execution_ok).toBe(true);
		expect(reviewer.runner_protocol_valid).toBe(false);
		expect(reviewer.output_schema_valid).toBe(false);
		expect(reviewer.error).toBe("codex-runner-protocol-invalid");
		expect(result.harness_validity.checks.runner_protocol_integrity).toBe(
			false,
		);
		expect(result.harness_validity.ok).toBe(false);
		expect(result.quality.disabled_passes).toBe(0);
		expect(result.quality.enabled_ready).toBe(true);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("fails enabled quality without misclassifying it as a harness failure", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ reviewerWrongEnabledIterations: [1, 2] }),
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.ok).toBe(true);
		expect(result.comparison.verdict).toBe("FAIL_REGRESSION");
		expect(result.quality.enabled_ready).toBe(false);
		expect(result.quality.enabled_review_audit_oracle_exact_passes).toBe(1);
		expect(result.evaluation.enabled_quality_pass).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it.each([
		{ case: "omitted", options: { reviewerOmitLast: true } },
		{ case: "duplicate", options: { reviewerDuplicateFirst: true } },
		{ case: "reordered", options: { reviewerReverse: true } },
	])(
		"does not repair omitted, duplicate, or reordered reviewer requirements: $case",
		async ({ options }) => {
			const root = tempRoot();
			const result = await workParallelAgentBenchmark({
				projectRoot: root,
				runs: 3,
				runner: runner(options),
				requirements: REQUIREMENTS,
			});
			const first = result.runs[0]!.disabled;
			const reviewer = first.stages.find((stage) => stage.stage === "reviewer");
			const final = first.stages.find(
				(stage) => stage.stage === "leader-integrate",
			);
			expect(final?.execution_mode).toBe("deterministic");
			expect(final?.output_correct).toBe(false);
			expect(final?.exact_requirements).toBe(reviewer?.exact_requirements);
			expect(final?.duplicate_requirement_ids).toBe(
				reviewer?.duplicate_requirement_ids,
			);
			expect(first.product_pass).toBe(false);
			if ("reviewerOmitLast" in options) {
				expect(first.review_audit_oracle_exact).toBe(false);
				expect(first.final_defects).toBe(1);
			}
			expect(result.quality.disabled_passes).toBe(0);
			expect(result.quality.enabled_passes).toBe(0);
			fs.rmSync(root, { recursive: true, force: true });
		},
		15_000,
	);
});
