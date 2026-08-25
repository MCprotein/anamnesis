import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	aggregateWorkAgentRuns,
	analyzePairedRuns,
	evaluateWorkAgentContract,
	parseCodexJsonl,
	publishWorkAgentBenchmarkArtifacts,
	WORK_AGENT_AB_BENCHMARK_OUTPUT_DIR,
	type WorkAgentAnswer,
	type WorkAgentRunner,
	type WorkAgentScenarioRun,
	workAgentBenchmark,
} from "./benchmark_work_agent.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function root(): string {
	const value = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-work-agent-ab-test-"),
	);
	roots.push(value);
	return value;
}

function jsonl(answer: WorkAgentAnswer, totalTokens = 100): string {
	return [
		JSON.stringify({
			type: "item.completed",
			item: { type: "agent_message", text: JSON.stringify(answer) },
		}),
		JSON.stringify({
			type: "turn.completed",
			usage: {
				input_tokens: totalTokens - 20,
				cached_input_tokens: 10,
				output_tokens: 20,
				total_tokens: totalTokens,
			},
		}),
	].join("\n");
}

function fakeRunner(
	prompts: string[],
	contexts: Array<{ cwd: string; content: string }> = [],
): WorkAgentRunner {
	return (request) => {
		prompts.push(request.prompt);
		const context = fs.readFileSync(path.join(request.cwd, "CONTEXT.md"), "utf8");
		contexts.push({ cwd: request.cwd, content: context });
		const rows = new Map<
			string,
			{ status: "verified" | "pending"; summary: string }
		>();
		for (const match of context.matchAll(
			/Requirement (REQ-[A-Z0-9]+): (.*?)\. Current status: (verified|pending)\./gu,
		)) {
			rows.set(match[1]!, {
				summary: match[2]!,
				status: match[3] as "verified" | "pending",
			});
		}
		const sharedPrefixMatch = context.match(/^Shared summary prefix: (.+)$/mu);
		const sharedPrefix = sharedPrefixMatch
			? (JSON.parse(sharedPrefixMatch[1]!) as string)
			: "";
		for (const match of context.matchAll(
			/^(REQ-[A-Z0-9]+)\|(verified|pending)\|(.+)$/gmu,
		)) {
			rows.set(match[1]!, {
				status: match[2] as "verified" | "pending",
				summary: sharedPrefix + (JSON.parse(match[3]!) as string),
			});
		}
		const enabled = request.cwd.endsWith("-enabled");
		if (enabled) {
			expect(context).toContain("Authoritative completeness:");
			expect(context).toContain("Current requirements:");
		}
		const gateBlocked = context.includes("completion_gate: blocked") ||
			context.includes("Required completion gates:") ||
			context.includes("Configured required review gates (not proof of satisfaction): completion");
		return {
			status: 0,
			stdout: jsonl(
				{
					completion_status: "incomplete",
					gate_blocked: gateBlocked,
					requirements: [...rows].map(([id, requirement]) => ({
						id,
						...requirement,
					})),
					reminder_or_reexplanation_requests: enabled ? 0 : 1,
				},
				enabled ? 95 : 100,
			),
			stderr: "",
			elapsedMs: enabled ? 9 : 10,
		};
	};
}

