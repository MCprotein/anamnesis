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
    "docs/ROADMAP.md",
    [
      "# Roadmap",
      "",
      "## v1.6",
      "Build a local context index prototype.",
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
    expect(result.summary.byKind["ontology-rule"]).toBeGreaterThan(0);
    expect(result.summary.byKind["ontology-relationship"]).toBeGreaterThan(0);
    expect(result.summary.byKind["handoff-task"]).toBeGreaterThan(0);
    expect(result.summary.byKind["manifest-entry"]).toBe(2);
    expect(result.summary.byKind["evidence-summary"]).toBe(1);
    expect(result.summary.byKind["doc-section"]).toBeGreaterThan(0);

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

    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]!.entry).toMatchObject({
      kind: "ontology-rule",
      source_path: ".anamnesis/ontology/base.yaml",
      stable_ref: "operational_notes[managed-region]",
    });
    expect(result.matches[0]!.entry.snippet).toContain("Managed regions");
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

  it("requires an index file before querying", () => {
    const project = setupContextProject();

    expect(() =>
      contextQuery({ projectRoot: project, query: "managed region" }),
    ).toThrow(ContextIndexError);
  });
});
