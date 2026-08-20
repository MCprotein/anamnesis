import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import YAML from "yaml";
import {
	appendEvidenceRecord,
	EVIDENCE_SCHEMA_VERSION,
	type RuntimeEvidenceRecord,
} from "../core/evidence.js";
import { briefWork, createWork, transitionWork } from "./work.js";

export const WORK_CONTINUITY_BENCHMARK_SCHEMA_VERSION =
	"anamnesis.work_continuity_benchmark.v1";
export const WORK_CONTINUITY_BENCHMARK_OUTPUT_DIR =
	"docs/benchmark-evidence/work-continuity";

export interface WorkContinuityConditionMetrics {
	setup_ms: number;
	resume_ms: number;
	requirements_recovered: number;
	requirement_recall_pct: number;
	status_accuracy_pct: number;
	progress_pct: number;
	progress_error_points: number;
	resume_payload_bytes: number;
	storage_bytes: number;
}

export interface WorkContinuityBenchmarkRun {
	iteration: number;
	disabled: WorkContinuityConditionMetrics;
	enabled: WorkContinuityConditionMetrics;
}

export interface WorkContinuityLatencyDistribution {
	average: number;
	p50: number;
	p95: number;
	min: number;
	max: number;
}

export interface WorkContinuityBenchmarkSummary {
	runs: number;
	requirements: number;
	verified_requirements: number;
	compact_fact_window: number;
	disabled: WorkContinuityConditionMetrics;
	enabled: WorkContinuityConditionMetrics;
	delta: {
		requirement_recall_points: number;
		status_accuracy_points: number;
		progress_error_points: number;
		resume_ms: number;
		resume_payload_bytes: number;
		storage_bytes: number;
	};
	latency: {
		disabled: {
			setup_ms: WorkContinuityLatencyDistribution;
			resume_ms: WorkContinuityLatencyDistribution;
		};
		enabled: {
			setup_ms: WorkContinuityLatencyDistribution;
			resume_ms: WorkContinuityLatencyDistribution;
		};
	};
}

export interface WorkContinuityBenchmarkResult {
	schema_version: typeof WORK_CONTINUITY_BENCHMARK_SCHEMA_VERSION;
	projectRoot: string;
	generatedAt: string;
	ok: boolean;
	scenario: {
		id: "continuity-compaction-resume-v1";
		requirements: number;
		verified_requirements: number;
		compact_fact_window: number;
		comparison_mode: "equal-facts" | "retention-stress";
	};
	runs: WorkContinuityBenchmarkRun[];
	summary: WorkContinuityBenchmarkSummary;
	artifacts: {
		outputDir?: string;
		json?: string;
		markdown?: string;
	};
	markdown: string;
	evidencePath?: string;
}

export interface WorkContinuityBenchmarkOptions {
	projectRoot: string;
	runs?: number;
	requirements?: number;
	compactFactWindow?: number;
	write?: boolean;
	append?: boolean;
	outputPath?: string;
	now?: () => Date;
}

export class WorkContinuityBenchmarkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkContinuityBenchmarkError";
	}
}

interface ScenarioFact {
	id: string;
	summary: string;
	status: "pending" | "verified";
}

