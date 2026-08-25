import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { renderWorkBriefingContext } from "./work_hook.js";
import { briefWork, createWork, transitionWork } from "./work.js";

export const WORK_AGENT_AB_BENCHMARK_SCHEMA_VERSION =
	"anamnesis.work_agent_ab_benchmark.v2";
export const WORK_AGENT_AB_BENCHMARK_OUTPUT_DIR =
	"docs/benchmark-evidence/work-agent-ab";
export const DEFAULT_WORK_AGENT_AB_MODEL = "gpt-5.6-luna";

export type WorkAgentCondition = "disabled" | "enabled";
export type WorkAgentScenarioId =
	| "perfect-handoff"
	| "bounded-loss"
	| "stale-conflict"
	| "multi-session-handoff"
	| "delegation-review"
	| "requirement-scale-100";

export type WorkAgentScenarioClass = "equal_information" | "resilience";

interface ScenarioRequirement {
	id: string;
	status: "verified" | "pending";
	summary: string;
}

interface Scenario {
	id: WorkAgentScenarioId;
	class: WorkAgentScenarioClass;
	requirements: ScenarioRequirement[];
	expectedComplete: boolean;
	expectedGateBlocked: boolean;
	enabledProjectRoot: string;
	disabledContext: string;
	enabledContext: string;
}

export interface WorkAgentRunnerRequest {
	cwd: string;
	model: string;
	prompt: string;
	outputSchemaPath: string;
}

export interface WorkAgentRunnerResponse {
	status: number | null;
	stdout: string;
	stderr: string;
	elapsedMs: number;
}

export type WorkAgentRunner = (
	request: WorkAgentRunnerRequest,
) => WorkAgentRunnerResponse;

export interface ParsedCodexJsonl {
	answer: WorkAgentAnswer;
	usage: WorkAgentTokenUsage;
}

export interface WorkAgentAnswer {
	completion_status: "complete" | "incomplete";
	gate_blocked: boolean;
	requirements: Array<{
		id: string;
		status: "verified" | "pending";
		summary: string;
	}>;
	reminder_or_reexplanation_requests: number;
}

export interface WorkAgentTokenUsage {
	input_tokens: number;
	cached_input_tokens: number;
	output_tokens: number;
	total_tokens: number;
}

export interface WorkAgentConditionRun {
	condition: WorkAgentCondition;
	execution_ok: boolean;
	elapsed_ms: number;
	tokens: WorkAgentTokenUsage;
	completion_correct: boolean;
	gate_correct: boolean;
	requirements_recovered: number;
	requirement_recall_pct: number;
	statuses_correct: number;
	status_recall_pct: number;
	reminders_or_reexplanations: number;
	reexplained_requirements: number;
	missed_requirements: number;
	hallucinated_requirements: number;
	duplicate_requirement_ids: number;
	summaries_correct: number;
	summary_recall_pct: number;
	error?: string;
}

export interface WorkAgentScenarioRun {
	iteration: number;
	scenario: WorkAgentScenarioId;
	scenario_class: WorkAgentScenarioClass;
	requirements: number;
	order: [WorkAgentCondition, WorkAgentCondition];
	disabled: WorkAgentConditionRun;
	enabled: WorkAgentConditionRun;
}

export interface WorkAgentAggregateMetrics {
	runs: number;
	execution_success_pct: number;
	elapsed_ms: number;
	input_tokens: number;
	cached_input_tokens: number;
	output_tokens: number;
	total_tokens: number;
	completion_correct_pct: number;
	gate_correct_pct: number;
	requirement_recall_pct: number;
	status_recall_pct: number;
	reminders_or_reexplanations: number;
	reexplained_requirements: number;
	missed_requirements: number;
	hallucinated_requirements: number;
	duplicate_requirement_ids: number;
	summary_recall_pct: number;
}

export interface WorkAgentDistribution {
	average: number;
	p50: number;
	p95: number;
	min: number;
	max: number;
	mad: number;
	bootstrap_90_ci: { low: number; high: number };
}

export interface WorkAgentPairedAnalysis {
	token_delta_pct: WorkAgentDistribution;
	elapsed_delta_pct: WorkAgentDistribution;
	token_pair_wins: number;
	elapsed_pair_wins: number;
	pairs: number;
}

export interface WorkAgentScenarioAnalysis {
	id: WorkAgentScenarioId;
	class: WorkAgentScenarioClass;
	disabled: WorkAgentAggregateMetrics;
	enabled: WorkAgentAggregateMetrics;
	paired: WorkAgentPairedAnalysis;
}

export interface WorkAgentClassAnalysis {
	class: WorkAgentScenarioClass;
	disabled: WorkAgentAggregateMetrics;
	enabled: WorkAgentAggregateMetrics;
	paired: WorkAgentPairedAnalysis;
}

export interface WorkAgentContract {
	ok: boolean;
	checks: Array<{
		id: string;
		ok: boolean;
		actual: number;
		limit: number;
		comparison: "gte" | "lte";
	}>;
	limits: {
		enabled_total_tokens_ratio: number;
		enabled_elapsed_ratio: number;
		strict_minimum_pairs: number;
		strict_regression_token_median_pct: number;
	};
}

export interface WorkAgentBenchmarkResult {
	schema_version: typeof WORK_AGENT_AB_BENCHMARK_SCHEMA_VERSION;
	generated_at: string;
	project_root: string;
	model: string;
	runs_per_scenario: number;
	scenarios: WorkAgentScenarioId[];
	scenario_classes: Record<WorkAgentScenarioClass, WorkAgentScenarioId[]>;
	planned_invocations: number;
	actual_invocations: number;
	runs: WorkAgentScenarioRun[];
	summary: {
		disabled: WorkAgentAggregateMetrics;
		enabled: WorkAgentAggregateMetrics;
		delta: {
			total_tokens_pct: number;
			elapsed_pct: number;
			requirement_recall_points: number;
			status_recall_points: number;
			completion_correct_points: number;
			missed_requirements: number;
			reminders_or_reexplanations: number;
		};
	};
	analysis: {
		overall: WorkAgentPairedAnalysis;
		classes: WorkAgentClassAnalysis[];
		scenarios: WorkAgentScenarioAnalysis[];
		excluded_model_failures: 0;
	};
	strict: boolean;
	contract: WorkAgentContract;
	ok: boolean;
	artifacts: {
		output_dir?: string;
		json?: string;
		markdown?: string;
	};
	markdown: string;
}

export interface WorkAgentBenchmarkOptions {
	projectRoot: string;
	runs?: number;
	model?: string;
	write?: boolean;
	outputPath?: string;
	now?: () => Date;
	runner?: WorkAgentRunner;
	strict?: boolean;
	scenarios?: WorkAgentScenarioId[];
	onPlan?: (plan: { runs: number; scenarios: number; invocations: number }) => void;
}

