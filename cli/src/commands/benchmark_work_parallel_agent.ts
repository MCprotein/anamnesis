import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import YAML from "yaml";
import type { WorkAgentTokenUsage } from "./benchmark_work_agent.js";
import { briefWork, createWork, transitionWork } from "./work.js";
import { renderWorkExecutionPacket } from "./work_hook.js";

export const WORK_PARALLEL_AGENT_SCHEMA_VERSION =
	"anamnesis.work_parallel_agent_ab.v4";
export const WORK_PARALLEL_AGENT_OUTPUT_DIR =
	"docs/benchmark-evidence/work-parallel-agent-ab";
export const DEFAULT_WORK_PARALLEL_AGENT_MODEL = "gpt-5.6-luna";

export type ParallelCondition = "disabled" | "enabled";
export type ParallelProtocol = "validate" | "shadow" | "final" | "legacy";
export type ParallelScenarioFamily =
	| "clean-partition"
	| "stale-cross-session-conflict"
	| "review-gate-recovery";
export type ParallelComparisonVerdict =
	| "INVALID"
	| "FAIL_CRITICAL_QUALITY"
	| "FAIL_ACCURACY"
	| "FAIL_COST"
	| "INCONCLUSIVE"
	| "PASS_PRODUCT"
	| "PASS_EFFICIENCY";
type LegacyVerdict = "PASS_DIRECTIONAL" | "FAIL_REGRESSION";
export type ParallelStage =
	| "leader-plan"
	| "child-a"
	| "child-b"
	| "reviewer"
	| "leader-integrate";

export interface ParallelRequirement {
	id: string;
	status: "verified" | "pending";
	summary: string;
}

export interface ParallelRunnerRequest {
	cwd: string;
	model: string;
	prompt: string;
	outputSchemaPath: string;
}

export interface ParallelRunnerResponse {
	status: number | null;
	stdout: string;
	stderr: string;
	elapsedMs: number;
}

export type ParallelRunner = (
	request: ParallelRunnerRequest,
) => ParallelRunnerResponse | Promise<ParallelRunnerResponse>;

export interface ParallelStageRecord {
	stage: ParallelStage;
	execution_ok: boolean;
	output_correct: boolean;
	token_accounting_complete: boolean;
	elapsed_ms: number;
	start_offset_ms: number;
	end_offset_ms: number;
	/** Deterministic prompt/context input-size proxy; not a token estimate. */
	input_bytes: number;
	input_bytes_complete: boolean;
	input_contract_ok?: boolean;
	tokens: WorkAgentTokenUsage;
	requirement_accuracy_pct?: number;
	expected_requirements?: number;
	exact_requirements?: number;
	unexpected_requirement_rows?: number;
	duplicate_requirement_ids?: number;
	malformed_requirement_rows?: number;
	error?: string;
}

export interface ParallelConditionRun {
	condition: ParallelCondition;
	execution_ok: boolean;
	product_pass: boolean;
	token_accounting_complete: boolean;
	critical_path_ms: number;
	agent_elapsed_ms: number;
	children_overlap_ms: number;
	children_overlap_ratio: number;
	reviewer_started_after_children: boolean;
	child_accuracy_pct: number;
	reviewer_accuracy_pct: number;
	final_accuracy_pct: number;
	final_exact_requirements: number;
	final_defects: number;
	tokens: WorkAgentTokenUsage;
	stages: ParallelStageRecord[];
}

export interface ParallelPairRun {
	iteration: number;
	scenario_id: ParallelScenarioFamily;
	requirement_count: number;
	fixture_hash: string;
	seed: string;
	order: [ParallelCondition, ParallelCondition];
	disabled: ParallelConditionRun;
	enabled: ParallelConditionRun;
}

interface ParallelSummary {
	runs: number;
	complete_passes: number;
	product_pass_pct: number;
	process_perfect_pct: number;
	child_accuracy_pct: number;
	reviewer_accuracy_pct: number;
	final_accuracy_pct: number;
	critical_path_ms: number;
	agent_elapsed_ms: number;
	children_overlap_ms: number;
	total_tokens: number;
	stage_tokens: Record<ParallelStage, number>;
	stage_input_bytes: Record<ParallelStage, number>;
}

export interface ParallelBenchmarkResult {
	schema_version: typeof WORK_PARALLEL_AGENT_SCHEMA_VERSION;
	generated_at: string;
	project_root: string;
	model: string;
	reasoning_effort: "high";
	protocol: ParallelProtocol;
	claim_eligible: boolean;
	implementation_git_sha: string;
	attempts_before_this_sha: number;
	scenario_families: ParallelScenarioFamily[];
	topology: "harness-orchestrated-two-child-reviewer-leader";
	scoring_version: "parallel-requirement-score.v4";
	runs_per_condition: number;
	planned_initial_invocations: number;
	actual_invocations: number;
	fixture_hash: string;
	harness_hash: string;
	reproducibility: {
		package_version: string;
		git_sha: string;
		codex_cli_version: string;
	};
	runs: ParallelPairRun[];
	summary: {
		disabled: ParallelSummary;
		enabled: ParallelSummary;
		delta: { total_tokens_pct: number; critical_path_pct: number };
		paired: {
			total_tokens_pct_p50: number;
			total_tokens_pct_mad: number;
			total_tokens_pct_upper_90: number;
			combined_child_tokens_pct_p50: number;
			combined_child_tokens_pct_upper_90: number;
			reviewer_tokens_pct_p50: number;
			reviewer_tokens_pct_upper_90: number;
			critical_path_pct_p50: number;
			critical_path_pct_mad: number;
			critical_path_pct_upper_90: number;
		};
	};
	harness_validity: { ok: boolean; checks: Record<string, boolean> };
	quality: {
		enabled_ready: boolean;
		disabled_passes: number;
		enabled_passes: number;
		total_per_condition: number;
	};
	comparison: {
		verdict: ParallelComparisonVerdict | LegacyVerdict;
		primary_metric: "final_requirement_accuracy_pct";
		disabled_mean_pct: number;
		enabled_mean_pct: number;
		delta_points: number;
		median_delta_requirements: number;
		minimum_pair_wins: number;
		enabled_pair_wins: number;
		paired_ties: number;
		enabled_pair_losses: number;
		total_pairs: number;
		disabled_aggregate_defects: number;
		enabled_aggregate_defects: number;
		sign_test_p_value: number;
		accuracy_gate: boolean;
		critical_quality_gate: boolean;
		stage_cost_gate: boolean;
		cost_gate: boolean;
		latency_gate: boolean;
	};
	family_summaries: Record<
		ParallelScenarioFamily,
		{
			pairs: number;
			disabled_final_accuracy_pct: number;
			enabled_final_accuracy_pct: number;
			accuracy_delta_points: number;
			enabled_wins: number;
			reviewer_exact: number;
			final_exact: number;
		}
	>;
	ok: boolean;
	artifacts: {
		output_dir?: string;
		json?: string;
		markdown?: string;
		summary_svg?: string;
	};
	markdown: string;
}

export interface ParallelBenchmarkOptions {
	projectRoot: string;
	runs?: number;
	protocol?: ParallelProtocol;
	scenarioFamilies?: ParallelScenarioFamily[];
	implementationSha?: string;
	model?: string;
	write?: boolean;
	outputPath?: string;
	now?: () => Date;
	runner?: ParallelRunner;
	requirements?: ParallelRequirement[];
	artifactOperations?: {
		renameSync: typeof fs.renameSync;
		rmSync: typeof fs.rmSync;
	};
	onPlan?: (plan: { runs: number; invocations: number }) => void;
}

const EMPTY_USAGE: WorkAgentTokenUsage = {
	input_tokens: 0,
	cached_input_tokens: 0,
	output_tokens: 0,
	total_tokens: 0,
};
const TOPOLOGY = "harness-orchestrated-two-child-reviewer-leader" as const;
const REASONING_EFFORT = "high" as const;
const STAGES: ParallelStage[] = [
	"leader-plan",
	"child-a",
	"child-b",
	"reviewer",
	"leader-integrate",
];

const PLAN_SCHEMA = strictObject(["child_a", "child_b"], {
	child_a: { type: "array", items: { type: "string" } },
	child_b: { type: "array", items: { type: "string" } },
});
const REQUIREMENTS_ARRAY_SCHEMA = {
	type: "array",
	items: strictObject(["id", "status", "summary"], {
		id: { type: "string" },
		status: { type: "string", enum: ["verified", "pending"] },
		summary: { type: "string" },
	}),
};
const REQUIREMENTS_SCHEMA = strictObject(["requirements"], {
	requirements: REQUIREMENTS_ARRAY_SCHEMA,
});
const REVIEW_SCHEMA = strictObject(
	[
		"requirements",
		"verdict",
		"missing_ids",
		"duplicate_ids",
		"unexpected_ids",
		"misassigned_ids",
		"status_mismatch_ids",
		"summary_mismatch_ids",
		"malformed_rows",
		"order_ok",
	],
	{
		requirements: REQUIREMENTS_ARRAY_SCHEMA,
		verdict: { type: "string", enum: ["accept", "repair"] },
		missing_ids: { type: "array", items: { type: "string" } },
		duplicate_ids: { type: "array", items: { type: "string" } },
		unexpected_ids: { type: "array", items: { type: "string" } },
		misassigned_ids: { type: "array", items: { type: "string" } },
		status_mismatch_ids: { type: "array", items: { type: "string" } },
		summary_mismatch_ids: { type: "array", items: { type: "string" } },
		malformed_rows: { type: "integer" },
		order_ok: { type: "boolean" },
	},
);

