import * as fs from "node:fs";
import * as path from "node:path";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";

export const AGENT_TASK_BENCHMARK_SCHEMA_VERSION =
  "anamnesis.agent_task_benchmark.v1";
export const AGENT_TASK_BENCHMARK_COMPARE_SCHEMA_VERSION =
  "anamnesis.agent_task_benchmark_compare.v1";

export interface AgentTaskBenchmarkInput {
  schema_version: typeof AGENT_TASK_BENCHMARK_SCHEMA_VERSION;
  generated_at: string;
  project: {
    name: string;
    shape?: string;
  };
  task: {
    id: string;
    prompt: string;
    expected_first_action?: string;
  };
  run: {
    id: string;
    agent: string;
    model: string;
    session_context_mode?: "full" | "compact" | "unknown";
    context_state:
      | "no-anamnesis"
      | "static"
      | "bootstrap"
      | "enriched"
      | "handoff";
  };
  metrics: {
    questions_before_action: number;
    tool_turns_to_context: number;
    first_correct_action: boolean;
    handoff_recovered: boolean;
    elapsed_ms: number;
    task_success?: boolean;
    required_source_reads?: number;
    expected_source_reads?: number;
    source_citations?: number;
    expected_source_citations?: number;
    missed_invariant_count?: number;
    hallucinated_fact_count?: number;
    unnecessary_context_reads?: number;
    managed_region_edit_attempts?: number;
    bootstrap_edit_attempts?: number;
    handoff_refresh_required?: boolean;
    handoff_refreshed?: boolean;
    matched_harness_read?: boolean;
    nonmatched_harness_reads?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  limitations?: string[];
  evidence?: string[];
}

export interface AgentTaskBenchmarkScore {
  points: number;
  total: number;
  first_correct_action: number;
  handoff_recovered: number;
  question_efficiency: number;
  context_turn_efficiency: number;
  elapsed_efficiency: number;
  retrieval?: {
    required_source_read_rate?: number;
    source_citation_rate?: number;
    task_success?: number;
    missed_invariant_count?: number;
    hallucinated_fact_count?: number;
    unnecessary_context_reads?: number;
    managed_region_edit_attempts?: number;
    bootstrap_edit_attempts?: number;
    handoff_refresh_success?: number;
    matched_harness_read?: number;
    nonmatched_harness_reads?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export interface AgentTaskBenchmarkResult {
  projectRoot: string;
  generatedAt: string;
  inputPath?: string;
  input: AgentTaskBenchmarkInput;
  score: AgentTaskBenchmarkScore;
  markdown: string;
  appendedPath?: string;
  evidencePath?: string;
}

export type AgentTaskBenchmarkCompareDirection =
  | "higher-is-better"
  | "lower-is-better";
export type AgentTaskBenchmarkCompareVerdict =
  | "compact-better"
  | "compact-worse"
  | "same"
  | "unknown";

export interface AgentTaskBenchmarkCompareDelta {
  id: string;
  label: string;
  direction: AgentTaskBenchmarkCompareDirection;
  full?: number;
  compact?: number;
  delta?: number;
  verdict: AgentTaskBenchmarkCompareVerdict;
  unit?: string;
}

export interface AgentTaskBenchmarkCompareSummary {
  regressions: number;
  failures: number;
  compact_task_success_within_tolerance?: boolean;
  compact_task_success_delta?: number;
  required_source_read_rate_delta?: number;
  source_citation_rate_delta?: number;
  missed_invariant_delta?: number;
  hallucinated_fact_delta?: number;
  unnecessary_context_reads_delta?: number;
  managed_region_edit_attempts_delta?: number;
  bootstrap_edit_attempts_delta?: number;
  handoff_refresh_success_delta?: number;
  matched_harness_read_delta?: number;
  nonmatched_harness_reads_delta?: number;
  elapsed_ms_delta?: number;
  total_tokens_delta?: number;
  compact_token_reduction_pct?: number;
}

export interface AgentTaskBenchmarkCompareResult {
  projectRoot: string;
  generatedAt: string;
  fullInputPath: string;
  compactInputPath: string;
  full: AgentTaskBenchmarkInput;
  compact: AgentTaskBenchmarkInput;
  fullScore: AgentTaskBenchmarkScore;
  compactScore: AgentTaskBenchmarkScore;
  deltas: AgentTaskBenchmarkCompareDelta[];
  summary: AgentTaskBenchmarkCompareSummary;
  markdown: string;
  appendedPath?: string;
  evidencePath?: string;
}

export interface AgentTaskBenchmarkCompareTemplate {
  full: AgentTaskBenchmarkInput;
  compact: AgentTaskBenchmarkInput;
  usage: {
    full_input: string;
    compact_input: string;
    compare_command: string;
    note: string;
  };
}

export interface AgentTaskBenchmarkOptions {
  projectRoot: string;
  inputPath?: string;
  append?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export interface AgentTaskBenchmarkCompareOptions {
  projectRoot: string;
  fullInputPath: string;
  compactInputPath: string;
  append?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export class AgentTaskBenchmarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTaskBenchmarkError";
  }
}

export function agentTaskBenchmarkTemplate(now = new Date()): AgentTaskBenchmarkInput {
  return {
    schema_version: AGENT_TASK_BENCHMARK_SCHEMA_VERSION,
    generated_at: now.toISOString(),
    project: {
      name: "example-project",
      shape: "frontend | backend/infra | python-api | self-dogfood",
    },
    task: {
      id: "load-context-and-plan",
      prompt:
        "Fresh agent: identify the current project goal, relevant ontology/handoff files, and first safe action.",
      expected_first_action:
        "Read injected or on-disk anamnesis context before editing project code.",
    },
    run: {
      id: "example-project-load-context-and-plan-codex-001",
      agent: "codex",
      model: "gpt-5.5",
      session_context_mode: "compact",
      context_state: "enriched",
    },
    metrics: {
      questions_before_action: 0,
      tool_turns_to_context: 1,
      first_correct_action: true,
      handoff_recovered: true,
      elapsed_ms: 60000,
      task_success: true,
      required_source_reads: 2,
      expected_source_reads: 2,
      source_citations: 2,
      expected_source_citations: 2,
      missed_invariant_count: 0,
      hallucinated_fact_count: 0,
      unnecessary_context_reads: 0,
      managed_region_edit_attempts: 0,
      bootstrap_edit_attempts: 0,
      handoff_refresh_required: true,
      handoff_refreshed: true,
      matched_harness_read: true,
      nonmatched_harness_reads: 0,
      input_tokens: 12000,
      output_tokens: 2000,
      total_tokens: 14000,
    },
    limitations: [
      "Model-dependent result; compare only repeated runs with the same fixed prompt and task.",
    ],
    evidence: [
      "terminal transcript or structured run log path",
      "benchmark report evidence for the same snapshot",
    ],
  };
}

export function agentTaskBenchmarkCompareTemplate(
  now = new Date(),
): AgentTaskBenchmarkCompareTemplate {
  const full = agentTaskBenchmarkTemplate(now);
  full.run.id = "example-project-load-context-and-plan-full-001";
  full.run.session_context_mode = "full";
  full.metrics.required_source_reads = 1;
  full.metrics.expected_source_reads = 2;
  full.metrics.source_citations = 1;
  full.metrics.expected_source_citations = 2;
  full.metrics.input_tokens = 24000;
  full.metrics.output_tokens = 2000;
  full.metrics.total_tokens = 26000;

  const compact = JSON.parse(JSON.stringify(full)) as AgentTaskBenchmarkInput;
  compact.run.id = "example-project-load-context-and-plan-compact-001";
  compact.run.session_context_mode = "compact";
  compact.metrics.required_source_reads = 2;
  compact.metrics.expected_source_reads = 2;
  compact.metrics.source_citations = 2;
  compact.metrics.expected_source_citations = 2;
  compact.metrics.input_tokens = 12000;
  compact.metrics.output_tokens = 2000;
  compact.metrics.total_tokens = 14000;

  return {
    full,
    compact,
    usage: {
      full_input: "full-run.json",
      compact_input: "compact-run.json",
      compare_command:
        "anamnesis benchmark task-compare --full full-run.json --compact compact-run.json --append",
      note:
        "Use the same task prompt, repo snapshot, agent, model, tool permissions, and context state for both runs. Replace metrics with observed run values before appending evidence.",
    },
  };
}

export function agentTaskBenchmark(
  opts: AgentTaskBenchmarkOptions,
): AgentTaskBenchmarkResult {
  const projectRoot = path.resolve(opts.projectRoot);
  if (!opts.inputPath) {
    throw new AgentTaskBenchmarkError("--input is required unless --template is used");
  }

  const inputPath = path.resolve(projectRoot, opts.inputPath);
  const input = readAgentTaskBenchmarkInput(inputPath);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const score = scoreAgentTaskBenchmark(input);
  const markdown = renderAgentTaskBenchmarkMarkdown({ input, score, generatedAt });

  let appendedPath: string | undefined;
  let evidencePath: string | undefined;
  if (opts.append === true) {
    const outputPath = path.resolve(
      projectRoot,
      opts.outputPath ?? path.join("docs", "AGENT-TASK-BENCHMARKS.md"),
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const prefix =
      fs.existsSync(outputPath) && fs.readFileSync(outputPath, "utf8").trim() !== ""
        ? "\n\n"
        : "";
    fs.appendFileSync(outputPath, `${prefix}${markdown}\n`, "utf8");
    appendedPath = displayPathFromProject(projectRoot, outputPath);
    evidencePath = appendEvidenceRecord(
      projectRoot,
      agentTaskBenchmarkEvidenceRecord({
        input,
        score,
        generatedAt,
        inputPath: displayPathFromProject(projectRoot, inputPath),
        appendedPath,
      }),
    );
  }

  return {
    projectRoot,
    generatedAt,
    inputPath: displayPathFromProject(projectRoot, inputPath),
    input,
    score,
    markdown,
    appendedPath,
    evidencePath,
  };
}

export function agentTaskBenchmarkCompare(
  opts: AgentTaskBenchmarkCompareOptions,
): AgentTaskBenchmarkCompareResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const fullInputPath = path.resolve(projectRoot, opts.fullInputPath);
  const compactInputPath = path.resolve(projectRoot, opts.compactInputPath);
  const full = readAgentTaskBenchmarkInput(fullInputPath);
  const compact = readAgentTaskBenchmarkInput(compactInputPath);
  validateComparablePair({
    full,
    compact,
    fullInputPath,
    compactInputPath,
  });

  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const fullScore = scoreAgentTaskBenchmark(full);
  const compactScore = scoreAgentTaskBenchmark(compact);
  const deltas = compareAgentTaskBenchmarkDeltas({
    full,
    compact,
    fullScore,
    compactScore,
  });
  const summary = summarizeAgentTaskBenchmarkCompare({
    full,
    compact,
    fullScore,
    compactScore,
    deltas,
  });
  const markdown = renderAgentTaskBenchmarkCompareMarkdown({
    generatedAt,
    full,
    compact,
    fullScore,
    compactScore,
    deltas,
    summary,
  });

  let appendedPath: string | undefined;
  let evidencePath: string | undefined;
  if (opts.append === true) {
    const outputPath = path.resolve(
      projectRoot,
      opts.outputPath ?? path.join("docs", "AGENT-TASK-BENCHMARKS.md"),
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const prefix =
      fs.existsSync(outputPath) && fs.readFileSync(outputPath, "utf8").trim() !== ""
        ? "\n\n"
        : "";
    fs.appendFileSync(outputPath, `${prefix}${markdown}\n`, "utf8");
    appendedPath = displayPathFromProject(projectRoot, outputPath);
    evidencePath = appendEvidenceRecord(
      projectRoot,
      agentTaskBenchmarkCompareEvidenceRecord({
        generatedAt,
        full,
        compact,
        fullScore,
        compactScore,
        deltas,
        summary,
        fullInputPath: displayPathFromProject(projectRoot, fullInputPath),
        compactInputPath: displayPathFromProject(projectRoot, compactInputPath),
        appendedPath,
      }),
    );
  }

  return {
    projectRoot,
    generatedAt,
    fullInputPath: displayPathFromProject(projectRoot, fullInputPath),
    compactInputPath: displayPathFromProject(projectRoot, compactInputPath),
    full,
    compact,
    fullScore,
    compactScore,
    deltas,
    summary,
    markdown,
    appendedPath,
    evidencePath,
  };
}

function readAgentTaskBenchmarkInput(filePath: string): AgentTaskBenchmarkInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new AgentTaskBenchmarkError(`agent task benchmark JSON is invalid: ${filePath}`);
    }
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AgentTaskBenchmarkError(`agent task benchmark JSON not found: ${filePath}`);
    }
    throw e;
  }
  return parseAgentTaskBenchmarkInput(parsed, filePath);
}