describe("Work agent A/B benchmark", () => {
	it("parses the final answer and turn.completed token usage", () => {
		const parsed = parseCodexJsonl(
			jsonl({
				completion_status: "incomplete",
				gate_blocked: true,
				requirements: [
					{ id: "REQ-X", status: "pending", summary: "requirement x" },
				],
				reminder_or_reexplanation_requests: 2,
			}),
		);

		expect(parsed).toEqual({
			answer: {
				completion_status: "incomplete",
				gate_blocked: true,
				requirements: [
					{ id: "REQ-X", status: "pending", summary: "requirement x" },
				],
				reminder_or_reexplanation_requests: 2,
			},
			usage: {
				input_tokens: 80,
				cached_input_tokens: 10,
				output_tokens: 20,
				total_tokens: 100,
			},
		});
	});

	it("aggregates paired metrics and alternates condition order", () => {
		const prompts: string[] = [];
		const contexts: Array<{ cwd: string; content: string }> = [];
		const plans: Array<{ runs: number; scenarios: number; invocations: number }> = [];
		const projectRoot = root();
		const outputDir = path.join(projectRoot, "evidence");
		fs.mkdirSync(outputDir, { recursive: true });
		fs.writeFileSync(path.join(outputDir, "work-agent-ab.json"), "old json");
		fs.writeFileSync(path.join(outputDir, "README.md"), "old markdown");
		const result = workAgentBenchmark({
			projectRoot,
			runs: 3,
			model: "test-model",
			runner: fakeRunner(prompts, contexts),
			onPlan: (plan) => plans.push(plan),
			write: true,
			outputPath: "evidence",
		});

		expect(result.planned_invocations).toBe(36);
		expect(plans).toEqual([{ runs: 3, scenarios: 6, invocations: 36 }]);
		expect(prompts).toHaveLength(42);
		expect(new Set(prompts)).toHaveLength(2);
		expect(result.actual_invocations).toBe(42);
		expect(result.scenario_classes).toEqual({
			equal_information: [
				"perfect-handoff",
				"delegation-review",
				"requirement-scale-100",
			],
			resilience: [
				"bounded-loss",
				"stale-conflict",
				"multi-session-handoff",
			],
		});
		expect(result.runs[0]!.order).not.toEqual(result.runs[6]!.order);
		expect(result.summary.enabled).toMatchObject({
			execution_success_pct: 100,
			completion_correct_pct: 100,
			gate_correct_pct: 100,
			requirement_recall_pct: 100,
			status_recall_pct: 100,
			total_tokens: 95,
			elapsed_ms: 9,
			reminders_or_reexplanations: 0,
		});
		expect(result.summary.disabled.total_tokens).toBe(133.33);
		expect(result.summary.disabled.reminders_or_reexplanations).toBe(0.33);
		expect(aggregateWorkAgentRuns(result.runs)).toEqual(result.summary);
		expect(result.markdown).toContain("## Scenario breakdown");
		expect(result.markdown).toContain("| multi-session-handoff | resilience |");
		expect(result.artifacts.json).toBe("evidence/work-agent-ab.json");
		const artifact = fs.readFileSync(
			path.join(result.project_root, result.artifacts.json!),
			"utf8",
		);
		expect(JSON.parse(artifact).artifacts).toEqual({
			output_dir: ".",
			json: "work-agent-ab.json",
			markdown: "README.md",
		});
		expect(
			fs
				.readdirSync(path.join(result.project_root, "evidence"))
				.filter((name) => name.startsWith(".work-agent-ab-publish-")),
		).toEqual([]);
		expect(artifact).not.toContain("Resume this sanitized project");
		expect(artifact).not.toContain("CONTEXT.md");
		const enabledMultiSession = contexts.find((item) =>
			item.cwd.includes("multi-session-handoff-1-enabled"),
		);
		expect(enabledMultiSession?.content).toContain(
			"Authoritative completeness: all current requirements follow",
		);
		expect(enabledMultiSession?.content).toContain(
			'Shared summary prefix: "sanitized acceptance condition 0"',
		);
		expect(enabledMultiSession?.content).toMatch(
			/REQ-[A-Z0-9]+\|(verified|pending)\|"\d{2}"/u,
		);
		expect(enabledMultiSession?.content.length).toBeLessThan(4_000);
	}, 30_000);

	it("does not publish either artifact when a destination is invalid", () => {
		const projectRoot = root();
		const outputDir = path.join(projectRoot, "evidence");
		fs.mkdirSync(outputDir, { recursive: true });
		fs.symlinkSync(
			path.join(outputDir, "missing-target.json"),
			path.join(outputDir, "work-agent-ab.json"),
		);
		const sentinel = "existing markdown";
		fs.writeFileSync(path.join(outputDir, "README.md"), sentinel);

		expect(() =>
			workAgentBenchmark({
				projectRoot,
				runs: 3,
				model: "test-model",
				runner: fakeRunner([]),
				write: true,
				outputPath: "evidence",
			}),
		).toThrow("artifact destination is not a regular file");
		expect(fs.readFileSync(path.join(outputDir, "README.md"), "utf8")).toBe(
			sentinel,
		);
		expect(
			fs
				.readdirSync(outputDir)
				.filter((name) => name.startsWith(".work-agent-ab-publish-")),
		).toEqual([]);
	}, 30_000);

	it("tracks a successful rename before post-publish identity validation", () => {
		const projectRoot = root();
		const outputDir = path.join(projectRoot, "evidence");
		fs.mkdirSync(outputDir, { recursive: true });
		fs.writeFileSync(path.join(outputDir, "work-agent-ab.json"), "old json");
		fs.writeFileSync(path.join(outputDir, "README.md"), "old markdown");

		expect(() =>
			workAgentBenchmark({
				projectRoot,
				runs: 3,
				model: "test-model",
				runner: fakeRunner([]),
				write: true,
				outputPath: "evidence",
				artifactOperations: {
					renameSync: (source, destination) => {
						fs.renameSync(source, destination);
						if (
							destination.endsWith("README.md") &&
							source.includes(".candidate-")
						) {
							fs.rmSync(destination);
						}
					},
					rmSync: fs.rmSync,
				},
			}),
		).toThrow("rollback was incomplete; recovery files preserved");
		const recoveryDirs = fs
			.readdirSync(outputDir)
			.filter((name) => name.startsWith(".work-agent-ab-publish-"));
		expect(recoveryDirs).toHaveLength(1);
		expect(
			fs.readdirSync(path.join(outputDir, recoveryDirs[0]!)),
		).toContain("README.md.previous-0");
	}, 30_000);

	it("restores the first artifact when the second atomic replacement fails", () => {
		const projectRoot = root();
		const outputDir = path.join(projectRoot, "evidence");
		fs.mkdirSync(outputDir, { recursive: true });
		fs.writeFileSync(path.join(outputDir, "work-agent-ab.json"), "old json");
		fs.writeFileSync(path.join(outputDir, "README.md"), "old markdown");

		expect(() =>
			workAgentBenchmark({
				projectRoot,
				runs: 3,
				model: "test-model",
				runner: fakeRunner([]),
				write: true,
				outputPath: "evidence",
				artifactOperations: {
					renameSync: (source, destination) => {
						if (
							destination.endsWith("work-agent-ab.json") &&
							source.includes(".candidate-")
						) {
							throw new Error("injected JSON publish failure");
						}
						fs.renameSync(source, destination);
					},
					rmSync: fs.rmSync,
				},
			}),
		).toThrow("injected JSON publish failure");
		expect(fs.readFileSync(path.join(outputDir, "work-agent-ab.json"), "utf8")).toBe(
			"old json",
		);
		expect(fs.readFileSync(path.join(outputDir, "README.md"), "utf8")).toBe(
			"old markdown",
		);
		expect(
			fs
				.readdirSync(outputDir)
				.filter((name) => name.startsWith(".work-agent-ab-publish-")),
		).toEqual([]);
	}, 30_000);

	it("preserves recovery files when publication and rollback both fail", () => {
		const projectRoot = root();
		const outputDir = path.join(projectRoot, "evidence");
		fs.mkdirSync(outputDir, { recursive: true });
		fs.writeFileSync(path.join(outputDir, "work-agent-ab.json"), "old json");
		fs.writeFileSync(path.join(outputDir, "README.md"), "old markdown");

		expect(() =>
			workAgentBenchmark({
				projectRoot,
				runs: 3,
				model: "test-model",
				runner: fakeRunner([]),
				write: true,
				outputPath: "evidence",
				artifactOperations: {
					renameSync: (source, destination) => {
						if (
							(destination.endsWith("work-agent-ab.json") &&
								source.includes(".candidate-")) ||
							source.includes(".previous-0")
						) {
							throw new Error("injected publish or rollback failure");
						}
						fs.renameSync(source, destination);
					},
					rmSync: fs.rmSync,
				},
			}),
		).toThrow("rollback was incomplete; recovery files preserved");
		const recoveryDirs = fs
			.readdirSync(outputDir)
			.filter((name) => name.startsWith(".work-agent-ab-publish-"));
		expect(recoveryDirs).toHaveLength(1);
		expect(
			fs.readdirSync(path.join(outputDir, recoveryDirs[0]!)),
		).toContain("README.md.previous-0");
	}, 30_000);

	it("fails the evaluator when enabled token cost breaches the contract", () => {
		const condition = {
			runs: 18,
			execution_success_pct: 100,
			elapsed_ms: 100,
			input_tokens: 80,
			cached_input_tokens: 10,
			output_tokens: 20,
			total_tokens: 100,
			completion_correct_pct: 100,
			gate_correct_pct: 100,
			requirement_recall_pct: 100,
			status_recall_pct: 100,
			summary_recall_pct: 100,
			reminders_or_reexplanations: 0,
			reexplained_requirements: 0,
			missed_requirements: 0,
			hallucinated_requirements: 0,
			duplicate_requirement_ids: 0,
		};
		const summary = {
			disabled: condition,
			enabled: condition,
			delta: {
				total_tokens_pct: 0,
				elapsed_pct: 0,
				requirement_recall_points: 0,
				status_recall_points: 0,
				completion_correct_points: 0,
				missed_requirements: 0,
				reminders_or_reexplanations: 0,
			},
		};
		const passing = evaluateWorkAgentContract(summary);
		expect(passing.ok).toBe(true);

		const failing = evaluateWorkAgentContract({
			...summary,
			enabled: { ...summary.enabled, total_tokens: 111 },
		});
		expect(failing.ok).toBe(false);
		expect(failing.checks).toContainEqual(
			expect.objectContaining({ id: "total-token-budget", ok: false }),
		);
	});

	it("enforces at least three repetitions before fixture generation", () => {
		const projectRoot = root();
		expect(() =>
			workAgentBenchmark({ projectRoot, runs: 2, runner: fakeRunner([]) }),
		).toThrow("at least 3");
	});

	it("rejects undersized strict runs before planning or paid model calls", () => {
		const projectRoot = root();
		let planned = false;
		let invoked = false;
		expect(() =>
			workAgentBenchmark({
				projectRoot,
				runs: 3,
				strict: true,
				onPlan: () => {
					planned = true;
				},
				runner: () => {
					invoked = true;
					throw new Error("runner must not be called");
				},
			}),
		).toThrow("--strict requires at least 9 runs");
		expect(planned).toBe(false);
		expect(invoked).toBe(false);
	});

	it("rejects hallucinated and duplicate requirement rows before accepting a correction", () => {
		const baseRunner = fakeRunner([]);
		const runner: WorkAgentRunner = (request) => {
			const response = baseRunner(request);
			if (request.prompt.startsWith("A deterministic oracle rejected")) {
				return response;
			}
			const events = response.stdout.split("\n").map((line) => JSON.parse(line));
			const message = events.find(
				(event) => event.type === "item.completed",
			);
			const answer = JSON.parse(message.item.text) as WorkAgentAnswer;
			answer.requirements.push(answer.requirements[0]!);
			answer.requirements.push({
				id: "REQ-HALLUCINATED",
				status: "verified",
				summary: "not in the authoritative task",
			});
			message.item.text = JSON.stringify(answer);
			return { ...response, stdout: events.map(JSON.stringify).join("\n") };
		};
		const result = workAgentBenchmark({
			projectRoot: root(),
			runs: 3,
			scenarios: ["perfect-handoff"],
			runner,
		});

		expect(result.actual_invocations).toBe(12);
		expect(result.summary.disabled.reminders_or_reexplanations).toBe(1);
		expect(result.summary.enabled.reminders_or_reexplanations).toBe(1);
		expect(result.summary.enabled.hallucinated_requirements).toBe(0);
		expect(result.summary.enabled.duplicate_requirement_ids).toBe(0);
	});

	it("uses paired distributions and strict per-scenario regression gates", () => {
		const runs = [
			...pairedRuns("multi-session-handoff", [-10, -8, -6, -4, -2, 0, 2, 4, 6]),
			...pairedRuns("delegation-review", [-5, -4, -3, -2, -1, 0, 1, 2, 3]),
		];
		const summary = aggregateWorkAgentRuns(runs);
		const analysis = analyzePairedRuns(runs);

		expect(analysis.excluded_model_failures).toBe(0);
		expect(analysis.overall.token_delta_pct).toMatchObject({
			p50: -1.5,
			min: -10,
			max: 6,
		});
		expect(analysis.scenarios[0]?.paired).toMatchObject({
			token_pair_wins: 6,
			pairs: 9,
		});
		expect(evaluateWorkAgentContract(summary, analysis, true).ok).toBe(false);
		expect(
			evaluateWorkAgentContract(summary, analysis, true).checks,
		).toContainEqual(
			expect.objectContaining({ id: "strict-scenario-coverage", ok: false }),
		);

		const strictRuns = (
			[
				"perfect-handoff",
				"bounded-loss",
				"stale-conflict",
				"multi-session-handoff",
				"delegation-review",
				"requirement-scale-100",
			] as const
		).flatMap((scenario) =>
			pairedRuns(scenario, [-9, -8, -7, -6, -5, -4, -3, -2, -1]),
		);
		expect(
			evaluateWorkAgentContract(
				aggregateWorkAgentRuns(strictRuns),
				analyzePairedRuns(strictRuns),
				true,
			).ok,
		).toBe(true);

		const regressed = pairedRuns(
			"delegation-review",
			[1, 2, 3, 4, 5, 6, 7, 8, 9],
		);
		const failedRuns = [
			...strictRuns.filter((run) => run.scenario !== "delegation-review"),
			...regressed,
		];
		const failed = evaluateWorkAgentContract(
			aggregateWorkAgentRuns(failedRuns),
			analyzePairedRuns(failedRuns),
			true,
		);
		expect(failed.ok).toBe(false);
		expect(failed.checks).toContainEqual(
			expect.objectContaining({
				id: "strict-delegation-review-token-median",
				ok: false,
			}),
		);

		const elapsedRegressed = pairedRuns(
			"multi-session-handoff",
			[-9, -8, -7, -6, -5, -4, -3, -2, -1],
			[1, 2, 3, 4, 5, 6, 7, 8, 9],
		);
		const elapsedFailedRuns = [
			...strictRuns.filter((run) => run.scenario !== "multi-session-handoff"),
			...elapsedRegressed,
		];
		const elapsedFailed = evaluateWorkAgentContract(
			aggregateWorkAgentRuns(elapsedFailedRuns),
			analyzePairedRuns(elapsedFailedRuns),
			true,
		);
		expect(elapsedFailed.ok).toBe(false);
		expect(elapsedFailed.checks).toContainEqual(
			expect.objectContaining({
				id: "strict-multi-session-handoff-elapsed-median",
				ok: false,
			}),
		);
		expect(elapsedFailed.checks).toContainEqual(
			expect.objectContaining({
				id: "strict-multi-session-handoff-elapsed-bootstrap-high",
				ok: false,
			}),
		);

		const averageRegression = strictRuns.map((run, index) =>
			index === 0
				? {
						...run,
						enabled: {
							...run.enabled,
							tokens: { ...run.enabled.tokens, total_tokens: 1_000 },
							elapsed_ms: 1_000,
						},
					}
				: run,
		);
		const averageFailed = evaluateWorkAgentContract(
			aggregateWorkAgentRuns(averageRegression),
			analyzePairedRuns(averageRegression),
			true,
		);
		expect(averageFailed.ok).toBe(false);
		expect(averageFailed.checks).toContainEqual(
			expect.objectContaining({ id: "strict-overall-token-average", ok: false }),
		);
		expect(averageFailed.checks).toContainEqual(
			expect.objectContaining({ id: "strict-overall-elapsed-average", ok: false }),
		);
	});

	it("does not overwrite canonical artifacts through a symlink when publication is denied", () => {
		const projectRoot = root();
		const canonicalDir = path.join(projectRoot, WORK_AGENT_AB_BENCHMARK_OUTPUT_DIR);
		fs.mkdirSync(canonicalDir, { recursive: true });
		const outputAlias = path.join(projectRoot, "benchmark-output-alias");
		fs.symlinkSync(canonicalDir, outputAlias, "dir");
		const sentinel = "existing canonical evidence";
		fs.writeFileSync(path.join(canonicalDir, "work-agent-ab.json"), sentinel);
		fs.writeFileSync(path.join(canonicalDir, "README.md"), sentinel);

		expect(() =>
			publishWorkAgentBenchmarkArtifacts(
				{
					strict: true,
					ok: false,
					project_root: projectRoot,
					markdown: "failed diagnostic",
				},
				outputAlias,
			),
		).toThrow("refusing to overwrite canonical public artifacts");
		expect(fs.readFileSync(path.join(canonicalDir, "work-agent-ab.json"), "utf8")).toBe(sentinel);
		expect(fs.readFileSync(path.join(canonicalDir, "README.md"), "utf8")).toBe(sentinel);
	});
});

