import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import YAML from "yaml";
import type { WorkAgentTokenUsage } from "./benchmark_work_agent.js";
import { briefWork, createWork, transitionWork } from "./work.js";
import { renderWorkBriefingContext } from "./work_hook.js";

export const WORK_PARALLEL_AGENT_SCHEMA_VERSION =
	"anamnesis.work_parallel_agent_ab.v1";
export const WORK_PARALLEL_AGENT_OUTPUT_DIR =
	"docs/benchmark-evidence/work-parallel-agent-ab";
export const DEFAULT_WORK_PARALLEL_AGENT_MODEL = "gpt-5.6-luna";

export type ParallelCondition = "disabled" | "enabled";
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
	tokens: WorkAgentTokenUsage;
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
	tokens: WorkAgentTokenUsage;
	stages: ParallelStageRecord[];
}

export interface ParallelPairRun {
	iteration: number;
	order: [ParallelCondition, ParallelCondition];
	disabled: ParallelConditionRun;
	enabled: ParallelConditionRun;
}

interface ParallelSummary {
	runs: number;
	product_pass_pct: number;
	critical_path_ms: number;
	agent_elapsed_ms: number;
	children_overlap_ms: number;
	total_tokens: number;
}

export interface ParallelBenchmarkResult {
	schema_version: typeof WORK_PARALLEL_AGENT_SCHEMA_VERSION;
	generated_at: string;
	project_root: string;
	model: string;
	reasoning_effort: "high";
	topology: "harness-orchestrated-two-child-reviewer-leader";
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
	};
	harness_validity: { ok: boolean; checks: Record<string, boolean> };
	product_contract: {
		ok: boolean;
		disabled_passes: number;
		enabled_passes: number;
		total_per_condition: number;
	};
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
const REQUIREMENTS_SCHEMA = strictObject(["requirements"], {
	requirements: {
		type: "array",
		items: strictObject(["id", "status", "summary"], {
			id: { type: "string" },
			status: { type: "string", enum: ["verified", "pending"] },
			summary: { type: "string" },
		}),
	},
});
const REVIEW_SCHEMA = strictObject(
	["union_complete", "duplicates", "conflicts"],
	{
		union_complete: { type: "boolean" },
		duplicates: { type: "integer" },
		conflicts: { type: "integer" },
	},
);