function parseAgentTaskBenchmarkInput(
  value: unknown,
  filePath: string,
): AgentTaskBenchmarkInput {
  if (!isObject(value)) {
    throw new AgentTaskBenchmarkError(`agent task benchmark JSON must be an object: ${filePath}`);
  }
  if (value.schema_version !== AGENT_TASK_BENCHMARK_SCHEMA_VERSION) {
    throw new AgentTaskBenchmarkError(
      `agent task benchmark JSON must use schema ${AGENT_TASK_BENCHMARK_SCHEMA_VERSION}: ${filePath}`,
    );
  }
  const project = objectField(value, "project");
  const task = objectField(value, "task");
  const run = objectField(value, "run");
  const metrics = objectField(value, "metrics");
  const sessionContextMode = optionalSessionContextModeField(
    run,
    "session_context_mode",
    filePath,
  );
  const taskSuccess = optionalBooleanField(metrics, "task_success");
  const handoffRefreshRequired = optionalBooleanField(
    metrics,
    "handoff_refresh_required",
  );
  const handoffRefreshed = optionalBooleanField(metrics, "handoff_refreshed");
  const matchedHarnessRead = optionalBooleanField(metrics, "matched_harness_read");
  const input: AgentTaskBenchmarkInput = {
    schema_version: AGENT_TASK_BENCHMARK_SCHEMA_VERSION,
    generated_at: stringField(value, "generated_at", filePath),
    project: {
      name: stringField(project, "name", filePath),
      ...(optionalStringField(project, "shape")
        ? { shape: optionalStringField(project, "shape") }
        : {}),
    },
    task: {
      id: stringField(task, "id", filePath),
      prompt: stringField(task, "prompt", filePath),
      ...(optionalStringField(task, "expected_first_action")
        ? { expected_first_action: optionalStringField(task, "expected_first_action") }
        : {}),
    },
    run: {
      id: stringField(run, "id", filePath),
      agent: stringField(run, "agent", filePath),
      model: stringField(run, "model", filePath),
      ...(sessionContextMode ? { session_context_mode: sessionContextMode } : {}),
      context_state: contextStateField(run, "context_state", filePath),
    },
    metrics: {
      questions_before_action: nonNegativeNumberField(
        metrics,
        "questions_before_action",
        filePath,
      ),
      tool_turns_to_context: nonNegativeNumberField(
        metrics,
        "tool_turns_to_context",
        filePath,
      ),
      first_correct_action: booleanField(metrics, "first_correct_action", filePath),
      handoff_recovered: booleanField(metrics, "handoff_recovered", filePath),
      elapsed_ms: nonNegativeNumberField(metrics, "elapsed_ms", filePath),
      ...(taskSuccess !== undefined ? { task_success: taskSuccess } : {}),
      ...optionalNonNegativeMetric(metrics, "required_source_reads", filePath),
      ...optionalNonNegativeMetric(metrics, "expected_source_reads", filePath),
      ...optionalNonNegativeMetric(metrics, "source_citations", filePath),
      ...optionalNonNegativeMetric(metrics, "expected_source_citations", filePath),
      ...optionalNonNegativeMetric(metrics, "missed_invariant_count", filePath),
      ...optionalNonNegativeMetric(metrics, "hallucinated_fact_count", filePath),
      ...optionalNonNegativeMetric(metrics, "unnecessary_context_reads", filePath),
      ...optionalNonNegativeMetric(metrics, "managed_region_edit_attempts", filePath),
      ...optionalNonNegativeMetric(metrics, "bootstrap_edit_attempts", filePath),
      ...(handoffRefreshRequired !== undefined
        ? { handoff_refresh_required: handoffRefreshRequired }
        : {}),
      ...(handoffRefreshed !== undefined
        ? { handoff_refreshed: handoffRefreshed }
        : {}),
      ...(matchedHarnessRead !== undefined
        ? { matched_harness_read: matchedHarnessRead }
        : {}),
      ...optionalNonNegativeMetric(metrics, "nonmatched_harness_reads", filePath),
      ...optionalNonNegativeMetric(metrics, "input_tokens", filePath),
      ...optionalNonNegativeMetric(metrics, "output_tokens", filePath),
      ...optionalNonNegativeMetric(metrics, "total_tokens", filePath),
    },
    ...(stringArrayField(value, "limitations")
      ? { limitations: stringArrayField(value, "limitations") }
      : {}),
    ...(stringArrayField(value, "evidence")
      ? { evidence: stringArrayField(value, "evidence") }
      : {}),
  };
  return input;
}

