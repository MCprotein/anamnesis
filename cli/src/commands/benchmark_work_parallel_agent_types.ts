import * as fs from "node:fs";
import type { WorkAgentTokenUsage } from "./benchmark_work_agent.js";

export const WORK_PARALLEL_AGENT_SCHEMA_VERSION =
	"anamnesis.work_parallel_agent_ab.v10";
export const WORK_PARALLEL_AGENT_OUTPUT_DIR =
	"docs/benchmark-evidence/work-parallel-agent-ab/v10";
export const WORK_PARALLEL_AGENT_ATTEMPT_LEDGER =
	"docs/benchmark-evidence/work-parallel-agent-ab/v10-attempts.jsonl";
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
export type LegacyVerdict = "PASS_DIRECTIONAL" | "FAIL_REGRESSION";
export type ParallelStage =
	| "leader-plan"
	| "child-a"
	| "child-b"
	| "reviewer"
	| "review-audit"
	| "leader-integrate";

export interface ParallelRequirement {
	id: string;
	status: "verified" | "pending";
	summary: string;
}

export interface ParallelReviewAudit {
	verdict: "accept" | "repair";
	missingIds: string[];
	duplicateIds: string[];
	unexpectedIds: string[];
	misassignedIds: string[];
	statusMismatchIds: string[];
	summaryMismatchIds: string[];
	malformedRows: number;
	orderOk: boolean;
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
	execution_mode: "model" | "deterministic";
	execution_ok: boolean;
	runner_protocol_valid?: boolean;
	runner_protocol_summary?: {
		events: number;
		item_updates: number;
		agent_messages: number;
		completed_turns: number;
		malformed_lines: number;
		invalid_envelopes: number;
		unknown_events: number;
		failure_events: number;
		forbidden_command_events: number;
	};
	output_schema_valid?: boolean;
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
	review_audit_summary?: {
		verdict: "accept" | "repair";
		missing: number;
		duplicate: number;
		unexpected: number;
		misassigned: number;
		status_mismatch: number;
		summary_mismatch: number;
		malformed_rows: number;
		order_ok: boolean;
		actual_digest?: string;
		oracle_digest?: string;
	};
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
	review_audit_oracle_exact: boolean;
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

export interface ParallelSummary {
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
	scoring_version: "parallel-requirement-score.v10";
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
		disabled_review_audit_oracle_exact_passes: number;
		enabled_review_audit_oracle_exact_passes: number;
		disabled_reviewer_exact_passes: number;
		enabled_reviewer_exact_passes: number;
		disabled_final_exact_passes: number;
		enabled_final_exact_passes: number;
		enabled_complete_passes: number;
		total_per_condition: number;
	};
	evaluation: {
		harness_pass: boolean;
		enabled_quality_pass: boolean;
		diagnostic_contract_pass: boolean;
		claim_eligible: boolean;
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
		efficiency_signal_gate: boolean;
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
			review_audit_oracle_exact: number;
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

export const EMPTY_USAGE: WorkAgentTokenUsage = {
	input_tokens: 0,
	cached_input_tokens: 0,
	output_tokens: 0,
	total_tokens: 0,
};
export const TOPOLOGY =
	"harness-orchestrated-two-child-reviewer-leader" as const;
export const REASONING_EFFORT = "high" as const;
export const STAGES: ParallelStage[] = [
	"leader-plan",
	"child-a",
	"child-b",
	"reviewer",
	"review-audit",
	"leader-integrate",
];
