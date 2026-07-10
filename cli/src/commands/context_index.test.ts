import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  contextIndex,
  contextQuery,
  ContextIndexError,
  readContextIndex,
} from "./context_index.js";
import { contextDiagnostics } from "./context_diagnostics.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(project: string, relPath: string, content: string): void {
  const absPath = path.join(project, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

function setupContextProject(): string {
  const project = tmpDir("anamnesis-context-index-");
  writeFile(
    project,
    "AGENTS.md",
    [
      "# Agent Rules",
      "",
      "## Operating Principles",
      "Read exact ontology sources before relying on invariants.",
      "",
    ].join("\n"),
  );
  writeFile(
    project,
    "system_graph.yaml",
    [
      'schema_version: "anamnesis.system_graph.v1"',
      "",
      "entities:",
      "  project_context:",
      '    id: "project-context"',
      '    name: "Project context"',
      '    description: "Local context sources used by agents."',
      "",
    ].join("\n"),
  );
  writeFile(
    project,
    ".anamnesis/ontology/base.yaml",
    [
      'schema_version: "anamnesis.enriched.v1"',
      "",
      "operational_notes:",
      '  - id: "managed-region"',
      '    rule: "Managed regions are generated; do not edit them directly."',
      '    severity: "must"',
      "",
      "relationships:",
      '  - id: "agentfile-manifest"',
      "    from:",
      '      kind: "Agentfile"',
      "    to:",
      '      kind: "Manifest"',
      '    reason: "updates render manifest-tracked regions"',
      "",
    ].join("\n"),
  );
  writeFile(
    project,
    ".anamnesis/ontology/base.bootstrap.yaml",
    [
      'schema_version: "anamnesis.bootstrap.v1"',
      "",
      "facts:",
      "  runtime:",
      '    name: "actual-runtime"',
      "",
    ].join("\n"),
  );
  writeFile(
    project,
    ".anamnesis/manifest.json",
    JSON.stringify(
      {
        version: 1,
        regions: [
          {
            file: "AGENTS.md",
            region_id: "anamnesis-base",
            fragment_id: "base",
            fragment_version: 1,
            template_version: 1,
            base_rendered_hash:
              "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            last_applied_hash:
              "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            current_user_hash:
              "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          },
        ],
        files: [
          {
            path: ".anamnesis/ontology/base.yaml",
            fragment_id: "base",
            fragment_version: 1,
            last_applied_hash:
              "sha256:1111111111111111111111111111111111111111111111111111111111111111",
            current_user_hash:
              "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          },
        ],
      },
      null,
      2,
    ),
  );
  writeFile(
    project,
    ".anamnesis/evidence/events.jsonl",
    `${JSON.stringify({
      schema_version: "anamnesis.evidence.v1",
      kind: "doctor-check",
      generated_at: "2026-06-19T00:00:00.000Z",
      command: ["anamnesis", "doctor"],
      project: { name: "fixture" },
      summary: { ok: true },
    })}\n`,
  );
  writeFile(
    project,
    ".anamnesis/handoff/active.md",
    [
      "# Active handoff index",
      "",
      "## Current focus",
      "- context index prototype - archive: `.anamnesis/handoff/2026-06-19T00-00-00Z.md`",
      "",
    ].join("\n"),
  );
  writeFile(
    project,
    ".anamnesis/handoff/2026-06-19T00-00-00Z.md",
    [
      "# Handoff - context index prototype",
      "",
      "## Next steps",
      "1. Query managed region rules from the index.",
      "",
    ].join("\n"),
  );
  writeFile(
    project,
    ".anamnesis/task-harnesses/context-continuity.yaml",
    [
      'schema_version: "anamnesis.task_harness.v1"',
      'id: "context-continuity"',
      'title: "Context continuity task harness"',
      "lifecycle:",
      '  kind: "reusable"',
      "goal: >",
      "  Preserve handoff, ontology, and context index continuity while keeping startup context compact.",
      "stop_condition: >",
      "  Required source pointers are read before claims and non-matched harnesses stay out of startup injection.",
      "required_evidence:",
      '  - id: "source-read"',
      '    description: "Opened the exact source pointer before relying on it."',
      "test_commands:",
      '  - "anamnesis context index --write"',
      "",
    ].join("\n"),
  );
  writeFile(
    project,
    "docs/ROADMAP.md",
    [
      "# Roadmap",
      "",
      "## v1.6",
      "Build a local context index prototype.",
      "",
      "## Ontology source management",
      "Agents should read the [base ontology](../.anamnesis/ontology/base.yaml) before updating managed regions.",
      "The source pointer keeps document evidence separate from accepted ontology facts.",
      "",
      "anamnesis-fact: facts.runtime.name = documented-runtime",
      "",
    ].join("\n"),
  );
  return project;
}

describe("context index", () => {
  it("builds and writes a deterministic JSONL index over local context sources", () => {
    const project = setupContextProject();

    const result = contextIndex({
      projectRoot: project,
      write: true,
      now: () => new Date("2026-06-19T01:00:00.000Z"),
    });

    expect(result.projectRoot).toBe(".");
    expect(result.writtenPath).toBe(".anamnesis/context/index.jsonl");
    expect(result.summary.entries).toBeGreaterThan(0);
    expect(result.summary.byKind["agent-rule"]).toBeGreaterThan(0);
    expect(result.summary.byKind["ontology-entity"]).toBeGreaterThan(0);
    expect(result.summary.byKind["ontology-rule"]).toBeGreaterThan(0);
    expect(result.summary.byKind["ontology-relationship"]).toBeGreaterThan(0);
    expect(result.summary.byKind["handoff-task"]).toBeGreaterThan(0);
    expect(result.summary.byKind["manifest-entry"]).toBe(2);
    expect(result.summary.byKind["evidence-summary"]).toBe(1);
    expect(result.summary.byKind["doc-section"]).toBeGreaterThan(0);
    expect(result.summary.byKind["doc-page"]).toBeGreaterThan(0);
    expect(result.summary.byKind["doc-heading"]).toBeGreaterThan(0);
    expect(result.summary.byKind["doc-ontology-ref"]).toBe(1);
    expect(result.summary.byKind["task-harness"]).toBe(1);

    const indexPath = path.join(project, ".anamnesis", "context", "index.jsonl");
    const lines = fs.readFileSync(indexPath, "utf8").trim().split(/\r?\n/);
    expect(lines).toHaveLength(result.summary.entries);
    expect(JSON.parse(lines[0]!) as { schema_version: string }).toMatchObject({
      schema_version: "anamnesis.context_index.v1",
    });

    const firstJsonl = fs.readFileSync(indexPath, "utf8");
    contextIndex({ projectRoot: project, write: true });
    expect(fs.readFileSync(indexPath, "utf8")).toBe(firstJsonl);
    expect(readContextIndex(project)).toHaveLength(result.summary.entries);
  });

  it("queries by terms and kind while preserving source pointers", () => {
    const project = setupContextProject();
    contextIndex({ projectRoot: project, write: true });

    const result = contextQuery({
      projectRoot: project,
      query: "managed region",
      kind: "ontology-rule",
      limit: 2,
    });

    expect(result.projectRoot).toBe(".");
    expect(result.summary.indexStatus).toBe("current");
    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      expect(path.isAbsolute(match.entry.source_path)).toBe(false);
      expect(match.entry.source_path).not.toContain(project);
      expect(match.entry.stable_ref.length).toBeGreaterThan(0);
      expect(match.entry.snippet.length).toBeGreaterThan(0);
      expect(["current", "stale", "unknown"]).toContain(match.entry.freshness);
    }
    expect(result.matches[0]!.entry).toMatchObject({
      kind: "ontology-rule",
      source_path: ".anamnesis/ontology/base.yaml",
      stable_ref: "operational_notes[managed-region]",
    });
    expect(result.matches[0]!.entry.snippet).toContain("Managed regions");
  });

  it("indexes task harnesses as retrieval targets", () => {
    const project = setupContextProject();
    contextIndex({ projectRoot: project, write: true });

    const result = contextQuery({
      projectRoot: project,
      query: "context continuity compact startup",
      kind: "task-harness",
      limit: 2,
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.entry).toMatchObject({
      kind: "task-harness",
      source_path: ".anamnesis/task-harnesses/context-continuity.yaml",
      stable_ref: "harness:context-continuity",
      title: "Context continuity task harness",
      freshness: "current",
    });
    expect(result.matches[0]!.entry.snippet).toContain("startup context compact");
  });

  it("indexes document pages, headings, and ontology refs as source pointers", () => {
    const project = setupContextProject();
    contextIndex({ projectRoot: project, write: true });

    const heading = contextQuery({
      projectRoot: project,
      query: "ontology source management document evidence",
      kind: "doc-heading",
      limit: 1,
    });

    expect(heading.matches).toHaveLength(1);
    expect(heading.matches[0]!.entry).toMatchObject({
      kind: "doc-heading",
      source_path: "docs/ROADMAP.md",
      stable_ref: "heading:ontology-source-management",
      title: "Ontology source management",
      freshness: "current",
    });
    expect(heading.matches[0]!.entry.snippet).toContain("base ontology");

    const ontologyRef = contextQuery({
      projectRoot: project,
      query: "base ontology managed regions",
      kind: "doc-ontology-ref",
      limit: 1,
    });

    expect(ontologyRef.matches).toHaveLength(1);
    expect(ontologyRef.matches[0]!.entry).toMatchObject({
      kind: "doc-ontology-ref",
      source_path: "docs/ROADMAP.md",
      title: "Ontology ref .anamnesis/ontology/base.yaml",
      freshness: "current",
    });
    expect(ontologyRef.matches[0]!.entry.snippet).toContain("status ok");

    const page = contextQuery({
      projectRoot: project,
      query: "roadmap canonical ontology",
      kind: "doc-page",
      limit: 3,
    });

    expect(
      page.matches.some(
        (match) =>
          match.entry.source_path === "docs/ROADMAP.md" &&
          match.entry.stable_ref === "file",
      ),
    ).toBe(true);
  });

  it("marks active handoff entries stale when referenced archives are missing", () => {
    const project = setupContextProject();
    fs.unlinkSync(
      path.join(project, ".anamnesis", "handoff", "2026-06-19T00-00-00Z.md"),
    );

    const result = contextIndex({ projectRoot: project });

    expect(
      result.entries.some(
        (entry) =>
          entry.source_path === ".anamnesis/handoff/active.md" &&
          entry.freshness === "stale",
      ),
    ).toBe(true);
  });

  it("ranks active handoff context ahead of cold history unless history is explicit", () => {
    const project = setupContextProject();
    writeFile(
      project,
      ".anamnesis/handoff/active.md",
      [
        "# Active handoff index",
        "",
        "## Current focus",
        "- payment migration rollout - archive: `.anamnesis/handoff/current.md`",
        "",
        "## Recently completed",
        "- legacy payment migration - archive: `.anamnesis/handoff/closed.md`",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      ".anamnesis/handoff/current.md",
      [
        "---",
        "handoff_status: open",
        "retention_tier: warm",
        "---",
        "# Payment migration rollout",
        "",
        "## Next steps",
        "Validate the active payment migration rollout.",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      ".anamnesis/handoff/closed.md",
      [
        "---",
        "handoff_status: closed",
        "retention_tier: cold",
        "---",
        "# Legacy payment migration decision",
        "",
        "## Decisions",
        "Historical legacy payment migration used the retired queue.",
        "",
      ].join("\n"),
    );

    const current = contextQuery({
      projectRoot: project,
      query: "payment migration rollout next steps",
      kind: "handoff-task",
      limit: 4,
    });
    expect(current.matches[0]!.entry.source_path).not.toBe(
      ".anamnesis/handoff/closed.md",
    );
    expect(
      current.matches.find(
        (match) => match.entry.source_path === ".anamnesis/handoff/closed.md",
      )?.entry.freshness,
    ).toBe("stale");

    const historical = contextQuery({
      projectRoot: project,
      query: "historical closed legacy payment migration decision",
      kind: "handoff-task",
      limit: 4,
    });
    expect(historical.matches[0]!.entry).toMatchObject({
      source_path: ".anamnesis/handoff/closed.md",
      freshness: "stale",
    });
    expect(historical.matches[0]!.entry.tags).toEqual(
      expect.arrayContaining(["closed", "cold"]),
    );
  });

  it("keeps querying valid entries when the JSONL index contains malformed or incomplete lines", () => {
    const project = setupContextProject();
    contextIndex({ projectRoot: project, write: true });
    const before = readContextIndex(project);
    const indexPath = path.join(project, ".anamnesis", "context", "index.jsonl");
    fs.appendFileSync(
      indexPath,
      [
        "not-json",
        JSON.stringify({ schema_version: "wrong" }),
        JSON.stringify({ ...before[0], freshness: "invalid" }),
        "",
      ].join("\n"),
      "utf8",
    );

    expect(readContextIndex(project)).toHaveLength(before.length);
    const result = contextQuery({
      projectRoot: project,
      query: "managed region",
      kind: "ontology-rule",
    });
    expect(result.projectRoot).toBe(".");
    expect(result.summary.indexStatus).toBe("current");
    expect(result.summary.entriesSearched).toBe(
      before.filter((entry) => entry.kind === "ontology-rule").length,
    );
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("rebuilds the default query index in memory when the index file is missing", () => {
    const project = setupContextProject();

    const result = contextQuery({
      projectRoot: project,
      query: "managed region",
      kind: "ontology-rule",
    });

    expect(result.summary.indexStatus).toBe("rebuilt-missing");
    expect(result.warnings.join("\n")).toContain("was not found");
    expect(result.matches[0]!.entry).toMatchObject({
      kind: "ontology-rule",
      source_path: ".anamnesis/ontology/base.yaml",
      stable_ref: "operational_notes[managed-region]",
    });
    expect(
      fs.existsSync(path.join(project, ".anamnesis", "context", "index.jsonl")),
    ).toBe(false);
  });

  it("rebuilds the default query index in memory when sources changed", () => {
    const project = setupContextProject();
    contextIndex({ projectRoot: project, write: true });
    const roadmapPath = path.join(project, "docs", "ROADMAP.md");
    fs.appendFileSync(
      roadmapPath,
      [
        "",
        "## Fresh Query Target",
        "This heading exists only after the stored index was written.",
        "",
      ].join("\n"),
      "utf8",
    );
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(roadmapPath, future, future);

    const result = contextQuery({
      projectRoot: project,
      query: "fresh query target stored index",
      kind: "doc-heading",
      limit: 1,
    });

    expect(result.summary.indexStatus).toBe("rebuilt-stale");
    expect(result.summary.changedSources).toBeGreaterThan(0);
    expect(result.warnings.join("\n")).toContain("is stale");
    expect(result.matches[0]!.entry).toMatchObject({
      kind: "doc-heading",
      source_path: "docs/ROADMAP.md",
      stable_ref: "heading:fresh-query-target",
      title: "Fresh Query Target",
    });
  });

  it("rebuilds old default indexes that lack generated document graph kinds", () => {
    const project = setupContextProject();
    contextIndex({ projectRoot: project, write: true });
    const indexPath = path.join(project, ".anamnesis", "context", "index.jsonl");
    const legacyLines = fs
      .readFileSync(indexPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => {
        if (line.trim() === "") return false;
        const parsed = JSON.parse(line) as { kind?: string };
        return !["doc-page", "doc-heading", "doc-ontology-ref"].includes(
          parsed.kind ?? "",
        );
      });
    fs.writeFileSync(indexPath, `${legacyLines.join("\n")}\n`, "utf8");

    const result = contextQuery({
      projectRoot: project,
      query: "ontology source management",
      kind: "doc-heading",
      limit: 1,
    });

    expect(result.summary.indexStatus).toBe("rebuilt-stale");
    expect(result.summary.missingGeneratedKinds).toBeGreaterThan(0);
    expect(result.matches[0]!.entry).toMatchObject({
      kind: "doc-heading",
      source_path: "docs/ROADMAP.md",
      stable_ref: "heading:ontology-source-management",
    });
  });

  it("keeps source pointers indexed for context diagnostic follow-up reads", () => {
    const project = setupContextProject();
    fs.unlinkSync(
      path.join(project, ".anamnesis", "handoff", "2026-06-19T00-00-00Z.md"),
    );
    fs.appendFileSync(
      path.join(project, ".anamnesis", "evidence", "events.jsonl"),
      [
        "not-json",
        JSON.stringify({
          schema_version: "anamnesis.evidence.v1",
          kind: "benchmark-report",
          generated_at: "2026-06-19T02:00:00.000Z",
          command: ["anamnesis", "benchmark", "report"],
          project: { name: "fixture" },
          summary: { ok: false },
          artifacts: { report: "docs/missing-report.md" },
        }),
        "",
      ].join("\n"),
      "utf8",
    );

    const diagnostics = contextDiagnostics({ projectRoot: project });
    expect(diagnostics.summary.warnings).toBeGreaterThan(0);
    expect(diagnostics.summary.byCode["docs-bootstrap-conflict"]).toBe(1);
    expect(diagnostics.summary.byCode["handoff-archive-missing"]).toBe(1);
    expect(diagnostics.summary.byCode["evidence-invalid-record"]).toBe(1);
    expect(diagnostics.summary.byCode["evidence-artifact-missing"]).toBe(1);

    const index = contextIndex({ projectRoot: project });
    const indexedSources = new Set(
      index.entries.map((entry) => entry.source_path),
    );
    for (const issue of diagnostics.issues) {
      expect(indexedSources.has(issue.source_path)).toBe(true);
    }
    expect(
      index.entries.some(
        (entry) =>
          entry.source_path === ".anamnesis/handoff/active.md" &&
          entry.freshness === "stale",
      ),
    ).toBe(true);
  });

  it("requires an explicit custom index file before querying", () => {
    const project = setupContextProject();

    expect(() =>
      contextQuery({
        projectRoot: project,
        query: "managed region",
        indexPath: ".anamnesis/context/custom.jsonl",
      }),
    ).toThrow(ContextIndexError);
  });
});