function pairedRuns(
	scenario: WorkAgentScenarioRun["scenario"],
	tokenDeltas: number[],
	elapsedDeltas: number[] = tokenDeltas,
): WorkAgentScenarioRun[] {
	return tokenDeltas.map((delta, index) => ({
		iteration: index + 1,
		scenario,
		scenario_class:
			scenario === "delegation-review" ? "equal_information" : "resilience",
		requirements: 20,
		order: index % 2 === 0 ? ["disabled", "enabled"] : ["enabled", "disabled"],
		disabled: condition("disabled", 100, 100),
		enabled: condition("enabled", 100 + delta, 100 + elapsedDeltas[index]!),
	}));
}

function condition(
	conditionName: "disabled" | "enabled",
	totalTokens: number,
	elapsedMs: number,
) {
	return {
		condition: conditionName,
		execution_ok: true,
		elapsed_ms: elapsedMs,
		tokens: {
			input_tokens: totalTokens - 20,
			cached_input_tokens: 10,
			output_tokens: 20,
			total_tokens: totalTokens,
		},
		completion_correct: true,
		gate_correct: true,
		requirements_recovered: 20,
		requirement_recall_pct: 100,
		statuses_correct: 20,
		status_recall_pct: 100,
		summaries_correct: 20,
		summary_recall_pct: 100,
		reminders_or_reexplanations: 0,
		reexplained_requirements: 0,
		missed_requirements: 0,
		hallucinated_requirements: 0,
		duplicate_requirement_ids: 0,
	};
}