export async function workParallelAgentBenchmark(
	options: ParallelBenchmarkOptions,
): Promise<ParallelBenchmarkResult> {
	const projectRoot = path.resolve(options.projectRoot);
	const protocol = options.protocol;
	const frozenProtocol = protocol !== undefined && protocol !== "legacy";
	if (frozenProtocol && options.runs !== undefined) {
		throw new Error("runs cannot override a frozen benchmark protocol");
	}
	if (
		frozenProtocol &&
		options.scenarioFamilies !== undefined
	) {
		throw new Error("scenario families cannot override a frozen benchmark protocol");
	}
	if (frozenProtocol && options.requirements !== undefined) {
		throw new Error("requirements cannot override a frozen benchmark protocol");
	}
	if (
		(protocol === "shadow" || protocol === "final") &&
		options.runner !== undefined
	) {
		throw new Error(`${protocol} protocol requires the real Codex runner`);
	}
	const runs =
		protocol === "final"
			? 3
			: protocol === "shadow"
				? 1
				: parseRuns(options.runs ?? 3);
	const scenarioFamilies = frozenProtocol
		? (options.scenarioFamilies ?? [
				"clean-partition",
				"stale-cross-session-conflict",
				"review-gate-recovery",
			])
		: (options.scenarioFamilies ?? ["clean-partition"]);
	const model = options.model?.trim() || DEFAULT_WORK_PARALLEL_AGENT_MODEL;
	const runner =
		protocol === "validate"
			? validationRunner
			: (options.runner ?? runCodexExec);
	const requirements = options.requirements ?? defaultRequirements();
	const reproducibility = collectReproducibility(projectRoot);
	if (
		(protocol === "shadow" || protocol === "final") &&
		options.implementationSha !== undefined &&
		options.implementationSha !== reproducibility.git_sha
	) {
		throw new Error(`${protocol} implementation SHA must match HEAD`);
	}
	const finalGuard = prepareFinalProtocol(
		projectRoot,
		protocol,
		options.write === true,
		options.outputPath,
		reproducibility.git_sha,
	);
	const implementationSha = options.implementationSha ?? reproducibility.git_sha;
	const harnessHash = digest({
		schema: WORK_PARALLEL_AGENT_SCHEMA_VERSION,
		topology: TOPOLOGY,
		stages: STAGES,
		reasoning_effort: REASONING_EFFORT,
		scoring_version: "parallel-requirement-score.v4",
		families: scenarioFamilies,
		final_pairs_per_family: 3,
		accuracy: { mean_delta_points: 5, one_sided_p: 0.05, wins: 6, family_floor: -2 },
		quality: { exact_overall: "8/9", exact_per_family: "2/3", final_defects: 0 },
		tokens: { aggregate_pct: 5, median_pct: 5, bootstrap_upper_90_pct: 10 },
		stage_tokens: {
			combined_children: { median_pct: 0, bootstrap_upper_90_pct: 5 },
			reviewer: { median_pct: 0, bootstrap_upper_90_pct: 5 },
		},
		latency: { median_pct: 10, bootstrap_upper_90_pct: 20 },
		reviewer_schema: REVIEW_SCHEMA,
	});
	const fixtureHash = digest(
		scenarioFamilies.flatMap((family) =>
			Array.from({ length: runs }, (_, index) =>
				buildScenarioFixture(requirements, family, frozenProtocol ? index + 1 : 0),
			),
		),
	);
	const plannedInitialInvocations =
		runs * scenarioFamilies.length * 2 * STAGES.length;
	options.onPlan?.({ runs, invocations: plannedInitialInvocations });

	const tempRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-parallel-agent-"),
	);
	const schemas = writeSchemas(tempRoot);
	const pairs: ParallelPairRun[] = [];
	let equalAuthoritativeFacts = true;
	try {
		for (const scenario_id of scenarioFamilies)
			for (let iteration = 1; iteration <= runs; iteration += 1) {
				const pairOrdinal =
					scenarioFamilies.indexOf(scenario_id) * runs + iteration;
				const scenario = buildScenarioFixture(
					requirements,
					scenario_id,
					frozenProtocol ? iteration : 0,
				);
				const scenarioRequirements = scenario.requirements;
				const order: [ParallelCondition, ParallelCondition] =
					pairOrdinal % 2 === 1
						? ["disabled", "enabled"]
						: ["enabled", "disabled"];
				const conditions = {} as Record<
					ParallelCondition,
					ParallelConditionRun
				>;
				const fixtures = {} as Record<
					ParallelCondition,
					{ cwd: string; factHash: string }
				>;
				for (const condition of ["disabled", "enabled"] as const) {
					const cwd = path.join(
						tempRoot,
						protocol === undefined
							? `${iteration}-${condition}`
							: `case-${iteration}-${digest({ scenario_id, condition }).slice(0, 12)}`,
					);
					fs.mkdirSync(cwd);
					const rendered: { context: string; factHash: string; childPackets?: string[] } =
						condition === "enabled"
							? materializeWorkContext(cwd, scenarioRequirements)
							: {
									context: scenario.legacyContext,
									factHash: digest(scenarioRequirements),
								};
					fs.writeFileSync(path.join(cwd, "CONTEXT.md"), rendered.context);
					if (condition === "enabled") {
						fs.writeFileSync(
			path.join(cwd, "CHILD_A.md"),
			rendered.childPackets![0]!,
						);
						fs.writeFileSync(
							path.join(cwd, "CHILD_B.md"),
			rendered.childPackets![1]!,
						);
					}
					fixtures[condition] = { cwd, factHash: rendered.factHash };
				}
				const pairFactsEqual =
					fixtures.disabled.factHash === digest(scenarioRequirements) &&
					fixtures.enabled.factHash === digest(scenarioRequirements);
				equalAuthoritativeFacts &&= pairFactsEqual;
				if (!pairFactsEqual) {
					throw new Error(
						"disabled/enabled authoritative fact hashes differ; refusing paid calls",
					);
				}
				for (const condition of order) {
					conditions[condition] = await executeCondition({
						condition,
						scenarioId: scenario_id,
						seed: digest({
							harness: harnessHash,
							family: scenario_id,
							replicate: iteration,
							implementation: implementationSha,
						}),
						cwd: fixtures[condition].cwd,
						model,
						runner,
						schemas,
						requirements: scenarioRequirements,
					});
				}
				pairs.push({
					iteration,
					scenario_id,
					requirement_count: scenarioRequirements.length,
					fixture_hash: digest(scenario),
					seed: digest({
					harness: harnessHash,
						implementation:
							implementationSha,
						family: scenario_id,
						replicate: iteration,
					}),
					order,
					disabled: conditions.disabled,
					enabled: conditions.enabled,
				});
			}
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}

	const allRuns = pairs.flatMap((pair) => [pair.disabled, pair.enabled]);
	const disabled = summarize(pairs.map((pair) => pair.disabled));
	const enabled = summarize(pairs.map((pair) => pair.enabled));
	const pairedTokenDeltas = pairs.map((pair) =>
		percent(
			pair.disabled.tokens.total_tokens,
			pair.enabled.tokens.total_tokens,
		),
	);
	const pairedCriticalPathDeltas = pairs.map((pair) =>
		percent(pair.disabled.critical_path_ms, pair.enabled.critical_path_ms),
	);
	const pairedCombinedChildTokenDeltas = pairs.map((pair) =>
		percent(
			stageTokens(pair.disabled, ["child-a", "child-b"]),
			stageTokens(pair.enabled, ["child-a", "child-b"]),
		),
	);
	const pairedReviewerTokenDeltas = pairs.map((pair) =>
		percent(
			stageTokens(pair.disabled, ["reviewer"]),
			stageTokens(pair.enabled, ["reviewer"]),
		),
	);
	const checks = {
		equal_authoritative_facts: equalAuthoritativeFacts,
		exactly_five_stages: allRuns.every(
			(run) =>
				run.stages.length === STAGES.length &&
				STAGES.every((stage) =>
					run.stages.some((record) => record.stage === stage),
				),
		),
		full_token_accounting: allRuns.every(
			(run) =>
				run.token_accounting_complete &&
				run.stages.reduce(
					(total, stage) => total + stage.tokens.total_tokens,
					0,
				) === run.tokens.total_tokens,
		),
		full_input_byte_accounting: allRuns.every((run) =>
			run.stages.every((stage) => stage.input_bytes_complete),
		),
		children_overlapped: allRuns.every((run) => run.children_overlap_ms > 0),
		leader_plan_exact: allRuns.every(
			(run) =>
				run.stages.find((stage) => stage.stage === "leader-plan")
					?.output_correct === true,
		),
		enabled_child_packets_exact: pairs.every((pair) =>
			pair.enabled.stages
				.filter(
					(stage) => stage.stage === "child-a" || stage.stage === "child-b",
				)
				.every((stage) => stage.input_contract_ok === true),
		),
		unique_pair_fixtures:
			!frozenProtocol ||
			new Set(pairs.map((pair) => pair.fixture_hash)).size === pairs.length,
		reviewer_after_children: allRuns.every(
			(run) => run.reviewer_started_after_children,
		),
		all_processes_returned: allRuns.every((run) => run.execution_ok),
		no_excluded_conditions:
			allRuns.length === runs * scenarioFamilies.length * 2,
		condition_order_alternated: pairs.every(
			(pair, index) =>
				pair.order[0] === (index % 2 === 0 ? "disabled" : "enabled"),
		),
		enabled_child_inputs_shrink: !frozenProtocol || pairs.every((pair) =>
			pair.enabled.stages
				.filter((stage) => stage.stage === "child-a" || stage.stage === "child-b")
				.reduce((total, stage) => total + stage.input_bytes, 0) <
			pair.disabled.stages
				.filter((stage) => stage.stage === "child-a" || stage.stage === "child-b")
				.reduce((total, stage) => total + stage.input_bytes, 0),
		),
		enabled_reviewer_input_shrinks: !frozenProtocol || pairs.every((pair) =>
			(pair.enabled.stages.find((stage) => stage.stage === "reviewer")?.input_bytes ?? 0) <
			(pair.disabled.stages.find((stage) => stage.stage === "reviewer")?.input_bytes ?? 0),
		),
		scenario_contract_frozen:
			protocol === undefined ||
			pairs.every(
				(pair) =>
					pair.requirement_count ===
					({
						"clean-partition": 24,
						"stale-cross-session-conflict": 32,
						"review-gate-recovery": 48,
					} as const)[pair.scenario_id],
			),
	};
	const harnessValidity = {
		ok: Object.values(checks).every(Boolean),
		checks,
	};
	const disabledPasses = pairs.filter(
		(pair) => pair.disabled.product_pass,
	).length;
	const enabledPasses = pairs.filter(
		(pair) => pair.enabled.product_pass,
	).length;
	const quality = {
		enabled_ready: enabledPasses >= Math.ceil((pairs.length * 8) / 9),
		disabled_passes: disabledPasses,
		enabled_passes: enabledPasses,
		total_per_condition: pairs.length,
	};
	const familySummaries = Object.fromEntries(
		scenarioFamilies.map((family) => {
			const familyPairs = pairs.filter((pair) => pair.scenario_id === family);
			const familyDisabled = summarize(
				familyPairs.map((pair) => pair.disabled),
			);
			const familyEnabled = summarize(familyPairs.map((pair) => pair.enabled));
			return [
				family,
				{
					pairs: familyPairs.length,
					disabled_final_accuracy_pct: familyDisabled.final_accuracy_pct,
					enabled_final_accuracy_pct: familyEnabled.final_accuracy_pct,
					accuracy_delta_points: round(
						familyEnabled.final_accuracy_pct -
							familyDisabled.final_accuracy_pct,
					),
					enabled_wins: familyPairs.filter(
						(pair) =>
							pair.enabled.final_exact_requirements >
							pair.disabled.final_exact_requirements,
					).length,
					reviewer_exact: familyPairs.filter(
						(pair) =>
							pair.enabled.stages.find((stage) => stage.stage === "reviewer")
								?.output_correct === true,
					).length,
					final_exact: familyPairs.filter(
						(pair) => pair.enabled.final_accuracy_pct === 100,
					).length,
				},
			];
		}),
	) as ParallelBenchmarkResult["family_summaries"];
	const pairedAccuracyDeltas = pairs.map(
		(pair) =>
			pair.enabled.final_accuracy_pct - pair.disabled.final_accuracy_pct,
	);
	const pairedExactRequirementDeltas = pairs.map(
		(pair) =>
			pair.enabled.final_exact_requirements -
			pair.disabled.final_exact_requirements,
	);
	const enabledPairWins = pairedAccuracyDeltas.filter(
		(delta) => delta > 0,
	).length;
	const enabledPairLosses = pairedAccuracyDeltas.filter(
		(delta) => delta < 0,
	).length;
	const pairedTies = pairs.length - enabledPairWins - enabledPairLosses;
	const minimumPairWins = Math.ceil((pairs.length * 2) / 3);
	const medianDeltaRequirements = median(pairedExactRequirementDeltas);
	const disabledAggregateDefects = pairs.reduce(
		(total, pair) => total + pair.disabled.final_defects,
		0,
	);
	const enabledAggregateDefects = pairs.reduce(
		(total, pair) => total + pair.enabled.final_defects,
		0,
	);
	const accuracyDeltaPoints = round(
		enabled.final_accuracy_pct - disabled.final_accuracy_pct,
	);
	const signTestPValue = exactOneSidedSignPValue(
		enabledPairWins,
		enabledPairLosses,
	);
	const accuracyGate =
		accuracyDeltaPoints >= 5 &&
		signTestPValue <= 0.05 &&
		enabledPairWins >= Math.min(6, minimumPairWins);
	const criticalQualityGate =
		enabledPasses >= Math.ceil((pairs.length * 8) / 9) &&
		enabledAggregateDefects === 0 &&
		scenarioFamilies.every((family) => {
			const summary = familySummaries[family];
			return (
				summary.accuracy_delta_points >= -2 &&
				summary.reviewer_exact >= Math.ceil((summary.pairs * 2) / 3) &&
				summary.final_exact >= Math.ceil((summary.pairs * 2) / 3)
			);
		});
	const tokenUpper90 = stratifiedBootstrapUpper90(pairs, (pair) =>
		percent(pair.disabled.tokens.total_tokens, pair.enabled.tokens.total_tokens),
	);
	const combinedChildTokenUpper90 = stratifiedBootstrapUpper90(pairs, (pair) =>
		percent(
			stageTokens(pair.disabled, ["child-a", "child-b"]),
			stageTokens(pair.enabled, ["child-a", "child-b"]),
		),
	);
	const reviewerTokenUpper90 = stratifiedBootstrapUpper90(pairs, (pair) =>
		percent(
			stageTokens(pair.disabled, ["reviewer"]),
			stageTokens(pair.enabled, ["reviewer"]),
		),
	);
	const latencyUpper90 = stratifiedBootstrapUpper90(pairs, (pair) =>
		percent(pair.disabled.critical_path_ms, pair.enabled.critical_path_ms),
	);
	const stageCostGate =
		median(pairedCombinedChildTokenDeltas) <= 0 &&
		combinedChildTokenUpper90 <= 5 &&
		median(pairedReviewerTokenDeltas) <= 0 &&
		reviewerTokenUpper90 <= 5;
	const costGate =
		percent(disabled.total_tokens, enabled.total_tokens) <= 5 &&
		median(pairedTokenDeltas) <= 5 &&
		tokenUpper90 <= 10 &&
		stageCostGate;
	const latencyGate =
		median(pairedCriticalPathDeltas) <= 10 && latencyUpper90 <= 20;
	const efficiencyGate =
		(median(pairedTokenDeltas) <= -10 && tokenUpper90 < 0) ||
		(median(pairedCriticalPathDeltas) <= -10 && latencyUpper90 < 0);
	const comparisonVerdict: ParallelComparisonVerdict | LegacyVerdict =
		protocol === undefined || protocol === "legacy"
			? !harnessValidity.ok
				? "INVALID"
				: enabledPairWins >= minimumPairWins &&
						medianDeltaRequirements >= 1 &&
						enabledAggregateDefects <= disabledAggregateDefects
					? "PASS_DIRECTIONAL"
					: enabledPairLosses >= minimumPairWins &&
							medianDeltaRequirements <= -1
						? "FAIL_REGRESSION"
						: "INCONCLUSIVE"
			: !harnessValidity.ok
				? "INVALID"
				: protocol !== "final"
					? "INCONCLUSIVE"
				: !criticalQualityGate
					? "FAIL_CRITICAL_QUALITY"
					: !accuracyGate
						? "FAIL_ACCURACY"
						: !costGate
							? "FAIL_COST"
							: !latencyGate
								? "INCONCLUSIVE"
								: efficiencyGate
									? "PASS_EFFICIENCY"
									: "PASS_PRODUCT";
	const result: ParallelBenchmarkResult = {
		schema_version: WORK_PARALLEL_AGENT_SCHEMA_VERSION,
		generated_at: (options.now ?? (() => new Date()))().toISOString(),
		project_root: projectRoot,
		model,
		reasoning_effort: REASONING_EFFORT,
		claim_eligible: protocol === "final",
		implementation_git_sha: implementationSha,
		attempts_before_this_sha: finalGuard.attemptsBefore,
		topology: TOPOLOGY,
		protocol: protocol ?? "legacy",
		scenario_families: scenarioFamilies,
		runs_per_condition: runs,
		scoring_version: "parallel-requirement-score.v4",
		planned_initial_invocations: plannedInitialInvocations,
		actual_invocations: allRuns.reduce(
			(total, run) => total + run.stages.length,
			0,
		),
		fixture_hash: fixtureHash,
		harness_hash: harnessHash,
		reproducibility,
		runs: pairs,
		summary: {
			disabled,
			enabled,
			delta: {
				total_tokens_pct: percent(disabled.total_tokens, enabled.total_tokens),
				critical_path_pct: percent(
					disabled.critical_path_ms,
					enabled.critical_path_ms,
				),
			},
			paired: {
				total_tokens_pct_p50: median(pairedTokenDeltas),
				total_tokens_pct_mad: medianAbsoluteDeviation(pairedTokenDeltas),
				total_tokens_pct_upper_90: tokenUpper90,
				combined_child_tokens_pct_p50: median(
					pairedCombinedChildTokenDeltas,
				),
				combined_child_tokens_pct_upper_90: combinedChildTokenUpper90,
				reviewer_tokens_pct_p50: median(pairedReviewerTokenDeltas),
				reviewer_tokens_pct_upper_90: reviewerTokenUpper90,
				critical_path_pct_p50: median(pairedCriticalPathDeltas),
				critical_path_pct_mad: medianAbsoluteDeviation(
					pairedCriticalPathDeltas,
				),
				critical_path_pct_upper_90: latencyUpper90,
			},
		},
		harness_validity: harnessValidity,
		quality,
		comparison: {
			verdict: comparisonVerdict,
			primary_metric: "final_requirement_accuracy_pct",
			disabled_mean_pct: disabled.final_accuracy_pct,
			enabled_mean_pct: enabled.final_accuracy_pct,
			delta_points: accuracyDeltaPoints,
			median_delta_requirements: medianDeltaRequirements,
			minimum_pair_wins: minimumPairWins,
			enabled_pair_wins: enabledPairWins,
			paired_ties: pairedTies,
			enabled_pair_losses: enabledPairLosses,
			total_pairs: pairs.length,
			disabled_aggregate_defects: disabledAggregateDefects,
			enabled_aggregate_defects: enabledAggregateDefects,
			sign_test_p_value: signTestPValue,
			accuracy_gate: accuracyGate,
			critical_quality_gate: criticalQualityGate,
			stage_cost_gate: stageCostGate,
			cost_gate: costGate,
			latency_gate: latencyGate,
		},
		family_summaries: familySummaries,
		ok:
			harnessValidity.ok &&
			(protocol !== "final" ||
				comparisonVerdict === "PASS_PRODUCT" ||
				comparisonVerdict === "PASS_EFFICIENCY"),
		artifacts: {},
		markdown: "",
	};
	result.markdown = addStageCostRows(
		renderParallelBenchmarkMarkdown(result),
		result,
	);
	if (options.write) {
		result.artifacts = publishParallelArtifacts(
			result,
			options.outputPath,
			options.artifactOperations,
		);
		if (protocol === "final") {
			recordFinalAttempt(projectRoot, options.outputPath, result);
		}
	}
	return result;
}