export class WorkAgentBenchmarkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkAgentBenchmarkError";
	}
}

const PROMPT = `Read CONTEXT.md first and reconstruct the authoritative current task state. The required structured JSON is the visible briefing for this benchmark; do not execute any stated next action or add prose. When CONTEXT says "Authoritative completeness", its requirement list is complete: do not inspect Agentfile or .anamnesis and do not run the status command. When it says "Required retrieval", run only that read-only command. Prefer explicitly current facts when legacy sources conflict. Return every requirement exactly once with its exact ID, status, and summary, plus overall completion, required-gate blocking, and reminder count. Do not modify files, use the network, or reveal unrelated file contents verbatim.`;

const WORK_AGENT_SCENARIO_DEFINITIONS: Array<
	readonly [WorkAgentScenarioId, number, number, WorkAgentScenarioClass]
> = [
	["perfect-handoff", 20, 10, "equal_information"],
	["bounded-loss", 20, 12, "resilience"],
	["stale-conflict", 20, 10, "resilience"],
	["multi-session-handoff", 20, 15, "resilience"],
	["delegation-review", 20, 20, "equal_information"],
	["requirement-scale-100", 100, 50, "equal_information"],
];

const ANSWER_SCHEMA = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	type: "object",
	additionalProperties: false,
	required: [
		"completion_status",
		"gate_blocked",
		"requirements",
		"reminder_or_reexplanation_requests",
	],
	properties: {
		completion_status: { enum: ["complete", "incomplete"] },
		gate_blocked: { type: "boolean" },
		requirements: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "status", "summary"],
				properties: {
					id: { type: "string" },
					status: { enum: ["verified", "pending"] },
					summary: { type: "string" },
				},
			},
		},
		reminder_or_reexplanation_requests: {
			type: "integer",
			minimum: 0,
		},
	},
} as const;

export function workAgentBenchmark(
	opts: WorkAgentBenchmarkOptions,
): WorkAgentBenchmarkResult {
	const projectRoot = path.resolve(opts.projectRoot);
	const runsPerScenario = minimumInteger(opts.runs ?? 3, 3, "--runs");
	if (opts.strict === true && runsPerScenario < 9) {
		throw new WorkAgentBenchmarkError("--strict requires at least 9 runs");
	}
	const model = nonempty(opts.model ?? DEFAULT_WORK_AGENT_AB_MODEL, "--model");
	const runner = opts.runner ?? runCodexExec;
	const tempRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-work-agent-ab-"),
	);
	const cliPath = path.join(projectRoot, "cli", "dist", "index.js");
	if (!fs.existsSync(cliPath) && opts.runner === undefined) {
		throw new WorkAgentBenchmarkError(
			"built CLI is required; run npm run build before benchmark work-agent-ab",
		);
	}
	const scenarios = buildScenarios(
		tempRoot,
		cliPath,
		opts.scenarios,
		opts.strict === true,
	);
	const plannedInvocations = runsPerScenario * scenarios.length * 2;
	opts.onPlan?.({
		runs: runsPerScenario,
		scenarios: scenarios.length,
		invocations: plannedInvocations,
	});
	const outputSchemaPath = path.join(tempRoot, "answer.schema.json");
	fs.writeFileSync(outputSchemaPath, `${JSON.stringify(ANSWER_SCHEMA, null, 2)}\n`);
	const runs: WorkAgentScenarioRun[] = [];
	try {
		for (let iteration = 1; iteration <= runsPerScenario; iteration += 1) {
			for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex += 1) {
				const scenario = scenarios[scenarioIndex]!;
				const enabledFirst = (iteration + scenarioIndex) % 2 === 0;
				const order: [WorkAgentCondition, WorkAgentCondition] = enabledFirst
					? ["enabled", "disabled"]
					: ["disabled", "enabled"];
				const byCondition = {} as Record<
					WorkAgentCondition,
					WorkAgentConditionRun
				>;
				for (const condition of order) {
					const fixtureDir = path.join(
						tempRoot,
						`${scenario.id}-${iteration}-${condition}`,
					);
					fs.mkdirSync(fixtureDir);
					fs.writeFileSync(
						path.join(fixtureDir, "CONTEXT.md"),
						condition === "enabled"
							? scenario.enabledContext
							: scenario.disabledContext,
					);
					if (condition === "enabled") {
						fs.cpSync(
							path.join(scenario.enabledProjectRoot, ".anamnesis"),
							path.join(fixtureDir, ".anamnesis"),
							{ recursive: true },
						);
						fs.copyFileSync(
							path.join(scenario.enabledProjectRoot, "Agentfile"),
							path.join(fixtureDir, "Agentfile"),
						);
					}
					byCondition[condition] = executeCondition({
						condition,
						fixtureDir,
						model,
						outputSchemaPath,
						runner,
						expected: scenario.requirements,
						expectedComplete: scenario.expectedComplete,
						expectedGateBlocked: scenario.expectedGateBlocked,
					});
				}
				runs.push({
					iteration,
					scenario: scenario.id,
					scenario_class: scenario.class,
					requirements: scenario.requirements.length,
					order,
					disabled: byCondition.disabled,
					enabled: byCondition.enabled,
				});
			}
		}
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}

	const summary = aggregateWorkAgentRuns(runs);
	const analysis = analyzePairedRuns(runs);
	const strict = opts.strict === true;
	const contract = evaluateWorkAgentContract(summary, analysis, strict);
	const result: WorkAgentBenchmarkResult = {
		schema_version: WORK_AGENT_AB_BENCHMARK_SCHEMA_VERSION,
		generated_at: (opts.now ?? (() => new Date()))().toISOString(),
		project_root: projectRoot,
		model,
		runs_per_scenario: runsPerScenario,
		scenarios: scenarios.map((scenario) => scenario.id),
		scenario_classes: {
			equal_information: scenarios
				.filter((scenario) => scenario.class === "equal_information")
				.map((scenario) => scenario.id),
			resilience: scenarios
				.filter((scenario) => scenario.class === "resilience")
				.map((scenario) => scenario.id),
		},
		planned_invocations: plannedInvocations,
		actual_invocations:
			plannedInvocations +
			runs.reduce(
				(total, run) =>
					total +
					run.disabled.reminders_or_reexplanations +
					run.enabled.reminders_or_reexplanations,
				0,
			),
		runs,
		summary,
		analysis,
		strict,
		contract,
		ok: contract.ok,
		artifacts: {},
		markdown: "",
	};
	result.markdown = renderWorkAgentBenchmarkMarkdown(result);
	if (opts.write === true) {
		if (
			result.strict &&
			!result.ok &&
			isCanonicalBenchmarkOutput(projectRoot, opts.outputPath)
		) {
			throw new WorkAgentBenchmarkError(
				"strict benchmark failed; refusing to overwrite canonical public artifacts (pass --output for diagnostic evidence)",
			);
		}
		result.artifacts = writeArtifacts(result, opts.outputPath);
	}
	return result;
}

