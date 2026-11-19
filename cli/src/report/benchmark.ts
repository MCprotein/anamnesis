import type {
	BenchmarkCompareResult,
	BenchmarkResult,
} from "../commands/benchmark.js";
import type { BenchmarkGalleryResult } from "../commands/benchmark_gallery.js";
import type {
	PromptDeltaGateResult,
} from "../commands/benchmark_prompt_gate.js";
import type {
	RetrievalBenchmarkResult,
} from "../commands/benchmark_retrieval.js";
import type {
	SessionContextBenchmarkResult,
} from "../commands/benchmark_session_context.js";
import type {
	SubagentInjectionBenchmarkResult,
} from "../commands/benchmark_subagent_injection.js";
import type {
	AgentTaskBenchmarkCompareResult,
	AgentTaskBenchmarkResult,
} from "../commands/benchmark_task.js";
import type {
	AgentTaskBenchmarkSeriesResult,
} from "../commands/benchmark_task_series.js";
import type {
	BenchmarkTraceRollupResult,
} from "../commands/benchmark_trace.js";
import type { UpgradeBenchmarkResult } from "../commands/benchmark_upgrade.js";
import type {
	WorkContinuityBenchmarkResult,
} from "../commands/benchmark_work.js";
import type {
	WorkAgentBenchmarkResult,
} from "../commands/benchmark_work_agent.js";
import type {
	ParallelBenchmarkResult,
} from "../commands/benchmark_work_parallel_agent.js";
import { reportAppendEvidence } from "./common.js";

