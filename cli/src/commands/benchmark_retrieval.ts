import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendEvidenceRecord,
  EVIDENCE_SCHEMA_VERSION,
  type RuntimeEvidenceRecord,
} from "../core/evidence.js";
import {
  contextQuery,
  type ContextIndexKind,
  type ContextQueryMatch,
} from "./context_index.js";
import { sessionContextBudget } from "./session_context_budget.js";

export const RETRIEVAL_BENCHMARK_SCHEMA_VERSION =
  "anamnesis.retrieval_benchmark.v2";

const DEFAULT_OUTPUT_DIR = path.join(
  "docs",
  "benchmark-evidence",
  "retrieval-source-pointers",
);
const TOP1_THRESHOLD = 0.9;
const TOP3_THRESHOLD = 1;
const MRR_THRESHOLD = 0.85;
const COMPACT_SESSION_START_TOKEN_CAP = 800;

export interface RetrievalBenchmarkOptions {
  projectRoot: string;
  write?: boolean;
  append?: boolean;
  outputPath?: string;
  now?: () => Date;
}

export interface RetrievalBenchmarkExpectedPointer {
  kind: ContextIndexKind;
  source_path: string;
  stable_ref?: string;
  title?: string;
}

export interface RetrievalBenchmarkCase {
  id: string;
  label: string;
  stratum: RetrievalBenchmarkStratum;
  query: string;
  expected: RetrievalBenchmarkExpectedPointer;
}

export type RetrievalBenchmarkStratum =
  | "agent-rules"
  | "diagnostics"
  | "documents"
  | "handoff"
  | "ontology"
  | "task-harness";

export interface RetrievalBenchmarkReturnedPointer {
  rank: number;
  score: number;
  kind: ContextIndexKind;
  source_path: string;
  stable_ref: string;
  title: string;
}

export interface RetrievalBenchmarkCaseResult {
  id: string;
  label: string;
  stratum: RetrievalBenchmarkStratum;
  kind: ContextIndexKind;
  query: string;
  expected: RetrievalBenchmarkExpectedPointer;
  rank?: number;
  top1Hit: boolean;
  top3Hit: boolean;
  reciprocalRank: number;
  returned: RetrievalBenchmarkReturnedPointer[];
  warnings: string[];
}

export interface RetrievalBenchmarkSafetyCheck {
  id: string;
  label: string;
  query: string;
  passed: boolean;
  violatingPointers: RetrievalBenchmarkReturnedPointer[];
}

export interface RetrievalBenchmarkStratumSummary {
  cases: number;
  top1Hits: number;
  top3Hits: number;
  top1HitRate: number;
  top3HitRate: number;
  mrr: number;
}

export interface RetrievalBenchmarkArtifacts {
  outputDir?: string;
  json?: string;
  markdown?: string;
  hitRatesSvg?: string;
  ranksSvg?: string;
  strataSvg?: string;
}

export interface RetrievalBenchmarkResult {
  schema_version: typeof RETRIEVAL_BENCHMARK_SCHEMA_VERSION;
  generatedAt: string;
  fixture: {
    id: string;
    description: string;
  };
  provenance: {
    packageVersion: string;
    fixtureHash: string;
    rankerHash: string;
    rankerInputs: string[];
  };
  cases: RetrievalBenchmarkCaseResult[];
  safetyChecks: RetrievalBenchmarkSafetyCheck[];
  summary: {
    cases: number;
    unfilteredCases: number;
    top1Hits: number;
    top3Hits: number;
    top1HitRate: number;
    top3HitRate: number;
    mrr: number;
    compactSessionStartTokens: number;
    compactSessionStartCap: number;
    compactSessionStartCapExceeded: boolean;
    byStratum: Record<RetrievalBenchmarkStratum, RetrievalBenchmarkStratumSummary>;
    safetyChecks: number;
    safetyPasses: number;
    staleHandoffTop3Leakage: number;
    missingOntologyRefTop3Leakage: number;
    behavioralValidation: "not-measured";
    ok: boolean;
  };
  artifacts: RetrievalBenchmarkArtifacts;
  markdown: string;
  evidenceRecordPath?: string;
}

export class RetrievalBenchmarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetrievalBenchmarkError";
  }
}