export function workContinuityBenchmark(
	opts: WorkContinuityBenchmarkOptions,
): WorkContinuityBenchmarkResult {
	const projectRoot = path.resolve(opts.projectRoot);
	const requestedRuns = positiveInteger(opts.runs ?? 5, "--runs");
	const requirements = positiveInteger(
		opts.requirements ?? 20,
		"--requirements",
	);
	const compactFactWindow = positiveInteger(
		opts.compactFactWindow ?? requirements,
		"--compact-window",
	);
	if (requirements > 100) {
		throw new WorkContinuityBenchmarkError(
			"--requirements must be at most 100 for the public sanitized fixture",
		);
	}
	const verifiedRequirements = Math.floor(requirements / 2);
	const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
	const runs: WorkContinuityBenchmarkRun[] = [];
	for (let iteration = 1; iteration <= requestedRuns; iteration += 1) {
		runs.push(
			runScenario({
				iteration,
				requirements,
				verifiedRequirements,
				compactFactWindow,
			}),
		);
	}
	const summary = summarizeRuns(
		runs,
		requirements,
		verifiedRequirements,
		compactFactWindow,
	);
	let result: WorkContinuityBenchmarkResult = {
		schema_version: WORK_CONTINUITY_BENCHMARK_SCHEMA_VERSION,
		projectRoot,
		generatedAt,
		ok:
			summary.enabled.requirement_recall_pct === 100 &&
			summary.enabled.status_accuracy_pct === 100 &&
			summary.enabled.progress_error_points === 0,
		scenario: {
			id: "continuity-compaction-resume-v1",
			requirements,
			verified_requirements: verifiedRequirements,
			compact_fact_window: compactFactWindow,
			comparison_mode:
				compactFactWindow >= requirements ? "equal-facts" : "retention-stress",
		},
		runs,
		summary,
		artifacts: {},
		markdown: "",
	};
	result = {
		...result,
		markdown: renderWorkContinuityBenchmarkMarkdown(result),
	};
	if (opts.write === true) {
		result = { ...result, artifacts: writeArtifacts(result, opts.outputPath) };
	}
	if (opts.append === true) {
		result = {
			...result,
			evidencePath: appendEvidenceRecord(
				projectRoot,
				workContinuityEvidenceRecord(result),
			),
		};
	}
	return result;
}

function runScenario(input: {
	iteration: number;
	requirements: number;
	verifiedRequirements: number;
	compactFactWindow: number;
}): WorkContinuityBenchmarkRun {
	const fixtureRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), `anamnesis-work-benchmark-${input.iteration}-`),
	);
	try {
		let disabled: WorkContinuityConditionMetrics;
		let enabled: WorkContinuityConditionMetrics;
		if (input.iteration % 2 === 1) {
			disabled = runDisabledScenario(fixtureRoot, input);
			enabled = runEnabledScenario(fixtureRoot, input);
		} else {
			enabled = runEnabledScenario(fixtureRoot, input);
			disabled = runDisabledScenario(fixtureRoot, input);
		}
		return { iteration: input.iteration, disabled, enabled };
	} finally {
		fs.rmSync(fixtureRoot, { recursive: true, force: true });
	}
}

function runDisabledScenario(
	fixtureRoot: string,
	input: {
		requirements: number;
		verifiedRequirements: number;
		compactFactWindow: number;
	},
): WorkContinuityConditionMetrics {
	const root = path.join(fixtureRoot, "disabled");
	fs.mkdirSync(root);
	const facts = scenarioCurrentFacts(
		input.requirements,
		input.verifiedRequirements,
	).slice(-input.compactFactWindow);
	const payload = Buffer.from(JSON.stringify(facts));
	const handoffPath = path.join(root, "legacy-handoff.json");
	const setupStart = performance.now();
	fs.writeFileSync(handoffPath, payload);
	const handle = fs.openSync(handoffPath, "r");
	try {
		fs.fsyncSync(handle);
	} finally {
		fs.closeSync(handle);
	}
	const setupMs = performance.now() - setupStart;
	const resumeStart = performance.now();
	const parsed = JSON.parse(
		fs.readFileSync(handoffPath, "utf8"),
	) as ScenarioFact[];
	const recovered = new Map(parsed.map((fact) => [fact.id, fact]));
	const metrics = qualityMetrics(
		recovered,
		input.requirements,
		input.verifiedRequirements,
	);
	const resumeMs = performance.now() - resumeStart;
	return {
		...metrics,
		setup_ms: roundMs(setupMs),
		resume_ms: roundMs(resumeMs),
		resume_payload_bytes: payload.byteLength,
		storage_bytes: directoryBytes(root),
	};
}