async function executeCondition(input: {
	condition: ParallelCondition;
	scenarioId: ParallelScenarioFamily;
	seed: string;
	cwd: string;
	model: string;
	runner: ParallelRunner;
	schemas: Record<ParallelStage, string>;
	requirements: ParallelRequirement[];
}): Promise<ParallelConditionRun> {
	const conditionStart = performance.now();
	const records: ParallelStageRecord[] = [];
	const ids = input.requirements.map((requirement) => requirement.id);
	const half = Math.ceil(ids.length / 2);
	const expectedA = ids.slice(0, half);
	const expectedB = ids.slice(half);
	const invoke = async (
		stage: ParallelStage,
		prompt: string,
		inputPaths: string[] = [],
	): Promise<{
		record: ParallelStageRecord;
		data: Record<string, unknown>;
	}> => {
		const started = performance.now();
		let response: ParallelRunnerResponse;
		try {
			response = await input.runner({
				cwd: input.cwd,
				model: input.model,
				prompt: `[parallel-stage:${stage}]\n${prompt}`,
				outputSchemaPath: input.schemas[stage],
			});
		} catch {
			const ended = performance.now();
			const measuredInput = measureInputBytes(prompt, inputPaths);
			const record: ParallelStageRecord = {
				stage,
				execution_ok: false,
				output_correct: false,
				token_accounting_complete: false,
				elapsed_ms: round(ended - started),
				start_offset_ms: round(started - conditionStart),
				end_offset_ms: round(ended - conditionStart),
				input_bytes: measuredInput.bytes,
				input_bytes_complete: measuredInput.complete,
				tokens: { ...EMPTY_USAGE },
				error: "runner-threw",
			};
			records.push(record);
			return { record, data: {} };
		}
		const ended = performance.now();
		const parsed = parseStageJsonl(response.stdout);
		const measuredInput = measureInputBytes(prompt, inputPaths);
		const record: ParallelStageRecord = {
			stage,
			execution_ok: response.status === 0 && parsed.data !== undefined,
			output_correct: false,
			token_accounting_complete: parsed.usage !== undefined,
			elapsed_ms: round(response.elapsedMs),
			start_offset_ms: round(started - conditionStart),
			end_offset_ms: round(ended - conditionStart),
			input_bytes: measuredInput.bytes,
			input_bytes_complete: measuredInput.complete,
			tokens: parsed.usage ?? { ...EMPTY_USAGE },
			...(response.status === 0 && parsed.data !== undefined
				? {}
				: { error: "codex-stage-failed" }),
		};
		records.push(record);
		return { record, data: parsed.data ?? {} };
	};
	const plan = await invoke(
		"leader-plan",
		`Scenario ${input.scenarioId}; replicate seed ${input.seed}. Read CONTEXT.md. Partition all authoritative requirement IDs in source order into two contiguous groups of ${expectedA.length} and ${expectedB.length}. Return only child_a and child_b arrays.`,
		[path.join(input.cwd, "CONTEXT.md")],
	);
	const planExact =
		equalStringArrays(plan.data.child_a, expectedA) &&
		equalStringArrays(plan.data.child_b, expectedB);
	const planA = planExact ? (plan.data.child_a as string[]) : expectedA;
	const planB = planExact ? (plan.data.child_b as string[]) : expectedB;
	const childAInputExact =
		input.condition !== "enabled" ||
		workPacketSubsetExact(
			input.cwd,
			"CHILD_A.md",
			input.requirements.slice(0, half),
		);
	const childBInputExact =
		input.condition !== "enabled" ||
		workPacketSubsetExact(
			input.cwd,
			"CHILD_B.md",
			input.requirements.slice(half),
		);
	const [childA, childB] = await Promise.all([
		invoke(
			"child-a",
			`Scenario ${input.scenarioId}; replicate seed ${input.seed}. ${input.condition === "enabled" ? "Read CHILD_A.md, the assigned Work execution packet subset." : "Read CONTEXT.md, the authoritative context."} Return exact id, status, and summary for only these assigned requirements, in this order: ${planA.join(", ")}.`,
			input.condition === "enabled"
				? [path.join(input.cwd, "CHILD_A.md")]
				: [path.join(input.cwd, "CONTEXT.md")],
		),
		invoke(
			"child-b",
			`Scenario ${input.scenarioId}; replicate seed ${input.seed}. ${input.condition === "enabled" ? "Read CHILD_B.md, the assigned Work execution packet subset." : "Read CONTEXT.md, the authoritative context."} Return exact id, status, and summary for only these assigned requirements, in this order: ${planB.join(", ")}.`,
			input.condition === "enabled"
				? [path.join(input.cwd, "CHILD_B.md")]
				: [path.join(input.cwd, "CONTEXT.md")],
		),
	]);
	childA.record.input_contract_ok = childAInputExact;
	childB.record.input_contract_ok = childBInputExact;
	const reviewedInputs = perturbReviewInputs(
		input.scenarioId,
		childA.data.requirements,
		childB.data.requirements,
	);
	const reviewPacketPath = path.join(input.cwd, "CHILD_REPORTS.json");
	fs.writeFileSync(
		reviewPacketPath,
		`${renderCompactReviewPacket(reviewedInputs.childA, reviewedInputs.childB)}\n`,
	);
	const reviewer = await invoke(
		"reviewer",
		`Read ${input.condition === "enabled" ? "CONTEXT.md" : "CONTEXT.md (legacy context)"} as authoritative truth and CHILD_REPORTS.json as compact [id,status,summary] child tuples. Child A is assigned: ${expectedA.join(", ")}. Child B is assigned: ${expectedB.join(", ")}. Return corrected exact requirements in source order plus the exact issue-ID arrays, malformed_rows count, order_ok, and verdict=accept only when every issue array is empty, malformed_rows is zero, and order is correct; otherwise verdict=repair.`,
		[path.join(input.cwd, "CONTEXT.md"), reviewPacketPath],
	);
	const final = await invoke(
		"leader-integrate",
		`Use only the authoritative reviewer requirements (do not reread CONTEXT.md and do not use reviewer issue metadata): ${JSON.stringify(reviewer.data.requirements ?? [])}. Return every requirement exactly once in expected order: ${ids.join(", ")}.`,
	);
	plan.record.output_correct = plan.record.execution_ok && planExact;
	const expectedChildA = input.requirements.slice(0, half);
	const expectedChildB = input.requirements.slice(half);
	const childAScore = scoreRequirements(
		childA.data.requirements,
		expectedChildA,
	);
	const childBScore = scoreRequirements(
		childB.data.requirements,
		expectedChildB,
	);
	applyRequirementScore(childA.record, childAScore);
	applyRequirementScore(childB.record, childBScore);
	childA.record.output_correct =
		childA.record.execution_ok && childAScore.exact;
	childB.record.output_correct =
		childB.record.execution_ok && childBScore.exact;
	const childReportAnalysis = analyzeChildReports(
		reviewedInputs.childA,
		reviewedInputs.childB,
		expectedChildA,
		expectedChildB,
	);
	const reviewerScore = scoreRequirements(
		reviewer.data.requirements,
		input.requirements,
	);
	applyRequirementScore(reviewer.record, reviewerScore);
	reviewer.record.output_correct =
		reviewer.record.execution_ok &&
		reviewerScore.exact &&
		reviewer.data.verdict === childReportAnalysis.verdict &&
		equalStringArrays(
			reviewer.data.missing_ids,
			childReportAnalysis.missingIds,
		) &&
		equalStringArrays(
			reviewer.data.duplicate_ids,
			childReportAnalysis.duplicateIds,
		) &&
		equalStringArrays(
			reviewer.data.unexpected_ids,
			childReportAnalysis.unexpectedIds,
		) &&
		equalStringArrays(
			reviewer.data.misassigned_ids,
			childReportAnalysis.misassignedIds,
		) &&
		equalStringArrays(
			reviewer.data.status_mismatch_ids,
			childReportAnalysis.statusMismatchIds,
		) &&
		equalStringArrays(
			reviewer.data.summary_mismatch_ids,
			childReportAnalysis.summaryMismatchIds,
		) &&
		reviewer.data.malformed_rows === childReportAnalysis.malformedRows &&
		reviewer.data.order_ok === childReportAnalysis.orderOk;
	const finalScore = scoreRequirements(
		final.data.requirements,
		input.requirements,
	);
	applyRequirementScore(final.record, finalScore);
	final.record.output_correct = final.record.execution_ok && finalScore.exact;
	const childStart = Math.max(
		childA.record.start_offset_ms,
		childB.record.start_offset_ms,
	);
	const childEnd = Math.min(
		childA.record.end_offset_ms,
		childB.record.end_offset_ms,
	);
	const childrenOverlapMs = round(Math.max(0, childEnd - childStart));
	const childStageSpan =
		Math.max(childA.record.end_offset_ms, childB.record.end_offset_ms) -
		Math.min(childA.record.start_offset_ms, childB.record.start_offset_ms);
	const reviewerStartedAfterChildren =
		reviewer.record.start_offset_ms >=
		Math.max(childA.record.end_offset_ms, childB.record.end_offset_ms);
	const ended = performance.now();
	const tokens = records.reduce(addUsage, { ...EMPTY_USAGE });
	return {
		condition: input.condition,
		execution_ok: records.every((record) => record.execution_ok),
		product_pass: reviewer.record.output_correct && final.record.output_correct,
		token_accounting_complete: records.every(
			(record) => record.token_accounting_complete,
		),
		critical_path_ms: round(ended - conditionStart),
		agent_elapsed_ms: round(
			records.reduce((total, record) => total + record.elapsed_ms, 0),
		),
		children_overlap_ms: childrenOverlapMs,
		children_overlap_ratio: round(
			childStageSpan > 0 ? childrenOverlapMs / childStageSpan : 0,
		),
		reviewer_started_after_children: reviewerStartedAfterChildren,
		child_accuracy_pct: round(
			((childAScore.exactRequirements + childBScore.exactRequirements) * 100) /
				input.requirements.length,
		),
		reviewer_accuracy_pct: reviewerScore.accuracyPct,
		final_accuracy_pct: finalScore.accuracyPct,
		final_exact_requirements: finalScore.exactRequirements,
		final_defects: finalScore.unexpectedRows + finalScore.duplicateIds,
		tokens,
		stages: records,
	};
}