export function retrievalBenchmark(
  opts: RetrievalBenchmarkOptions,
): RetrievalBenchmarkResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "anamnesis-retrieval-benchmark-"),
  );

  try {
    writeRetrievalFixture(fixtureRoot);
    const provenance = retrievalBenchmarkProvenance(fixtureRoot);
    const cases = retrievalBenchmarkCases().map((item) =>
      runRetrievalCase(fixtureRoot, item),
    );
    const safetyChecks = runRetrievalSafetyChecks(fixtureRoot);
    const compactBudget = sessionContextBudget({
      projectRoot: fixtureRoot,
      maxTokens: COMPACT_SESSION_START_TOKEN_CAP,
      now: () => new Date(generatedAt),
    });
    const artifacts: RetrievalBenchmarkArtifacts = {};
    const result: RetrievalBenchmarkResult = {
      schema_version: RETRIEVAL_BENCHMARK_SCHEMA_VERSION,
      generatedAt,
      fixture: {
        id: "public-mixed-context-retrieval",
        description:
          "Synthetic public-safe project with mixed document, ontology, handoff, task-harness, agent-rule, and diagnostic pointers.",
      },
      provenance,
      cases,
      safetyChecks,
      summary: summarizeRetrievalBenchmark(
        cases,
        safetyChecks,
        compactBudget.estimatedTokens,
      ),
      artifacts,
      markdown: "",
    };
    result.markdown = renderRetrievalBenchmarkMarkdown(result);

    if (opts.write === true) {
      writeRetrievalBenchmarkArtifacts({
        projectRoot,
        outputPath: opts.outputPath,
        result,
      });
    }

    if (opts.append === true) {
      result.evidenceRecordPath = appendEvidenceRecord(
        projectRoot,
        retrievalBenchmarkEvidenceRecord(result),
      );
    }

    return result;
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function writeRetrievalFixture(projectRoot: string): void {
  writeFile(
    projectRoot,
    "Agentfile",
    [
      "version: 1",
      "project: { name: retrieval-fixture }",
      "tools: [codex]",
      "fragments:",
      "  - id: base",
      "    version: 20",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    "AGENTS.md",
    [
      "# Agent Rules",
      "",
      "## Evidence Retrieval Contract",
      "",
      "Before claiming a project invariant, use context query and open the returned source pointer.",
      "Do not treat snippets as authority.",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    "system_graph.yaml",
    [
      'schema_version: "anamnesis.system_graph.v1"',
      "entities:",
      "  - id: checkout-service",
      "    kind: service",
      "    name: checkout-service",
      "  - id: ledger-gateway",
      "    kind: service",
      "    name: ledger-gateway",
      "relationships:",
      "  - id: checkout-ledger-route",
      "    from: checkout-service",
      "    to: ledger-gateway",
      "    reason: ledger gateway owns final settlement routing",
      "operational_notes:",
      "  - id: settlement-source-read",
      "    rule: settlement routing changes must read payment ontology before edits",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    ".anamnesis/ontology/payments.yaml",
    [
      'schema_version: "anamnesis.ontology.v1"',
      "entities:",
      "  - id: payment-worker",
      "    kind: worker",
      "    name: payment-worker",
      "relationships:",
      "  - id: checkout-payment-dispatch",
      "    from: checkout-service",
      "    to: payment-worker",
      "    type: dispatches",
      "operational_notes:",
      "  - id: payment-idempotency-owner",
      "    rule: payment worker owns cobalt idempotency key verification",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    ".anamnesis/docs/catalog.yaml",
    [
      "roots:",
      "  - README.md",
      "  - docs",
      "canonical_docs:",
      "  - README.md",
      "  - docs/architecture.md",
      "excludes:",
      "  - docs/deprecated",
      "  - docs/benchmark-evidence",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    "README.md",
    [
      "# Retrieval Fixture",
      "",
      "This public-safe fixture documents the Nebula Cart agent memory contract.",
      "",
      "## Agent Continuity Contract",
      "",
      "Agents preserve project context by using source pointers before changing ontology or docs.",
      "The canonical top-level graph is [system_graph.yaml](system_graph.yaml), and the checkout flow is in [Architecture](docs/architecture.md#checkout-intent-flow).",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    "docs/architecture.md",
    [
      "# Architecture",
      "",
      "## Checkout Intent Flow",
      "",
      "The checkout service dispatches payment authorization to the payment worker.",
      "This reviewed semantic flow is recorded in `.anamnesis/ontology/payments.yaml` and must be read before ontology edits.",
      "",
      "## Release Automation Checklist",
      "",
      "The release runner verifies npm publication, GitHub release metadata, and generated surface drift.",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    "docs/operations.md",
    [
      "# Operations",
      "",
      "## Handoff Retention Policy",
      "",
      "Hot handoff archives stay startup-active; cold archives are retrieved only by source pointer.",
      "The policy references `.anamnesis/ontology/payments.yaml` only as source evidence, not as generated prose.",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    "docs/runbook.md",
    [
      "# Runbook",
      "",
      "## Orchid Failover Procedure",
      "",
      "During an Orchid incident, fail over the ledger gateway before replaying checkout intents.",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    "docs/diagnostics.md",
    [
      "# Diagnostics",
      "",
      "## Missing Ontology Source",
      "",
      "The removed worker source still points to [missing evidence](../.anamnesis/ontology/missing.yaml).",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    ".anamnesis/handoff/active.md",
    [
      "# Active handoff index",
      "",
      "## Current focus",
      "- Aurora billing cutover - archive: `.anamnesis/handoff/current.md`",
      "",
      "## Recently completed",
      "- legacy invoice transport - archive: `.anamnesis/handoff/closed.md`",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    ".anamnesis/handoff/current.md",
    [
      "---",
      "handoff_status: open",
      "retention_tier: warm",
      "---",
      "# Aurora billing cutover",
      "",
      "## Next steps",
      "Validate the cobalt queue before the Aurora billing cutover.",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    ".anamnesis/handoff/closed.md",
    [
      "---",
      "handoff_status: closed",
      "retention_tier: cold",
      "---",
      "# Legacy invoice transport decision",
      "",
      "## Decisions",
      "The historical invoice pipeline used the retired comet transport.",
      "",
    ].join("\n"),
  );
  writeFile(
    projectRoot,
    ".anamnesis/task-harnesses/release-safety.yaml",
    [
      'schema_version: "anamnesis.task_harness.v1"',
      'id: "release-safety"',
      'title: "Release safety verification"',
      "goal: verify package publication and generated surface drift",
      "stop_condition: npm and GitHub release evidence agree",
      "required_evidence:",
      "  - release runner output",
      "",
    ].join("\n"),
  );
}

function retrievalBenchmarkCases(): RetrievalBenchmarkCase[] {
  return [
    {
      id: "doc-page-readme",
      label: "README doc page",
      stratum: "documents",
      query: "Retrieval Fixture README canonical document page",
      expected: {
        kind: "doc-page",
        source_path: "README.md",
        stable_ref: "file",
      },
    },
    {
      id: "doc-heading-checkout-flow",
      label: "Checkout intent heading",
      stratum: "documents",
      query: "checkout intent flow payment authorization worker",
      expected: {
        kind: "doc-heading",
        source_path: "docs/architecture.md",
        stable_ref: "heading:checkout-intent-flow",
      },
    },
    {
      id: "doc-heading-release-checklist",
      label: "Release automation heading",
      stratum: "documents",
      query: "release automation checklist npm github generated drift",
      expected: {
        kind: "doc-heading",
        source_path: "docs/architecture.md",
        stable_ref: "heading:release-automation-checklist",
      },
    },
    {
      id: "doc-heading-handoff-retention",
      label: "Handoff retention heading",
      stratum: "documents",
      query: "hot handoff archive cold source pointer retention policy",
      expected: {
        kind: "doc-heading",
        source_path: "docs/operations.md",
        stable_ref: "heading:handoff-retention-policy",
      },
    },
    {
      id: "doc-heading-orchid-failover",
      label: "Orchid failover heading",
      stratum: "documents",
      query: "Orchid incident ledger gateway failover checkout replay",
      expected: {
        kind: "doc-heading",
        source_path: "docs/runbook.md",
        stable_ref: "heading:orchid-failover-procedure",
      },
    },
    {
      id: "doc-ontology-payments",
      label: "Payments ontology ref",
      stratum: "documents",
      query: "reviewed semantic flow recorded payments ontology edits",
      expected: {
        kind: "doc-ontology-ref",
        source_path: "docs/architecture.md",
        title: "Ontology ref .anamnesis/ontology/payments.yaml",
      },
    },
    {
      id: "doc-ontology-system-graph",
      label: "System graph ontology ref",
      stratum: "documents",
      query: "canonical top-level graph system graph",
      expected: {
        kind: "doc-ontology-ref",
        source_path: "README.md",
        title: "Ontology ref system_graph.yaml",
      },
    },
    {
      id: "ontology-checkout-service",
      label: "Checkout service entity",
      stratum: "ontology",
      query: "checkout-service service entity top-level graph",
      expected: {
        kind: "ontology-entity",
        source_path: "system_graph.yaml",
        title: "checkout-service",
      },
    },
    {
      id: "ontology-ledger-gateway",
      label: "Ledger gateway entity",
      stratum: "ontology",
      query: "ledger-gateway settlement service entity",
      expected: {
        kind: "ontology-entity",
        source_path: "system_graph.yaml",
        title: "ledger-gateway",
      },
    },
    {
      id: "ontology-payment-worker",
      label: "Payment worker entity",
      stratum: "ontology",
      query: "payment-worker worker cobalt idempotency",
      expected: {
        kind: "ontology-entity",
        source_path: ".anamnesis/ontology/payments.yaml",
        title: "payment-worker",
      },
    },
    {
      id: "ontology-checkout-payment-dispatch",
      label: "Checkout payment relationship",
      stratum: "ontology",
      query: "checkout payment dispatches worker relationship",
      expected: {
        kind: "ontology-relationship",
        source_path: ".anamnesis/ontology/payments.yaml",
        title: "checkout-payment-dispatch",
      },
    },
    {
      id: "ontology-payment-idempotency",
      label: "Payment idempotency rule",
      stratum: "ontology",
      query: "cobalt idempotency key verification owner rule",
      expected: {
        kind: "ontology-rule",
        source_path: ".anamnesis/ontology/payments.yaml",
        title: "payment-idempotency-owner",
      },
    },
    {
      id: "ontology-settlement-source-read",
      label: "Settlement source-read rule",
      stratum: "ontology",
      query: "settlement routing changes payment ontology source read rule",
      expected: {
        kind: "ontology-rule",
        source_path: "system_graph.yaml",
        title: "settlement-source-read",
      },
    },
    {
      id: "diagnostic-missing-ontology",
      label: "Missing ontology diagnostic pointer",
      stratum: "diagnostics",
      query: "missing removed worker ontology evidence diagnostic",
      expected: {
        kind: "doc-ontology-ref",
        source_path: "docs/diagnostics.md",
        title: "Ontology ref .anamnesis/ontology/missing.yaml",
      },
    },
    {
      id: "handoff-current-aurora",
      label: "Current Aurora handoff",
      stratum: "handoff",
      query: "Aurora billing cutover cobalt queue next steps",
      expected: {
        kind: "handoff-task",
        source_path: ".anamnesis/handoff/current.md",
        title: "Aurora billing cutover",
      },
    },
    {
      id: "handoff-historical-comet",
      label: "Historical comet handoff",
      stratum: "handoff",
      query: "historical closed cold legacy invoice comet transport decision",
      expected: {
        kind: "handoff-task",
        source_path: ".anamnesis/handoff/closed.md",
        title: "Legacy invoice transport decision",
      },
    },
    {
      id: "task-harness-release-safety",
      label: "Release safety task harness",
      stratum: "task-harness",
      query: "release safety package publication generated surface drift evidence",
      expected: {
        kind: "task-harness",
        source_path: ".anamnesis/task-harnesses/release-safety.yaml",
        title: "Release safety verification",
      },
    },
    {
      id: "agent-rule-evidence-retrieval",
      label: "Agent evidence retrieval rule",
      stratum: "agent-rules",
      query: "agent evidence retrieval contract source pointer snippets authority",
      expected: {
        kind: "agent-rule",
        source_path: "AGENTS.md",
        title: "Evidence Retrieval Contract",
      },
    },
  ];
}

function runRetrievalCase(
  projectRoot: string,
  item: RetrievalBenchmarkCase,
): RetrievalBenchmarkCaseResult {
  const query = contextQuery({
    projectRoot,
    query: item.query,
    limit: 8,
  });
  const rankIndex = query.matches.findIndex((match) =>
    pointerMatches(match, item.expected),
  );
  const rank = rankIndex >= 0 ? rankIndex + 1 : undefined;
  return {
    ...item,
    kind: item.expected.kind,
    ...(rank !== undefined ? { rank } : {}),
    top1Hit: rank === 1,
    top3Hit: rank !== undefined && rank <= 3,
    reciprocalRank: rank === undefined ? 0 : 1 / rank,
    returned: query.matches.map(returnedPointer),
    warnings: query.warnings,
  };
}

function runRetrievalSafetyChecks(
  projectRoot: string,
): RetrievalBenchmarkSafetyCheck[] {
  return [
    runRetrievalSafetyCheck({
      projectRoot,
      id: "ordinary-query-excludes-stale-handoff",
      label: "Ordinary queries exclude stale handoff history",
      query: "legacy invoice comet transport decision",
      violates: (match) =>
        match.entry.kind === "handoff-task" && match.entry.freshness === "stale",
    }),
    runRetrievalSafetyCheck({
      projectRoot,
      id: "ordinary-query-demotes-missing-ontology",
      label: "Ordinary queries exclude missing ontology refs from top-3",
      query: "removed worker ontology evidence source",
      violates: (match) =>
        match.entry.kind === "doc-ontology-ref" &&
        match.entry.tags.includes("missing"),
    }),
  ];
}

function runRetrievalSafetyCheck(input: {
  projectRoot: string;
  id: string;
  label: string;
  query: string;
  violates: (match: ContextQueryMatch) => boolean;
}): RetrievalBenchmarkSafetyCheck {
  const query = contextQuery({
    projectRoot: input.projectRoot,
    query: input.query,
    limit: 3,
  });
  const violatingPointers = query.matches
    .filter(input.violates)
    .map(returnedPointer);
  return {
    id: input.id,
    label: input.label,
    query: input.query,
    passed: violatingPointers.length === 0,
    violatingPointers,
  };
}

function pointerMatches(
  match: ContextQueryMatch,
  expected: RetrievalBenchmarkExpectedPointer,
): boolean {
  return (
    match.entry.kind === expected.kind &&
    match.entry.source_path === expected.source_path &&
    (expected.stable_ref === undefined ||
      match.entry.stable_ref === expected.stable_ref) &&
    (expected.title === undefined || match.entry.title === expected.title)
  );
}

function returnedPointer(
  match: ContextQueryMatch,
  index: number,
): RetrievalBenchmarkReturnedPointer {
  return {
    rank: index + 1,
    score: match.score,
    kind: match.entry.kind,
    source_path: match.entry.source_path,
    stable_ref: match.entry.stable_ref,
    title: match.entry.title,
  };
}

function summarizeRetrievalBenchmark(
  cases: readonly RetrievalBenchmarkCaseResult[],
  safetyChecks: readonly RetrievalBenchmarkSafetyCheck[],
  compactSessionStartTokens: number,
): RetrievalBenchmarkResult["summary"] {
  const total = cases.length;
  const top1Hits = cases.filter((item) => item.top1Hit).length;
  const top3Hits = cases.filter((item) => item.top3Hit).length;
  const top1HitRate = rate(top1Hits, total);
  const top3HitRate = rate(top3Hits, total);
  const mrr = roundRate(
    cases.reduce((sum, item) => sum + item.reciprocalRank, 0) /
      Math.max(1, total),
  );
  const compactSessionStartCapExceeded =
    compactSessionStartTokens > COMPACT_SESSION_START_TOKEN_CAP;
  const byStratum = summarizeRetrievalStrata(cases);
  const safetyPasses = safetyChecks.filter((item) => item.passed).length;
  const staleHandoffTop3Leakage = safetyViolationCount(
    safetyChecks,
    "ordinary-query-excludes-stale-handoff",
  );
  const missingOntologyRefTop3Leakage = safetyViolationCount(
    safetyChecks,
    "ordinary-query-demotes-missing-ontology",
  );
  return {
    cases: total,
    unfilteredCases: total,
    top1Hits,
    top3Hits,
    top1HitRate,
    top3HitRate,
    mrr,
    compactSessionStartTokens,
    compactSessionStartCap: COMPACT_SESSION_START_TOKEN_CAP,
    compactSessionStartCapExceeded,
    byStratum,
    safetyChecks: safetyChecks.length,
    safetyPasses,
    staleHandoffTop3Leakage,
    missingOntologyRefTop3Leakage,
    behavioralValidation: "not-measured",
    ok:
      top1HitRate >= TOP1_THRESHOLD &&
      top3HitRate >= TOP3_THRESHOLD &&
      mrr >= MRR_THRESHOLD &&
      !compactSessionStartCapExceeded &&
      Object.values(byStratum).every(
        (stratum) =>
          stratum.cases === 0 || stratum.top3HitRate >= TOP3_THRESHOLD,
      ) &&
      safetyPasses === safetyChecks.length,
  };
}

function summarizeRetrievalStrata(
  cases: readonly RetrievalBenchmarkCaseResult[],
): Record<RetrievalBenchmarkStratum, RetrievalBenchmarkStratumSummary> {
  const strata: RetrievalBenchmarkStratum[] = [
    "agent-rules",
    "diagnostics",
    "documents",
    "handoff",
    "ontology",
    "task-harness",
  ];
  return Object.fromEntries(
    strata.map((stratum) => {
      const selected = cases.filter((item) => item.stratum === stratum);
      const top1Hits = selected.filter((item) => item.top1Hit).length;
      const top3Hits = selected.filter((item) => item.top3Hit).length;
      return [
        stratum,
        {
          cases: selected.length,
          top1Hits,
          top3Hits,
          top1HitRate: rate(top1Hits, selected.length),
          top3HitRate: rate(top3Hits, selected.length),
          mrr: roundRate(
            selected.reduce((sum, item) => sum + item.reciprocalRank, 0) /
              Math.max(1, selected.length),
          ),
        },
      ];
    }),
  ) as Record<RetrievalBenchmarkStratum, RetrievalBenchmarkStratumSummary>;
}

function safetyViolationCount(
  checks: readonly RetrievalBenchmarkSafetyCheck[],
  id: string,
): number {
  return checks.find((item) => item.id === id)?.violatingPointers.length ?? 0;
}

function writeRetrievalBenchmarkArtifacts(input: {
  projectRoot: string;
  outputPath?: string;
  result: RetrievalBenchmarkResult;
}): void {
  const outputDir = path.resolve(
    input.projectRoot,
    input.outputPath ?? DEFAULT_OUTPUT_DIR,
  );
  fs.mkdirSync(outputDir, { recursive: true });

  input.result.artifacts.outputDir = displayPathFromProject(
    input.projectRoot,
    outputDir,
  );
  input.result.artifacts.json = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "retrieval-source-pointers.json"),
  );
  input.result.artifacts.markdown = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "retrieval-source-pointers.md"),
  );
  input.result.artifacts.hitRatesSvg = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "retrieval-hit-rates.svg"),
  );
  input.result.artifacts.ranksSvg = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "retrieval-ranks.svg"),
  );
  input.result.artifacts.strataSvg = displayPathFromProject(
    input.projectRoot,
    path.join(outputDir, "retrieval-strata.svg"),
  );
  input.result.markdown = renderRetrievalBenchmarkMarkdown(input.result);

  fs.writeFileSync(
    path.join(outputDir, "retrieval-source-pointers.json"),
    `${JSON.stringify(input.result, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "retrieval-source-pointers.md"),
    `${input.result.markdown}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "retrieval-hit-rates.svg"),
    renderHitRatesSvg(input.result),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "retrieval-ranks.svg"),
    renderRanksSvg(input.result),
    "utf8",
  );
  fs.writeFileSync(
    path.join(outputDir, "retrieval-strata.svg"),
    renderStrataSvg(input.result),
    "utf8",
  );
}

function renderRetrievalBenchmarkMarkdown(
  input: RetrievalBenchmarkResult,
): string {
  const lines = [
    `# Retrieval Source-Pointer Benchmark — ${input.generatedAt}`,
    "",
    "Deterministic unfiltered benchmark for `context query` source-pointer ranking over public-safe mixed context sources.",
    "",
    `Package: ${input.provenance.packageVersion}`,
    `Fixture hash: ${input.provenance.fixtureHash}`,
    `Ranker hash: ${input.provenance.rankerHash}`,
    `Ranker inputs: ${input.provenance.rankerInputs.join(", ")}`,
    `Cases: ${input.summary.cases}`,
    `Top-1 hit rate: ${formatRate(input.summary.top1HitRate)} (${input.summary.top1Hits}/${input.summary.cases})`,
    `Top-3 hit rate: ${formatRate(input.summary.top3HitRate)} (${input.summary.top3Hits}/${input.summary.cases})`,
    `MRR: ${input.summary.mrr.toFixed(3)}`,
    `Compact SessionStart: ${input.summary.compactSessionStartTokens}/${input.summary.compactSessionStartCap} estimated tokens`,
    `Safety checks: ${input.summary.safetyPasses}/${input.summary.safetyChecks} passed`,
    `Behavioral validation: ${input.summary.behavioralValidation} (use model-dependent task benchmarks)`,
    `Gate: ${input.summary.ok ? "pass" : "fail"}`,
    "",
    "| Case | Stratum | Kind | Query | Expected pointer | Rank | Top-1 | Top-3 |",
    "|---|---|---|---|---|---:|---|---|",
  ];
  for (const item of input.cases) {
    lines.push(
      `| ${escapeCell(item.label)} | ${item.stratum} | ${item.kind} | ${escapeCell(item.query)} | ${escapeCell(formatExpectedPointer(item.expected))} | ${item.rank ?? "miss"} | ${item.top1Hit ? "yes" : "no"} | ${item.top3Hit ? "yes" : "no"} |`,
    );
  }
  lines.push(
    "",
    "## Safety checks",
    "",
    "| Check | Result | Violations |",
    "|---|---|---:|",
    ...input.safetyChecks.map(
      (item) =>
        `| ${escapeCell(item.label)} | ${item.passed ? "pass" : "fail"} | ${item.violatingPointers.length} |`,
    ),
  );
  if (input.artifacts.hitRatesSvg) {
    lines.push(
      "",
      "## Charts",
      "",
      `![Retrieval hit rates](${path.basename(input.artifacts.hitRatesSvg)})`,
      `![Retrieval ranks](${path.basename(input.artifacts.ranksSvg ?? "")})`,
      `![Retrieval strata](${path.basename(input.artifacts.strataSvg ?? "")})`,
    );
  }
  return lines.join("\n");
}

function renderHitRatesSvg(input: RetrievalBenchmarkResult): string {
  const width = 720;
  const height = 300;
  const metrics = [
    { label: "Top-1", value: input.summary.top1HitRate, threshold: TOP1_THRESHOLD },
    { label: "Top-3", value: input.summary.top3HitRate, threshold: TOP3_THRESHOLD },
    { label: "MRR", value: input.summary.mrr, threshold: MRR_THRESHOLD },
  ];
  const parts = svgFrame(width, height, "Retrieval Hit Rates");
  const chartX = 80;
  const chartY = 54;
  const chartW = 560;
  const chartH = 170;
  parts.push(axis(width, height, chartX, chartY, chartW, chartH));
  metrics.forEach((metric, index) => {
    const groupW = chartW / metrics.length;
    const barW = 64;
    const x = chartX + index * groupW + groupW / 2 - barW / 2;
    const h = metric.value * chartH;
    const y = chartY + chartH - h;
    const ok = metric.value >= metric.threshold;
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" fill="${ok ? "#059669" : "#dc2626"}"><title>${escapeXml(metric.label)} ${formatRate(metric.value)} threshold ${formatRate(metric.threshold)}</title></rect>`,
      `<line x1="${(x - 14).toFixed(1)}" y1="${(chartY + chartH - metric.threshold * chartH).toFixed(1)}" x2="${(x + barW + 14).toFixed(1)}" y2="${(chartY + chartH - metric.threshold * chartH).toFixed(1)}" stroke="#111827" stroke-dasharray="4 3" />`,
      `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 44}" text-anchor="middle" font-size="13" fill="#374151">${escapeXml(metric.label)}</text>`,
      `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="12" fill="#111827">${formatRate(metric.value)}</text>`,
    );
  });
  parts.push(
    `<text x="${width / 2}" y="${height - 18}" text-anchor="middle" font-size="12" fill="#4b5563">bars show measured value; dashed line shows gate threshold</text>`,
    "</svg>\n",
  );
  return parts.join("\n");
}

function renderRanksSvg(input: RetrievalBenchmarkResult): string {
  const width = 980;
  const height = 360;
  const chartX = 80;
  const chartY = 42;
  const chartW = 840;
  const chartH = 220;
  const maxRank = Math.max(
    ...input.cases.map((item) => item.rank ?? 9),
    3,
  );
  const parts = svgFrame(width, height, "Expected Pointer Rank By Case");
  parts.push(axis(width, height, chartX, chartY, chartW, chartH));
  input.cases.forEach((item, index) => {
    const groupW = chartW / input.cases.length;
    const barW = Math.max(22, groupW * 0.42);
    const value = item.rank ?? maxRank;
    const h = (value / maxRank) * chartH;
    const x = chartX + index * groupW + groupW / 2 - barW / 2;
    const y = chartY + chartH - h;
    const color = item.top1Hit ? "#059669" : item.top3Hit ? "#d97706" : "#dc2626";
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}"><title>${escapeXml(item.label)} rank ${item.rank ?? "miss"}</title></rect>`,
      `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="12" fill="#111827">${item.rank ?? "miss"}</text>`,
      `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 70}" text-anchor="end" transform="rotate(-35 ${(x + barW / 2).toFixed(1)} ${height - 70})" font-size="11" fill="#374151">${escapeXml(item.id)}</text>`,
    );
  });
  parts.push(
    `<text x="${width / 2}" y="${height - 24}" text-anchor="middle" font-size="12" fill="#4b5563">lower rank is better; green is rank 1, amber is rank 2-3</text>`,
    "</svg>\n",
  );
  return parts.join("\n");
}