function runEnabledScenario(
	fixtureRoot: string,
	input: { requirements: number; verifiedRequirements: number },
): WorkContinuityConditionMetrics {
	const root = path.join(fixtureRoot, "enabled");
	fs.mkdirSync(root);
	writeFixtureAgentfile(root);
	const setupStart = performance.now();
	let mutation = createWork({
		project_root: root,
		work_id: "benchmark_work",
		event_id: "work_created",
		occurred_at: timestamp(0),
		expected_head: null,
		draft: contractDraft(input.requirements),
		source_stdin: {
			event_id: "source_create",
			captured_at: timestamp(0),
			client: "codex",
			content_type: "text/plain; charset=utf-8",
			fidelity: "client_exact",
			allocation_status: "allocated",
			body: Buffer.from("Sanitized benchmark requirements", "utf8"),
		},
	});
	for (let index = 0; index < input.verifiedRequirements; index += 1) {
		mutation = transitionWork({
			project_root: root,
			work_id: "benchmark_work",
			event_id: `verified_${index + 1}`,
			occurred_at: timestamp(index + 1),
			expected_head: mutation.projection.ledger_head!,
			draft: Buffer.from(
				YAML.stringify({
					requirement_id: requirementId(index),
					status: "verified",
					evidence_refs: [`benchmark:evidence:${index + 1}`],
				}),
			),
		});
	}
	const setupMs = performance.now() - setupStart;
	const resumeStart = performance.now();
	const brief = briefWork({
		project_root: root,
		work_id: "benchmark_work",
	});
	const recovered = new Map(
		brief.projection.requirements.map((requirement) => [
			requirement.id,
			{
				id: requirement.id,
				summary: requirement.summary,
				status: requirement.status === "verified" ? "verified" : "pending",
			} satisfies ScenarioFact,
		]),
	);
	const metrics = qualityMetrics(
		recovered,
		input.requirements,
		input.verifiedRequirements,
	);
	const resumeMs = performance.now() - resumeStart;
	return {
		...metrics,
		setup_ms: roundMs(setupMs),
		resume_ms: roundMs(resumeMs),
		resume_payload_bytes: Buffer.byteLength(JSON.stringify(brief.briefing)),
		storage_bytes: directoryBytes(path.join(root, ".anamnesis")),
	};
}

function scenarioCurrentFacts(
	requirements: number,
	verifiedRequirements: number,
): ScenarioFact[] {
	return Array.from({ length: requirements }, (_, index) => {
		return {
			id: requirementId(index),
			summary: requirementSummary(index),
			status: index < verifiedRequirements ? "verified" : "pending",
		} satisfies ScenarioFact;
	});
}

function qualityMetrics(
	recovered: Map<string, ScenarioFact>,
	requirements: number,
	verifiedRequirements: number,
): Omit<
	WorkContinuityConditionMetrics,
	"setup_ms" | "resume_ms" | "resume_payload_bytes" | "storage_bytes"
> {
	let correct = 0;
	let recoveredVerified = 0;
	for (let index = 0; index < requirements; index += 1) {
		const fact = recovered.get(requirementId(index));
		const expected = index < verifiedRequirements ? "verified" : "pending";
		if (
			fact?.summary === requirementSummary(index) &&
			fact.status === expected
		) {
			correct += 1;
		}
		if (fact?.status === "verified") recoveredVerified += 1;
	}
	const progressPct =
		recovered.size === 0 ? 0 : percentage(recoveredVerified, recovered.size);
	const expectedProgress = percentage(verifiedRequirements, requirements);
	return {
		requirements_recovered: recovered.size,
		requirement_recall_pct: percentage(recovered.size, requirements),
		status_accuracy_pct: percentage(correct, recovered.size),
		progress_pct: progressPct,
		progress_error_points: roundMs(Math.abs(progressPct - expectedProgress)),
	};
}

function contractDraft(requirements: number): Buffer {
	return Buffer.from(
		YAML.stringify({
			work: {
				title: "Continuity benchmark Work",
				completion_contract: "Every benchmark requirement is verified",
			},
			boundary: {
				state: "accepted",
				classification: "new_unit",
				reason_codes: ["same_deliverable"],
				confidence: "high",
			},
			requirements: Array.from({ length: requirements }, (_, index) => ({
				id: requirementId(index),
				summary: requirementSummary(index),
				source_event_ids: ["source_create"],
			})),
			open_conflicts: [],
		}),
	);
}

function writeFixtureAgentfile(root: string): void {
	fs.writeFileSync(
		path.join(root, "Agentfile"),
		YAML.stringify({
			version: 2,
			project: { name: "work-continuity-benchmark" },
			tools: ["codex"],
			fragments: [],
		}),
	);
}