function scoreAgentTaskBenchmark(
  input: AgentTaskBenchmarkInput,
): AgentTaskBenchmarkScore {
  const firstCorrect = input.metrics.first_correct_action ? 1 : 0;
  const handoff = input.metrics.handoff_recovered ? 1 : 0;
  const questionEfficiency =
    input.metrics.questions_before_action === 0
      ? 1
      : input.metrics.questions_before_action <= 1
        ? 0.5
        : 0;
  const contextTurnEfficiency =
    input.metrics.tool_turns_to_context <= 1
      ? 1
      : input.metrics.tool_turns_to_context <= 3
        ? 0.5
        : 0;
  const elapsedEfficiency =
    input.metrics.elapsed_ms <= 60000
      ? 1
      : input.metrics.elapsed_ms <= 180000
        ? 0.5
        : 0;
  const points =
    firstCorrect +
    handoff +
    questionEfficiency +
    contextTurnEfficiency +
    elapsedEfficiency;
  const retrieval = retrievalScore(input);
  return {
    points,
    total: 5,
    first_correct_action: firstCorrect,
    handoff_recovered: handoff,
    question_efficiency: questionEfficiency,
    context_turn_efficiency: contextTurnEfficiency,
    elapsed_efficiency: elapsedEfficiency,
    ...(retrieval ? { retrieval } : {}),
  };
}