function parseStageJsonl(stdout: string): {
	data?: Record<string, unknown>;
	usage?: WorkAgentTokenUsage;
} {
	let text: string | undefined;
	let usage: WorkAgentTokenUsage | undefined;
	for (const raw of stdout.split(/\r?\n/u)) {
		if (!raw.trim()) continue;
		let event: unknown;
		try {
			event = JSON.parse(raw);
		} catch {
			continue;
		}
		if (!event || typeof event !== "object") continue;
		const record = event as Record<string, unknown>;
		const item = record.item;
		if (
			record.type === "item.completed" &&
			item &&
			typeof item === "object" &&
			(item as Record<string, unknown>).type === "agent_message" &&
			typeof (item as Record<string, unknown>).text === "string"
		) {
			text = (item as Record<string, unknown>).text as string;
		}
		if (
			record.type === "turn.completed" &&
			record.usage &&
			typeof record.usage === "object"
		) {
			usage = parseUsage(record.usage);
		}
	}
	let data: Record<string, unknown> | undefined;
	if (text) {
		try {
			const parsed = JSON.parse(text) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				data = parsed as Record<string, unknown>;
			}
		} catch {
			// A malformed answer remains a product failure; any usage is retained.
		}
	}
	return { data, usage };
}

function materializeWorkContext(
	projectRoot: string,
	requirements: ParallelRequirement[],
): { context: string; factHash: string; childPackets: string[] } {
	fs.writeFileSync(
		path.join(projectRoot, "Agentfile"),
		YAML.stringify({
			version: 2,
			project: { name: "sanitized-parallel-benchmark" },
			tools: ["codex"],
			fragments: [],
			settings: {
				work_policy: {
					reconciliation: { preset: "adaptive" },
					review: { preset: "advisory" },
					delegation: { parallelism: "auto" },
				},
			},
		}),
	);
	let mutation = createWork({
		project_root: projectRoot,
		work_id: "wu_parallel_sanitized",
		event_id: "evt_parallel_create",
		occurred_at: "2026-08-20T00:00:00.000Z",
		expected_head: null,
		draft: Buffer.from(
			YAML.stringify({
				work: {
					title: "Sanitized parallel benchmark",
					completion_contract:
						"Recover every authoritative requirement exactly.",
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
					source_event_ids: ["src_parallel"],
				})),
				open_conflicts: [],
			}),
		),
		source_stdin: {
			event_id: "src_parallel",
			captured_at: "2026-08-20T00:00:00.000Z",
			client: "codex",
			content_type: "text/plain; charset=utf-8",
			fidelity: "native_exact",
			allocation_status: "allocated",
			body: Buffer.from("sanitized parallel benchmark requirements"),
		},
	});
	for (const [index, requirement] of requirements.entries()) {
		if (requirement.status !== "verified") continue;
		mutation = transitionWork({
			project_root: projectRoot,
			work_id: "wu_parallel_sanitized",
			event_id: `evt_parallel_verify_${index}`,
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
		work_id: "wu_parallel_sanitized",
		cursor_id: "parallel-benchmark",
		client_session_ref: "sanitized-session",
		occurred_at: "2026-08-20T01:00:00.000Z",
	});
	const briefingFacts = brief.briefing.requirements.map((requirement) => ({
		id: requirement.id,
		status: requirement.status,
		summary: requirement.summary,
	}));
	return {
		context: `# Anamnesis Work context\n\n${renderWorkExecutionPacket(
			brief.briefing,
			{ max_bytes: 50_000 },
		)}\n`,
		childPackets: [
			renderWorkExecutionPacket(brief.briefing, {
				requirement_ids: requirements.slice(0, Math.ceil(requirements.length / 2)).map((requirement) => requirement.id),
				max_bytes: 50_000,
			}),
			renderWorkExecutionPacket(brief.briefing, {
				requirement_ids: requirements.slice(Math.ceil(requirements.length / 2)).map((requirement) => requirement.id),
				max_bytes: 50_000,
			}),
		],
		factHash: digest(briefingFacts),
	};
}

function renderCompactReviewPacket(childA: unknown, childB: unknown): string {
	const encode = (value: unknown): unknown[] => {
		if (!Array.isArray(value)) return [["$malformed"]];
		return value.map((row) => {
			if (!row || typeof row !== "object" || Array.isArray(row)) {
				return ["$malformed"];
			}
			const record = row as Record<string, unknown>;
			return [record.id ?? null, record.status ?? null, record.summary ?? null];
		});
	};
	return JSON.stringify({ child_a: encode(childA), child_b: encode(childB) });
}

function measureInputBytes(
	prompt: string,
	inputPaths: string[],
): { bytes: number; complete: boolean } {
	let bytes = Buffer.byteLength(prompt, "utf8");
	for (const file of inputPaths) {
		try {
			bytes += fs.statSync(file).size;
		} catch {
			return { bytes, complete: false };
		}
	}
	return { bytes, complete: true };
}

function renderLegacyContext(requirements: ParallelRequirement[]): string {
	return `# Legacy parallel handoff\n\nAuthoritative completeness: all current requirements follow.\n${requirements
		.map(
			(requirement) =>
				`Requirement ${requirement.id}: ${requirement.summary}. Current status: ${requirement.status}.`,
		)
		.join("\n")}\n`;
}

function defaultRequirements(): ParallelRequirement[] {
	return Array.from({ length: 24 }, (_, index) => ({
		id: `REQ-${String(index + 1).padStart(3, "0")}`,
		status: index < 18 ? ("verified" as const) : ("pending" as const),
		summary: `sanitized parallel acceptance condition ${String(index + 1).padStart(3, "0")}`,
	}));
}

interface ParallelScenarioFixture {
	requirements: ParallelRequirement[];
	legacyContext: string;
}

function buildScenarioFixture(
	base: ParallelRequirement[],
	family: ParallelScenarioFamily,
	iteration = 1,
): ParallelScenarioFixture {
	const variant = iteration > 0 ? ` (fixture variant ${iteration})` : "";
	if (family === "clean-partition") {
		const requirements = base.map((requirement, index) => ({
			...requirement,
			summary: `${requirement.summary}${variant}${iteration > 0 ? ` (lane ${index % 3})` : ""}`,
		}));
		return { requirements, legacyContext: renderLegacyContext(requirements) };
	}
	const count = family === "stale-cross-session-conflict" ? 32 : 48;
	const requirements = Array.from({ length: count }, (_, index) => ({
		id: `REQ-${String(index + 1).padStart(3, "0")}`,
		status:
			(index + iteration) % 5 === 0
				? ("pending" as const)
				: ("verified" as const),
		summary:
			family === "stale-cross-session-conflict"
				? `current cross-session requirement ${index + 1}${variant}${iteration > 0 ? ` (delta ${index % 4})` : ""}`
				: `review recovery ${index % 4 === 0 ? "blocked dependency" : "required gate"} ${index + 1}${variant}${iteration > 0 ? ` (gate ${index % 5})` : ""}`,
	}));
	if (family === "review-gate-recovery") {
		return { requirements, legacyContext: renderLegacyContext(requirements) };
	}
	const removed = ["REQ-REMOVED-01", "REQ-REMOVED-02"];
	const firstSession = requirements
		.map((requirement, index) =>
			`Requirement ${requirement.id}: ${index < 4 ? `superseded draft ${index + 1}` : requirement.summary}. Current status: ${index < 8 ? "pending" : requirement.status}.`,
		)
		.concat(removed.map((id) => `Requirement ${id}: obsolete requirement. Current status: pending.`));
	const secondSession = requirements.slice(0, 8).map(
		(requirement, index) =>
			`Update ${requirement.id}: status ${requirement.status}; summary ${index < 4 ? JSON.stringify(requirement.summary) : "unchanged"}.`,
	);
	const legacyContext = `# Legacy chronological handoffs\n\nSession 1 (older):\n${firstSession.join("\n")}\n\nSession 2 (newer updates):\n${secondSession.join("\n")}\nRemoved after session 2: ${removed.join(", ")}\n\nReconstruct the current projection from the chronological deltas above; no final projection is provided.`;
	return { requirements, legacyContext };
}