function renderStrataSvg(input: RetrievalBenchmarkResult): string {
  const width = 980;
  const height = 390;
  const chartX = 90;
  const chartY = 54;
  const chartW = 820;
  const chartH = 230;
  const strata = Object.entries(input.summary.byStratum) as [
    RetrievalBenchmarkStratum,
    RetrievalBenchmarkStratumSummary,
  ][];
  const parts = svgFrame(width, height, "Top-3 Retrieval By Context Stratum");
  parts.push(axis(width, height, chartX, chartY, chartW, chartH));
  strata.forEach(([stratum, summary], index) => {
    const groupW = chartW / strata.length;
    const barW = Math.max(30, groupW * 0.45);
    const x = chartX + index * groupW + groupW / 2 - barW / 2;
    const h = summary.top3HitRate * chartH;
    const y = chartY + chartH - h;
    const color = summary.top3HitRate >= TOP3_THRESHOLD ? "#059669" : "#dc2626";
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}"><title>${escapeXml(stratum)} ${formatRate(summary.top3HitRate)} (${summary.top3Hits}/${summary.cases})</title></rect>`,
      `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="12" fill="#111827">${formatRate(summary.top3HitRate)}</text>`,
      `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 72}" text-anchor="end" transform="rotate(-30 ${(x + barW / 2).toFixed(1)} ${height - 72})" font-size="11" fill="#374151">${escapeXml(stratum)}</text>`,
    );
  });
  parts.push(
    `<text x="${width / 2}" y="${height - 22}" text-anchor="middle" font-size="12" fill="#4b5563">all cases run without a kind filter; each stratum must reach 100% top-3</text>`,
    "</svg>\n",
  );
  return parts.join("\n");
}

