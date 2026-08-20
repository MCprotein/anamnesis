import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	aggregateWorkAgentRuns,
	evaluateWorkAgentContract,
	parseCodexJsonl,
	type WorkAgentAnswer,
	type WorkAgentRunner,
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

function fakeRunner(prompts: string[]): WorkAgentRunner {
	return (request) => {
		prompts.push(request.prompt);
		const context = fs.readFileSync(path.join(request.cwd, "CONTEXT.md"), "utf8");
		const rows = new Map<string, "verified" | "pending">();
		for (const match of context.matchAll(
			/(REQ-[A-Z0-9]+)[^\n]*(verified|pending)/gu,
		)) {
			rows.set(match[1]!, match[2] as "verified" | "pending");
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
					requirements: [...rows].map(([id, status]) => ({ id, status })),
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
				requirements: [{ id: "REQ-X", status: "pending" }],
				reminder_or_reexplanation_requests: 2,
			}),
		);

		expect(parsed).toEqual({
			answer: {
				completion_status: "incomplete",
				gate_blocked: true,
				requirements: [{ id: "REQ-X", status: "pending" }],
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
		const plans: Array<{ runs: number; scenarios: number; invocations: number }> = [];
		const result = workAgentBenchmark({
			projectRoot: root(),
			runs: 3,
			model: "test-model",
			runner: fakeRunner(prompts),
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
		expect(artifact).not.toContain("Resume this sanitized project");
		expect(artifact).not.toContain("CONTEXT.md");
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
			reminders_or_reexplanations: 0,
			missed_requirements: 0,
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
});
