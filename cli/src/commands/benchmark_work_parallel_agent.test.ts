import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	auditParallelReviewConsistency,
	type ParallelRequirement,
	type ParallelRunner,
	publishParallelArtifacts,
	workParallelAgentBenchmark,
} from "./benchmark_work_parallel_agent.js";

const REQUIREMENTS: ParallelRequirement[] = [
	"REQ-A",
	"REQ-B",
	"REQ-C",
	"REQ-D",
].map((id, index) => ({
	id,
	status: index === 3 ? "pending" : "verified",
	summary: `sanitized parallel condition ${index + 1}`,
}));

function tempRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "parallel-agent-test-"));
}
function output(
	data: Record<string, unknown>,
	tokens = 10,
	usage?: Record<string, unknown>,
): string {
	return `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(data) } })}\n${JSON.stringify({ type: "turn.completed", usage: usage ?? { input_tokens: tokens - 2, cached_input_tokens: 0, output_tokens: 2, total_tokens: tokens } })}`;
}
function runner(
	opts: {
		childAContainer?: "missing" | "null" | "scalar";
		malformedOutputRows?: boolean;
		malformedUsage?: boolean;
		overlap?: boolean;
		repairFinal?: boolean;
		reviewerDuplicateFirst?: boolean;
		reviewerOmitLast?: boolean;
		reviewerReverse?: boolean;
		wrong?: boolean;
		wrongPlan?: boolean;
		wrongDisabledIterations?: number[];
		wrongEnabledIterations?: number[];
		reviewerWrongDisabledIterations?: number[];
		reviewerWrongEnabledIterations?: number[];
	} = {},
): ParallelRunner {
	let active = 0;
	let sawOverlap = false;
	return async (request) => {
		const stage = request.prompt.match(/\[parallel-stage:([^\]]+)/u)?.[1];
		const fixture = path
			.basename(request.cwd)
			.match(/^(\d+)-(disabled|enabled)$/u);
		const iteration = Number(fixture?.[1]);
		const condition = fixture?.[2];
		const wrong =
			opts.wrong === true ||
			(condition === "disabled" &&
				opts.wrongDisabledIterations?.includes(iteration) === true) ||
			(condition === "enabled" &&
				opts.wrongEnabledIterations?.includes(iteration) === true);
		const reviewerWrong =
			opts.reviewerOmitLast === true ||
			(condition === "disabled" &&
				opts.reviewerWrongDisabledIterations?.includes(iteration) === true) ||
			(condition === "enabled" &&
				opts.reviewerWrongEnabledIterations?.includes(iteration) === true);
		active += 1;
		if (active > 1) sawOverlap = true;
		await new Promise((resolve) =>
			setTimeout(
				resolve,
				opts.overlap === false
					? 0
					: stage === "child-a"
						? 12
						: stage === "child-b"
							? 6
							: 1,
			),
		);
		active -= 1;
		const ids = ["REQ-A", "REQ-B", "REQ-C", "REQ-D"];
		let data: Record<string, unknown>;
		const req = (id: string) => ({
			id,
			status: id === "REQ-D" ? "pending" : "verified",
			summary: `sanitized parallel condition ${ids.indexOf(id) + 1}`,
		});
		if (stage === "leader-plan")
			data = opts.wrongPlan
				? { child_a: ids.slice(2), child_b: ids.slice(0, 2) }
				: { child_a: ids.slice(0, 2), child_b: ids.slice(2) };
		else if (stage === "child-a") {
			if (opts.childAContainer === "missing") data = {};
			else if (opts.childAContainer === "null") data = { requirements: null };
			else if (opts.childAContainer === "scalar")
				data = { requirements: "not-an-array" };
			else
				data = {
					requirements: [
						...(wrong ? [ids[0]] : ids.slice(0, 2)).map(req),
						...(opts.malformedOutputRows ? [null, 7, []] : []),
					],
				};
		} else if (stage === "child-b")
			data = { requirements: ids.slice(2).map(req) };
		else if (stage === "reviewer") {
			const reviewerIds = reviewerWrong ? ids.slice(0, -1) : ids;
			const reviewerRequirements = reviewerIds.map(req);
			if (opts.reviewerDuplicateFirst) reviewerRequirements.push(req(ids[0]!));
			if (opts.reviewerReverse) reviewerRequirements.reverse();
			data = {
				requirements: [
					...reviewerRequirements,
					...(opts.malformedOutputRows ? [null, 7, []] : []),
				],
			};
		} else
			data = {
				requirements: [
					...(wrong && !opts.repairFinal ? ids.slice(0, 3) : ids).map(req),
					...(opts.malformedOutputRows ? [null, 7, []] : []),
				],
			};
		return {
			status: 0,
			stdout: opts.malformedUsage
				? `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(data) } })}\n${JSON.stringify({ type: "turn.completed", usage: {} })}`
				: output(data),
			stderr: sawOverlap ? "" : "",
			elapsedMs: 1,
		};
	};
}

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
		expect(result.schema_version).toBe("anamnesis.work_parallel_agent_ab.v7");
		expect(result.runs).toHaveLength(9);
		expect(result.planned_initial_invocations).toBe(72);
		expect(result.actual_invocations).toBe(72);
		expect(result.harness_validity.checks.no_hidden_model_calls).toBe(true);
		expect(result.harness_validity.checks.deterministic_stage_integrity).toBe(
			true,
		);
		expect(result.harness_validity.ok).toBe(true);
		expect(result.quality.enabled_passes).toBe(9);
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

	it("refuses an unrecorded or uncommitted claim-eligible final run", async () => {
		const root = tempRoot();
		await expect(
			workParallelAgentBenchmark({
				projectRoot: root,
				protocol: "final",
				runner: runner(),
			}),
		).rejects.toThrow(/requires the real Codex runner/iu);
		await expect(
			workParallelAgentBenchmark({
				projectRoot: root,
				protocol: "final",
				scenarioFamilies: ["clean-partition"],
			}),
		).rejects.toThrow(/scenario families cannot override/iu);
		await expect(
			workParallelAgentBenchmark({ projectRoot: root, protocol: "final" }),
		).rejects.toThrow(/requires --write/iu);
		await expect(
			workParallelAgentBenchmark({
				projectRoot: root,
				protocol: "final",
				write: true,
			}),
		).rejects.toThrow(/requires a Git commit/iu);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("requires a committed clean worktree for a paid shadow run", async () => {
		const root = tempRoot();
		await expect(
			workParallelAgentBenchmark({
				projectRoot: root,
				protocol: "shadow",
				runner: runner(),
			}),
		).rejects.toThrow(/requires the real Codex runner/iu);
		await expect(
			workParallelAgentBenchmark({ projectRoot: root, protocol: "shadow" }),
		).rejects.toThrow(/requires a Git commit/iu);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("runs child stages concurrently and aggregates four model stages plus two deterministic stages", async () => {
		const root = tempRoot();
		let runnerCalls = 0;
		let disabledReviewerPrompt = "";
		let disabledChildPrompt = "";
		let enabledChildPrompt = "";
		const baseRunner = runner();
		const observingRunner: ParallelRunner = async (request) => {
			runnerCalls += 1;
			expect(request.prompt).not.toContain("[parallel-stage:leader-integrate]");
			expect(request.prompt).not.toContain("[parallel-stage:review-audit]");
			if (
				request.cwd.endsWith("-disabled") &&
				request.prompt.includes("[parallel-stage:reviewer]")
			) {
				disabledReviewerPrompt = request.prompt;
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
		expect(disabledReviewerPrompt).toContain(
			"Read CONTEXT.md (legacy context) as authoritative truth",
		);
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
		expect(result.runs[0]?.disabled.review_audit_exact).toBe(true);
		expect(
			result.runs[0]?.disabled.stages.filter(
				(stage) => stage.execution_mode === "deterministic",
			),
		).toHaveLength(2);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("fails validity when a stage is incorrect without excluding the run", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ wrong: true }),
			requirements: REQUIREMENTS,
		});
		expect(result.ok).toBe(true);
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

	it("counts a reviewer-repaired final result as product success while retaining process defects", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ wrong: true, repairFinal: true }),
			requirements: REQUIREMENTS,
		});
		expect(result.quality.disabled_passes).toBe(3);
		expect(result.quality.enabled_passes).toBe(3);
		expect(result.summary.disabled.process_perfect_pct).toBe(0);
		expect(result.summary.disabled.final_accuracy_pct).toBe(100);
		expect(result.comparison.verdict).toBe("INCONCLUSIVE");
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("fails token-accounting validity when a usage event is malformed", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ malformedUsage: true }),
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.checks.full_token_accounting).toBe(false);
		expect(result.harness_validity.ok).toBe(false);
		expect(result.runs[0]?.disabled.token_accounting_complete).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("derives total tokens from current Codex usage events", async () => {
		const root = tempRoot();
		const currentUsageRunner: ParallelRunner = async (request) => {
			const result = await runner()(request);
			return {
				...result,
				stdout: result.stdout.replace(/,"total_tokens":10/gu, ""),
			};
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: currentUsageRunner,
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.checks.full_token_accounting).toBe(true);
		expect(result.runs[0]?.disabled.tokens.total_tokens).toBe(40);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("rejects an explicitly malformed or inconsistent total token field", async () => {
		for (const total of [null, 11]) {
			const root = tempRoot();
			const incompatibleUsageRunner: ParallelRunner = async (request) => {
				const result = await runner()(request);
				return {
					...result,
					stdout: result.stdout.replace(
						/"total_tokens":10/gu,
						`"total_tokens":${JSON.stringify(total)}`,
					),
				};
			};
			const result = await workParallelAgentBenchmark({
				projectRoot: root,
				runs: 3,
				runner: incompatibleUsageRunner,
				requirements: REQUIREMENTS,
			});
			expect(result.harness_validity.checks.full_token_accounting).toBe(false);
			fs.rmSync(root, { recursive: true, force: true });
		}
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
	});

	it("preserves non-array child containers as malformed process defects", async () => {
		for (const childAContainer of ["null", "scalar", "missing"] as const) {
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
			expect(first.review_audit_exact).toBe(true);
			expect(first.product_pass).toBe(true);
			expect(result.summary.disabled.process_perfect_pct).toBe(0);
			fs.rmSync(root, { recursive: true, force: true });
		}
	}, 15_000);

	it("invalidates comparison when deterministic audit detects reviewer omission", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ reviewerWrongDisabledIterations: [1, 2] }),
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.ok).toBe(false);
		expect(result.comparison.verdict).toBe("INVALID");
		expect(result.quality.enabled_ready).toBe(true);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("invalidates comparison when enabled reviewer data fails audit", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ reviewerWrongEnabledIterations: [1, 2] }),
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.ok).toBe(false);
		expect(result.ok).toBe(false);
		expect(result.comparison.verdict).toBe("INVALID");
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("does not repair omitted, duplicate, or reordered reviewer requirements", async () => {
		for (const options of [
			{ reviewerOmitLast: true },
			{ reviewerDuplicateFirst: true },
			{ reviewerReverse: true },
		]) {
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
				expect(first.review_audit_exact).toBe(false);
			}
			expect(result.quality.disabled_passes).toBe(0);
			expect(result.quality.enabled_passes).toBe(0);
			fs.rmSync(root, { recursive: true, force: true });
		}
	}, 15_000);

	it("publishes atomically and rejects escaping or symlink destinations", () => {
		const root = tempRoot();
		const result = {
			project_root: root,
			artifacts: {},
			markdown: "safe",
			model: "test<&>",
			runs_per_condition: 1,
			harness_validity: { ok: true, checks: {} },
			summary: {
				disabled: { total_tokens: 10, final_accuracy_pct: 100 },
				enabled: { total_tokens: 9, final_accuracy_pct: 100 },
				delta: { total_tokens_pct: -10, critical_path_pct: 5 },
				paired: {
					total_tokens_pct_p50: -10,
					critical_path_pct_p50: 5,
				},
			},
			quality: {
				enabled_ready: true,
				disabled_passes: 1,
				enabled_passes: 1,
				total_per_condition: 1,
			},
			comparison: {
				verdict: "INCONCLUSIVE",
				delta_points: 0,
			},
		} as Parameters<typeof publishParallelArtifacts>[0];
		const artifacts = publishParallelArtifacts(result);
		expect(fs.existsSync(path.join(root, artifacts.json!))).toBe(true);
		const artifactPaths = [
			artifacts.markdown!,
			artifacts.summary_svg!,
			artifacts.json!,
		];
		const original = artifactPaths.map((relativePath) =>
			fs.readFileSync(path.join(root, relativePath), "utf8"),
		);
		expect(original[1]).toContain("Work A/B benchmark");
		expect(original[1]).toContain("product verdict INCONCLUSIVE");
		expect(original[1]).toContain("Stage token gate");
		expect(original[1]).not.toContain("directional verdict");
		let renames = 0;
		expect(() =>
			publishParallelArtifacts(
				{ ...result, markdown: "replacement" },
				undefined,
				{
					renameSync: (from, to) => {
						renames += 1;
						if (renames === 2) throw new Error("injected publish failure");
						fs.renameSync(from, to);
					},
					rmSync: fs.rmSync,
				},
			),
		).toThrow(/injected publish failure/iu);
		expect(
			artifactPaths.map((relativePath) =>
				fs.readFileSync(path.join(root, relativePath), "utf8"),
			),
		).toEqual(original);
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), "parallel-outside-"));
		expect(() =>
			publishParallelArtifacts(result, "../parallel-outside"),
		).toThrow(/escapes/iu);
		const link = path.join(root, "link");
		fs.symlinkSync(outside, link, "dir");
		expect(() => publishParallelArtifacts(result, "link")).toThrow(/symlink/iu);
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	});

	it("fails closed if the private staging directory changes during publication", () => {
		const root = tempRoot();
		const outside = fs.mkdtempSync(
			path.join(os.tmpdir(), "parallel-stage-race-"),
		);
		const result = {
			project_root: root,
			artifacts: {},
			markdown: "safe",
			model: "test",
			runs_per_condition: 1,
			harness_validity: { ok: true, checks: {} },
			summary: {
				disabled: { total_tokens: 10, final_accuracy_pct: 100 },
				enabled: { total_tokens: 9, final_accuracy_pct: 100 },
				delta: { total_tokens_pct: -10, critical_path_pct: 5 },
				paired: {
					total_tokens_pct_p50: -10,
					critical_path_pct_p50: 5,
				},
			},
			quality: {
				enabled_ready: true,
				disabled_passes: 1,
				enabled_passes: 1,
				total_per_condition: 1,
			},
			comparison: {
				verdict: "INCONCLUSIVE",
				delta_points: 0,
			},
		} as Parameters<typeof publishParallelArtifacts>[0];
		let replaced = false;
		expect(() =>
			publishParallelArtifacts(result, undefined, {
				renameSync: (from, to) => {
					fs.renameSync(from, to);
					if (replaced) return;
					replaced = true;
					const stagedDir = path.dirname(from);
					fs.renameSync(stagedDir, `${stagedDir}.moved`);
					fs.symlinkSync(outside, stagedDir, "dir");
				},
				rmSync: fs.rmSync,
			}),
		).toThrow(/artifact publish failed|changed during publication/iu);
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	});
});
