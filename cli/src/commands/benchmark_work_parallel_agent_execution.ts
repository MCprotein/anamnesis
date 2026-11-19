import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import {
	appendParallelPaidAttemptLocked,
	parallelPaidAttemptIndexPath,
	recordPaidAttempt,
} from "./benchmark_work_parallel_agent_attempts.js";
import {
	addStageCostRows,
	publishParallelArtifacts,
	renderParallelBenchmarkMarkdown,
} from "./benchmark_work_parallel_agent_report.js";
import {
	addUsage,
	parseStageJsonl,
	runCodexExec,
	validationRunner,
} from "./benchmark_work_parallel_agent_runner.js";
import {
	buildScenarioFixture,
	defaultRequirements,
	materializeWorkContext,
	measureInputBytes,
	parseInlinePayload,
	parseNamedInlinePayload,
	readInlineInput,
	renderCompactReviewPacket,
	renderInlinePayload,
	renderNamedInlinePayload,
	REVIEW_SCHEMA,
	workPacketSubsetExact,
	writeSchemas,
} from "./benchmark_work_parallel_agent_scenario.js";
import {
	analyzeChildReports,
	applyRequirementScore,
	auditParallelReviewConsistency,
	countFinalRequirementDefects,
	equalStringArrays,
	exactOneSidedSignPValue,
	expectedChildRequirements,
	median,
	medianAbsoluteDeviation,
	percent,
	perturbReviewInputs,
	reviewAuditEqual,
	reviewAuditStageIntegrity,
	round,
	scoreRequirements,
	stageTokens,
	stratifiedBootstrapUpper90,
	summarize,
} from "./benchmark_work_parallel_agent_scoring.js";
import {
	DEFAULT_WORK_PARALLEL_AGENT_MODEL,
	EMPTY_USAGE,
	type LegacyVerdict,
	type ParallelBenchmarkOptions,
	type ParallelBenchmarkResult,
	type ParallelComparisonVerdict,
	type ParallelCondition,
	type ParallelConditionRun,
	type ParallelPairRun,
	type ParallelProtocol,
	type ParallelRequirement,
	type ParallelRunner,
	type ParallelRunnerResponse,
	type ParallelScenarioFamily,
	type ParallelStage,
	type ParallelStageRecord,
	REASONING_EFFORT,
	STAGES,
	TOPOLOGY,
	WORK_PARALLEL_AGENT_SCHEMA_VERSION,
} from "./benchmark_work_parallel_agent_types.js";
import { digest } from "./benchmark_work_parallel_agent_util.js";