export function parseCodexJsonl(stdout: string): ParsedCodexJsonl {
	let finalText: string | undefined;
	let usage: WorkAgentTokenUsage | undefined;
	for (const rawLine of stdout.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (line.length === 0) continue;
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(event)) continue;
		if (event.type === "item.completed" && isRecord(event.item)) {
			if (
				event.item.type === "agent_message" &&
				typeof event.item.text === "string"
			) {
				finalText = event.item.text;
			}
		}
		if (event.type === "turn.completed" && isRecord(event.usage)) {
			usage = {
				input_tokens: nonnegativeNumber(event.usage.input_tokens),
				cached_input_tokens: nonnegativeNumber(
					event.usage.cached_input_tokens,
				),
				output_tokens: nonnegativeNumber(event.usage.output_tokens),
				total_tokens: nonnegativeNumber(event.usage.total_tokens),
			};
		}
	}
	if (!finalText) {
		throw new WorkAgentBenchmarkError(
			"codex JSONL did not contain a completed agent message",
		);
	}
	if (!usage) {
		throw new WorkAgentBenchmarkError(
			"codex JSONL did not contain turn.completed usage",
		);
	}
	if (usage.total_tokens === 0) {
		usage.total_tokens = usage.input_tokens + usage.output_tokens;
	}
	return { answer: parseAnswer(finalText), usage };
}

export function aggregateWorkAgentRuns(
	runs: WorkAgentScenarioRun[],
): WorkAgentBenchmarkResult["summary"] {
	const disabled = aggregateCondition(runs.map((run) => run.disabled));
	const enabled = aggregateCondition(runs.map((run) => run.enabled));
	return {
		disabled,
		enabled,
		delta: {
			total_tokens_pct: percentDelta(
				disabled.total_tokens,
				enabled.total_tokens,
			),
			elapsed_pct: percentDelta(disabled.elapsed_ms, enabled.elapsed_ms),
			requirement_recall_points: round(
				enabled.requirement_recall_pct - disabled.requirement_recall_pct,
			),
			status_recall_points: round(
				enabled.status_recall_pct - disabled.status_recall_pct,
			),
			completion_correct_points: round(
				enabled.completion_correct_pct - disabled.completion_correct_pct,
			),
			missed_requirements:
				enabled.missed_requirements - disabled.missed_requirements,
			reminders_or_reexplanations: round(
				enabled.reminders_or_reexplanations -
					disabled.reminders_or_reexplanations,
			),
		},
	};
}

export function analyzePairedRuns(
	runs: WorkAgentScenarioRun[],
): WorkAgentBenchmarkResult["analysis"] {
	return {
		overall: pairedAnalysis(runs),
		classes: (["equal_information", "resilience"] as const).flatMap(
			(scenarioClass) => {
				const classRuns = runs.filter(
					(run) => run.scenario_class === scenarioClass,
				);
				if (classRuns.length === 0) return [];
				return [{
					class: scenarioClass,
					disabled: aggregateCondition(classRuns.map((run) => run.disabled)),
					enabled: aggregateCondition(classRuns.map((run) => run.enabled)),
					paired: pairedAnalysis(classRuns),
				}];
			},
		),
		scenarios: uniqueScenarioIds(runs).map((id) => {
			const scenarioRuns = runs.filter((run) => run.scenario === id);
			return {
				id,
				class: scenarioRuns[0]?.scenario_class ?? "equal_information",
				disabled: aggregateCondition(scenarioRuns.map((run) => run.disabled)),
				enabled: aggregateCondition(scenarioRuns.map((run) => run.enabled)),
				paired: pairedAnalysis(scenarioRuns),
			};
		}),
		excluded_model_failures: 0,
	};
}