function retrievalScore(
  input: AgentTaskBenchmarkInput,
): AgentTaskBenchmarkScore["retrieval"] | undefined {
  const metrics = input.metrics;
  const hasRetrievalMetric =
    metrics.task_success !== undefined ||
    metrics.required_source_reads !== undefined ||
    metrics.expected_source_reads !== undefined ||
    metrics.source_citations !== undefined ||
    metrics.expected_source_citations !== undefined ||
    metrics.missed_invariant_count !== undefined ||
    metrics.hallucinated_fact_count !== undefined ||
    metrics.unnecessary_context_reads !== undefined ||
    metrics.managed_region_edit_attempts !== undefined ||
    metrics.bootstrap_edit_attempts !== undefined ||
    metrics.handoff_refresh_required !== undefined ||
    metrics.handoff_refreshed !== undefined ||
    metrics.matched_harness_read !== undefined ||
    metrics.nonmatched_harness_reads !== undefined ||
    metrics.input_tokens !== undefined ||
    metrics.output_tokens !== undefined ||
    metrics.total_tokens !== undefined;
  if (!hasRetrievalMetric) return undefined;

  const expected = metrics.expected_source_reads;
  const required = metrics.required_source_reads;
  const requiredSourceReadRate =
    expected !== undefined && expected > 0 && required !== undefined
      ? required / expected
      : undefined;
  const expectedCitations = metrics.expected_source_citations;
  const citations = metrics.source_citations;
  const sourceCitationRate =
    expectedCitations !== undefined && expectedCitations > 0 && citations !== undefined
      ? citations / expectedCitations
      : undefined;
  const handoffRefreshSuccess =
    metrics.handoff_refresh_required === true && metrics.handoff_refreshed !== undefined
      ? metrics.handoff_refreshed
        ? 1
        : 0
      : undefined;

  return {
    ...(requiredSourceReadRate !== undefined
      ? { required_source_read_rate: requiredSourceReadRate }
      : {}),
    ...(sourceCitationRate !== undefined
      ? { source_citation_rate: sourceCitationRate }
      : {}),
    ...(metrics.task_success !== undefined
      ? { task_success: metrics.task_success ? 1 : 0 }
      : {}),
    ...(metrics.missed_invariant_count !== undefined
      ? { missed_invariant_count: metrics.missed_invariant_count }
      : {}),
    ...(metrics.hallucinated_fact_count !== undefined
      ? { hallucinated_fact_count: metrics.hallucinated_fact_count }
      : {}),
    ...(metrics.unnecessary_context_reads !== undefined
      ? { unnecessary_context_reads: metrics.unnecessary_context_reads }
      : {}),
    ...(metrics.managed_region_edit_attempts !== undefined
      ? { managed_region_edit_attempts: metrics.managed_region_edit_attempts }
      : {}),
    ...(metrics.bootstrap_edit_attempts !== undefined
      ? { bootstrap_edit_attempts: metrics.bootstrap_edit_attempts }
      : {}),
    ...(handoffRefreshSuccess !== undefined
      ? { handoff_refresh_success: handoffRefreshSuccess }
      : {}),
    ...(metrics.matched_harness_read !== undefined
      ? { matched_harness_read: metrics.matched_harness_read ? 1 : 0 }
      : {}),
    ...(metrics.nonmatched_harness_reads !== undefined
      ? { nonmatched_harness_reads: metrics.nonmatched_harness_reads }
      : {}),
    ...(metrics.input_tokens !== undefined
      ? { input_tokens: metrics.input_tokens }
      : {}),
    ...(metrics.output_tokens !== undefined
      ? { output_tokens: metrics.output_tokens }
      : {}),
    ...(metrics.total_tokens !== undefined
      ? { total_tokens: metrics.total_tokens }
      : {}),
  };
}

function renderAgentTaskBenchmarkMarkdown(input: {
  input: AgentTaskBenchmarkInput;
  score: AgentTaskBenchmarkScore;
  generatedAt: string;
}): string {
  const run = input.input;
  return [
    `## Agent Task Benchmark — ${input.generatedAt}`,
    "",
    `Project: ${run.project.name}`,
    `Shape: ${run.project.shape ?? "(unspecified)"}`,
    `Task: ${run.task.id}`,
    `Agent/model: ${run.run.agent} / ${run.run.model}`,
    `Session context mode: ${run.run.session_context_mode ?? "(unspecified)"}`,
    `Context state: ${run.run.context_state}`,
    `Score: ${formatScore(input.score.points)}/${input.score.total}`,
    "",
    "| Metric | Value | Score |",
    "|---|---:|---:|",
    `| Questions before action | ${run.metrics.questions_before_action} | ${formatScore(input.score.question_efficiency)} |`,
    `| Tool turns to context | ${run.metrics.tool_turns_to_context} | ${formatScore(input.score.context_turn_efficiency)} |`,
    `| First correct action | ${run.metrics.first_correct_action ? "yes" : "no"} | ${input.score.first_correct_action} |`,
    `| Handoff recovered | ${run.metrics.handoff_recovered ? "yes" : "no"} | ${input.score.handoff_recovered} |`,
    `| Elapsed | ${run.metrics.elapsed_ms} ms | ${formatScore(input.score.elapsed_efficiency)} |`,
    ...retrievalMetricRows(run, input.score),
    "",
    "Prompt:",
    "",
    `> ${run.task.prompt.replace(/\n/g, " ")}`,
    "",
    "Limitations:",
    ...(run.limitations && run.limitations.length > 0
      ? run.limitations.map((limitation) => `- ${limitation}`)
      : ["- Model-dependent result; do not compare with deterministic benchmark scorecards."]),
    "",
    "Evidence:",
    ...(run.evidence && run.evidence.length > 0
      ? run.evidence.map((item) => `- ${item}`)
      : ["- (none recorded)"]),
  ].join("\n");
}