function retrievalBenchmarkEvidenceRecord(
  result: RetrievalBenchmarkResult,
): RuntimeEvidenceRecord {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    kind: "retrieval-benchmark",
    generated_at: result.generatedAt,
    command: ["anamnesis", "benchmark", "retrieval"],
    project: { name: "retrieval-fixture" },
    summary: {
      schema_version: result.schema_version,
      fixture_id: result.fixture.id,
      ...result.summary,
    },
    details: {
      cases: result.cases.map((item) => ({
        id: item.id,
        stratum: item.stratum,
        kind: item.kind,
        rank: item.rank ?? null,
        top1Hit: item.top1Hit,
        top3Hit: item.top3Hit,
        expected: item.expected,
      })),
      safety_checks: result.safetyChecks,
      provenance: result.provenance,
    },
    artifacts: retrievalBenchmarkArtifactRecord(result.artifacts),
  };
}

function retrievalBenchmarkArtifactRecord(
  artifacts: RetrievalBenchmarkArtifacts,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(artifacts).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function retrievalBenchmarkProvenance(fixtureRoot: string): {
  packageVersion: string;
  fixtureHash: string;
  rankerHash: string;
  rankerInputs: string[];
} {
  const ranker = hashRetrievalModules();
  return {
    packageVersion: benchmarkPackageVersion(),
    fixtureHash: hashFixture(fixtureRoot),
    rankerHash: ranker.hash,
    rankerInputs: ranker.inputs,
  };
}

function benchmarkPackageVersion(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(current, "package.json");
    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as {
          name?: string;
          version?: string;
        };
        if (
          parsed.name === "@mcprotein/anamnesis" &&
          typeof parsed.version === "string"
        ) {
          return parsed.version;
        }
      } catch {
        // Keep walking in case this package.json belongs to a nested tool.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "unknown";
}

function hashRetrievalModules(): { hash: string; inputs: string[] } {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const extension = fs.existsSync(path.join(moduleDir, "context_index.ts"))
    ? ".ts"
    : ".js";
  const modules = [
    path.join(moduleDir, `context_index${extension}`),
    path.join(moduleDir, `context_docs${extension}`),
    path.join(moduleDir, "..", "core", `handoff_active_text${extension}`),
  ];
  const existing = modules.filter((candidate) => fs.existsSync(candidate));
  if (existing.length === modules.length) {
    const hash = crypto.createHash("sha256");
    const inputs: string[] = [];
    for (const candidate of existing) {
      const label = path.relative(path.join(moduleDir, "..", ".."), candidate).replace(/\\/g, "/");
      inputs.push(label);
      hash.update(label);
      hash.update("\0");
      hash.update(fs.readFileSync(candidate));
      hash.update("\0");
    }
    return { hash: `sha256:${hash.digest("hex")}`, inputs };
  }
  return {
    hash: sha256(Buffer.from(`package:${benchmarkPackageVersion()}`, "utf8")),
    inputs: [`package:${benchmarkPackageVersion()}`],
  };
}

function hashFixture(projectRoot: string): string {
  const files: string[] = [];
  const stack = [projectRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(absPath);
      else if (entry.isFile()) files.push(absPath);
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  const hash = crypto.createHash("sha256");
  for (const absPath of files) {
    const relPath = displayPathFromProject(projectRoot, absPath);
    hash.update(relPath);
    hash.update("\0");
    hash.update(fs.readFileSync(absPath));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function sha256(value: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function writeFile(projectRoot: string, relPath: string, content: string): void {
  const absPath = path.join(projectRoot, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : roundRate(numerator / denominator);
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatExpectedPointer(pointer: RetrievalBenchmarkExpectedPointer): string {
  return [
    pointer.source_path,
    pointer.stable_ref,
    pointer.title,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}

function displayPathFromProject(projectRoot: string, absPath: string): string {
  const rel = path.relative(projectRoot, absPath).split(path.sep).join("/");
  return rel === "" ? "." : rel;
}

function svgFrame(width: number, height: number, title: string): string[] {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff" />`,
    `<text x="24" y="28" font-size="18" font-weight="700" fill="#111827">${escapeXml(title)}</text>`,
  ];
}

function axis(
  width: number,
  height: number,
  chartX: number,
  chartY: number,
  chartW: number,
  chartH: number,
): string {
  return [
    `<line x1="${chartX}" y1="${chartY + chartH}" x2="${chartX + chartW}" y2="${chartY + chartH}" stroke="#d1d5db" />`,
    `<line x1="${chartX}" y1="${chartY}" x2="${chartX}" y2="${chartY + chartH}" stroke="#d1d5db" />`,
    `<text x="${chartX - 10}" y="${chartY + 4}" text-anchor="end" font-size="11" fill="#6b7280">high</text>`,
    `<text x="${width - 24}" y="${height - 10}" text-anchor="end" font-size="10" fill="#9ca3af">anamnesis deterministic fixture</text>`,
  ].join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