function summarizeRuns(
	runs: readonly WorkContinuityBenchmarkRun[],
	requirements: number,
	verifiedRequirements: number,
	compactFactWindow: number,
): WorkContinuityBenchmarkSummary {
	const disabled = averageCondition(runs.map((run) => run.disabled));
	const enabled = averageCondition(runs.map((run) => run.enabled));
	return {
		runs: runs.length,
		requirements,
		verified_requirements: verifiedRequirements,
		compact_fact_window: compactFactWindow,
		disabled,
		enabled,
		delta: {
			requirement_recall_points: roundMs(
				enabled.requirement_recall_pct - disabled.requirement_recall_pct,
			),
			status_accuracy_points: roundMs(
				enabled.status_accuracy_pct - disabled.status_accuracy_pct,
			),
			progress_error_points: roundMs(
				enabled.progress_error_points - disabled.progress_error_points,
			),
			resume_ms: roundMs(enabled.resume_ms - disabled.resume_ms),
			resume_payload_bytes:
				enabled.resume_payload_bytes - disabled.resume_payload_bytes,
			storage_bytes: enabled.storage_bytes - disabled.storage_bytes,
		},
		latency: {
			disabled: {
				setup_ms: distribution(runs.map((run) => run.disabled.setup_ms)),
				resume_ms: distribution(runs.map((run) => run.disabled.resume_ms)),
			},
			enabled: {
				setup_ms: distribution(runs.map((run) => run.enabled.setup_ms)),
				resume_ms: distribution(runs.map((run) => run.enabled.resume_ms)),
			},
		},
	};
}

function averageCondition(
	values: readonly WorkContinuityConditionMetrics[],
): WorkContinuityConditionMetrics {
	const average = (key: keyof WorkContinuityConditionMetrics) =>
		roundMs(values.reduce((sum, value) => sum + value[key], 0) / values.length);
	return {
		setup_ms: average("setup_ms"),
		resume_ms: average("resume_ms"),
		requirements_recovered: average("requirements_recovered"),
		requirement_recall_pct: average("requirement_recall_pct"),
		status_accuracy_pct: average("status_accuracy_pct"),
		progress_pct: average("progress_pct"),
		progress_error_points: average("progress_error_points"),
		resume_payload_bytes: average("resume_payload_bytes"),
		storage_bytes: average("storage_bytes"),
	};
}

function renderWorkContinuityBenchmarkMarkdown(
	result: WorkContinuityBenchmarkResult,
): string {
	const { summary } = result;
	return [
		"# Work Continuity Before/After Benchmark",
		"",
		`Generated: ${result.generatedAt}`,
		"",
		`Same sanitized scenario: ${summary.requirements} requirements, ${summary.verified_requirements} verified transitions, then a compaction/resume boundary retaining ${summary.compact_fact_window} recent facts when Work continuity is disabled.`,
		`Comparison mode: ${result.scenario.comparison_mode}. The default keeps all current facts in both conditions; a smaller explicit compact window is a retention-stress experiment, not an attributable before/after quality claim.`,
		"",
		"| Metric | Disabled | Enabled | Delta (enabled-disabled) |",
		"|---|---:|---:|---:|",
		`| Requirement recall | ${summary.disabled.requirement_recall_pct}% | ${summary.enabled.requirement_recall_pct}% | ${signed(summary.delta.requirement_recall_points)} pp |`,
		`| Status accuracy | ${summary.disabled.status_accuracy_pct}% | ${summary.enabled.status_accuracy_pct}% | ${signed(summary.delta.status_accuracy_points)} pp |`,
		`| Progress error | ${summary.disabled.progress_error_points} pp | ${summary.enabled.progress_error_points} pp | ${signed(summary.delta.progress_error_points)} pp |`,
		`| Resume latency | ${summary.disabled.resume_ms} ms | ${summary.enabled.resume_ms} ms | ${signed(summary.delta.resume_ms)} ms |`,
		`| Resume latency p50/p95 | ${summary.latency.disabled.resume_ms.p50}/${summary.latency.disabled.resume_ms.p95} ms | ${summary.latency.enabled.resume_ms.p50}/${summary.latency.enabled.resume_ms.p95} ms | — |`,
		`| Resume payload | ${summary.disabled.resume_payload_bytes} B | ${summary.enabled.resume_payload_bytes} B | ${signed(summary.delta.resume_payload_bytes)} B |`,
		`| Durable storage | ${summary.disabled.storage_bytes} B | ${summary.enabled.storage_bytes} B | ${signed(summary.delta.storage_bytes)} B |`,
		"",
		"Claim boundary:",
		"- Quality values are deterministic structural recovery from the same logical end state and scenario, not measured model intelligence.",
		"- Disabled reopens a persisted JSON handoff; enabled reopens and refolds the authoritative Work ledger, builds the briefing, and constructs the same consumer-state metrics.",
		"- Condition order alternates between runs. Reports include averages plus p50/p95/min/max latency distributions.",
		"- Latency and byte values are local-machine measurements. Repeat on the target host before making performance claims.",
		"- Real agent task success and token use require paired repeated model runs using the existing task-compare/task-series harness.",
		"",
	].join("\n");
}