export function reportBenchmark(result: BenchmarkResult): void {
  console.log(
    `anamnesis benchmark report — ${result.status.agentfile.project.name}`,
  );
  console.log(`  tools: ${result.status.agentfile.tools.join(", ")}`);
	console.log(
		`  ready layers: ${result.summary.ready}/${result.summary.total}`,
	);
  console.log(
    `  continuity: ${result.scorecard.continuity.passed}/${result.scorecard.continuity.total}`,
  );
  console.log(
    `  doctor: ${result.doctor.ok ? "ok" : "issues"} (${result.scorecard.diagnostics.doctor_errors} errors, ${result.scorecard.diagnostics.doctor_warnings} warnings)`,
  );
  console.log(
    `  codex hook warnings: ${result.scorecard.diagnostics.codex_hook_warnings}`,
  );
  console.log(
    `  evidence: ${result.scorecard.evidence.records} valid, ${result.scorecard.evidence.invalid_records} invalid`,
  );
  for (const layer of result.layers) {
    console.log(
      `  ${layer.status.padEnd(7)} ${layer.label}: ${layer.score}/${layer.total}`,
    );
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

export function reportBenchmarkCompare(result: BenchmarkCompareResult): void {
  console.log(`anamnesis benchmark compare — ${result.after.projectName}`);
  console.log(`  baseline: ${result.baselinePath}`);
  console.log(`  after: ${result.afterPath}`);
  console.log(
    `  summary: ${result.summary.improved} improved, ${result.summary.regressed} regressed, ${result.summary.unchanged} unchanged`,
  );
  for (const delta of result.deltas) {
    const unit = delta.unit ?? "";
    const signed = delta.delta > 0 ? `+${delta.delta}` : String(delta.delta);
    console.log(
      `  ${delta.verdict.padEnd(9)} ${delta.label}: ${delta.before}${unit} -> ${delta.after}${unit} (${signed})`,
    );
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

export function reportBenchmarkGallery(result: BenchmarkGalleryResult): void {
  console.log("anamnesis benchmark gallery");
  console.log(
    `  evidence: ${result.evidenceRecords} valid, ${result.invalidEvidenceLines} invalid`,
  );
  console.log(`  entries: ${result.entries.length}`);
  console.log(`  claim candidates: ${result.claimCandidates.length}`);
  if (result.warnings.length > 0) {
    console.log(`  warnings: ${result.warnings.length}`);
    for (const warning of result.warnings) {
      console.log(`    - ${warning}`);
    }
  }
  if (result.writtenPath) {
    console.log(`  written: ${result.writtenPath}`);
  }
  if (result.validation) {
    console.log(
      `  validation: ${result.validation.ok ? "ok" : "stale"} (${result.validation.checkedPath})`,
    );
  }
}

export function reportBenchmarkTrace(result: BenchmarkTraceRollupResult): void {
  console.log(`anamnesis benchmark trace — ${result.projectName}`);
  console.log(`  source: ${result.sourcePath}`);
  console.log(`  records: ${result.total} valid, ${result.invalid} invalid`);
  if (result.latest) {
    console.log(
      `  latest: ${result.latest.phase} ${result.latest.status} at ${result.latest.generated_at}`,
    );
  } else {
    console.log("  latest: none");
  }
  if (result.byStatus.length > 0) {
    console.log(
      `  status: ${result.byStatus.map((s) => `${s.status}=${s.total}`).join(", ")}`,
    );
  }
  for (const phase of result.byPhase) {
    const statuses = Object.entries(phase.byStatus)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `${status}=${count}`)
      .join(", ");
    const duration =
      phase.duration_ms.count > 0
        ? `, duration=${phase.duration_ms.total}ms`
        : "";
    console.log(`    ${phase.phase}: ${phase.total} (${statuses}${duration})`);
  }
  if (Object.keys(result.metrics).length > 0) {
    console.log(
      `  metrics: ${Object.entries(result.metrics)
        .map(([name, total]) => `${name}=${total}`)
        .join(", ")}`,
    );
  }
  reportAppendEvidence(result.appendedPath, result.evidencePath);
}

export function reportUpgradeBenchmark(result: UpgradeBenchmarkResult): void {
  console.log("anamnesis benchmark upgrade");
  console.log(
    `  summary: ${result.summary.passed}/${result.summary.runs} pass (${result.summary.passRatePct}%), failures=${result.summary.failed}`,
  );
  console.log(
    `  health: pending=${result.summary.postPendingTotal}, doctor_errors=${result.summary.doctorErrorsTotal}, drift=${result.summary.driftTotal}`,
  );
  console.log(
    `  duration: avg=${result.summary.averageDurationMs}ms, max=${result.summary.maxDurationMs}ms`,
  );
  for (const fixture of result.fixtures) {
    console.log(
      `  ${fixture.fixtureId}: ${fixture.passed}/${fixture.runs} pass (${fixture.passRatePct}%), avg=${fixture.durationMs.average}ms, pending=${fixture.postPendingTotal}, doctor_errors=${fixture.doctorErrorsTotal}, drift=${fixture.driftTotal}`,
    );
  }
  if (result.artifacts.outputDir) {
    console.log(`  output: ${result.artifacts.outputDir}`);
  }
  for (const artifact of [
    result.artifacts.json,
    result.artifacts.markdown,
    result.artifacts.passRateSvg,
    result.artifacts.durationSvg,
  ]) {
    if (artifact) console.log(`  artifact: ${artifact}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

export function reportWorkContinuityBenchmark(
	result: WorkContinuityBenchmarkResult,
): void {
	console.log("anamnesis benchmark work-continuity");
	console.log(
		`  scenario: requirements=${result.summary.requirements}, verified=${result.summary.verified_requirements}, compact_window=${result.summary.compact_fact_window}, runs=${result.summary.runs}`,
	);
	console.log(
		`  requirement recall: disabled=${result.summary.disabled.requirement_recall_pct}%, enabled=${result.summary.enabled.requirement_recall_pct}%, delta=${result.summary.delta.requirement_recall_points}pp`,
	);
	console.log(
		`  status accuracy: disabled=${result.summary.disabled.status_accuracy_pct}%, enabled=${result.summary.enabled.status_accuracy_pct}%, delta=${result.summary.delta.status_accuracy_points}pp`,
	);
	console.log(
		`  progress error: disabled=${result.summary.disabled.progress_error_points}pp, enabled=${result.summary.enabled.progress_error_points}pp`,
	);
	console.log(
		`  resume: disabled=${result.summary.disabled.resume_ms}ms/${result.summary.disabled.resume_payload_bytes}B, enabled=${result.summary.enabled.resume_ms}ms/${result.summary.enabled.resume_payload_bytes}B`,
	);
	console.log(
		`  enabled durable storage: ${result.summary.enabled.storage_bytes}B`,
	);
	if (result.artifacts.outputDir)
		console.log(`  output: ${result.artifacts.outputDir}`);
	if (result.evidencePath) console.log(`  evidence: ${result.evidencePath}`);
}

export function reportWorkAgentBenchmark(result: WorkAgentBenchmarkResult): void {
	console.log("anamnesis benchmark work-agent-ab");
	console.log(
		`  model=${result.model}, runs/scenario=${result.runs_per_scenario}, invocations=${result.planned_invocations}`,
	);
	console.log(
		`  tokens: disabled=${result.summary.disabled.total_tokens}, enabled=${result.summary.enabled.total_tokens}, delta=${result.summary.delta.total_tokens_pct}%`,
	);
	console.log(
		`  recall: requirements ${result.summary.disabled.requirement_recall_pct}% -> ${result.summary.enabled.requirement_recall_pct}%, status ${result.summary.disabled.status_recall_pct}% -> ${result.summary.enabled.status_recall_pct}%`,
	);
	console.log(
		`  completion/gates: ${result.summary.enabled.completion_correct_pct}%/${result.summary.enabled.gate_correct_pct}%`,
	);
	console.log(
		`  paired overall: tokens p50=${result.analysis.overall.token_delta_pct.p50}% p95=${result.analysis.overall.token_delta_pct.p95}%, elapsed p50=${result.analysis.overall.elapsed_delta_pct.p50}% p95=${result.analysis.overall.elapsed_delta_pct.p95}%`,
	);
	for (const scenario of result.analysis.scenarios) {
		console.log(
			`  ${scenario.id}: tokens p50=${scenario.paired.token_delta_pct.p50}% p95=${scenario.paired.token_delta_pct.p95}% wins=${scenario.paired.token_pair_wins}/${scenario.paired.pairs}; corrections ${scenario.disabled.reminders_or_reexplanations}->${scenario.enabled.reminders_or_reexplanations}`,
		);
	}
	console.log(`  contract: ${result.ok ? "PASS" : "FAIL"}`);
	if (result.artifacts.output_dir)
		console.log(`  output: ${result.artifacts.output_dir}`);
}

export function reportWorkParallelAgentBenchmark(
	result: ParallelBenchmarkResult,
): void {
	console.log("anamnesis benchmark work-parallel-agent-ab");
	console.log(
		`  protocol=${result.protocol}, model=${result.model}, pairs=${result.comparison.total_pairs}, invocations=${result.actual_invocations}`,
	);
	console.log(
		`  tokens/run: disabled=${result.summary.disabled.total_tokens}, enabled=${result.summary.enabled.total_tokens}, delta=${result.summary.delta.total_tokens_pct}%`,
	);
	console.log(
		`  critical path/run: disabled=${result.summary.disabled.critical_path_ms}ms, enabled=${result.summary.enabled.critical_path_ms}ms, delta=${result.summary.delta.critical_path_pct}%`,
	);
	console.log(
		`  final accuracy: disabled=${result.summary.disabled.final_accuracy_pct}%, enabled=${result.summary.enabled.final_accuracy_pct}%, delta=${result.comparison.delta_points}pp`,
	);
	console.log(
		`  paired accuracy: wins=${result.comparison.enabled_pair_wins}, ties=${result.comparison.paired_ties}, losses=${result.comparison.enabled_pair_losses}, verdict=${result.comparison.verdict}`,
	);
	console.log(
		`  harness=${result.harness_validity.ok ? "PASS" : "FAIL"}, enabled-quality=${result.quality.enabled_ready ? "PASS" : "FAIL"}`,
	);
	if (result.artifacts.output_dir) {
		console.log(`  output: ${result.artifacts.output_dir}`);
	}
}

export function reportAgentTaskBenchmark(result: AgentTaskBenchmarkResult): void {
  console.log(`anamnesis benchmark task — ${result.input.project.name}`);
  console.log(`  task: ${result.input.task.id}`);
  console.log(`  run: ${result.input.run.id}`);
  console.log(
    `  agent/model: ${result.input.run.agent} / ${result.input.run.model}`,
  );
  if (result.input.run.session_context_mode) {
		console.log(
			`  session context mode: ${result.input.run.session_context_mode}`,
		);
  }
  console.log(`  context state: ${result.input.run.context_state}`);
  console.log(`  score: ${result.score.points}/${result.score.total}`);
  console.log(
    `  metrics: questions=${result.input.metrics.questions_before_action}, tool_turns=${result.input.metrics.tool_turns_to_context}, elapsed_ms=${result.input.metrics.elapsed_ms}`,
  );
  console.log(
    `  first correct action: ${result.input.metrics.first_correct_action ? "yes" : "no"}`,
  );
  console.log(
    `  handoff recovered: ${result.input.metrics.handoff_recovered ? "yes" : "no"}`,
  );
  if (result.score.retrieval) {
    const metrics = result.input.metrics;
    console.log(
      `  retrieval: success=${metrics.task_success === undefined ? "unknown" : metrics.task_success ? "yes" : "no"}, source_reads=${metrics.required_source_reads ?? "-"}/${metrics.expected_source_reads ?? "-"}, missed=${metrics.missed_invariant_count ?? "-"}, hallucinated=${metrics.hallucinated_fact_count ?? "-"}, unnecessary=${metrics.unnecessary_context_reads ?? "-"}, total_tokens=${metrics.total_tokens ?? "-"}`,
    );
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

export function reportAgentTaskBenchmarkCompare(
  result: AgentTaskBenchmarkCompareResult,
): void {
  console.log(`anamnesis benchmark task-compare — ${result.full.project.name}`);
  console.log(`  task: ${result.full.task.id}`);
	console.log(
		`  agent/model: ${result.full.run.agent} / ${result.full.run.model}`,
	);
  console.log(`  full run: ${result.full.run.id}`);
  console.log(`  compact run: ${result.compact.run.id}`);
  console.log(
    `  score: full ${result.fullScore.points}/${result.fullScore.total}, compact ${result.compactScore.points}/${result.compactScore.total}`,
  );
  console.log(
    `  compact task success within tolerance: ${result.summary.compact_task_success_within_tolerance === undefined ? "unknown" : result.summary.compact_task_success_within_tolerance ? "yes" : "no"}`,
  );
  console.log(
    `  regressions/failures: ${result.summary.regressions}/${result.summary.failures}`,
  );
  if (result.summary.compact_token_reduction_pct !== undefined) {
    console.log(
      `  compact token reduction: ${result.summary.compact_token_reduction_pct}%`,
    );
  }
  for (const delta of result.deltas) {
    const compact = delta.compact === undefined ? "-" : String(delta.compact);
    const full = delta.full === undefined ? "-" : String(delta.full);
    const diff =
      delta.delta === undefined
        ? "-"
        : delta.delta > 0
          ? `+${delta.delta}`
          : String(delta.delta);
    console.log(
      `  ${delta.verdict.padEnd(14)} ${delta.label}: full=${full}, compact=${compact}, delta=${diff}`,
    );
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

export function reportAgentTaskBenchmarkSeries(
  result: AgentTaskBenchmarkSeriesResult,
): void {
  console.log("anamnesis benchmark task-series");
  console.log(
    `  evidence: ${result.evidenceRecords} valid, ${result.invalidEvidenceLines} invalid`,
  );
  console.log(`  compare records: ${result.compareRecords}`);
  console.log(
    `  summary: ${result.summary.groups} group(s), ${result.summary.pairs} pair(s), regressions=${result.summary.regressions}, failures=${result.summary.failures}`,
  );
  for (const group of result.groups) {
    const tokenDelta =
      group.total_tokens_delta.average === undefined
        ? "unknown"
        : String(group.total_tokens_delta.average);
    const sourceDelta =
      group.required_source_read_rate_delta.average === undefined
        ? "unknown"
        : String(group.required_source_read_rate_delta.average);
    const citationDelta =
      group.source_citation_rate_delta.average === undefined
        ? "unknown"
        : String(group.source_citation_rate_delta.average);
    console.log(
      `  ${group.id}: pairs=${group.pairs}, compact_success=${formatCliRate(group.compact_task_success_rate)}, source_read_delta=${sourceDelta}, source_citation_delta=${citationDelta}, token_delta=${tokenDelta}`,
    );
  }
  if (result.artifacts.outputDir) {
    console.log(`  output: ${result.artifacts.outputDir}`);
  }
  for (const artifact of [
    result.artifacts.json,
    result.artifacts.markdown,
    result.artifacts.tokenDeltaSvg,
    result.artifacts.qualitySummarySvg,
    result.artifacts.sourceCitationDeltaSvg,
  ]) {
    if (artifact) console.log(`  artifact: ${artifact}`);
  }
}

function formatCliRate(value: number | undefined): string {
  return value === undefined ? "unknown" : `${Math.round(value * 100)}%`;
}

export function reportPromptDeltaGate(result: PromptDeltaGateResult): void {
  console.log(
    `anamnesis benchmark prompt-gate — ${result.status.agentfile.project.name}`,
  );
  console.log(`  decision: ${result.decision.recommendation}`);
  console.log(
    `  implement prompt delta: ${result.decision.shouldImplementPromptDelta ? "yes" : "no"}`,
  );
  console.log(`  reason: ${result.decision.reason}`);
  console.log(
    `  evidence: ${result.evidence.records} valid, ${result.evidence.invalidRecords} invalid`,
  );
  console.log(
    `  session-context benchmarks: ${result.evidence.sessionContextBenchmarks}`,
  );
  console.log(
    `  agent task compares: ${result.evidence.agentTaskBenchmarkCompares}`,
  );
  console.log(
    `  retrieval benchmarks: ${result.evidence.retrievalBenchmarks} (compact ${result.evidence.compactRetrievalBenchmarks}, full ${result.evidence.fullRetrievalBenchmarks}), friction/failures ${result.evidence.retrievalFriction}/${result.evidence.retrievalFailures}`,
  );
  console.log(
    `  source-pointer retrieval: ${result.evidence.retrievalSourcePointerBenchmarks} benchmark(s), failures ${result.evidence.retrievalSourcePointerFailures}`,
  );
  console.log(
    `  retrieval top-1/top-3/MRR: ${formatCliRate(result.evidence.retrievalTop1HitRate)} / ${formatCliRate(result.evidence.retrievalTop3HitRate)} / ${result.evidence.retrievalMrr?.toFixed(3) ?? "unknown"}`,
  );
  console.log(
    `  context budget: ~${result.contextBudget.estimatedTokens}/${result.contextBudget.maxPromptDeltaTokens} tokens, duplicate risk ${result.contextBudget.duplicateContextRisk}`,
  );
  for (const signal of result.signals) {
    const assessment = formatPromptDeltaSignalAssessment(signal.status);
		console.log(`  ${assessment.padEnd(5)} ${signal.label}: ${signal.detail}`);
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidenceRecordPath) {
    console.log(`  evidence: ${result.evidenceRecordPath}`);
  }
}

function formatPromptDeltaSignalAssessment(status: string): string {
  switch (status) {
    case "pass":
      return "pass";
    case "warn":
      return "watch";
    case "fail":
      return "risk";
    default:
      return status;
  }
}

export function reportSessionContextBenchmark(
  result: SessionContextBenchmarkResult,
): void {
  console.log("anamnesis benchmark session-context");
  console.log(`  fixtures: ${result.summary.fixtures}`);
  console.log(
    `  compact required rules: ${result.summary.compactRequiredRulePasses}/${result.summary.compactRequiredRuleTotal}`,
  );
  console.log(
    `  compact source pointer fixtures: ${result.summary.compactSourcePointerFixtures}/${result.summary.fixtures}`,
  );
  console.log(
    `  large fixture reduction: ${result.summary.largeFixtureCompactReductionPct}%`,
  );
  console.log(
    `  cap exceeded: compact=${result.summary.compactCapExceeded}, full=${result.summary.fullCapExceeded}`,
  );
  for (const fixture of result.fixtures) {
    const direction =
      fixture.compactReductionPct >= 0
        ? `${fixture.compactReductionPct}% less`
        : `${Math.abs(fixture.compactReductionPct)}% more`;
    console.log(
      `  ${fixture.id}: full=${fixture.metrics.full.estimatedTokens} tokens, compact=${fixture.metrics.compact.estimatedTokens} tokens (${direction})`,
    );
  }
  if (result.artifacts.outputDir) {
    console.log(`  output: ${result.artifacts.outputDir}`);
  }
  for (const artifact of [
    result.artifacts.json,
    result.artifacts.markdown,
    result.artifacts.tokenByModeSvg,
    result.artifacts.payloadCompositionSvg,
    result.artifacts.fixtureGrowthSvg,
    result.artifacts.capSuccessSummarySvg,
  ]) {
    if (artifact) console.log(`  artifact: ${artifact}`);
  }
}

export function reportRetrievalBenchmark(result: RetrievalBenchmarkResult): void {
  console.log("anamnesis benchmark retrieval");
  console.log(`  cases: ${result.summary.cases}`);
  console.log(
    `  top-1: ${formatCliRate(result.summary.top1HitRate)} (${result.summary.top1Hits}/${result.summary.cases})`,
  );
  console.log(
    `  top-3: ${formatCliRate(result.summary.top3HitRate)} (${result.summary.top3Hits}/${result.summary.cases})`,
  );
  console.log(`  mrr: ${result.summary.mrr.toFixed(3)}`);
  console.log(
    `  compact session context: ${result.summary.compactSessionStartTokens}/${result.summary.compactSessionStartCap} tokens`,
  );
  console.log(`  gate: ${result.summary.ok ? "pass" : "fail"}`);
  if (result.artifacts.outputDir) {
    console.log(`  artifacts: ${result.artifacts.outputDir}`);
  }
  if (result.evidenceRecordPath) {
    console.log(`  evidence: ${result.evidenceRecordPath}`);
  }
}

export function reportSubagentInjectionBenchmark(
  result: SubagentInjectionBenchmarkResult,
): void {
  console.log("anamnesis benchmark subagent-injection");
  console.log(`  attempts per lane: ${result.requestedAttempts}`);
  console.log(
    `  injection: ${result.summary.injected}/${result.summary.injectionEligibleAttempts}` +
      ` injected, ${result.summary.missed} missed` +
      (result.summary.injectionRatePct !== null
        ? ` (${result.summary.injectionRatePct}%)`
        : ""),
  );
  console.log(
    `  prompt contract: ${result.summary.contractAccepted}/${result.summary.contractAttempts}` +
      ` accepted, ${result.summary.contractRejected} rejected` +
      (result.summary.contractPassRatePct !== null
        ? ` (${result.summary.contractPassRatePct}%)`
        : ""),
  );
  for (const lane of result.lanes) {
		const rate =
			lane.injectionRatePct !== null
      ? `${lane.injectionRatePct}% injection`
      : lane.contractPassRatePct !== null
        ? `${lane.contractPassRatePct}% contract`
        : "n/a";
    console.log(
      `  ${lane.laneId}: ${lane.enforcement}, attempts=${lane.attempts}, ` +
        `injected=${lane.injected}, missed=${lane.missed}, ` +
        `accepted=${lane.accepted}, rejected=${lane.rejected}, rate=${rate}`,
    );
  }
  if (result.artifacts.outputDir) {
    console.log(`  output: ${result.artifacts.outputDir}`);
  }
  for (const artifact of [
    result.artifacts.json,
    result.artifacts.markdown,
    result.artifacts.countsSvg,
    result.artifacts.ratesSvg,
  ]) {
    if (artifact) console.log(`  artifact: ${artifact}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}