function agentTaskBenchmarkEvidenceRecord(input: {
  input: AgentTaskBenchmarkInput;
  score: AgentTaskBenchmarkScore;
  generatedAt: string;
  inputPath: string;
  appendedPath: string;
}): RuntimeEvidenceRecord {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "agent-task-benchmark",
    generated_at: input.generatedAt,
    command: ["anamnesis", "benchmark", "task"],
    project: { name: input.input.project.name },
    summary: {
      schema_version: AGENT_TASK_BENCHMARK_SCHEMA_VERSION,
      task_id: input.input.task.id,
      run_id: input.input.run.id,
      agent: input.input.run.agent,
      model: input.input.run.model,
      session_context_mode: input.input.run.session_context_mode,
      context_state: input.input.run.context_state,
      score: {
        points: input.score.points,
        total: input.score.total,
      },
      metrics: input.input.metrics,
      ...(input.score.retrieval ? { retrieval: input.score.retrieval } : {}),
    },
    details: {
      limitations: input.input.limitations ?? [],
      evidence: input.input.evidence ?? [],
    },
    artifacts: {
      input: input.inputPath,
      markdown: input.appendedPath,
    },
  };
}

function validateComparablePair(input: {
  full: AgentTaskBenchmarkInput;
  compact: AgentTaskBenchmarkInput;
  fullInputPath: string;
  compactInputPath: string;
}): void {
  if (input.full.run.session_context_mode !== "full") {
    throw new AgentTaskBenchmarkError(
      `full benchmark input must use run.session_context_mode=full: ${input.fullInputPath}`,
    );
  }
  if (input.compact.run.session_context_mode !== "compact") {
    throw new AgentTaskBenchmarkError(
      `compact benchmark input must use run.session_context_mode=compact: ${input.compactInputPath}`,
    );
  }

  const comparisons: [string, string, string][] = [
    ["project.name", input.full.project.name, input.compact.project.name],
    ["task.id", input.full.task.id, input.compact.task.id],
    ["task.prompt", input.full.task.prompt, input.compact.task.prompt],
    ["run.agent", input.full.run.agent, input.compact.run.agent],
    ["run.model", input.full.run.model, input.compact.run.model],
    ["run.context_state", input.full.run.context_state, input.compact.run.context_state],
  ];
  for (const [label, fullValue, compactValue] of comparisons) {
    if (fullValue !== compactValue) {
      throw new AgentTaskBenchmarkError(
        `full and compact benchmark inputs must share ${label}`,
      );
    }
  }
}

function compareAgentTaskBenchmarkDeltas(input: {
  full: AgentTaskBenchmarkInput;
  compact: AgentTaskBenchmarkInput;
  fullScore: AgentTaskBenchmarkScore;
  compactScore: AgentTaskBenchmarkScore;
}): AgentTaskBenchmarkCompareDelta[] {
  return [
    compareDelta({
      id: "score",
      label: "5-point score",
      direction: "higher-is-better",
      full: input.fullScore.points,
      compact: input.compactScore.points,
      unit: "points",
    }),
    compareDelta({
      id: "task-success",
      label: "Task success",
      direction: "higher-is-better",
      full: input.fullScore.retrieval?.task_success,
      compact: input.compactScore.retrieval?.task_success,
    }),
    compareDelta({
      id: "required-source-read-rate",
      label: "Required source read rate",
      direction: "higher-is-better",
      full: input.fullScore.retrieval?.required_source_read_rate,
      compact: input.compactScore.retrieval?.required_source_read_rate,
    }),
    compareDelta({
      id: "source-citation-rate",
      label: "Source citation rate",
      direction: "higher-is-better",
      full: input.fullScore.retrieval?.source_citation_rate,
      compact: input.compactScore.retrieval?.source_citation_rate,
    }),
    compareDelta({
      id: "missed-invariants",
      label: "Missed invariants",
      direction: "lower-is-better",
      full: input.full.metrics.missed_invariant_count,
      compact: input.compact.metrics.missed_invariant_count,
    }),
    compareDelta({
      id: "hallucinated-facts",
      label: "Hallucinated facts",
      direction: "lower-is-better",
      full: input.full.metrics.hallucinated_fact_count,
      compact: input.compact.metrics.hallucinated_fact_count,
    }),
    compareDelta({
      id: "unnecessary-context-reads",
      label: "Unnecessary context reads",
      direction: "lower-is-better",
      full: input.full.metrics.unnecessary_context_reads,
      compact: input.compact.metrics.unnecessary_context_reads,
    }),
    compareDelta({
      id: "managed-region-edit-attempts",
      label: "Managed region edit attempts",
      direction: "lower-is-better",
      full: input.full.metrics.managed_region_edit_attempts,
      compact: input.compact.metrics.managed_region_edit_attempts,
    }),
    compareDelta({
      id: "bootstrap-edit-attempts",
      label: "Bootstrap edit attempts",
      direction: "lower-is-better",
      full: input.full.metrics.bootstrap_edit_attempts,
      compact: input.compact.metrics.bootstrap_edit_attempts,
    }),
    compareDelta({
      id: "handoff-refresh-success",
      label: "Handoff refresh success",
      direction: "higher-is-better",
      full: input.fullScore.retrieval?.handoff_refresh_success,
      compact: input.compactScore.retrieval?.handoff_refresh_success,
    }),
    compareDelta({
      id: "matched-harness-read",
      label: "Matched harness read",
      direction: "higher-is-better",
      full: input.fullScore.retrieval?.matched_harness_read,
      compact: input.compactScore.retrieval?.matched_harness_read,
    }),
    compareDelta({
      id: "nonmatched-harness-reads",
      label: "Non-matched harness reads",
      direction: "lower-is-better",
      full: input.full.metrics.nonmatched_harness_reads,
      compact: input.compact.metrics.nonmatched_harness_reads,
    }),
    compareDelta({
      id: "elapsed-ms",
      label: "Elapsed",
      direction: "lower-is-better",
      full: input.full.metrics.elapsed_ms,
      compact: input.compact.metrics.elapsed_ms,
      unit: "ms",
    }),
    compareDelta({
      id: "total-tokens",
      label: "Total tokens",
      direction: "lower-is-better",
      full: input.full.metrics.total_tokens,
      compact: input.compact.metrics.total_tokens,
      unit: "tokens",
    }),
  ];
}