export function evaluateWorkAgentContract(
	summary: WorkAgentBenchmarkResult["summary"],
	analysis?: WorkAgentBenchmarkResult["analysis"],
	strict = false,
): WorkAgentContract {
	const limits = {
		enabled_total_tokens_ratio: 1.1,
		enabled_elapsed_ratio: 1.25,
		strict_minimum_pairs: 9,
		strict_regression_token_median_pct: 0.1,
	};
	const checks: WorkAgentContract["checks"] = [
		check("enabled-execution-success", summary.enabled.execution_success_pct, 100, "gte"),
		check("enabled-completion-correct", summary.enabled.completion_correct_pct, 100, "gte"),
		check("enabled-gate-correct", summary.enabled.gate_correct_pct, 100, "gte"),
		check("enabled-requirement-recall", summary.enabled.requirement_recall_pct, 100, "gte"),
		check("enabled-status-recall", summary.enabled.status_recall_pct, 100, "gte"),
		check("enabled-summary-recall", summary.enabled.summary_recall_pct, 100, "gte"),
		check(
			"enabled-hallucinated-requirements",
			summary.enabled.hallucinated_requirements,
			0,
			"lte",
		),
		check(
			"enabled-duplicate-requirement-ids",
			summary.enabled.duplicate_requirement_ids,
			0,
			"lte",
		),
		check(
			"requirement-recall-noninferiority",
			summary.enabled.requirement_recall_pct,
			summary.disabled.requirement_recall_pct,
			"gte",
		),
		check(
			"status-recall-noninferiority",
			summary.enabled.status_recall_pct,
			summary.disabled.status_recall_pct,
			"gte",
		),
		check(
			"summary-recall-noninferiority",
			summary.enabled.summary_recall_pct,
			summary.disabled.summary_recall_pct,
			"gte",
		),
		check(
			"reminder-noninferiority",
			summary.enabled.reminders_or_reexplanations,
			summary.disabled.reminders_or_reexplanations,
			"lte",
		),
		check(
			"total-token-budget",
			summary.enabled.total_tokens,
			summary.disabled.total_tokens * limits.enabled_total_tokens_ratio,
			"lte",
		),
		check(
			"elapsed-budget",
			summary.enabled.elapsed_ms,
			summary.disabled.elapsed_ms * limits.enabled_elapsed_ratio,
			"lte",
		),
	];
	if (strict) {
		if (!analysis) {
			throw new WorkAgentBenchmarkError(
				"strict Work A/B evaluation requires paired analysis",
			);
		}
		const requiredScenarioIds = WORK_AGENT_SCENARIO_DEFINITIONS.map(
			([id]) => id,
		);
		const actualScenarioIds = new Set(
			analysis.scenarios.map((scenario) => scenario.id),
		);
		const hasExactScenarioCoverage =
			actualScenarioIds.size === requiredScenarioIds.length &&
			requiredScenarioIds.every((id) => actualScenarioIds.has(id));
		const requiredScenarios = requiredScenarioIds
			.map((id) => analysis.scenarios.find((scenario) => scenario.id === id))
			.filter((scenario): scenario is WorkAgentScenarioAnalysis => scenario !== undefined);
		checks.push(
			check(
				"strict-scenario-coverage",
				hasExactScenarioCoverage ? 1 : 0,
				1,
				"gte",
			),
			check(
				"strict-pairs-per-scenario",
				requiredScenarios.length === requiredScenarioIds.length
					? Math.min(...requiredScenarios.map((scenario) => scenario.paired.pairs))
					: 0,
				limits.strict_minimum_pairs,
				"gte",
			),
			check(
				"strict-overall-token-median",
				analysis.overall.token_delta_pct.p50,
				0,
				"lte",
			),
			check(
				"strict-overall-elapsed-median",
				analysis.overall.elapsed_delta_pct.p50,
				0,
				"lte",
			),
			check(
				"strict-overall-token-average",
				summary.delta.total_tokens_pct,
				0,
				"lte",
			),
			check(
				"strict-overall-elapsed-average",
				summary.delta.elapsed_pct,
				0,
				"lte",
			),
		);
		for (const scenario of analysis.scenarios) {
			checks.push(
				check(
					`strict-${scenario.id}-corrections`,
					scenario.enabled.reminders_or_reexplanations,
					scenario.disabled.reminders_or_reexplanations,
					"lte",
				),
			);
		}
		for (const id of [
			"multi-session-handoff",
			"delegation-review",
		] as const) {
			const scenario = analysis.scenarios.find((item) => item.id === id);
			if (!scenario) {
				checks.push(
					check(
						`strict-${id}-token-median`,
						limits.strict_regression_token_median_pct + 1,
						limits.strict_regression_token_median_pct,
						"lte",
					),
				);
				continue;
			}
			checks.push(
				check(
					`strict-${id}-token-median`,
					scenario.paired.token_delta_pct.p50,
					limits.strict_regression_token_median_pct,
					"lte",
				),
				check(
					`strict-${id}-token-bootstrap-high`,
					scenario.paired.token_delta_pct.bootstrap_90_ci.high,
					limits.strict_regression_token_median_pct,
					"lte",
				),
				check(
					`strict-${id}-elapsed-median`,
					scenario.paired.elapsed_delta_pct.p50,
					limits.strict_regression_token_median_pct,
					"lte",
				),
				check(
					`strict-${id}-elapsed-bootstrap-high`,
					scenario.paired.elapsed_delta_pct.bootstrap_90_ci.high,
					limits.strict_regression_token_median_pct,
					"lte",
				),
			);
		}
	}
	return { ok: checks.every((item) => item.ok), checks, limits };
}

function executeCondition(input: {
	condition: WorkAgentCondition;
	fixtureDir: string;
	model: string;
	outputSchemaPath: string;
	runner: WorkAgentRunner;
	expected: ScenarioRequirement[];
	expectedComplete: boolean;
	expectedGateBlocked: boolean;
}): WorkAgentConditionRun {
	const firstResponse = input.runner({
		cwd: input.fixtureDir,
		model: input.model,
		prompt: PROMPT,
		outputSchemaPath: input.outputSchemaPath,
	});
	const emptyUsage: WorkAgentTokenUsage = {
		input_tokens: 0,
		cached_input_tokens: 0,
		output_tokens: 0,
		total_tokens: 0,
	};
	if (firstResponse.status !== 0) {
		return failedCondition(
			input.condition,
			firstResponse.elapsedMs,
			emptyUsage,
			"codex-exec-failed",
			input.expected.length,
		);
	}
	let parsed: ParsedCodexJsonl;
	try {
		parsed = parseCodexJsonl(firstResponse.stdout);
	} catch {
		return failedCondition(
			input.condition,
			firstResponse.elapsedMs,
			emptyUsage,
			"invalid-codex-jsonl",
			input.expected.length,
		);
	}
	let elapsedMs = firstResponse.elapsedMs;
	let usage = parsed.usage;
	let reminders = 0;
	let reexplainedRequirements = 0;
	let scored = scoreAnswer(parsed.answer, input);
	if (!scored.exact) {
		reminders = 1;
		reexplainedRequirements = scored.incorrectRequirementIds.length;
		fs.writeFileSync(
			path.join(input.fixtureDir, "CORRECTION.md"),
			[
				"# Deterministic correction",
				"",
				"The prior reconstruction was incomplete or inconsistent.",
				`Recheck these requirement IDs: ${scored.incorrectRequirementIds.join(", ") || "none"}.`,
				`Expected completion_status: ${input.expectedComplete ? "complete" : "incomplete"}.`,
				`Expected gate_blocked: ${input.expectedGateBlocked}.`,
			].join("\n"),
		);
		const correction = input.runner({
			cwd: input.fixtureDir,
			model: input.model,
			prompt:
				"A deterministic oracle rejected the previous reconstruction. Read CORRECTION.md and CONTEXT.md, then return the required structured JSON again. Do not modify files or use the network.",
			outputSchemaPath: input.outputSchemaPath,
		});
		elapsedMs += correction.elapsedMs;
		if (correction.status !== 0) {
			return failedCondition(
				input.condition,
				elapsedMs,
				usage,
				"codex-correction-failed",
				input.expected.length,
			);
		}
		try {
			parsed = parseCodexJsonl(correction.stdout);
		} catch {
			return failedCondition(
				input.condition,
				elapsedMs,
				usage,
				"invalid-correction-jsonl",
				input.expected.length,
			);
		}
		usage = addUsage(usage, parsed.usage);
		scored = scoreAnswer(parsed.answer, input);
	}
	return {
		condition: input.condition,
		execution_ok: true,
		elapsed_ms: round(elapsedMs),
		tokens: usage,
		...scored.metrics,
		reminders_or_reexplanations: reminders,
		reexplained_requirements: reexplainedRequirements,
	};
}