export async function workParallelAgentBenchmark(
	options: ParallelBenchmarkOptions,
): Promise<ParallelBenchmarkResult> {
	const projectRoot = path.resolve(options.projectRoot);
	const runs = parseRuns(options.runs ?? 3);
	const model = options.model?.trim() || DEFAULT_WORK_PARALLEL_AGENT_MODEL;
	const runner = options.runner ?? runCodexExec;
	const requirements = options.requirements ?? defaultRequirements();
	const fixtureHash = digest(requirements);
	const plannedInitialInvocations = runs * 2 * STAGES.length;
	options.onPlan?.({ runs, invocations: plannedInitialInvocations });

	const tempRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-parallel-agent-"),
	);
	const schemas = writeSchemas(tempRoot);
	const pairs: ParallelPairRun[] = [];
	let equalAuthoritativeFacts = true;
	try {
		for (let iteration = 1; iteration <= runs; iteration += 1) {
			const order: [ParallelCondition, ParallelCondition] =
				iteration % 2 === 1 ? ["disabled", "enabled"] : ["enabled", "disabled"];
			const conditions = {} as Record<ParallelCondition, ParallelConditionRun>;
			const fixtures = {} as Record<
				ParallelCondition,
				{ cwd: string; factHash: string }
			>;
			for (const condition of ["disabled", "enabled"] as const) {
				const cwd = path.join(tempRoot, `${iteration}-${condition}`);
				fs.mkdirSync(cwd);
				const rendered =
					condition === "enabled"
						? materializeWorkContext(cwd, requirements)
						: {
								context: renderLegacyContext(requirements),
								factHash: digest(requirements),
							};
				fs.writeFileSync(path.join(cwd, "CONTEXT.md"), rendered.context);
				fixtures[condition] = { cwd, factHash: rendered.factHash };
			}
			const pairFactsEqual =
				fixtures.disabled.factHash === fixtureHash &&
				fixtures.enabled.factHash === fixtureHash;
			equalAuthoritativeFacts &&= pairFactsEqual;
			if (!pairFactsEqual) {
				throw new Error(
					"disabled/enabled authoritative fact hashes differ; refusing paid calls",
				);
			}
			for (const condition of order) {
				conditions[condition] = await executeCondition({
					condition,
					cwd: fixtures[condition].cwd,
					model,
					runner,
					schemas,
					requirements,
				});
			}
			pairs.push({
				iteration,
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
		children_overlapped: allRuns.every((run) => run.children_overlap_ms > 0),
		reviewer_after_children: allRuns.every(
			(run) => run.reviewer_started_after_children,
		),
		all_processes_returned: allRuns.every((run) => run.execution_ok),
		no_excluded_conditions: allRuns.length === runs * 2,
		condition_order_alternated: pairs.every(
			(pair) =>
				pair.order[0] === (pair.iteration % 2 === 1 ? "disabled" : "enabled"),
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
	const productContract = {
		ok: disabledPasses === runs && enabledPasses === runs,
		disabled_passes: disabledPasses,
		enabled_passes: enabledPasses,
		total_per_condition: runs,
	};
	const result: ParallelBenchmarkResult = {
		schema_version: WORK_PARALLEL_AGENT_SCHEMA_VERSION,
		generated_at: (options.now ?? (() => new Date()))().toISOString(),
		project_root: projectRoot,
		model,
		reasoning_effort: REASONING_EFFORT,
		topology: TOPOLOGY,
		runs_per_condition: runs,
		planned_initial_invocations: plannedInitialInvocations,
		actual_invocations: allRuns.reduce(
			(total, run) => total + run.stages.length,
			0,
		),
		fixture_hash: fixtureHash,
		harness_hash: digest({
			schema: WORK_PARALLEL_AGENT_SCHEMA_VERSION,
			topology: TOPOLOGY,
			stages: STAGES,
			reasoning_effort: REASONING_EFFORT,
		}),
		reproducibility: collectReproducibility(projectRoot),
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
		},
		harness_validity: harnessValidity,
		product_contract: productContract,
		ok: harnessValidity.ok && productContract.ok,
		artifacts: {},
		markdown: "",
	};
	result.markdown = renderParallelBenchmarkMarkdown(result);
	if (options.write) {
		result.artifacts = publishParallelArtifacts(
			result,
			options.outputPath,
			options.artifactOperations,
		);
	}
	return result;
}

async function executeCondition(input: {
	condition: ParallelCondition;
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
			const record: ParallelStageRecord = {
				stage,
				execution_ok: false,
				output_correct: false,
				token_accounting_complete: false,
				elapsed_ms: round(ended - started),
				start_offset_ms: round(started - conditionStart),
				end_offset_ms: round(ended - conditionStart),
				tokens: { ...EMPTY_USAGE },
				error: "runner-threw",
			};
			records.push(record);
			return { record, data: {} };
		}
		const ended = performance.now();
		const parsed = parseStageJsonl(response.stdout);
		const record: ParallelStageRecord = {
			stage,
			execution_ok: response.status === 0 && parsed.data !== undefined,
			output_correct: false,
			token_accounting_complete: parsed.usage !== undefined,
			elapsed_ms: round(response.elapsedMs),
			start_offset_ms: round(started - conditionStart),
			end_offset_ms: round(ended - conditionStart),
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
		`Read CONTEXT.md. Partition all authoritative requirement IDs in source order into two contiguous groups of ${expectedA.length} and ${expectedB.length}. Return only child_a and child_b arrays.`,
	);
	const planA = stringArray(plan.data.child_a) ?? expectedA;
	const planB = stringArray(plan.data.child_b) ?? expectedB;
	const [childA, childB] = await Promise.all([
		invoke(
			"child-a",
			`Read CONTEXT.md. Return exact id, status, and summary for only these assigned requirements, in this order: ${planA.join(", ")}.`,
		),
		invoke(
			"child-b",
			`Read CONTEXT.md. Return exact id, status, and summary for only these assigned requirements, in this order: ${planB.join(", ")}.`,
		),
	]);
	const reviewer = await invoke(
		"reviewer",
		`Review the two child reports only. Expected IDs in order: ${ids.join(", ")}. Child A: ${JSON.stringify(childA.data)} Child B: ${JSON.stringify(childB.data)}. Return union_complete, duplicates, and conflicts.`,
	);
	const final = await invoke(
		"leader-integrate",
		`Integrate only the child reports after considering the reviewer verdict. Child A: ${JSON.stringify(childA.data)} Child B: ${JSON.stringify(childB.data)} Reviewer: ${JSON.stringify(reviewer.data)}. Return every requirement exactly once in expected order: ${ids.join(", ")}.`,
	);
	plan.record.output_correct =
		plan.record.execution_ok &&
		equalStringArrays(plan.data.child_a, expectedA) &&
		equalStringArrays(plan.data.child_b, expectedB);
	childA.record.output_correct =
		childA.record.execution_ok &&
		exactRequirements(
			childA.data.requirements,
			input.requirements.slice(0, half),
		);
	childB.record.output_correct =
		childB.record.execution_ok &&
		exactRequirements(childB.data.requirements, input.requirements.slice(half));
	reviewer.record.output_correct =
		reviewer.record.execution_ok &&
		reviewer.data.union_complete === true &&
		reviewer.data.duplicates === 0 &&
		reviewer.data.conflicts === 0;
	final.record.output_correct =
		final.record.execution_ok &&
		exactRequirements(final.data.requirements, input.requirements);
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
		product_pass: records.every((record) => record.output_correct),
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
): { context: string; factHash: string } {
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
		context: `# Anamnesis Work context\n\n${renderWorkBriefingContext(
			brief.briefing,
			"full",
			true,
			50_000,
		)}\n`,
		factHash: digest(briefingFacts),
	};
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

function exactRequirements(
	value: unknown,
	expected: ParallelRequirement[],
): boolean {
	if (!Array.isArray(value) || value.length !== expected.length) return false;
	return value.every((item, index) => {
		if (!item || typeof item !== "object") return false;
		const actual = item as Record<string, unknown>;
		const wanted = expected[index];
		return (
			actual.id === wanted?.id &&
			actual.status === wanted.status &&
			actual.summary === wanted.summary
		);
	});
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
	return {
		runs: runs.length,
		product_pass_pct: round(
			(runs.filter((run) => run.product_pass).length * 100) / runs.length,
		),
		critical_path_ms: round(average(runs.map((run) => run.critical_path_ms))),
		agent_elapsed_ms: round(average(runs.map((run) => run.agent_elapsed_ms))),
		children_overlap_ms: round(
			average(runs.map((run) => run.children_overlap_ms)),
		),
		total_tokens: round(average(runs.map((run) => run.tokens.total_tokens))),
	};
}

export function renderParallelBenchmarkMarkdown(
	result: ParallelBenchmarkResult,
): string {
	return `# Harness-orchestrated parallel-agent Work A/B\n\n- Generated: ${result.generated_at}\n- Model: \`${result.model}\` (reasoning effort: ${result.reasoning_effort})\n- Pairs per condition: ${result.runs_per_condition}\n- Topology: leader plan → two concurrent children → reviewer → leader integration\n- Planned/actual invocations: ${result.planned_initial_invocations}/${result.actual_invocations}\n- Harness validity: **${result.harness_validity.ok ? "PASS" : "FAIL"}**\n- Product contract: **${result.product_contract.ok ? "PASS" : "FAIL"}**\n\n![Parallel-agent ${escapeMarkdownAlt(result.model)} diagnostic](work-parallel-agent-ab-summary.svg)\n\n| Condition | Product passes | Critical path/run | Agent elapsed/run | Child overlap/run | Tokens/run |\n| --- | ---: | ---: | ---: | ---: | ---: |\n| Work disabled | ${result.product_contract.disabled_passes}/${result.runs_per_condition} | ${result.summary.disabled.critical_path_ms} ms | ${result.summary.disabled.agent_elapsed_ms} ms | ${result.summary.disabled.children_overlap_ms} ms | ${result.summary.disabled.total_tokens} |\n| Work enabled | ${result.product_contract.enabled_passes}/${result.runs_per_condition} | ${result.summary.enabled.critical_path_ms} ms | ${result.summary.enabled.agent_elapsed_ms} ms | ${result.summary.enabled.children_overlap_ms} ms | ${result.summary.enabled.total_tokens} |\n\nDescriptive paired-pilot delta with Work: **${result.summary.delta.total_tokens_pct}% tokens**, **${result.summary.delta.critical_path_pct}% critical-path time**. Work improved complete-pipeline success from **${result.product_contract.disabled_passes}/${result.runs_per_condition}** to **${result.product_contract.enabled_passes}/${result.runs_per_condition}**, but this pilot does not establish a token or latency win.\n\n## Claim boundary\n\nThis is a ${result.runs_per_condition}-pair directional diagnostic over one sanitized equal-information state-reconstruction scenario. The harness launches separate Codex processes and proves that the two child intervals overlap; it does not measure same-session native subagent spawning or general coding productivity. All stage costs are charged, and failed or malformed stages are retained. No prompts, answers, stderr, PIDs, fixture bodies, or host paths are published.\n`;
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
		| "product_contract"
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
		| "product_contract"
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
	const disabledPassWidth = Math.round(
		(340 * result.product_contract.disabled_passes) /
			result.product_contract.total_per_condition,
	);
	const enabledPassWidth = Math.round(
		(340 * result.product_contract.enabled_passes) /
			result.product_contract.total_per_condition,
	);
	const model = escapeXml(result.model);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="330" viewBox="0 0 760 330" role="img" aria-labelledby="title desc">
  <title id="title">Parallel-agent ${model} Work A/B diagnostic</title>
  <desc id="desc">Work left token cost nearly flat and improved complete pipeline passes from ${result.product_contract.disabled_passes} of ${result.product_contract.total_per_condition} to ${result.product_contract.enabled_passes} of ${result.product_contract.total_per_condition}.</desc>
  <rect width="760" height="330" rx="16" fill="#0f172a"/>
  <text x="32" y="42" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="22" font-weight="700">Parallel-agent ${model} diagnostic (${result.runs_per_condition} pairs)</text>
  <text x="32" y="72" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="14">Harness ${result.harness_validity.ok ? "PASS" : "FAIL"} · Product contract ${result.product_contract.ok ? "PASS" : "FAIL"} · directional only</text>
  <text x="32" y="112" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="16" font-weight="600">Average total tokens / pipeline</text>
  <text x="32" y="142" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="14">Disabled</text>
  <rect x="128" y="126" width="${disabledWidth}" height="22" rx="5" fill="#64748b"/>
  <text x="480" y="142" fill="#f8fafc" font-family="ui-monospace,monospace" font-size="14">${result.summary.disabled.total_tokens}</text>
  <text x="32" y="176" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="14">Enabled</text>
  <rect x="128" y="160" width="${enabledWidth}" height="22" rx="5" fill="#38bdf8"/>
  <text x="480" y="176" fill="#f8fafc" font-family="ui-monospace,monospace" font-size="14">${result.summary.enabled.total_tokens} (${result.summary.delta.total_tokens_pct}%)</text>
  <text x="32" y="222" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="16" font-weight="600">Complete pipeline passes</text>
  <text x="32" y="252" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="14">Disabled</text>
  <rect x="128" y="236" width="${disabledPassWidth}" height="22" rx="5" fill="#64748b"/>
  <text x="480" y="252" fill="#f8fafc" font-family="ui-monospace,monospace" font-size="14">${result.product_contract.disabled_passes}/${result.product_contract.total_per_condition}</text>
  <text x="32" y="286" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="14">Enabled</text>
  <rect x="128" y="270" width="${enabledPassWidth}" height="22" rx="5" fill="#22c55e"/>
  <text x="480" y="286" fill="#f8fafc" font-family="ui-monospace,monospace" font-size="14">${result.product_contract.enabled_passes}/${result.product_contract.total_per_condition}</text>
  <text x="32" y="316" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="12">Token delta ${formatSignedPercent(result.summary.delta.total_tokens_pct)} · critical-path delta ${formatSignedPercent(result.summary.delta.critical_path_pct)}</text>
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
		"total_tokens",
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
	return {
		input_tokens: record.input_tokens as number,
		cached_input_tokens: record.cached_input_tokens as number,
		output_tokens: record.output_tokens as number,
		total_tokens: record.total_tokens as number,
	};
}

function formatSignedPercent(value: number): string {
	return `${value > 0 ? "+" : ""}${value}%`;
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

function percent(before: number, after: number): number {
	return before === 0 ? 0 : round(((after - before) * 100) / before);
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