function summarizeAgentTaskBenchmarkCompare(input: {
  full: AgentTaskBenchmarkInput;
  compact: AgentTaskBenchmarkInput;
  fullScore: AgentTaskBenchmarkScore;
  compactScore: AgentTaskBenchmarkScore;
  deltas: readonly AgentTaskBenchmarkCompareDelta[];
}): AgentTaskBenchmarkCompareSummary {
  const taskSuccessDelta = deltaById(input.deltas, "task-success")?.delta;
  const requiredSourceReadRateDelta = deltaById(
    input.deltas,
    "required-source-read-rate",
  )?.delta;
  const sourceCitationRateDelta = deltaById(
    input.deltas,
    "source-citation-rate",
  )?.delta;
  const missedInvariantDelta = deltaById(input.deltas, "missed-invariants")?.delta;
  const hallucinatedFactDelta = deltaById(input.deltas, "hallucinated-facts")?.delta;
  const unnecessaryContextReadsDelta = deltaById(
    input.deltas,
    "unnecessary-context-reads",
  )?.delta;
  const managedRegionEditAttemptsDelta = deltaById(
    input.deltas,
    "managed-region-edit-attempts",
  )?.delta;
  const bootstrapEditAttemptsDelta = deltaById(
    input.deltas,
    "bootstrap-edit-attempts",
  )?.delta;
  const handoffRefreshSuccessDelta = deltaById(
    input.deltas,
    "handoff-refresh-success",
  )?.delta;
  const matchedHarnessReadDelta = deltaById(
    input.deltas,
    "matched-harness-read",
  )?.delta;
  const nonmatchedHarnessReadsDelta = deltaById(
    input.deltas,
    "nonmatched-harness-reads",
  )?.delta;
  const elapsedMsDelta = deltaById(input.deltas, "elapsed-ms")?.delta;
  const totalTokensDelta = deltaById(input.deltas, "total-tokens")?.delta;
  const fullTokens = input.full.metrics.total_tokens;
  const compactTokens = input.compact.metrics.total_tokens;
  const compactTokenReductionPct =
    fullTokens !== undefined && fullTokens > 0 && compactTokens !== undefined
      ? roundNumber(((fullTokens - compactTokens) / fullTokens) * 100)
      : undefined;
  const compactTaskSuccessWithinTolerance =
    taskSuccessDelta === undefined ? undefined : taskSuccessDelta >= -0.05;
  const regressions = input.deltas.filter(
    (delta) => delta.verdict === "compact-worse",
  ).length;
  const failures =
    (compactTaskSuccessWithinTolerance === false ? 1 : 0) +
    (missedInvariantDelta !== undefined && missedInvariantDelta > 0 ? 1 : 0) +
    (hallucinatedFactDelta !== undefined && hallucinatedFactDelta > 0 ? 1 : 0) +
    (input.compactScore.retrieval?.source_citation_rate !== undefined &&
    input.compactScore.retrieval.source_citation_rate < 1
      ? 1
      : 0) +
    ((input.compact.metrics.managed_region_edit_attempts ?? 0) > 0 ? 1 : 0) +
    ((input.compact.metrics.bootstrap_edit_attempts ?? 0) > 0 ? 1 : 0) +
    (input.compact.metrics.handoff_refresh_required === true &&
    input.compact.metrics.handoff_refreshed === false
      ? 1
      : 0);

  return {
    regressions,
    failures,
    ...(compactTaskSuccessWithinTolerance !== undefined
      ? { compact_task_success_within_tolerance: compactTaskSuccessWithinTolerance }
      : {}),
    ...(taskSuccessDelta !== undefined
      ? { compact_task_success_delta: taskSuccessDelta }
      : {}),
    ...(requiredSourceReadRateDelta !== undefined
      ? { required_source_read_rate_delta: requiredSourceReadRateDelta }
      : {}),
    ...(sourceCitationRateDelta !== undefined
      ? { source_citation_rate_delta: sourceCitationRateDelta }
      : {}),
    ...(missedInvariantDelta !== undefined
      ? { missed_invariant_delta: missedInvariantDelta }
      : {}),
    ...(hallucinatedFactDelta !== undefined
      ? { hallucinated_fact_delta: hallucinatedFactDelta }
      : {}),
    ...(unnecessaryContextReadsDelta !== undefined
      ? { unnecessary_context_reads_delta: unnecessaryContextReadsDelta }
      : {}),
    ...(managedRegionEditAttemptsDelta !== undefined
      ? { managed_region_edit_attempts_delta: managedRegionEditAttemptsDelta }
      : {}),
    ...(bootstrapEditAttemptsDelta !== undefined
      ? { bootstrap_edit_attempts_delta: bootstrapEditAttemptsDelta }
      : {}),
    ...(handoffRefreshSuccessDelta !== undefined
      ? { handoff_refresh_success_delta: handoffRefreshSuccessDelta }
      : {}),
    ...(matchedHarnessReadDelta !== undefined
      ? { matched_harness_read_delta: matchedHarnessReadDelta }
      : {}),
    ...(nonmatchedHarnessReadsDelta !== undefined
      ? { nonmatched_harness_reads_delta: nonmatchedHarnessReadsDelta }
      : {}),
    ...(elapsedMsDelta !== undefined ? { elapsed_ms_delta: elapsedMsDelta } : {}),
    ...(totalTokensDelta !== undefined ? { total_tokens_delta: totalTokensDelta } : {}),
    ...(compactTokenReductionPct !== undefined
      ? { compact_token_reduction_pct: compactTokenReductionPct }
      : {}),
  };
}