function scoreAnswer(
	answer: WorkAgentAnswer,
	input: {
		expected: ScenarioRequirement[];
		expectedComplete: boolean;
		expectedGateBlocked: boolean;
	},
): {
	exact: boolean;
	incorrectRequirementIds: string[];
	metrics: Pick<
		WorkAgentConditionRun,
		| "completion_correct"
		| "gate_correct"
		| "requirements_recovered"
		| "requirement_recall_pct"
		| "statuses_correct"
		| "status_recall_pct"
		| "summaries_correct"
		| "summary_recall_pct"
		| "missed_requirements"
		| "hallucinated_requirements"
		| "duplicate_requirement_ids"
	>;
} {
	const expected = new Map(
		input.expected.map((requirement) => [requirement.id, requirement]),
	);
	const recovered = new Map<string, WorkAgentAnswer["requirements"][number]>();
	const seen = new Set<string>();
	let duplicateRequirementIds = 0;
	let hallucinatedRequirements = 0;
	for (const requirement of answer.requirements) {
		if (seen.has(requirement.id)) duplicateRequirementIds += 1;
		seen.add(requirement.id);
		if (!expected.has(requirement.id)) {
			hallucinatedRequirements += 1;
			continue;
		}
		if (!recovered.has(requirement.id)) recovered.set(requirement.id, requirement);
	}
	let statusesCorrect = 0;
	let summariesCorrect = 0;
	const incorrectRequirementIds: string[] = [];
	for (const [id, requirement] of expected) {
		const actual = recovered.get(id);
		if (actual?.status === requirement.status) statusesCorrect += 1;
		if (actual?.summary === requirement.summary) summariesCorrect += 1;
		if (
			actual?.status !== requirement.status ||
			actual.summary !== requirement.summary
		) {
			incorrectRequirementIds.push(id);
		}
	}
	const requirementsRecovered = recovered.size;
	const completionCorrect =
		(answer.completion_status === "complete") === input.expectedComplete;
	const gateCorrect = answer.gate_blocked === input.expectedGateBlocked;
	return {
			exact:
			completionCorrect &&
			gateCorrect &&
			requirementsRecovered === input.expected.length &&
			statusesCorrect === input.expected.length &&
			summariesCorrect === input.expected.length &&
			hallucinatedRequirements === 0 &&
			duplicateRequirementIds === 0,
		incorrectRequirementIds,
		metrics: {
			completion_correct: completionCorrect,
			gate_correct: gateCorrect,
			requirements_recovered: requirementsRecovered,
			requirement_recall_pct: percentage(
				requirementsRecovered,
				input.expected.length,
			),
			statuses_correct: statusesCorrect,
			status_recall_pct: percentage(statusesCorrect, input.expected.length),
			summaries_correct: summariesCorrect,
			summary_recall_pct: percentage(summariesCorrect, input.expected.length),
			missed_requirements: input.expected.length - requirementsRecovered,
			hallucinated_requirements: hallucinatedRequirements,
			duplicate_requirement_ids: duplicateRequirementIds,
		},
	};
}

function addUsage(
	left: WorkAgentTokenUsage,
	right: WorkAgentTokenUsage,
): WorkAgentTokenUsage {
	return {
		input_tokens: left.input_tokens + right.input_tokens,
		cached_input_tokens: left.cached_input_tokens + right.cached_input_tokens,
		output_tokens: left.output_tokens + right.output_tokens,
		total_tokens: left.total_tokens + right.total_tokens,
	};
}

function runCodexExec(request: WorkAgentRunnerRequest): WorkAgentRunnerResponse {
	const started = performance.now();
	const result = spawnSync(
		"codex",
		[
			"exec",
			"--json",
			"--ephemeral",
			"--ignore-user-config",
			"--sandbox",
			"read-only",
			"--skip-git-repo-check",
			"--model",
			request.model,
			"--output-schema",
			request.outputSchemaPath,
			"-C",
			request.cwd,
			"-",
		],
		{
			encoding: "utf8",
			input: request.prompt,
			maxBuffer: 16 * 1024 * 1024,
			timeout: 10 * 60 * 1000,
		},
	);
	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		elapsedMs: performance.now() - started,
	};
}

function buildScenarios(
	tempRoot: string,
	cliPath: string,
	requested: WorkAgentScenarioId[] | undefined,
	strict: boolean,
): Scenario[] {
	if (strict && requested !== undefined) {
		throw new WorkAgentBenchmarkError(
			"--strict evaluates every scenario; --scenarios is diagnostic-only",
		);
	}
	if (requested === undefined) {
		return WORK_AGENT_SCENARIO_DEFINITIONS.map(([id, count, verified, scenarioClass]) =>
			buildScenario(tempRoot, cliPath, id, count, verified, scenarioClass),
		);
	}
	if (requested.length === 0) {
		throw new WorkAgentBenchmarkError("--scenarios requires at least one scenario");
	}
	const unique = [...new Set(requested)];
	if (unique.length !== requested.length) {
		throw new WorkAgentBenchmarkError("--scenarios contains duplicates");
	}
	const known = new Map(
		WORK_AGENT_SCENARIO_DEFINITIONS.map((definition) => [definition[0], definition]),
	);
	return unique.map((id) => {
		const definition = known.get(id);
		if (!definition) throw new WorkAgentBenchmarkError(`unknown scenario: ${id}`);
		return buildScenario(tempRoot, cliPath, ...definition);
	});
}

function buildScenario(
	tempRoot: string,
	cliPath: string,
	id: WorkAgentScenarioId,
	count: number,
	verified: number,
	scenarioClass: WorkAgentScenarioClass,
): Scenario {
	const requirements = Array.from({ length: count }, (_, index) => ({
		id: requirementId(index),
		status: index < verified ? ("verified" as const) : ("pending" as const),
		summary: `sanitized acceptance condition ${String(index + 1).padStart(3, "0")}`,
	}));
	const gatePending = id === "delegation-review";
	const enabledProjectRoot = path.join(tempRoot, `product-${id}`);
	const enabledContext = renderProductWorkContext(
		enabledProjectRoot,
		requirements,
		gatePending,
		cliPath,
	);
	let disabledContext: string;
	switch (id) {
		case "perfect-handoff":
			disabledContext = renderLegacyContext(requirements, "current complete handoff");
			break;
		case "bounded-loss":
			disabledContext = renderLegacyContext(
				requirements.slice(-8),
				"current compacted handoff; earlier facts were not retained",
			);
			break;
		case "stale-conflict":
			disabledContext = renderLegacyContext(
				requirements.map((requirement) => ({
					...requirement,
					status:
						requirement.status === "verified" ? "pending" : "verified",
				})),
				"handoff snapshot; timestamp unavailable and status may be stale",
			);
			break;
		case "multi-session-handoff":
			disabledContext = `${renderLegacyContext(
				requirements.map((requirement) => ({ ...requirement, status: "pending" })),
				"session 1 handoff",
			)}\n\n${renderLegacyContext(
				requirements.slice(0, 15),
				"session 2 latest delta; omitted requirements retain earlier status",
			)}`;
			break;
		case "delegation-review":
			disabledContext = `${renderLegacyContext(
				requirements,
				"current complete handoff",
			)}\nRequired completion gates: delegation evidence is missing; independent review is requested but not recorded. Do not declare completion until both gates are satisfied.\n`;
			break;
		case "requirement-scale-100":
			disabledContext = renderLegacyContext(
				requirements,
				"current complete handoff with prose repetition",
				true,
			);
			break;
	}
	return {
		id,
		class: scenarioClass,
		requirements,
		expectedComplete: false,
		expectedGateBlocked: gatePending,
		enabledProjectRoot,
		disabledContext,
		enabledContext,
	};
}