function writeSchemas(tempRoot: string): Record<ParallelStage, string> {
	const schemaByStage: Record<ParallelStage, unknown> = {
		"leader-plan": PLAN_SCHEMA,
		"child-a": REQUIREMENTS_SCHEMA,
		"child-b": REQUIREMENTS_SCHEMA,
		reviewer: REVIEW_SCHEMA,
		"leader-integrate": REQUIREMENTS_SCHEMA,
	};
	return Object.fromEntries(
		Object.entries(schemaByStage).map(([stage, schema]) => {
			const schemaPath = path.join(tempRoot, `${stage}.schema.json`);
			fs.writeFileSync(schemaPath, `${JSON.stringify(schema)}\n`);
			return [stage, schemaPath];
		}),
	) as Record<ParallelStage, string>;
}

function strictObject(
	required: string[],
	properties: Record<string, unknown>,
): Record<string, unknown> {
	return {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		type: "object",
		required,
		properties,
		additionalProperties: false,
	};
}

interface RequirementScore {
	accuracyPct: number;
	exact: boolean;
	expectedRequirements: number;
	exactRequirements: number;
	unexpectedRows: number;
	duplicateIds: number;
	malformedRows: number;
}

function scoreRequirements(
	value: unknown,
	expected: ParallelRequirement[],
): RequirementScore {
	const rawRows = Array.isArray(value) ? value : [];
	const rows = rawRows.filter(
		(item): item is Record<string, unknown> =>
			item !== null && typeof item === "object" && !Array.isArray(item),
	);
	const malformedRows = rawRows.length - rows.length;
	const expectedIds = new Set(expected.map((requirement) => requirement.id));
	const idCounts = new Map<string, number>();
	for (const row of rows) {
		if (typeof row.id !== "string") continue;
		idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1);
	}
	const exactRequirements = expected.filter((requirement) => {
		if (idCounts.get(requirement.id) !== 1) return false;
		return rows.some(
			(row) =>
				row.id === requirement.id &&
				row.status === requirement.status &&
				row.summary === requirement.summary,
		);
	}).length;
	const unexpectedRows =
		malformedRows +
		rows.filter((row) => typeof row.id !== "string" || !expectedIds.has(row.id))
			.length;
	const duplicateIds = [...idCounts.values()].reduce(
		(total, count) => total + Math.max(0, count - 1),
		0,
	);
	const orderedExact =
		rawRows.length === expected.length &&
		malformedRows === 0 &&
		rawRows.every((item, index) => {
			if (!item || typeof item !== "object" || Array.isArray(item))
				return false;
			const row = item as Record<string, unknown>;
			const wanted = expected[index];
			return (
				row.id === wanted?.id &&
				row.status === wanted.status &&
				row.summary === wanted.summary
			);
		});
	return {
		accuracyPct: round(
			expected.length > 0 ? (exactRequirements * 100) / expected.length : 100,
		),
		exact:
			orderedExact &&
			unexpectedRows === 0 &&
			duplicateIds === 0 &&
			exactRequirements === expected.length,
		expectedRequirements: expected.length,
		exactRequirements,
		unexpectedRows,
		duplicateIds,
		malformedRows,
	};
}

function applyRequirementScore(
	record: ParallelStageRecord,
	score: RequirementScore,
): void {
	record.requirement_accuracy_pct = score.accuracyPct;
	record.expected_requirements = score.expectedRequirements;
	record.exact_requirements = score.exactRequirements;
	record.unexpected_requirement_rows = score.unexpectedRows;
	record.duplicate_requirement_ids = score.duplicateIds;
	record.malformed_requirement_rows = score.malformedRows;
}

function perturbReviewInputs(
	family: ParallelScenarioFamily,
	childA: unknown,
	childB: unknown,
): { childA: unknown[]; childB: unknown[] } {
	const left = Array.isArray(childA) ? structuredClone(childA) : [];
	const right = Array.isArray(childB) ? structuredClone(childB) : [];
	if (family !== "review-gate-recovery" || left.length < 4) {
		return { childA: left, childB: right };
	}
	const omitted = left.shift();
	const duplicate = left[0];
	if (duplicate !== undefined) left.splice(1, 0, structuredClone(duplicate));
	const stale = left[2];
	if (stale && typeof stale === "object" && !Array.isArray(stale)) {
		const row = stale as Record<string, unknown>;
		row.status = row.status === "verified" ? "pending" : "verified";
	}
	const misassigned = left.splice(3, 1)[0];
	if (misassigned !== undefined) right.unshift(misassigned);
	void omitted;
	return { childA: left, childB: right };
}

function analyzeChildReports(
	childA: unknown,
	childB: unknown,
	expectedChildA: ParallelRequirement[],
	expectedChildB: ParallelRequirement[],
): {
	verdict: "accept" | "repair";
	missingIds: string[];
	duplicateIds: string[];
	unexpectedIds: string[];
	misassignedIds: string[];
	statusMismatchIds: string[];
	summaryMismatchIds: string[];
	malformedRows: number;
	orderOk: boolean;
} {
	const rawRowsByChild = [childA, childB].map((value) =>
		Array.isArray(value) ? value : [],
	);
	const rowsByChild = rawRowsByChild.map((rows) =>
		rows.filter(
			(item): item is Record<string, unknown> =>
				item !== null && typeof item === "object" && !Array.isArray(item),
		),
	);
	const malformedRows = rawRowsByChild.reduce(
		(total, rawRows, index) =>
			total + rawRows.length - rowsByChild[index]!.length,
		0,
	);
	const rows = rowsByChild.flat();
	const expected = [...expectedChildA, ...expectedChildB];
	const expectedById = new Map(
		expected.map((requirement) => [requirement.id, requirement]),
	);
	const byId = new Map<string, Record<string, unknown>[]>();
	for (const row of rows) {
		if (typeof row.id !== "string") continue;
		const current = byId.get(row.id) ?? [];
		current.push(row);
		byId.set(row.id, current);
	}
	const missingIds = expected
		.filter((requirement) => !byId.has(requirement.id))
		.map((requirement) => requirement.id);
	const duplicateIds = expected
		.filter((requirement) => (byId.get(requirement.id)?.length ?? 0) > 1)
		.map((requirement) => requirement.id);
	const unexpectedIds = [...byId.keys()].filter((id) => !expectedById.has(id));
	const expectedAIds = new Set(
		expectedChildA.map((requirement) => requirement.id),
	);
	const expectedBIds = new Set(
		expectedChildB.map((requirement) => requirement.id),
	);
	const misassignedIds = [
		...rowsByChild[0]!
			.filter(
				(row) =>
					typeof row.id === "string" &&
					expectedById.has(row.id) &&
					!expectedAIds.has(row.id),
			)
			.map((row) => row.id as string),
		...rowsByChild[1]!
			.filter(
				(row) =>
					typeof row.id === "string" &&
					expectedById.has(row.id) &&
					!expectedBIds.has(row.id),
			)
			.map((row) => row.id as string),
	].filter((id, index, values) => values.indexOf(id) === index);
	const statusMismatchIds = expected
		.filter((requirement) =>
			(byId.get(requirement.id) ?? []).some(
				(row) => row.status !== requirement.status,
			),
		)
		.map((requirement) => requirement.id);
	const summaryMismatchIds = expected
		.filter((requirement) =>
			(byId.get(requirement.id) ?? []).some(
				(row) => row.summary !== requirement.summary,
			),
		)
		.map((requirement) => requirement.id);
	const orderOk =
		equalStringArrays(
			rowsByChild[0]!.map((row) => row.id),
			expectedChildA.map((requirement) => requirement.id),
		) &&
		equalStringArrays(
			rowsByChild[1]!.map((row) => row.id),
			expectedChildB.map((requirement) => requirement.id),
		);
	const hasIssues =
		!orderOk ||
		[
			missingIds,
			duplicateIds,
			unexpectedIds,
			misassignedIds,
			statusMismatchIds,
			summaryMismatchIds,
		].some((values) => values.length > 0);
	const requiresRepair = hasIssues || malformedRows > 0;
	return {
		verdict: requiresRepair ? "repair" : "accept",
		missingIds,
		duplicateIds,
		unexpectedIds,
		misassignedIds,
		statusMismatchIds,
		summaryMismatchIds,
		malformedRows,
		orderOk,
	};
}

function stringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
		? value
		: undefined;
}

function equalStringArrays(value: unknown, expected: string[]): boolean {
	const actual = stringArray(value);
	return (
		actual !== undefined &&
		actual.length === expected.length &&
		actual.every((item, index) => item === expected[index])
	);
}

function summarize(runs: ParallelConditionRun[]): ParallelSummary {
	const stage_tokens = Object.fromEntries(
		STAGES.map((stage) => [
			stage,
			round(
				average(
					runs.flatMap((run) =>
						run.stages
							.filter((record) => record.stage === stage)
							.map((record) => record.tokens.total_tokens),
					),
				),
			),
		]),
	) as Record<ParallelStage, number>;
	const stage_input_bytes = Object.fromEntries(
		STAGES.map((stage) => [
			stage,
			round(
				average(
					runs
					.flatMap((run) =>
						run.stages
							.filter((record) => record.stage === stage)
							.map((record) => record.input_bytes),
					),
				),
			),
		]),
	) as Record<ParallelStage, number>;
	return {
		runs: runs.length,
		complete_passes: runs.filter((run) => run.product_pass).length,
		product_pass_pct: round(
			(runs.filter((run) => run.product_pass).length * 100) / runs.length,
		),
		process_perfect_pct: round(
			(runs.filter((run) => run.stages.every((stage) => stage.output_correct))
				.length *
				100) /
				runs.length,
		),
		child_accuracy_pct: round(
			average(runs.map((run) => run.child_accuracy_pct)),
		),
		reviewer_accuracy_pct: round(
			average(runs.map((run) => run.reviewer_accuracy_pct)),
		),
		final_accuracy_pct: round(
			average(runs.map((run) => run.final_accuracy_pct)),
		),
		critical_path_ms: round(average(runs.map((run) => run.critical_path_ms))),
		agent_elapsed_ms: round(average(runs.map((run) => run.agent_elapsed_ms))),
		children_overlap_ms: round(
			average(runs.map((run) => run.children_overlap_ms)),
		),
		total_tokens: round(average(runs.map((run) => run.tokens.total_tokens))),
		stage_tokens,
		stage_input_bytes,
	};
}

function stageTokens(
	run: ParallelConditionRun,
	stages: ParallelStage[],
): number {
	const selected = new Set(stages);
	return run.stages.reduce(
		(total, stage) =>
			total + (selected.has(stage.stage) ? stage.tokens.total_tokens : 0),
		0,
	);
}