function writeArtifacts(
	result: WorkContinuityBenchmarkResult,
	outputPath?: string,
): WorkContinuityBenchmarkResult["artifacts"] {
	const outputDir = outputPath ?? WORK_CONTINUITY_BENCHMARK_OUTPUT_DIR;
	const absDir = path.isAbsolute(outputDir)
		? outputDir
		: path.join(result.projectRoot, outputDir);
	fs.mkdirSync(absDir, { recursive: true });
	const artifacts = {
		outputDir,
		json: path.posix.join(outputDir, "work-continuity.json"),
		markdown: path.posix.join(outputDir, "work-continuity.md"),
	};
	fs.writeFileSync(
		path.join(absDir, "work-continuity.json"),
		`${JSON.stringify({ ...result, projectRoot: ".", artifacts }, null, 2)}\n`,
	);
	fs.writeFileSync(path.join(absDir, "work-continuity.md"), result.markdown);
	return artifacts;
}

function workContinuityEvidenceRecord(
	result: WorkContinuityBenchmarkResult,
): RuntimeEvidenceRecord {
	return {
		schema_version: EVIDENCE_SCHEMA_VERSION,
		kind: "work-continuity-benchmark",
		generated_at: result.generatedAt,
		command: ["anamnesis", "benchmark", "work-continuity"],
		project: { name: path.basename(result.projectRoot) },
		summary: {
			schema_version: result.schema_version,
			runs: result.summary.runs,
			requirements: result.summary.requirements,
			disabled_recall_pct: result.summary.disabled.requirement_recall_pct,
			enabled_recall_pct: result.summary.enabled.requirement_recall_pct,
			status_accuracy_delta_points: result.summary.delta.status_accuracy_points,
			resume_ms_delta: result.summary.delta.resume_ms,
		},
		details: {
			scenario: result.scenario,
			disabled: result.summary.disabled,
			enabled: result.summary.enabled,
			delta: result.summary.delta,
			latency: result.summary.latency,
		},
		...(Object.keys(result.artifacts).length > 0
			? { artifacts: result.artifacts as Record<string, string> }
			: {}),
	};
}

function positiveInteger(value: number, flag: string): number {
	if (!Number.isInteger(value) || value < 1) {
		throw new WorkContinuityBenchmarkError(
			`${flag} requires a positive integer`,
		);
	}
	return value;
}

function timestamp(offsetSeconds: number): string {
	return new Date(Date.UTC(2026, 7, 20, 0, 0, offsetSeconds)).toISOString();
}

function requirementId(index: number): string {
	return `req_${String(index + 1).padStart(3, "0")}`;
}

function requirementSummary(index: number): string {
	return `Requirement ${String(index + 1).padStart(3, "0")} must remain exact`;
}

function directoryBytes(root: string): number {
	if (!fs.existsSync(root)) return 0;
	let total = 0;
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const target = path.join(root, entry.name);
		if (entry.isDirectory()) total += directoryBytes(target);
		else if (entry.isFile()) total += fs.statSync(target).size;
	}
	return total;
}

function percentage(part: number, total: number): number {
	return total === 0 ? 0 : roundMs((part / total) * 100);
}

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}

function distribution(
	values: readonly number[],
): WorkContinuityLatencyDistribution {
	const sorted = [...values].sort((left, right) => left - right);
	const percentile = (fraction: number) =>
		sorted[
			Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
		]!;
	return {
		average: roundMs(
			values.reduce((sum, value) => sum + value, 0) / values.length,
		),
		p50: roundMs(percentile(0.5)),
		p95: roundMs(percentile(0.95)),
		min: roundMs(sorted[0]!),
		max: roundMs(sorted.at(-1)!),
	};
}

function signed(value: number): string {
	return value > 0 ? `+${value}` : String(value);
}