function renderProductWorkContext(
	projectRoot: string,
	requirements: ScenarioRequirement[],
	gatePending: boolean,
	cliPath: string,
): string {
	fs.mkdirSync(projectRoot);
	fs.writeFileSync(
		path.join(projectRoot, "Agentfile"),
		YAML.stringify({
			version: 2,
			project: { name: "sanitized-work-agent-benchmark" },
			tools: ["codex"],
			fragments: [],
			settings: {
				work_policy: gatePending
					? {
						review: {
							preset: "custom",
							gates: [
								{ gate: "planning", enforcement: "off" },
								{ gate: "completion", enforcement: "required" },
							],
						},
						delegation: { parallelism: "prefer" },
					}
					: {
						review: { preset: "off" },
						delegation: { parallelism: "off" },
					},
			},
		}),
	);
	const workId = "wu_sanitized_agent_resume";
	const sourceEventId = "src_sanitized_create";
	let mutation = createWork({
		project_root: projectRoot,
		work_id: workId,
		event_id: "evt_sanitized_create",
		occurred_at: "2026-08-20T00:00:00.000Z",
		expected_head: null,
		draft: Buffer.from(
			YAML.stringify({
				work: {
					title: "Sanitized agent resume benchmark",
					completion_contract: gatePending
						? "All requirements must be verified. Completion is blocked: delegation evidence is missing and independent review is not recorded."
						: "Every requirement is verified and every configured completion gate is satisfied.",
				},
				boundary: {
					state: "accepted",
					classification: "new_unit",
					reason_codes: ["same_deliverable"],
					confidence: "high",
				},
				requirements: requirements.map((requirement) => ({
					id: requirement.id,
					summary: requirement.summary,
					source_event_ids: [sourceEventId],
				})),
				open_conflicts: [],
			}),
		),
		source_stdin: {
			event_id: sourceEventId,
			captured_at: "2026-08-20T00:00:00.000Z",
			client: "codex",
			content_type: "text/plain; charset=utf-8",
			fidelity: "native_exact",
			allocation_status: "allocated",
			body: Buffer.from("sanitized benchmark requirements"),
		},
	});
	for (const [index, requirement] of requirements.entries()) {
		if (requirement.status !== "verified") continue;
		mutation = transitionWork({
			project_root: projectRoot,
			work_id: workId,
			event_id: `evt_verify_${index}`,
			occurred_at: new Date(
				Date.parse("2026-08-20T00:00:00.000Z") + (index + 1) * 1_000,
			).toISOString(),
			expected_head: mutation.projection.ledger_head,
			draft: Buffer.from(
				YAML.stringify({
					requirement_id: requirement.id,
					status: "verified",
					evidence_refs: [`benchmark:${requirement.id}`],
				}),
			),
		});
	}
	const brief = briefWork({
		project_root: projectRoot,
		work_id: workId,
		cursor_id: `cursor_${path.basename(projectRoot)}`,
		client_session_ref: "sanitized-session",
		occurred_at: "2026-08-20T01:00:00.000Z",
	});
	return renderWorkBriefingContext(brief.briefing, "full", true, 50_000).replace(
		"anamnesis work status",
		`node ${shellQuote(cliPath)} work status --project-root ${shellQuote(projectRoot)}`,
	);
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function renderLegacyContext(
	requirements: ScenarioRequirement[],
	label: string,
	repetitive = false,
): string {
	return `# Legacy session handoff\n\n${label}.\n\n${requirements
		.map((item) => {
			const base = `Requirement ${item.id}: ${item.summary}. Current status: ${item.status}.`;
			return repetitive
				? `${base} Preserve this requirement exactly when resuming and remember its current status.`
				: base;
		})
		.join("\n")}\n`;
}

function requirementId(index: number): string {
	let value = (index + 1) * 2654435761;
	value = (value ^ (value >>> 16)) >>> 0;
	return `REQ-${value.toString(36).toUpperCase().padStart(7, "0")}`;
}

function aggregateCondition(
	runs: WorkAgentConditionRun[],
): WorkAgentAggregateMetrics {
	const count = runs.length;
	if (count === 0) {
		return {
			runs: 0,
			execution_success_pct: 0,
			elapsed_ms: 0,
			input_tokens: 0,
			cached_input_tokens: 0,
			output_tokens: 0,
			total_tokens: 0,
			completion_correct_pct: 0,
			gate_correct_pct: 0,
			requirement_recall_pct: 0,
			status_recall_pct: 0,
			summary_recall_pct: 0,
			reminders_or_reexplanations: 0,
			reexplained_requirements: 0,
			missed_requirements: 0,
			hallucinated_requirements: 0,
			duplicate_requirement_ids: 0,
		};
	}
	return {
		runs: count,
		execution_success_pct: percentage(
			runs.filter((run) => run.execution_ok).length,
			count,
		),
		elapsed_ms: average(runs.map((run) => run.elapsed_ms)),
		input_tokens: average(runs.map((run) => run.tokens.input_tokens)),
		cached_input_tokens: average(
			runs.map((run) => run.tokens.cached_input_tokens),
		),
		output_tokens: average(runs.map((run) => run.tokens.output_tokens)),
		total_tokens: average(runs.map((run) => run.tokens.total_tokens)),
		completion_correct_pct: percentage(
			runs.filter((run) => run.completion_correct).length,
			count,
		),
		gate_correct_pct: percentage(
			runs.filter((run) => run.gate_correct).length,
			count,
		),
		requirement_recall_pct: average(
			runs.map((run) => run.requirement_recall_pct),
		),
		status_recall_pct: average(runs.map((run) => run.status_recall_pct)),
		summary_recall_pct: average(runs.map((run) => run.summary_recall_pct)),
		reminders_or_reexplanations: average(
			runs.map((run) => run.reminders_or_reexplanations),
		),
		reexplained_requirements: average(
			runs.map((run) => run.reexplained_requirements),
		),
		missed_requirements: average(
			runs.map((run) => run.missed_requirements),
		),
		hallucinated_requirements: average(
			runs.map((run) => run.hallucinated_requirements),
		),
		duplicate_requirement_ids: average(
			runs.map((run) => run.duplicate_requirement_ids),
		),
	};
}

function uniqueScenarioIds(runs: WorkAgentScenarioRun[]): WorkAgentScenarioId[] {
	return [...new Set(runs.map((run) => run.scenario))];
}

function pairedAnalysis(runs: WorkAgentScenarioRun[]): WorkAgentPairedAnalysis {
	const tokenDeltas = runs.map((run) =>
		percentDelta(run.disabled.tokens.total_tokens, run.enabled.tokens.total_tokens),
	);
	const elapsedDeltas = runs.map((run) =>
		percentDelta(run.disabled.elapsed_ms, run.enabled.elapsed_ms),
	);
	return {
		token_delta_pct: distribution(tokenDeltas),
		elapsed_delta_pct: distribution(elapsedDeltas),
		token_pair_wins: tokenDeltas.filter((value) => value <= 0).length,
		elapsed_pair_wins: elapsedDeltas.filter((value) => value <= 0).length,
		pairs: runs.length,
	};
}

function distribution(values: number[]): WorkAgentDistribution {
	if (values.length === 0) {
		throw new WorkAgentBenchmarkError("paired distribution requires values");
	}
	const sorted = [...values].sort((left, right) => left - right);
	const p50 = percentile(sorted, 0.5);
	const deviations = sorted
		.map((value) => Math.abs(value - p50))
		.sort((left, right) => left - right);
	const bootstrap = bootstrapMedian90(sorted);
	return {
		average: average(sorted),
		p50,
		p95: percentile(sorted, 0.95),
		min: round(sorted[0]!),
		max: round(sorted.at(-1)!),
		mad: percentile(deviations, 0.5),
		bootstrap_90_ci: bootstrap,
	};
}

function percentile(sorted: number[], quantile: number): number {
	const position = (sorted.length - 1) * quantile;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return round(sorted[lower]!);
	const weight = position - lower;
	return round(sorted[lower]! * (1 - weight) + sorted[upper]! * weight);
}

function bootstrapMedian90(sorted: number[]): { low: number; high: number } {
	let state = bootstrapSeed(sorted);
	const medians: number[] = [];
	for (let iteration = 0; iteration < 2_000; iteration += 1) {
		const sample: number[] = [];
		for (let index = 0; index < sorted.length; index += 1) {
			state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
			sample.push(sorted[state % sorted.length]!);
		}
		sample.sort((left, right) => left - right);
		medians.push(percentile(sample, 0.5));
	}
	medians.sort((left, right) => left - right);
	return {
		low: percentile(medians, 0.05),
		high: percentile(medians, 0.95),
	};
}

function bootstrapSeed(values: number[]): number {
	let seed = 2_166_136_261;
	for (const value of values) {
		for (const character of String(value)) {
			seed ^= character.charCodeAt(0);
			seed = Math.imul(seed, 16_777_619) >>> 0;
		}
	}
	return seed || 1;
}

function failedCondition(
	condition: WorkAgentCondition,
	elapsedMs: number,
	tokens: WorkAgentTokenUsage,
	error: string,
	expectedRequirements: number,
): WorkAgentConditionRun {
	return {
		condition,
		execution_ok: false,
		elapsed_ms: round(elapsedMs),
		tokens,
		completion_correct: false,
		gate_correct: false,
		requirements_recovered: 0,
		requirement_recall_pct: 0,
		statuses_correct: 0,
		status_recall_pct: 0,
		summaries_correct: 0,
		summary_recall_pct: 0,
		reminders_or_reexplanations: 0,
		reexplained_requirements: 0,
		missed_requirements: expectedRequirements,
		hallucinated_requirements: 0,
		duplicate_requirement_ids: 0,
		error,
	};
}

function parseAnswer(text: string): WorkAgentAnswer {
	const trimmed = text.trim();
	const unfenced = trimmed
		.replace(/^```(?:json)?\s*/u, "")
		.replace(/\s*```$/u, "");
	let value: unknown;
	try {
		value = JSON.parse(unfenced);
	} catch {
		throw new WorkAgentBenchmarkError("agent final message was not valid JSON");
	}
	if (!isRecord(value)) {
		throw new WorkAgentBenchmarkError("agent final message was not an object");
	}
	if (
		value.completion_status !== "complete" &&
		value.completion_status !== "incomplete"
	) {
		throw new WorkAgentBenchmarkError("agent completion_status was invalid");
	}
	if (typeof value.gate_blocked !== "boolean") {
		throw new WorkAgentBenchmarkError("agent gate_blocked was invalid");
	}
	if (!Array.isArray(value.requirements)) {
		throw new WorkAgentBenchmarkError("agent requirements were invalid");
	}
	const requirements = value.requirements.map((item) => {
		if (
			!isRecord(item) ||
			typeof item.id !== "string" ||
			typeof item.summary !== "string" ||
			(item.status !== "verified" && item.status !== "pending")
		) {
			throw new WorkAgentBenchmarkError("agent requirement row was invalid");
		}
		const status: "verified" | "pending" = item.status;
		return { id: item.id, status, summary: item.summary };
	});
	if (
		typeof value.reminder_or_reexplanation_requests !== "number" ||
		!Number.isInteger(value.reminder_or_reexplanation_requests) ||
		value.reminder_or_reexplanation_requests < 0
	) {
		throw new WorkAgentBenchmarkError(
			"agent reminder_or_reexplanation_requests was invalid",
		);
	}
	return {
		completion_status: value.completion_status,
		gate_blocked: value.gate_blocked,
		requirements,
		reminder_or_reexplanation_requests:
			value.reminder_or_reexplanation_requests,
	};
}

function renderWorkAgentBenchmarkMarkdown(
	result: WorkAgentBenchmarkResult,
): string {
	const { disabled, enabled, delta } = result.summary;
	const scenarioRows = result.analysis.scenarios.map((scenario) => {
		return `| ${scenario.id} | ${scenario.class} | ${scenario.paired.token_delta_pct.p50}% (${scenario.paired.token_delta_pct.p95}%) | ${scenario.paired.elapsed_delta_pct.p50}% (${scenario.paired.elapsed_delta_pct.p95}%) | ${scenario.paired.token_pair_wins}/${scenario.paired.pairs} | ${scenario.disabled.status_recall_pct}% → ${scenario.enabled.status_recall_pct}% | ${scenario.disabled.reminders_or_reexplanations} → ${scenario.enabled.reminders_or_reexplanations} |`;
	});
	const classRows = result.analysis.classes.map((analysis) => {
		return `| ${analysis.class} | ${analysis.paired.token_delta_pct.p50}% (${analysis.paired.token_delta_pct.bootstrap_90_ci.low}% to ${analysis.paired.token_delta_pct.bootstrap_90_ci.high}%) | ${analysis.paired.elapsed_delta_pct.p50}% (${analysis.paired.elapsed_delta_pct.bootstrap_90_ci.low}% to ${analysis.paired.elapsed_delta_pct.bootstrap_90_ci.high}%) | ${analysis.paired.token_pair_wins}/${analysis.paired.pairs} |`;
	});
	const overall = result.analysis.overall;
	return `# Work agent A/B benchmark\n\n- Generated: ${result.generated_at}\n- Model: ${result.model}\n- Repetitions per scenario: ${result.runs_per_scenario}\n- Strict contract: ${result.strict ? "enabled" : "disabled"}\n- Planned initial Codex invocations: ${result.planned_invocations}\n- Actual invocations including oracle corrections: ${result.actual_invocations}\n- Equal-information scenarios: ${result.scenario_classes.equal_information.join(", ")}\n- Resilience scenarios: ${result.scenario_classes.resilience.join(", ")}\n- Excluded model failures: ${result.analysis.excluded_model_failures}\n- Contract: ${result.ok ? "PASS" : "FAIL"}\n\n| Metric | Disabled | Enabled | Delta |\n| --- | ---: | ---: | ---: |\n| Total tokens (average/run) | ${disabled.total_tokens} | ${enabled.total_tokens} | ${delta.total_tokens_pct}% |\n| Elapsed ms (average/run) | ${disabled.elapsed_ms} | ${enabled.elapsed_ms} | ${delta.elapsed_pct}% |\n| Paired token delta | — | — | p50 ${overall.token_delta_pct.p50}%, p95 ${overall.token_delta_pct.p95}%, MAD ${overall.token_delta_pct.mad}% |\n| Paired elapsed delta | — | — | p50 ${overall.elapsed_delta_pct.p50}%, p95 ${overall.elapsed_delta_pct.p95}%, MAD ${overall.elapsed_delta_pct.mad}% |\n| Completion correctness | ${disabled.completion_correct_pct}% | ${enabled.completion_correct_pct}% | ${delta.completion_correct_points}pp |\n| Gate correctness | ${disabled.gate_correct_pct}% | ${enabled.gate_correct_pct}% | — |\n| Requirement recall | ${disabled.requirement_recall_pct}% | ${enabled.requirement_recall_pct}% | ${delta.requirement_recall_points}pp |\n| Status recall | ${disabled.status_recall_pct}% | ${enabled.status_recall_pct}% | ${delta.status_recall_points}pp |\n| Summary recall | ${disabled.summary_recall_pct}% | ${enabled.summary_recall_pct}% | — |\n| Hallucinated requirements (average/run) | ${disabled.hallucinated_requirements} | ${enabled.hallucinated_requirements} | — |\n| Duplicate requirement IDs (average/run) | ${disabled.duplicate_requirement_ids} | ${enabled.duplicate_requirement_ids} | — |\n| Missed requirements (average/run) | ${disabled.missed_requirements} | ${enabled.missed_requirements} | ${delta.missed_requirements} |\n| Actual correction rounds (average/run) | ${disabled.reminders_or_reexplanations} | ${enabled.reminders_or_reexplanations} | ${delta.reminders_or_reexplanations} |\n| Re-explained requirements (average/run) | ${disabled.reexplained_requirements} | ${enabled.reexplained_requirements} | — |\n\n## Comparison classes\n\n| Class | Token p50 (90% bootstrap CI) | Elapsed p50 (90% bootstrap CI) | Token wins |\n| --- | ---: | ---: | ---: |\n${classRows.join("\n")}\n\n## Scenario breakdown\n\n| Scenario | Class | Token p50 (p95) | Elapsed p50 (p95) | Token wins | Disabled → enabled status accuracy | Disabled → enabled corrections/run |\n| --- | --- | ---: | ---: | ---: | ---: | ---: |\n${scenarioRows.join("\n")}\n\nEvery accepted answer contains each expected requirement exactly once with an exact ID, status, and summary; hallucinated or duplicate rows trigger deterministic correction. Each paired distribution also records min, max, MAD, and a deterministic 90% bootstrap interval in the JSON artifact. Model failures are scored, never excluded. Prompts, fixture bodies, model answers, and stderr are intentionally excluded from artifacts.\n`;
}

function writeArtifacts(
	result: WorkAgentBenchmarkResult,
	outputPath?: string,
): WorkAgentBenchmarkResult["artifacts"] {
	const outputDir = path.resolve(
		result.project_root,
		outputPath ?? WORK_AGENT_AB_BENCHMARK_OUTPUT_DIR,
	);
	fs.mkdirSync(outputDir, { recursive: true });
	const jsonPath = path.join(outputDir, "work-agent-ab.json");
	const markdownPath = path.join(outputDir, "README.md");
	const artifacts = {
		output_dir: relative(result.project_root, outputDir),
		json: relative(result.project_root, jsonPath),
		markdown: relative(result.project_root, markdownPath),
	};
	const publicArtifacts = {
		output_dir: ".",
		json: path.basename(jsonPath),
		markdown: path.basename(markdownPath),
	};
	fs.writeFileSync(
		jsonPath,
		`${JSON.stringify({ ...result, project_root: ".", artifacts: publicArtifacts }, null, 2)}\n`,
	);
	fs.writeFileSync(markdownPath, result.markdown);
	return artifacts;
}

function isCanonicalBenchmarkOutput(
	projectRoot: string,
	outputPath: string | undefined,
): boolean {
	return (
		path.resolve(
			projectRoot,
			outputPath ?? WORK_AGENT_AB_BENCHMARK_OUTPUT_DIR,
		) === path.resolve(projectRoot, WORK_AGENT_AB_BENCHMARK_OUTPUT_DIR)
	);
}

function check(
	id: string,
	actual: number,
	limit: number,
	comparison: "gte" | "lte",
): WorkAgentContract["checks"][number] {
	return {
		id,
		ok: comparison === "gte" ? actual >= limit : actual <= limit,
		actual: round(actual),
		limit: round(limit),
		comparison,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonnegativeNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: 0;
}

function positiveInteger(value: number, flag: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new WorkAgentBenchmarkError(`${flag} requires a positive integer`);
	}
	return value;
}

function minimumInteger(value: number, minimum: number, flag: string): number {
	positiveInteger(value, flag);
	if (value < minimum) {
		throw new WorkAgentBenchmarkError(
			`${flag} requires at least ${minimum} repetitions`,
		);
	}
	return value;
}

function nonempty(value: string, flag: string): string {
	if (value.trim().length === 0) {
		throw new WorkAgentBenchmarkError(`${flag} requires a value`);
	}
	return value;
}

function average(values: number[]): number {
	return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentage(numerator: number, denominator: number): number {
	return denominator === 0 ? 0 : round((numerator / denominator) * 100);
}

function percentDelta(baseline: number, after: number): number {
	return baseline === 0 ? 0 : round(((after - baseline) / baseline) * 100);
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function relative(projectRoot: string, target: string): string {
	return path.relative(projectRoot, target).split(path.sep).join("/");
}
