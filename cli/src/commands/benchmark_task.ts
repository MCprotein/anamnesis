import * as fs from "node:fs";
import * as path from "node:path";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";

export const AGENT_TASK_BENCHMARK_SCHEMA_VERSION =
  "anamnesis.agent_task_benchmark.v1";

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
    missed_invariant_count?: number;
    hallucinated_fact_count?: number;
    unnecessary_context_reads?: number;
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
    task_success?: number;
    missed_invariant_count?: number;
    hallucinated_fact_count?: number;
    unnecessary_context_reads?: number;
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

export interface AgentTaskBenchmarkOptions {
  projectRoot: string;
  inputPath?: string;
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
      missed_invariant_count: 0,
      hallucinated_fact_count: 0,
      unnecessary_context_reads: 0,
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
      ...optionalNonNegativeMetric(metrics, "missed_invariant_count", filePath),
      ...optionalNonNegativeMetric(metrics, "hallucinated_fact_count", filePath),
      ...optionalNonNegativeMetric(metrics, "unnecessary_context_reads", filePath),
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
    metrics.missed_invariant_count !== undefined ||
    metrics.hallucinated_fact_count !== undefined ||
    metrics.unnecessary_context_reads !== undefined ||
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

  return {
    ...(requiredSourceReadRate !== undefined
      ? { required_source_read_rate: requiredSourceReadRate }
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

function retrievalMetricRows(
  input: AgentTaskBenchmarkInput,
  score: AgentTaskBenchmarkScore,
): string[] {
  if (
    input.metrics.task_success === undefined &&
    input.metrics.required_source_reads === undefined &&
    input.metrics.expected_source_reads === undefined &&
    input.metrics.missed_invariant_count === undefined &&
    input.metrics.hallucinated_fact_count === undefined &&
    input.metrics.unnecessary_context_reads === undefined &&
    input.metrics.input_tokens === undefined &&
    input.metrics.output_tokens === undefined &&
    input.metrics.total_tokens === undefined
  ) {
    return [];
  }

  const rate = retrievalScore(input)?.required_source_read_rate;
  return [
    `| Task success | ${input.metrics.task_success === undefined ? "(unspecified)" : input.metrics.task_success ? "yes" : "no"} | ${score.retrieval?.task_success ?? "-"} |`,
    `| Required source reads | ${formatMaybeNumber(input.metrics.required_source_reads)}/${formatMaybeNumber(input.metrics.expected_source_reads)} | ${rate === undefined ? "-" : `${Math.round(rate * 100)}%`} |`,
    `| Missed invariants | ${formatMaybeNumber(input.metrics.missed_invariant_count)} | - |`,
    `| Hallucinated facts | ${formatMaybeNumber(input.metrics.hallucinated_fact_count)} | - |`,
    `| Unnecessary context reads | ${formatMaybeNumber(input.metrics.unnecessary_context_reads)} | - |`,
    `| Input tokens | ${formatMaybeNumber(input.metrics.input_tokens)} | - |`,
    `| Output tokens | ${formatMaybeNumber(input.metrics.output_tokens)} | - |`,
    `| Total tokens | ${formatMaybeNumber(input.metrics.total_tokens)} | - |`,
  ];
}

function formatMaybeNumber(value: number | undefined): string {
  return value === undefined ? "-" : String(value);
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