export async function workParallelAgentBenchmark(
	options: ParallelBenchmarkOptions,
): Promise<ParallelBenchmarkResult> {
	const projectRoot = path.resolve(options.projectRoot);
	const protocol = options.protocol;
	const frozenProtocol = protocol !== undefined && protocol !== "legacy";
	if (frozenProtocol && options.runs !== undefined) {
		throw new Error("runs cannot override a frozen benchmark protocol");
	}
	if (frozenProtocol && options.scenarioFamilies !== undefined) {
		throw new Error(
			"scenario families cannot override a frozen benchmark protocol",
		);
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
		reproducibility.git_sha,
	);
	const implementationSha =
		options.implementationSha ?? reproducibility.git_sha;
	const harnessHash = digest({
		schema: WORK_PARALLEL_AGENT_SCHEMA_VERSION,
		topology: TOPOLOGY,
		stages: STAGES,
		reasoning_effort: REASONING_EFFORT,
		scoring_version: "parallel-requirement-score.v10",
		families: scenarioFamilies,
		final_pairs_per_family: 3,
		accuracy: {
			noninferiority_delta_points: 0,
			maximum_pair_losses: 0,
			aggregate_defects: "enabled<=disabled",
			family_floor: -2,
		},
		quality: {
			audit_reviewer_final_exact_overall: "all",
			audit_reviewer_final_exact_per_family: "all",
			final_defects: 0,
		},
		child_transport: "inline-authoritative-payload-v1",
		final_transport: "deterministic-reviewer-pass-through-v1",
		review_audit: {
			version: "review-audit.v1",
			inputs: [
				"reviewer-raw-requirements",
				"raw-child-a",
				"raw-child-b",
				"actual-plan-assignments",
			],
			oracle: "post-execution-scoring-only",
			oracle_outcome: "separate-enabled-quality-gate",
			stage_integrity: "all-condition-required-harness-gate",
		},
		model_stages_per_condition: 4,
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
				buildScenarioFixture(
					requirements,
					family,
					frozenProtocol ? index + 1 : 0,
				),
			),
		),
	);
	const modelStagesPerCondition = 4;
	const plannedInitialInvocations =
		runs * scenarioFamilies.length * 2 * modelStagesPerCondition;
	let actualInvocations = 0;
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
					const rendered: {
						context: string;
						factHash: string;
						childPackets?: string[];
					} =
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
						onModelInvocation: () => {
							actualInvocations += 1;
						},
					});
				}
				pairs.push({
					iteration,
					scenario_id,
					requirement_count: scenarioRequirements.length,
					fixture_hash: digest(scenario),
					seed: digest({
						harness: harnessHash,
						implementation: implementationSha,
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
		invocation_count_matches_plan:
			actualInvocations === plannedInitialInvocations,
		no_hidden_model_calls: allRuns.every(
			(run) =>
				run.stages.filter((stage) => stage.execution_mode === "model")
					.length === modelStagesPerCondition &&
				run.stages.filter((stage) => stage.execution_mode === "deterministic")
					.length === 2,
		),
		runner_protocol_integrity: allRuns.every((run) =>
			run.stages
				.filter((stage) => stage.execution_mode === "model")
				.every((stage) => stage.runner_protocol_valid === true),
		),
		review_audit_stage_integrity: allRuns.every((run) =>
			reviewAuditStageIntegrity(run.stages),
		),
		deterministic_stage_integrity: allRuns.every((run) => {
			const deterministic = run.stages.filter(
				(stage) => stage.execution_mode === "deterministic",
			);
			const finals = deterministic.filter(
				(stage) => stage.stage === "leader-integrate",
			);
			const final = finals[0];
			return (
				deterministic.length === 2 &&
				deterministic.every(
					(stage) =>
						stage.execution_ok &&
						stage.token_accounting_complete &&
						stage.input_bytes_complete &&
						stage.input_bytes > 0 &&
						stage.elapsed_ms >= 0 &&
						stage.start_offset_ms >= 0 &&
						stage.end_offset_ms >= stage.start_offset_ms &&
						Object.values(stage.tokens).every((tokens) => tokens === 0),
				) &&
				finals.length === 1 &&
				final?.execution_mode === "deterministic" &&
				final.execution_ok &&
				final.token_accounting_complete &&
				final.input_bytes_complete &&
				final.elapsed_ms >= 0 &&
				final.end_offset_ms >= final.start_offset_ms &&
				Object.values(final.tokens).every((tokens) => tokens === 0)
			);
		}),
		equal_authoritative_facts: equalAuthoritativeFacts,
		exactly_six_stages: allRuns.every(
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
		enabled_child_inputs_shrink:
			!frozenProtocol ||
			pairs.every(
				(pair) =>
					pair.enabled.stages
						.filter(
							(stage) => stage.stage === "child-a" || stage.stage === "child-b",
						)
						.reduce((total, stage) => total + stage.input_bytes, 0) <
					pair.disabled.stages
						.filter(
							(stage) => stage.stage === "child-a" || stage.stage === "child-b",
						)
						.reduce((total, stage) => total + stage.input_bytes, 0),
			),
		enabled_reviewer_input_shrinks:
			!frozenProtocol ||
			pairs.every(
				(pair) =>
					(pair.enabled.stages.find((stage) => stage.stage === "reviewer")
						?.input_bytes ?? 0) <
					(pair.disabled.stages.find((stage) => stage.stage === "reviewer")
						?.input_bytes ?? 0),
			),
		scenario_contract_frozen:
			protocol === undefined ||
			pairs.every(
				(pair) =>
					pair.requirement_count ===
					(
						{
							"clean-partition": 24,
							"stale-cross-session-conflict": 32,
							"review-gate-recovery": 48,
						} as const
					)[pair.scenario_id],
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
	const disabledAuditExactPasses = pairs.filter(
		(pair) => pair.disabled.review_audit_oracle_exact,
	).length;
	const enabledAuditExactPasses = pairs.filter(
		(pair) => pair.enabled.review_audit_oracle_exact,
	).length;
	const disabledReviewerExactPasses = pairs.filter(
		(pair) =>
			pair.disabled.stages.find((stage) => stage.stage === "reviewer")
				?.output_correct === true,
	).length;
	const enabledReviewerExactPasses = pairs.filter(
		(pair) =>
			pair.enabled.stages.find((stage) => stage.stage === "reviewer")
				?.output_correct === true,
	).length;
	const disabledFinalExactPasses = pairs.filter(
		(pair) => pair.disabled.final_accuracy_pct === 100,
	).length;
	const enabledFinalExactPasses = pairs.filter(
		(pair) => pair.enabled.final_accuracy_pct === 100,
	).length;
	const enabledCompletePasses = pairs.filter(
		(pair) =>
			pair.enabled.review_audit_oracle_exact && pair.enabled.product_pass,
	).length;
	const enabledQualityThreshold = pairs.length;
	const quality = {
		enabled_ready: enabledCompletePasses >= enabledQualityThreshold,
		disabled_passes: disabledPasses,
		enabled_passes: enabledPasses,
		disabled_review_audit_oracle_exact_passes: disabledAuditExactPasses,
		enabled_review_audit_oracle_exact_passes: enabledAuditExactPasses,
		disabled_reviewer_exact_passes: disabledReviewerExactPasses,
		enabled_reviewer_exact_passes: enabledReviewerExactPasses,
		disabled_final_exact_passes: disabledFinalExactPasses,
		enabled_final_exact_passes: enabledFinalExactPasses,
		enabled_complete_passes: enabledCompletePasses,
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
					review_audit_oracle_exact: familyPairs.filter(
						(pair) => pair.enabled.review_audit_oracle_exact,
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
		accuracyDeltaPoints >= 0 &&
		enabledPairLosses === 0 &&
		enabledAggregateDefects <= disabledAggregateDefects;
	const criticalQualityGate =
		enabledCompletePasses >= enabledQualityThreshold &&
		enabledAggregateDefects === 0 &&
		scenarioFamilies.every((family) => {
			const summary = familySummaries[family];
			return (
				summary.accuracy_delta_points >= -2 &&
				summary.review_audit_oracle_exact === summary.pairs &&
				summary.reviewer_exact === summary.pairs &&
				summary.final_exact === summary.pairs
			);
		});
	const tokenUpper90 = stratifiedBootstrapUpper90(pairs, (pair) =>
		percent(
			pair.disabled.tokens.total_tokens,
			pair.enabled.tokens.total_tokens,
		),
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
	const efficiencySignalGate =
		(median(pairedTokenDeltas) < 0 && tokenUpper90 <= 0) ||
		(median(pairedCriticalPathDeltas) < 0 && latencyUpper90 <= 0);
	const diagnosticContractPass =
		harnessValidity.ok &&
		criticalQualityGate &&
		accuracyGate &&
		costGate &&
		stageCostGate &&
		latencyGate &&
		efficiencySignalGate;
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
									: !efficiencySignalGate
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
		scoring_version: "parallel-requirement-score.v10",
		planned_initial_invocations: plannedInitialInvocations,
		actual_invocations: actualInvocations,
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
				combined_child_tokens_pct_p50: median(pairedCombinedChildTokenDeltas),
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
		evaluation: {
			harness_pass: harnessValidity.ok,
			enabled_quality_pass: criticalQualityGate,
			diagnostic_contract_pass: diagnosticContractPass,
			claim_eligible: protocol === "final",
		},
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
			efficiency_signal_gate: efficiencySignalGate,
		},
		family_summaries: familySummaries,
		ok:
			protocol === "shadow"
				? diagnosticContractPass
				: harnessValidity.ok &&
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
		if (protocol === "shadow" || protocol === "final") {
			recordPaidAttempt(projectRoot, result, "evaluated");
		}
		result.artifacts = publishParallelArtifacts(
			result,
			options.outputPath,
			options.artifactOperations,
		);
		if (protocol === "shadow" || protocol === "final") {
			recordPaidAttempt(projectRoot, result, "published");
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
	onModelInvocation: () => void;
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
		inputComplete = true,
	): Promise<{
		record: ParallelStageRecord;
		data: Record<string, unknown>;
	}> => {
		input.onModelInvocation();
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
				execution_mode: "model",
				execution_ok: false,
				output_correct: false,
				token_accounting_complete: false,
				elapsed_ms: round(ended - started),
				start_offset_ms: round(started - conditionStart),
				end_offset_ms: round(ended - conditionStart),
				input_bytes: measuredInput.bytes,
				input_bytes_complete: measuredInput.complete && inputComplete,
				tokens: { ...EMPTY_USAGE },
				error: "runner-threw",
			};
			records.push(record);
			return { record, data: {} };
		}
		const ended = performance.now();
		const parsed = parseStageJsonl(response.stdout, stage);
		const measuredInput = measureInputBytes(prompt, inputPaths);
		const processSucceeded = response.status === 0 && !parsed.runnerFailed;
		const record: ParallelStageRecord = {
			stage,
			execution_mode: "model",
			execution_ok: processSucceeded,
			runner_protocol_valid: parsed.protocolValid,
			output_schema_valid: parsed.outputSchemaValid,
			runner_protocol_summary: parsed.summary,
			output_correct: false,
			token_accounting_complete: parsed.usage !== undefined,
			elapsed_ms: round(response.elapsedMs),
			start_offset_ms: round(started - conditionStart),
			end_offset_ms: round(ended - conditionStart),
			input_bytes: measuredInput.bytes,
			input_bytes_complete: measuredInput.complete && inputComplete,
			tokens: parsed.usage ?? { ...EMPTY_USAGE },
			...(response.status !== 0
				? { error: "codex-process-failed" }
				: parsed.runnerFailed
					? { error: "codex-runner-reported-failure" }
					: !parsed.protocolValid
						? { error: "codex-runner-protocol-invalid" }
						: !parsed.outputSchemaValid
							? { error: "codex-output-invalid" }
							: {}),
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
	if (!planExact) {
		plan.record.output_correct = false;
		return {
			condition: input.condition,
			execution_ok: false,
			product_pass: false,
			token_accounting_complete: false,
			critical_path_ms: round(performance.now() - conditionStart),
			agent_elapsed_ms: round(plan.record.elapsed_ms),
			children_overlap_ms: 0,
			children_overlap_ratio: 0,
			reviewer_started_after_children: false,
			child_accuracy_pct: 0,
			reviewer_accuracy_pct: 0,
			review_audit_oracle_exact: false,
			final_accuracy_pct: 0,
			final_exact_requirements: 0,
			final_defects: input.requirements.length,
			tokens: { ...plan.record.tokens },
			stages: records,
		};
	}
	const planA = plan.data.child_a as string[];
	const planB = plan.data.child_b as string[];
	const expectedChildA = expectedChildRequirements(input.requirements, planA);
	const expectedChildB = expectedChildRequirements(input.requirements, planB);
	const childAInput = readInlineInput(
		path.join(
			input.cwd,
			input.condition === "enabled" ? "CHILD_A.md" : "CONTEXT.md",
		),
	);
	const childBInput = readInlineInput(
		path.join(
			input.cwd,
			input.condition === "enabled" ? "CHILD_B.md" : "CONTEXT.md",
		),
	);
	const childAPrompt = `Scenario ${input.scenarioId}; replicate seed ${input.seed}. Use only the authoritative payload below; do not read files or run commands.\n${renderInlinePayload(childAInput.content)}\nReturn exact id, status, and summary for only these assigned requirements, in this order: ${planA.join(", ")}.`;
	const childBPrompt = `Scenario ${input.scenarioId}; replicate seed ${input.seed}. Use only the authoritative payload below; do not read files or run commands.\n${renderInlinePayload(childBInput.content)}\nReturn exact id, status, and summary for only these assigned requirements, in this order: ${planB.join(", ")}.`;
	const childAInputExact =
		parseInlinePayload(childAPrompt) === childAInput.content &&
		(input.condition !== "enabled" ||
			workPacketSubsetExact(
				input.cwd,
				"CHILD_A.md",
				input.requirements.slice(0, half),
				input.requirements,
			));
	const childBInputExact =
		parseInlinePayload(childBPrompt) === childBInput.content &&
		(input.condition !== "enabled" ||
			workPacketSubsetExact(
				input.cwd,
				"CHILD_B.md",
				input.requirements.slice(half),
				input.requirements,
			));
	const [childA, childB] = await Promise.all([
		invoke("child-a", childAPrompt, [], childAInput.complete),
		invoke("child-b", childBPrompt, [], childBInput.complete),
	]);
	childA.record.input_contract_ok = childAInputExact;
	childB.record.input_contract_ok = childBInputExact;
	const reviewedInputs = perturbReviewInputs(
		input.scenarioId,
		childA.data.requirements,
		childB.data.requirements,
	);
	const reviewerTruth = readInlineInput(path.join(input.cwd, "CONTEXT.md"));
	const reviewPacket = renderCompactReviewPacket(
		reviewedInputs.childA,
		reviewedInputs.childB,
	);
	const reviewerPrompt = `Use only the two framed payloads below; do not read files or run commands. The authoritative truth overrides child reports.\n${renderNamedInlinePayload("authoritative-truth", reviewerTruth.content)}\n${renderNamedInlinePayload("child-reports", reviewPacket)}\nReturn only corrected exact requirements in source order.`;
	const reviewer = await invoke(
		"reviewer",
		reviewerPrompt,
		[],
		reviewerTruth.complete &&
			parseNamedInlinePayload(reviewerPrompt, "authoritative-truth") ===
				reviewerTruth.content &&
			parseNamedInlinePayload(reviewerPrompt, "child-reports") === reviewPacket,
	);
	const auditStarted = performance.now();
	const auditInput = JSON.stringify({
		reviewer_requirements: reviewer.data.requirements,
		child_a: reviewedInputs.childA,
		child_b: reviewedInputs.childB,
		plan: { child_a: planA, child_b: planB },
	});
	const audit = auditParallelReviewConsistency({
		reviewerRequirements: reviewer.data.requirements,
		childA: reviewedInputs.childA,
		childB: reviewedInputs.childB,
		childAAssignment: planA,
		childBAssignment: planB,
	});
	const auditEnded = performance.now();
	const auditRecord: ParallelStageRecord = {
		stage: "review-audit",
		execution_mode: "deterministic",
		execution_ok: true,
		output_correct: false,
		token_accounting_complete: true,
		elapsed_ms: round(auditEnded - auditStarted),
		start_offset_ms: round(auditStarted - conditionStart),
		end_offset_ms: round(auditEnded - conditionStart),
		input_bytes: Buffer.byteLength(auditInput, "utf8"),
		input_bytes_complete: true,
		tokens: { ...EMPTY_USAGE },
		review_audit_summary: {
			verdict: audit.verdict,
			missing: audit.missingIds.length,
			duplicate: audit.duplicateIds.length,
			unexpected: audit.unexpectedIds.length,
			misassigned: audit.misassignedIds.length,
			status_mismatch: audit.statusMismatchIds.length,
			summary_mismatch: audit.summaryMismatchIds.length,
			malformed_rows: audit.malformedRows,
			order_ok: audit.orderOk,
			actual_digest: digest(audit),
		},
	};
	records.push(auditRecord);
	// Serialize and parse the reviewer envelope to make this a real clone boundary.
	// Missing, malformed, duplicate, or misordered rows remain exactly as supplied;
	// expected requirements are never consulted by this deterministic stage.
	const finalStarted = performance.now();
	const finalEnvelopeJson = JSON.stringify({
		requirements: reviewer.data.requirements,
	});
	const finalEnvelope = JSON.parse(finalEnvelopeJson) as {
		requirements?: unknown;
	};
	const finalEnded = performance.now();
	const finalRecord: ParallelStageRecord = {
		stage: "leader-integrate",
		execution_mode: "deterministic",
		execution_ok: true,
		output_correct: false,
		token_accounting_complete: true,
		elapsed_ms: round(finalEnded - finalStarted),
		start_offset_ms: round(finalStarted - conditionStart),
		end_offset_ms: round(finalEnded - conditionStart),
		input_bytes: Buffer.byteLength(finalEnvelopeJson, "utf8"),
		input_bytes_complete: true,
		tokens: { ...EMPTY_USAGE },
	};
	const final = { record: finalRecord, data: finalEnvelope };
	records.push(finalRecord);
	// The fixture oracle is consulted only after every execution stage has
	// completed. It scores the already-produced audit; it never enters the audit
	// helper or any model prompt.
	const expectedAudit = analyzeChildReports(
		reviewedInputs.childA,
		reviewedInputs.childB,
		expectedChildRequirements(input.requirements, planA),
		expectedChildRequirements(input.requirements, planB),
	);
	auditRecord.review_audit_summary!.oracle_digest = digest(expectedAudit);
	auditRecord.output_correct = reviewAuditEqual(audit, expectedAudit);
	plan.record.output_correct = plan.record.execution_ok && planExact;
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
	const reviewerScore = scoreRequirements(
		reviewer.data.requirements,
		input.requirements,
	);
	applyRequirementScore(reviewer.record, reviewerScore);
	reviewer.record.output_correct =
		reviewer.record.execution_ok && reviewerScore.exact;
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
		review_audit_oracle_exact: auditRecord.output_correct,
		final_accuracy_pct: finalScore.accuracyPct,
		final_exact_requirements: finalScore.exactRequirements,
		final_defects: countFinalRequirementDefects(finalScore),
		tokens,
		stages: records,
	};
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
	gitSha: string,
): { attemptsBefore: number } {
	if (protocol !== "shadow" && protocol !== "final") {
		return { attemptsBefore: 0 };
	}
	if ((protocol === "shadow" || protocol === "final") && !write) {
		throw new Error(
			`${protocol} protocol requires --write to retain every outcome`,
		);
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
	const indexPath = parallelPaidAttemptIndexPath(projectRoot);
	fs.mkdirSync(path.dirname(indexPath), { recursive: true });
	const attemptsBefore = appendParallelPaidAttemptLocked(
		indexPath,
		{
			schema_version: "anamnesis.work_parallel_agent_attempt.v1",
			protocol,
			phase: "started",
			generated_at: new Date().toISOString(),
			implementation_git_sha: gitSha,
		},
		gitSha,
	);
	return { attemptsBefore };
}

function commandOutput(command: string, args: string[], cwd: string): string {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	return result.status === 0 ? result.stdout.trim() || "unknown" : "unknown";
}

function parseRuns(value: number): number {
	if (!Number.isInteger(value) || value < 3) {
		throw new Error("--runs requires an integer >= 3");
	}
	return value;
}