export function renderParallelBenchmarkMarkdown(
	result: ParallelBenchmarkResult,
): string {
	const finalProtocol = result.protocol === "final";
	const familyRows = result.scenario_families
		.map((family) => {
			const summary = result.family_summaries[family];
			return `| ${family} | ${summary.pairs} | ${summary.disabled_final_accuracy_pct}% | ${summary.enabled_final_accuracy_pct}% | ${formatSignedNumber(summary.accuracy_delta_points)}pp | ${summary.reviewer_exact}/${summary.pairs} | ${summary.final_exact}/${summary.pairs} |`;
		})
		.join("\n");
	return `# Harness-orchestrated parallel-agent Work A/B\n\n- Generated: ${result.generated_at}\n- Protocol: \`${result.protocol}\`${result.claim_eligible ? " (claim eligible)" : " (diagnostic only)"}\n- Model: \`${result.model}\` (reasoning effort: ${result.reasoning_effort})\n- Implementation: \`${result.implementation_git_sha}\`\n- Prior final attempts: ${result.attempts_before_this_sha}\n- Scenarios: ${result.scenario_families.join(", ")}\n- Pairs: ${result.comparison.total_pairs}\n- Planned/actual invocations: ${result.planned_initial_invocations}/${result.actual_invocations}\n- Harness validity: **${result.harness_validity.ok ? "PASS" : "FAIL"}**\n- Product verdict: **${result.comparison.verdict}**\n- Enabled absolute-quality gate: **${result.quality.enabled_ready ? "PASS" : "FAIL"}** (${result.quality.enabled_passes}/${result.quality.total_per_condition})\n\n![Parallel-agent ${escapeMarkdownAlt(result.model)} benchmark](work-parallel-agent-ab-summary.svg)\n\n| Condition | Exact reviewed pipelines | Child accuracy | Reviewer accuracy | Final accuracy | Critical path/run | Tokens/run |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n| Work disabled | ${result.quality.disabled_passes}/${result.quality.total_per_condition} | ${result.summary.disabled.child_accuracy_pct}% | ${result.summary.disabled.reviewer_accuracy_pct}% | ${result.summary.disabled.final_accuracy_pct}% | ${result.summary.disabled.critical_path_ms} ms | ${result.summary.disabled.total_tokens} |\n| Work enabled | ${result.quality.enabled_passes}/${result.quality.total_per_condition} | ${result.summary.enabled.child_accuracy_pct}% | ${result.summary.enabled.reviewer_accuracy_pct}% | ${result.summary.enabled.final_accuracy_pct}% | ${result.summary.enabled.critical_path_ms} ms | ${result.summary.enabled.total_tokens} |\n\n| Scenario family | Pairs | Disabled accuracy | Enabled accuracy | Delta | Reviewer exact | Final exact |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${familyRows}\n\nEnabled won **${result.comparison.enabled_pair_wins}/${result.comparison.total_pairs}**, tied **${result.comparison.paired_ties}/${result.comparison.total_pairs}**, and lost **${result.comparison.enabled_pair_losses}/${result.comparison.total_pairs}**. Mean final-accuracy delta: **${formatSignedNumber(result.comparison.delta_points)}pp**; exact one-sided sign-test p-value: **${result.comparison.sign_test_p_value}**.\n\n| Preregistered gate | Result |\n| --- | --- |\n| Harness validity | ${result.harness_validity.ok ? "PASS" : "FAIL"} |\n| Accuracy and per-family floor | ${result.comparison.accuracy_gate ? "PASS" : "FAIL"} |\n| Absolute quality | ${result.comparison.critical_quality_gate ? "PASS" : "FAIL"} |\n| Tokens (aggregate ≤+5%, p50 ≤+5%, bootstrap upper ≤+10%) | ${result.comparison.cost_gate ? "PASS" : "FAIL"} — p50 ${formatSignedPercent(result.summary.paired.total_tokens_pct_p50)}, upper ${formatSignedPercent(result.summary.paired.total_tokens_pct_upper_90)} |\n| Critical path (p50 ≤+10%, bootstrap upper ≤+20%) | ${result.comparison.latency_gate ? "PASS" : "FAIL"} — p50 ${formatSignedPercent(result.summary.paired.critical_path_pct_p50)}, upper ${formatSignedPercent(result.summary.paired.critical_path_pct_upper_90)} |\n\n## Claim boundary\n\n${finalProtocol ? "This is the single held-out claim-eligible attempt for the recorded implementation commit. A pass means only that the preregistered three-scenario contract passed; it is not a general productivity or model-independent claim." : "Validate and shadow protocols are never claim eligible. Their verdict remains INCONCLUSIVE even when harness and quality checks pass."} The harness launches separate Codex processes and proves child interval overlap; it does not measure same-session native subagent spawning. All stage costs and failures are retained. No prompts, answers, stderr, PIDs, fixture bodies, or host paths are published.\n`;
}

function addStageCostRows(
	markdown: string,
	result: Pick<ParallelBenchmarkResult, "summary" | "comparison">,
): string {
	const stageRows = `| Combined child tokens (p50 ≤0%, bootstrap upper ≤+5%) | p50 ${formatSignedPercent(result.summary.paired.combined_child_tokens_pct_p50)}, upper ${formatSignedPercent(result.summary.paired.combined_child_tokens_pct_upper_90)} |\n| Reviewer tokens (p50 ≤0%, bootstrap upper ≤+5%) | p50 ${formatSignedPercent(result.summary.paired.reviewer_tokens_pct_p50)}, upper ${formatSignedPercent(result.summary.paired.reviewer_tokens_pct_upper_90)} |\n| Stage token gate | ${result.comparison.stage_cost_gate ? "PASS" : "FAIL"} |`;
	return markdown.replace(
		"\n| Critical path (",
		`\n${stageRows}\n| Critical path (`,
	);
}

export function publishParallelArtifacts(
	result: Pick<
		ParallelBenchmarkResult,
		| "project_root"
		| "artifacts"
		| "markdown"
		| "model"
		| "runs_per_condition"
		| "summary"
		| "harness_validity"
		| "quality"
		| "comparison"
	>,
	outputPath = WORK_PARALLEL_AGENT_OUTPUT_DIR,
	operations = { renameSync: fs.renameSync, rmSync: fs.rmSync },
): ParallelBenchmarkResult["artifacts"] {
	const root = path.resolve(result.project_root);
	const outputDir = path.resolve(root, outputPath);
	if (outputDir === root || !outputDir.startsWith(`${root}${path.sep}`)) {
		throw new Error("benchmark output path escapes project root");
	}
	assertNoSymlinkPath(root, outputDir);
	fs.mkdirSync(outputDir, { recursive: true });
	assertNoSymlinkPath(root, outputDir);
	const outputIdentity = captureParallelArtifactDirectoryIdentity(outputDir);
	const jsonPath = path.join(outputDir, "work-parallel-agent-ab.json");
	const markdownPath = path.join(outputDir, "README.md");
	const summarySvgPath = path.join(
		outputDir,
		"work-parallel-agent-ab-summary.svg",
	);
	for (const artifactPath of [jsonPath, markdownPath, summarySvgPath]) {
		if (
			fs.existsSync(artifactPath) &&
			fs.lstatSync(artifactPath).isSymbolicLink()
		) {
			throw new Error("benchmark artifact must not be a symlink");
		}
	}
	const artifacts = {
		output_dir: path.relative(root, outputDir),
		json: path.relative(root, jsonPath),
		markdown: path.relative(root, markdownPath),
		summary_svg: path.relative(root, summarySvgPath),
	};
	const published = {
		...result,
		project_root: ".",
		artifacts,
		markdown: undefined,
	};
	assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
	const stagedDir = fs.mkdtempSync(
		path.join(outputDir, ".work-parallel-agent-publish-"),
	);
	const stagedIdentity = captureParallelArtifactDirectoryIdentity(stagedDir);
	const stagedJson = path.join(stagedDir, path.basename(jsonPath));
	const stagedMarkdown = path.join(stagedDir, path.basename(markdownPath));
	const stagedSvg = path.join(stagedDir, path.basename(summarySvgPath));
	let preserveStagedDir = false;
	try {
		assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
		assertParallelArtifactDirectoryIdentity(stagedDir, stagedIdentity);
		fs.writeFileSync(stagedJson, `${JSON.stringify(published, null, 2)}\n`, {
			flag: "wx",
		});
		assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
		assertParallelArtifactDirectoryIdentity(stagedDir, stagedIdentity);
		fs.writeFileSync(stagedMarkdown, result.markdown, { flag: "wx" });
		assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
		assertParallelArtifactDirectoryIdentity(stagedDir, stagedIdentity);
		fs.writeFileSync(stagedSvg, renderSummarySvg(result), { flag: "wx" });
		publishStagedParallelArtifacts(
			[
				{ staged: stagedMarkdown, destination: markdownPath },
				{ staged: stagedSvg, destination: summarySvgPath },
				// JSON is last because it is the machine-readable commit record.
				{ staged: stagedJson, destination: jsonPath },
			],
			outputDir,
			outputIdentity,
			stagedDir,
			stagedIdentity,
			operations,
		);
	} catch (error) {
		preserveStagedDir =
			error instanceof ParallelArtifactRollbackError ||
			error instanceof ParallelArtifactIdentityError;
		throw error;
	} finally {
		if (!preserveStagedDir) {
			assertParallelArtifactDirectoryIdentity(stagedDir, stagedIdentity);
			operations.rmSync(stagedDir, { recursive: true, force: true });
		}
	}
	return artifacts;
}