function agentTaskBenchmarkCompareEvidenceRecord(input: {
  generatedAt: string;
  full: AgentTaskBenchmarkInput;
  compact: AgentTaskBenchmarkInput;
  fullScore: AgentTaskBenchmarkScore;
  compactScore: AgentTaskBenchmarkScore;
  deltas: readonly AgentTaskBenchmarkCompareDelta[];
  summary: AgentTaskBenchmarkCompareSummary;
  fullInputPath: string;
  compactInputPath: string;
  appendedPath: string;
}): RuntimeEvidenceRecord {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "agent-task-benchmark-compare",
    generated_at: input.generatedAt,
    command: ["anamnesis", "benchmark", "task-compare"],
    project: { name: input.full.project.name },
    summary: {
      schema_version: AGENT_TASK_BENCHMARK_COMPARE_SCHEMA_VERSION,
      task_id: input.full.task.id,
      agent: input.full.run.agent,
      model: input.full.run.model,
      context_state: input.full.run.context_state,
      full_run_id: input.full.run.id,
      compact_run_id: input.compact.run.id,
      full_score: {
        points: input.fullScore.points,
        total: input.fullScore.total,
      },
      compact_score: {
        points: input.compactScore.points,
        total: input.compactScore.total,
      },
      ...input.summary,
    },
    details: {
      deltas: input.deltas,
      full_metrics: input.full.metrics,
      compact_metrics: input.compact.metrics,
    },
    artifacts: {
      full_input: input.fullInputPath,
      compact_input: input.compactInputPath,
      markdown: input.appendedPath,
    },
  };
}

function renderAgentTaskBenchmarkCompareMarkdown(input: {
  generatedAt: string;
  full: AgentTaskBenchmarkInput;
  compact: AgentTaskBenchmarkInput;
  fullScore: AgentTaskBenchmarkScore;
  compactScore: AgentTaskBenchmarkScore;
  deltas: readonly AgentTaskBenchmarkCompareDelta[];
  summary: AgentTaskBenchmarkCompareSummary;
}): string {
  return [
    `## Agent Task Benchmark Compare — ${input.generatedAt}`,
    "",
    `Project: ${input.full.project.name}`,
    `Task: ${input.full.task.id}`,
    `Agent/model: ${input.full.run.agent} / ${input.full.run.model}`,
    `Context state: ${input.full.run.context_state}`,
    `Full run: ${input.full.run.id} (${formatScore(input.fullScore.points)}/${input.fullScore.total})`,
    `Compact run: ${input.compact.run.id} (${formatScore(input.compactScore.points)}/${input.compactScore.total})`,
    "",
    "Summary:",
    `- compact task success within tolerance: ${formatMaybeBoolean(input.summary.compact_task_success_within_tolerance)}`,
    `- regressions: ${input.summary.regressions}`,
    `- failures: ${input.summary.failures}`,
    `- compact token reduction: ${formatMaybePercent(input.summary.compact_token_reduction_pct)}`,
    "",
    "| Metric | Full | Compact | Delta | Verdict |",
    "|---|---:|---:|---:|---|",
    ...input.deltas.map(
      (delta) =>
        `| ${delta.label} | ${formatDeltaValue(delta.full, delta.unit)} | ${formatDeltaValue(delta.compact, delta.unit)} | ${formatSignedDelta(delta.delta, delta.unit)} | ${delta.verdict} |`,
    ),
    "",
    "Claim boundary:",
    "- This is one paired model-dependent comparison, not deterministic product evidence.",
    "- Public compact/full success claims require repeated public-safe pairs on the same task suite.",
  ].join("\n");
}

function compareDelta(input: {
  id: string;
  label: string;
  direction: AgentTaskBenchmarkCompareDirection;
  full?: number;
  compact?: number;
  unit?: string;
}): AgentTaskBenchmarkCompareDelta {
  if (input.full === undefined || input.compact === undefined) {
    return {
      id: input.id,
      label: input.label,
      direction: input.direction,
      ...(input.full !== undefined ? { full: input.full } : {}),
      ...(input.compact !== undefined ? { compact: input.compact } : {}),
      verdict: "unknown",
      ...(input.unit ? { unit: input.unit } : {}),
    };
  }
  const delta = roundNumber(input.compact - input.full);
  const verdict =
    delta === 0
      ? "same"
      : input.direction === "higher-is-better"
        ? delta > 0
          ? "compact-better"
          : "compact-worse"
        : delta < 0
          ? "compact-better"
          : "compact-worse";
  return {
    id: input.id,
    label: input.label,
    direction: input.direction,
    full: input.full,
    compact: input.compact,
    delta,
    verdict,
    ...(input.unit ? { unit: input.unit } : {}),
  };
}

function deltaById(
  deltas: readonly AgentTaskBenchmarkCompareDelta[],
  id: string,
): AgentTaskBenchmarkCompareDelta | undefined {
  return deltas.find((delta) => delta.id === id);
}

function roundNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function retrievalMetricRows(
  input: AgentTaskBenchmarkInput,
  score: AgentTaskBenchmarkScore,
): string[] {
  if (
    input.metrics.task_success === undefined &&
    input.metrics.required_source_reads === undefined &&
    input.metrics.expected_source_reads === undefined &&
    input.metrics.source_citations === undefined &&
    input.metrics.expected_source_citations === undefined &&
    input.metrics.missed_invariant_count === undefined &&
    input.metrics.hallucinated_fact_count === undefined &&
    input.metrics.unnecessary_context_reads === undefined &&
    input.metrics.managed_region_edit_attempts === undefined &&
    input.metrics.bootstrap_edit_attempts === undefined &&
    input.metrics.handoff_refresh_required === undefined &&
    input.metrics.handoff_refreshed === undefined &&
    input.metrics.matched_harness_read === undefined &&
    input.metrics.nonmatched_harness_reads === undefined &&
    input.metrics.input_tokens === undefined &&
    input.metrics.output_tokens === undefined &&
    input.metrics.total_tokens === undefined
  ) {
    return [];
  }

  const retrieval = retrievalScore(input);
  const rate = retrieval?.required_source_read_rate;
  const citationRate = retrieval?.source_citation_rate;
  return [
    `| Task success | ${input.metrics.task_success === undefined ? "(unspecified)" : input.metrics.task_success ? "yes" : "no"} | ${score.retrieval?.task_success ?? "-"} |`,
    `| Required source reads | ${formatMaybeNumber(input.metrics.required_source_reads)}/${formatMaybeNumber(input.metrics.expected_source_reads)} | ${rate === undefined ? "-" : `${Math.round(rate * 100)}%`} |`,
    `| Source citations | ${formatMaybeNumber(input.metrics.source_citations)}/${formatMaybeNumber(input.metrics.expected_source_citations)} | ${citationRate === undefined ? "-" : `${Math.round(citationRate * 100)}%`} |`,
    `| Missed invariants | ${formatMaybeNumber(input.metrics.missed_invariant_count)} | - |`,
    `| Hallucinated facts | ${formatMaybeNumber(input.metrics.hallucinated_fact_count)} | - |`,
    `| Unnecessary context reads | ${formatMaybeNumber(input.metrics.unnecessary_context_reads)} | - |`,
    `| Managed region edit attempts | ${formatMaybeNumber(input.metrics.managed_region_edit_attempts)} | - |`,
    `| Bootstrap edit attempts | ${formatMaybeNumber(input.metrics.bootstrap_edit_attempts)} | - |`,
    `| Handoff refresh | ${formatHandoffRefresh(input.metrics)} | ${retrieval?.handoff_refresh_success ?? "-"} |`,
    `| Matched harness read | ${formatMaybeMetricBoolean(input.metrics.matched_harness_read)} | ${retrieval?.matched_harness_read ?? "-"} |`,
    `| Non-matched harness reads | ${formatMaybeNumber(input.metrics.nonmatched_harness_reads)} | - |`,
    `| Input tokens | ${formatMaybeNumber(input.metrics.input_tokens)} | - |`,
    `| Output tokens | ${formatMaybeNumber(input.metrics.output_tokens)} | - |`,
    `| Total tokens | ${formatMaybeNumber(input.metrics.total_tokens)} | - |`,
  ];
}

function formatHandoffRefresh(
  metrics: AgentTaskBenchmarkInput["metrics"],
): string {
  if (metrics.handoff_refresh_required === undefined) return "-";
  if (metrics.handoff_refresh_required === false) return "not required";
  return metrics.handoff_refreshed === undefined
    ? "required / unknown"
    : metrics.handoff_refreshed
      ? "required / refreshed"
      : "required / stale";
}

function formatMaybeNumber(value: number | undefined): string {
  return value === undefined ? "-" : String(value);
}

function formatMaybeMetricBoolean(value: boolean | undefined): string {
  return value === undefined ? "-" : value ? "yes" : "no";
}

function formatMaybeBoolean(value: boolean | undefined): string {
  return value === undefined ? "unknown" : value ? "yes" : "no";
}

function formatMaybePercent(value: number | undefined): string {
  return value === undefined ? "unknown" : `${value}%`;
}

function formatDeltaValue(value: number | undefined, unit?: string): string {
  if (value === undefined) return "-";
  return unit ? `${value} ${unit}` : String(value);
}

function formatSignedDelta(value: number | undefined, unit?: string): string {
  if (value === undefined) return "-";
  const formatted = value > 0 ? `+${value}` : String(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function displayPathFromProject(projectRoot: string, targetPath: string): string {
  const rel = path.relative(projectRoot, targetPath).split(path.sep).join("/");
  if (rel === "") return ".";
  if (rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) {
    return targetPath;
  }
  return rel;
}

function objectField(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const field = value[key];
  if (!isObject(field)) {
    throw new AgentTaskBenchmarkError(`field '${key}' must be an object`);
  }
  return field;
}

function stringField(
  value: Record<string, unknown>,
  key: string,
  filePath: string,
): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim() === "") {
    throw new AgentTaskBenchmarkError(
      `field '${key}' must be a non-empty string: ${filePath}`,
    );
  }
  return field;
}

function optionalStringField(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim() !== "" ? field : undefined;
}

function optionalSessionContextModeField(
  value: Record<string, unknown>,
  key: string,
  filePath: string,
): AgentTaskBenchmarkInput["run"]["session_context_mode"] | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (field === "full" || field === "compact" || field === "unknown") {
    return field;
  }
  throw new AgentTaskBenchmarkError(
    `field '${key}' must be one of full, compact, unknown: ${filePath}`,
  );
}

function contextStateField(
  value: Record<string, unknown>,
  key: string,
  filePath: string,
): AgentTaskBenchmarkInput["run"]["context_state"] {
  const field = stringField(value, key, filePath);
  if (
    field === "no-anamnesis" ||
    field === "static" ||
    field === "bootstrap" ||
    field === "enriched" ||
    field === "handoff"
  ) {
    return field;
  }
  throw new AgentTaskBenchmarkError(
    `field '${key}' must be one of no-anamnesis, static, bootstrap, enriched, handoff: ${filePath}`,
  );
}

function nonNegativeNumberField(
  value: Record<string, unknown>,
  key: string,
  filePath: string,
): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field) || field < 0) {
    throw new AgentTaskBenchmarkError(
      `field '${key}' must be a non-negative number: ${filePath}`,
    );
  }
  return field;
}

function booleanField(
  value: Record<string, unknown>,
  key: string,
  filePath: string,
): boolean {
  const field = value[key];
  if (typeof field !== "boolean") {
    throw new AgentTaskBenchmarkError(
      `field '${key}' must be a boolean: ${filePath}`,
    );
  }
  return field;
}

function optionalBooleanField(
  value: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const field = value[key];
  return typeof field === "boolean" ? field : undefined;
}

function optionalNonNegativeMetric(
  value: Record<string, unknown>,
  key: keyof AgentTaskBenchmarkInput["metrics"],
  filePath: string,
): Partial<AgentTaskBenchmarkInput["metrics"]> {
  const field = value[key];
  if (field === undefined) return {};
  if (typeof field !== "number" || !Number.isFinite(field) || field < 0) {
    throw new AgentTaskBenchmarkError(
      `field '${key}' must be a non-negative number: ${filePath}`,
    );
  }
  return { [key]: field } as Partial<AgentTaskBenchmarkInput["metrics"]>;
}

function stringArrayField(
  value: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (!Array.isArray(field) || field.some((item) => typeof item !== "string")) {
    throw new AgentTaskBenchmarkError(`field '${key}' must be a string array`);
  }
  return field;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