function renderSummarySvg(
	result: Pick<
		ParallelBenchmarkResult,
		| "model"
		| "runs_per_condition"
		| "summary"
		| "harness_validity"
		| "quality"
		| "comparison"
	>,
): string {
	const maxTokens = Math.max(
		result.summary.disabled.total_tokens,
		result.summary.enabled.total_tokens,
	);
	const disabledWidth = Math.round(
		maxTokens > 0
			? (340 * result.summary.disabled.total_tokens) / maxTokens
			: 0,
	);
	const enabledWidth = Math.round(
		maxTokens > 0 ? (340 * result.summary.enabled.total_tokens) / maxTokens : 0,
	);
	const disabledAccuracyWidth = Math.round(
		(340 * result.summary.disabled.final_accuracy_pct) / 100,
	);
	const enabledAccuracyWidth = Math.round(
		(340 * result.summary.enabled.final_accuracy_pct) / 100,
	);
	const model = escapeXml(result.model);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="348" viewBox="0 0 760 348" role="img" aria-labelledby="title desc">
  <title id="title">Parallel-agent ${model} Work A/B benchmark</title>
  <desc id="desc">Final requirement accuracy changed from ${result.summary.disabled.final_accuracy_pct} percent to ${result.summary.enabled.final_accuracy_pct} percent; product verdict ${result.comparison.verdict}.</desc>
	  <rect width="760" height="348" rx="16" fill="#0f172a"/>
  <text x="32" y="42" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="22" font-weight="700">Parallel-agent ${model} benchmark (${result.comparison.total_pairs} pairs)</text>
  <text x="32" y="72" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="14">Harness ${result.harness_validity.ok ? "PASS" : "FAIL"} · ${result.comparison.verdict} · enabled quality ${result.quality.enabled_ready ? "PASS" : "FAIL"}</text>
  <text x="32" y="112" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="16" font-weight="600">Average total tokens / pipeline</text>
  <text x="32" y="142" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="14">Disabled</text>
  <rect x="128" y="126" width="${disabledWidth}" height="22" rx="5" fill="#64748b"/>
  <text x="480" y="142" fill="#f8fafc" font-family="ui-monospace,monospace" font-size="14">${result.summary.disabled.total_tokens}</text>
  <text x="32" y="176" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="14">Enabled</text>
  <rect x="128" y="160" width="${enabledWidth}" height="22" rx="5" fill="#38bdf8"/>
  <text x="480" y="176" fill="#f8fafc" font-family="ui-monospace,monospace" font-size="14">${result.summary.enabled.total_tokens} (${formatSignedPercent(result.summary.delta.total_tokens_pct)})</text>
  <text x="32" y="222" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="16" font-weight="600">Final exact-requirement accuracy</text>
  <text x="32" y="252" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="14">Disabled</text>
  <rect x="128" y="236" width="${disabledAccuracyWidth}" height="22" rx="5" fill="#64748b"/>
  <text x="480" y="252" fill="#f8fafc" font-family="ui-monospace,monospace" font-size="14">${result.summary.disabled.final_accuracy_pct}%</text>
  <text x="32" y="286" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="14">Enabled</text>
  <rect x="128" y="270" width="${enabledAccuracyWidth}" height="22" rx="5" fill="#22c55e"/>
  <text x="480" y="286" fill="#f8fafc" font-family="ui-monospace,monospace" font-size="14">${result.summary.enabled.final_accuracy_pct}% (${formatSignedNumber(result.comparison.delta_points)}pp)</text>
	  <text x="32" y="316" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="12">Paired p50: total ${formatSignedPercent(result.summary.paired.total_tokens_pct_p50)} · children ${formatSignedPercent(result.summary.paired.combined_child_tokens_pct_p50)} · reviewer ${formatSignedPercent(result.summary.paired.reviewer_tokens_pct_p50)}</text>
	  <text x="32" y="334" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="12">Stage token gate ${result.comparison.stage_cost_gate ? "PASS" : "FAIL"} · critical path ${formatSignedPercent(result.summary.paired.critical_path_pct_p50)}</text>
</svg>\n`;
}

interface ParallelArtifactPathIdentity {
	exists: boolean;
	dev?: number;
	ino?: number;
}

interface ParallelArtifactDirectoryIdentity
	extends ParallelArtifactPathIdentity {
	realPath: string;
}

class ParallelArtifactRollbackError extends Error {}
class ParallelArtifactIdentityError extends Error {}

function publishStagedParallelArtifacts(
	artifacts: Array<{ staged: string; destination: string }>,
	outputDir: string,
	outputIdentity: ParallelArtifactDirectoryIdentity,
	stagedDir: string,
	stagedDirectoryIdentity: ParallelArtifactDirectoryIdentity,
	operations: NonNullable<ParallelBenchmarkOptions["artifactOperations"]>,
): void {
	assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
	const prepared = artifacts.map((artifact, index) => {
		assertParallelArtifactDirectoryIdentity(stagedDir, stagedDirectoryIdentity);
		const stagedIdentity = captureParallelArtifactFileIdentity(artifact.staged);
		const identity = captureParallelArtifactFileIdentity(artifact.destination);
		const backup = `${artifact.staged}.previous-${index}`;
		const candidate = `${artifact.staged}.candidate-${index}`;
		assertParallelArtifactFileIdentity(artifact.staged, stagedIdentity);
		fs.copyFileSync(artifact.staged, candidate);
		const candidateIdentity = captureParallelArtifactFileIdentity(candidate);
		let backupIdentity: ParallelArtifactPathIdentity | undefined;
		if (identity.exists) {
			assertParallelArtifactDirectoryIdentity(
				stagedDir,
				stagedDirectoryIdentity,
			);
			assertParallelArtifactFileIdentity(artifact.destination, identity);
			fs.copyFileSync(artifact.destination, backup);
			backupIdentity = captureParallelArtifactFileIdentity(backup);
		}
		return {
			...artifact,
			backup,
			backupIdentity,
			candidate,
			candidateIdentity,
			identity,
			stagedIdentity,
		};
	});
	const published: typeof prepared = [];
	try {
		for (const artifact of prepared) {
			assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
			assertParallelArtifactDirectoryIdentity(
				stagedDir,
				stagedDirectoryIdentity,
			);
			assertParallelArtifactFileIdentity(
				artifact.destination,
				artifact.identity,
			);
			assertParallelArtifactFileIdentity(
				artifact.candidate,
				artifact.candidateIdentity,
			);
			operations.renameSync(artifact.candidate, artifact.destination);
			published.push({ ...artifact, identity: artifact.candidateIdentity });
			assertParallelArtifactFileIdentity(
				artifact.destination,
				artifact.candidateIdentity,
			);
		}
	} catch (error) {
		const rollbackFailures: string[] = [];
		for (const artifact of published.reverse()) {
			try {
				assertParallelArtifactDirectoryIdentity(outputDir, outputIdentity);
				assertParallelArtifactDirectoryIdentity(
					stagedDir,
					stagedDirectoryIdentity,
				);
				assertParallelArtifactFileIdentity(
					artifact.destination,
					artifact.identity,
				);
				if (artifact.backupIdentity) {
					assertParallelArtifactFileIdentity(
						artifact.backup,
						artifact.backupIdentity,
					);
					operations.renameSync(artifact.backup, artifact.destination);
				} else {
					operations.rmSync(artifact.destination, { force: true });
				}
			} catch (rollbackError) {
				rollbackFailures.push(
					`${artifact.destination}: ${errorMessage(rollbackError)}`,
				);
			}
		}
		if (rollbackFailures.length > 0) {
			throw new ParallelArtifactRollbackError(
				`artifact publish failed (${errorMessage(error)}) and rollback was incomplete; recovery files preserved in ${path.dirname(artifacts[0]!.staged)}: ${rollbackFailures.join("; ")}`,
			);
		}
		throw error;
	}
}

function captureParallelArtifactDirectoryIdentity(
	directory: string,
): ParallelArtifactDirectoryIdentity {
	const stat = fs.lstatSync(directory);
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(`artifact output is not a stable directory: ${directory}`);
	}
	return {
		exists: true,
		dev: stat.dev,
		ino: stat.ino,
		realPath: fs.realpathSync.native(directory),
	};
}

function assertParallelArtifactDirectoryIdentity(
	directory: string,
	expected: ParallelArtifactDirectoryIdentity,
): void {
	const actual = captureParallelArtifactDirectoryIdentity(directory);
	if (
		actual.dev !== expected.dev ||
		actual.ino !== expected.ino ||
		actual.realPath !== expected.realPath
	) {
		throw new ParallelArtifactIdentityError(
			`artifact output changed during publication: ${directory}`,
		);
	}
}

function captureParallelArtifactFileIdentity(
	file: string,
): ParallelArtifactPathIdentity {
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(file);
	} catch (error) {
		if (isFileNotFoundError(error)) return { exists: false };
		throw error;
	}
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new Error(`artifact destination is not a regular file: ${file}`);
	}
	return { exists: true, dev: stat.dev, ino: stat.ino };
}

function assertParallelArtifactFileIdentity(
	file: string,
	expected: ParallelArtifactPathIdentity,
): void {
	const actual = captureParallelArtifactFileIdentity(file);
	if (
		actual.exists !== expected.exists ||
		actual.dev !== expected.dev ||
		actual.ino !== expected.ino
	) {
		throw new ParallelArtifactIdentityError(
			`artifact destination changed during publication: ${file}`,
		);
	}
}

function assertNoSymlinkPath(root: string, destination: string): void {
	let current = destination;
	while (current !== root) {
		if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
			throw new Error("benchmark output directory must not traverse a symlink");
		}
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
}

/** Local, deterministic runner used by `validate`; it never starts Codex. */
const validationRunner: ParallelRunner = (request) => {
	const stage = request.prompt.match(/\[parallel-stage:([^\]]+)/u)?.[1];
	const contextFile =
		stage === "child-a" && request.prompt.includes("CHILD_A.md")
			? "CHILD_A.md"
			: stage === "child-b" && request.prompt.includes("CHILD_B.md")
				? "CHILD_B.md"
				: "CONTEXT.md";
	const requirements = requirementsFromContext(request.cwd, contextFile);
	const ids = requirements.map((requirement) => requirement.id);
	const assignedIds = request.prompt.match(/assigned requirements, in this order: ([^.]+)\./u)?.[1]
		?.split(/,\s*/u)
		.filter(Boolean);
	const rows = assignedIds
		? assignedIds.flatMap((id) => requirements.filter((row) => row.id === id))
		: requirements;
	let data: Record<string, unknown>;
	if (stage === "leader-plan") {
		const half = Math.ceil(ids.length / 2);
		data = { child_a: ids.slice(0, half), child_b: ids.slice(half) };
	} else if (stage === "reviewer") {
		let packet: Record<string, unknown> = {};
		try {
			packet = JSON.parse(
				fs.readFileSync(path.join(request.cwd, "CHILD_REPORTS.json"), "utf8"),
			) as Record<string, unknown>;
		} catch {
			packet = {};
		}
		const childA = parseCompactRequirementRows(packet.child_a);
		const childB = parseCompactRequirementRows(packet.child_b);
		const half = Math.ceil(requirements.length / 2);
		const issues = analyzeChildReports(
			childA,
			childB,
			requirements.slice(0, half),
			requirements.slice(half),
		);
		data = {
			requirements,
			verdict: issues.verdict,
			missing_ids: issues.missingIds,
			duplicate_ids: issues.duplicateIds,
			unexpected_ids: issues.unexpectedIds,
			misassigned_ids: issues.misassignedIds,
			status_mismatch_ids: issues.statusMismatchIds,
			summary_mismatch_ids: issues.summaryMismatchIds,
			malformed_rows: issues.malformedRows,
			order_ok: issues.orderOk,
		};
	} else {
		data = { requirements: rows };
	}
	return new Promise((resolve) =>
		setTimeout(
			() =>
				resolve({
					status: 0,
					stdout: outputJsonl(data),
					stderr: "",
					elapsedMs: 1,
				}),
			1,
		),
	);
};

function requirementsFromContext(
	cwd: string,
	filename = "CONTEXT.md",
): ParallelRequirement[] {
	let context: string;
	try {
		context = fs.readFileSync(path.join(cwd, filename), "utf8");
	} catch {
		return [];
	}
	const jsonStart = context.indexOf("{");
	if (jsonStart >= 0) {
		try {
			const packet = JSON.parse(context.slice(jsonStart)) as { requirements?: unknown };
			if (Array.isArray(packet.requirements)) {
				return packet.requirements.flatMap((value) => {
					if (typeof value !== "string") return [];
					const match = value.match(/^([^|]+)\|([^|]+)\|(.*)$/u);
					if (!match) return [];
					return [{ id: match[1]!, status: match[2] as ParallelRequirement["status"], summary: JSON.parse(match[3]!) as string }];
				});
			}
		} catch {
			// Fall through to the legacy parser.
		}
	}
	const marker = "# Legacy parallel handoff";
	const chronologicalMarker = "# Legacy chronological handoffs";
	if (context.includes(chronologicalMarker)) {
		const body = context.slice(context.indexOf(chronologicalMarker));
		const current = [...body.matchAll(/^Requirement ([^:]+): (.*)\. Current status: (verified|pending)\.$/gmu)].map(
			(match) => ({ id: match[1]!, summary: match[2]!, status: match[3]! as ParallelRequirement["status"] }),
		);
		for (const update of body.matchAll(/^Update ([^:]+): status (verified|pending); summary (.*)\.$/gmu)) {
			const target = current.find((requirement) => requirement.id === update[1]);
			if (target) {
				target.status = update[2] as ParallelRequirement["status"];
				const summary = update[3]!;
				target.summary = summary.startsWith('"') ? JSON.parse(summary) as string : target.summary;
			}
		}
		const removed = body.match(/Removed after session 2: (.+)$/mu)?.[1]?.split(", ") ?? [];
		return current.filter((requirement) => !removed.includes(requirement.id));
	}
	const current = context.slice(Math.max(0, context.lastIndexOf(marker)));
	return [...current.matchAll(/^Requirement ([^:]+): (.*)\. Current status: (verified|pending)\.$/gmu)].map(
		(match) => ({ id: match[1]!, summary: match[2]!, status: match[3]! as ParallelRequirement["status"] }),
	);
}

function readWorkExecutionPacket(
	cwd: string,
	filename: string,
): Record<string, unknown> | undefined {
	let context: string;
	try {
		context = fs.readFileSync(path.join(cwd, filename), "utf8");
	} catch {
		return undefined;
	}
	const jsonStart = context.indexOf("{");
	if (jsonStart < 0) return undefined;
	try {
		const parsed = JSON.parse(context.slice(jsonStart)) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function workPacketSubsetExact(
	cwd: string,
	filename: string,
	expected: ParallelRequirement[],
): boolean {
	const full = readWorkExecutionPacket(cwd, "CONTEXT.md");
	const subset = readWorkExecutionPacket(cwd, filename);
	if (!full || !subset) return false;
	const sameMetadata = [
		"schema_version",
		"work_id",
		"contract_revision",
		"contract",
		"blocker_ids",
		"required_gates",
	].every(
		(key) =>
			Object.hasOwn(full, key) &&
			Object.hasOwn(subset, key) &&
			digest(full[key]) === digest(subset[key]),
	);
	return (
		sameMetadata &&
		subset.authoritative_completeness === false &&
		digest(requirementsFromContext(cwd, filename)) === digest(expected)
	);
}

function parseCompactRequirementRows(value: unknown): unknown[] {
	if (!Array.isArray(value)) return [];
	return value.map((row) => {
		if (!Array.isArray(row) || row.length !== 3) return null;
		return { id: row[0], status: row[1], summary: row[2] };
	});
}

function outputJsonl(data: Record<string, unknown>): string {
	return `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(data) } })}\n${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, total_tokens: 2 } })}`;
}

function runCodexExec(
	request: ParallelRunnerRequest,
): Promise<ParallelRunnerResponse> {
	return new Promise((resolve) => {
		const started = performance.now();
		let settled = false;
		let timedOut = false;
		let killTimeout: NodeJS.Timeout | undefined;
		const child = spawn(
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
				"-c",
				`model_reasoning_effort=${REASONING_EFFORT}`,
				"--output-schema",
				request.outputSchemaPath,
				"-C",
				request.cwd,
				"-",
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		const finish = (status: number | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (killTimeout) clearTimeout(killTimeout);
			resolve({
				status,
				stdout,
				stderr,
				elapsedMs: performance.now() - started,
			});
		};
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			killTimeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
		}, 180_000);
		child.stdout.on("data", (bytes: Buffer) => {
			stdout += bytes.toString("utf8");
		});
		child.stderr.on("data", (bytes: Buffer) => {
			stderr += bytes.toString("utf8");
		});
		child.on("error", () => finish(null));
		child.on("close", (status) => finish(timedOut ? null : status));
		child.stdin.end(request.prompt);
	});
}

function collectReproducibility(projectRoot: string): {
	package_version: string;
	git_sha: string;
	codex_cli_version: string;
} {
	let packageVersion = "unknown";
	try {
		const parsed = JSON.parse(
			fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
		) as { version?: unknown };
		if (typeof parsed.version === "string") packageVersion = parsed.version;
	} catch {
		// Optional reproducibility metadata only.
	}
	return {
		package_version: packageVersion,
		git_sha: commandOutput("git", ["rev-parse", "HEAD"], projectRoot),
		codex_cli_version: commandOutput("codex", ["--version"], projectRoot),
	};
}

function prepareFinalProtocol(
	projectRoot: string,
	protocol: ParallelProtocol | undefined,
	write: boolean,
	outputPath: string | undefined,
	gitSha: string,
): { attemptsBefore: number } {
	if (protocol !== "shadow" && protocol !== "final") {
		return { attemptsBefore: 0 };
	}
	if (protocol === "final" && !write) {
		throw new Error("final protocol requires --write to retain every outcome");
	}
	if (gitSha === "unknown") {
		throw new Error(`${protocol} protocol requires a Git commit`);
	}
	const status = spawnSync("git", ["status", "--porcelain"], {
		cwd: projectRoot,
		encoding: "utf8",
	});
	if (status.status !== 0 || status.stdout.trim() !== "") {
		throw new Error(`${protocol} protocol requires a clean worktree`);
	}
	if (protocol === "shadow") return { attemptsBefore: 0 };
	const indexPath = finalAttemptIndexPath(projectRoot, outputPath);
	fs.mkdirSync(path.dirname(indexPath), { recursive: true });
	const attemptsBefore = appendFinalAttemptLocked(indexPath, {
		schema_version: "anamnesis.work_parallel_agent_attempt.v1",
		phase: "started",
		generated_at: new Date().toISOString(),
		implementation_git_sha: gitSha,
	}, gitSha);
	return { attemptsBefore };
}

interface FinalAttemptRecord {
	schema_version?: unknown;
	phase?: unknown;
	implementation_git_sha?: unknown;
	[key: string]: unknown;
}

function finalAttemptIndexPath(
	projectRoot: string,
	outputPath: string | undefined,
): string {
	const outputDir = path.resolve(
		projectRoot,
		outputPath ?? WORK_PARALLEL_AGENT_OUTPUT_DIR,
	);
	if (
		outputDir === projectRoot ||
		!outputDir.startsWith(`${path.resolve(projectRoot)}${path.sep}`)
	) {
		throw new Error("benchmark output path escapes project root");
	}
	assertNoSymlinkPath(path.resolve(projectRoot), outputDir);
	return path.join(outputDir, "attempts.jsonl");
}

function recordFinalAttempt(
	projectRoot: string,
	outputPath: string | undefined,
	result: ParallelBenchmarkResult,
): void {
	const indexPath = finalAttemptIndexPath(projectRoot, outputPath);
	appendFinalAttemptLocked(indexPath, {
		schema_version: "anamnesis.work_parallel_agent_attempt.v1",
		phase: "completed",
		generated_at: result.generated_at,
		implementation_git_sha: result.implementation_git_sha,
		harness_hash: result.harness_hash,
		fixture_hash: result.fixture_hash,
		model: result.model,
		verdict: result.comparison.verdict,
		harness_valid: result.harness_validity.ok,
	});
}

function appendFinalAttemptLocked(
	indexPath: string,
	record: Record<string, unknown>,
	uniqueImplementationSha?: string,
): number {
	fs.mkdirSync(path.dirname(indexPath), { recursive: true });
	const lockPath = `${indexPath}.lock`;
	let lock: number | undefined;
	try {
		lock = fs.openSync(lockPath, "wx", 0o600);
		const previous = fs.existsSync(indexPath)
			? fs.readFileSync(indexPath, "utf8")
			: "";
		const attempts = previous
			.split(/\r?\n/u)
			.filter(Boolean)
			.map((line) => JSON.parse(line) as FinalAttemptRecord);
		if (
			uniqueImplementationSha !== undefined &&
			attempts.some(
				(attempt) =>
					attempt.implementation_git_sha === uniqueImplementationSha,
			)
		) {
			throw new Error("final protocol already ran for this implementation commit");
		}
		const attemptsBefore = attempts.filter(
			(attempt) => attempt.phase === "started",
		).length;
		const completeRecord =
			record.phase === "started"
				? { ...record, attempt_number: attemptsBefore + 1 }
				: record;
		const temporary = `${indexPath}.tmp-${process.pid}-${Date.now()}`;
		fs.writeFileSync(temporary, `${previous}${JSON.stringify(completeRecord)}\n`, {
			flag: "wx",
			mode: 0o600,
		});
		fs.renameSync(temporary, indexPath);
		return attemptsBefore;
	} catch (error) {
		if (isFileExistsError(error)) {
			throw new Error("another final benchmark attempt is being recorded");
		}
		throw error;
	} finally {
		if (lock !== undefined) {
			fs.closeSync(lock);
			fs.unlinkSync(lockPath);
		}
	}
}

function commandOutput(command: string, args: string[], cwd: string): string {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	return result.status === 0 ? result.stdout.trim() || "unknown" : "unknown";
}

function addUsage(
	total: WorkAgentTokenUsage,
	record: ParallelStageRecord,
): WorkAgentTokenUsage {
	return {
		input_tokens: total.input_tokens + record.tokens.input_tokens,
		cached_input_tokens:
			total.cached_input_tokens + record.tokens.cached_input_tokens,
		output_tokens: total.output_tokens + record.tokens.output_tokens,
		total_tokens: total.total_tokens + record.tokens.total_tokens,
	};
}

function parseUsage(value: unknown): WorkAgentTokenUsage | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	const record = value as Record<string, unknown>;
	const fields = [
		"input_tokens",
		"cached_input_tokens",
		"output_tokens",
	] as const;
	if (
		!fields.every(
			(field) =>
				typeof record[field] === "number" &&
				Number.isSafeInteger(record[field]) &&
				record[field] >= 0,
		)
	) {
		return;
	}
	const derivedTotal =
		(record.input_tokens as number) + (record.output_tokens as number);
	const totalTokens = Object.hasOwn(record, "total_tokens")
		? record.total_tokens
		: derivedTotal;
	if (
		typeof totalTokens !== "number" ||
		!Number.isSafeInteger(totalTokens) ||
		totalTokens < 0 ||
		totalTokens !== derivedTotal
	) {
		return;
	}
	return {
		input_tokens: record.input_tokens as number,
		cached_input_tokens: record.cached_input_tokens as number,
		output_tokens: record.output_tokens as number,
		total_tokens: totalTokens,
	};
}

function formatSignedPercent(value: number): string {
	return `${value > 0 ? "+" : ""}${value}%`;
}

function formatSignedNumber(value: number): string {
	return `${value > 0 ? "+" : ""}${value}`;
}

function escapeXml(value: string): string {
	return value.replace(/[&<>"']/gu, (character) => {
		const entities: Record<string, string> = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&apos;",
		};
		return entities[character]!;
	});
}

function escapeMarkdownAlt(value: string): string {
	return value.replace(/[\\\[\]]/gu, "\\$&");
}

function isFileNotFoundError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

function isFileExistsError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "EEXIST"
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseRuns(value: number): number {
	if (!Number.isInteger(value) || value < 3) {
		throw new Error("--runs requires an integer >= 3");
	}
	return value;
}

function average(values: number[]): number {
	return values.length > 0
		? values.reduce((sum, value) => sum + value, 0) / values.length
		: 0;
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return round(
		sorted.length % 2 === 1
			? sorted[middle]!
			: (sorted[middle - 1]! + sorted[middle]!) / 2,
	);
}

function medianAbsoluteDeviation(values: number[]): number {
	const center = median(values);
	return median(values.map((value) => Math.abs(value - center)));
}

function stratifiedBootstrapUpper90(
	pairs: ParallelPairRun[],
	metric: (pair: ParallelPairRun) => number,
): number {
	if (pairs.length === 0) return 0;
	const strata = [...new Set(pairs.map((pair) => pair.scenario_id))].map(
		(family) => pairs.filter((pair) => pair.scenario_id === family),
	);
	let state = 0x6d2b79f5;
	const randomIndex = (length: number): number => {
		state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
		state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
		return Math.floor((((state ^ (state >>> 14)) >>> 0) / 2 ** 32) * length);
	};
	const samples: number[] = [];
	for (let iteration = 0; iteration < 5_000; iteration += 1) {
		const selected = strata.flatMap((stratum) =>
			Array.from({ length: stratum.length }, () => stratum[randomIndex(stratum.length)]!),
		);
		samples.push(average(selected.map(metric)));
	}
	samples.sort((left, right) => left - right);
	return round(samples[Math.ceil(samples.length * 0.9) - 1] ?? 0);
}

function exactOneSidedSignPValue(wins: number, losses: number): number {
	const n = wins + losses;
	if (n === 0) return 1;
	let tail = 0;
	for (let k = wins; k <= n; k += 1) tail += binomial(n, k) / 2 ** n;
	return round(Math.min(1, tail));
}

function binomial(n: number, k: number): number {
	if (k < 0 || k > n) return 0;
	let value = 1;
	for (let i = 1; i <= Math.min(k, n - k); i += 1)
		value = (value * (n - i + 1)) / i;
	return value;
}

function percent(before: number, after: number): number {
	return before === 0 ? 0 : round(((after - before) * 100) / before);
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
