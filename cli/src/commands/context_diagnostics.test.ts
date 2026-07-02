import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { contextDiagnostics } from "./context_diagnostics.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(project: string, relPath: string, content: string): void {
  const absPath = path.join(project, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

describe("context diagnostics", () => {
  it("reports handoff, ontology, and evidence consistency issues", () => {
    const project = tmpDir("anamnesis-context-diagnostics-");
    writeFile(
      project,
      ".anamnesis/handoff/active.md",
      [
        "# Active handoff index",
        "",
        "## Current focus",
        "- continue diagnostics - archive: `.anamnesis/handoff/old.md`",
        "- missing branch - archive: `.anamnesis/handoff/missing.md`",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      ".anamnesis/handoff/old.md",
      "# Handoff - old\n\n## Goal\nold\n\n## Next steps\n1. Continue\n",
    );
    writeFile(
      project,
      ".anamnesis/handoff/new.md",
      "# Handoff - new\n\n## Goal\nnew\n\n## Next steps\n1. Continue\n",
    );
    fs.utimesSync(
      path.join(project, ".anamnesis", "handoff", "old.md"),
      new Date("2026-06-19T00:00:00.000Z"),
      new Date("2026-06-19T00:00:00.000Z"),
    );
    fs.utimesSync(
      path.join(project, ".anamnesis", "handoff", "new.md"),
      new Date("2026-06-20T00:00:00.000Z"),
      new Date("2026-06-20T00:00:00.000Z"),
    );
    writeFile(
      project,
      "system_graph.yaml",
      [
        "entities:",
        "  - id: api",
        '    name: "API"',
        "relationships:",
        "  - id: api-db",
        "    from: { kind: Service, name: api }",
        "    to: { kind: Database, name: primary }",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      ".anamnesis/ontology/base.enriched.yaml",
      [
        'schema_version: "anamnesis.enriched.v1"',
        "entities:",
        "  - id: api",
        '    name: "API duplicate"',
        "relationships:",
        "  - id: api-db",
        "    from: { kind: Service, name: api }",
        "    to: { kind: Queue, name: jobs }",
        "operational_notes:",
        "  - id: old-rule",
        '    rule: "Use the old context path."',
        "  - id: new-rule",
        "    supersedes: old-rule",
        '    rule: "Use the new context path."',
        "",
      ].join("\n"),
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
        artifacts: {
          markdown: "docs/MISSING.md",
          external: "https://example.com/report",
        },
      })}\nnot-json\n`,
    );

    const result = contextDiagnostics({
      projectRoot: project,
      now: () => new Date("2026-06-22T00:00:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.summary.byCode["handoff-archive-missing"]).toBe(1);
    expect(result.summary.byCode["handoff-archive-stale"]).toBe(1);
    expect(result.summary.byCode["ontology-duplicate-id"]).toBe(1);
    expect(result.summary.byCode["ontology-relationship-conflict"]).toBe(1);
    expect(result.summary.byCode["ontology-superseded-entry-current"]).toBe(1);
    expect(result.summary.byCode["evidence-artifact-missing"]).toBe(1);
    expect(result.summary.byCode["evidence-invalid-record"]).toBe(1);
    expect(
      result.issues.find(
        (issue) => issue.code === "ontology-relationship-conflict",
      )?.related,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("system_graph.yaml relationships[api-db]"),
        expect.stringContaining(
          ".anamnesis/ontology/base.enriched.yaml relationships[api-db]",
        ),
      ]),
    );
  });

  it("reports ok when local context sources are internally consistent", () => {
    const project = tmpDir("anamnesis-context-diagnostics-clean-");
    writeFile(
      project,
      ".anamnesis/handoff/active.md",
      [
        "# Active handoff index",
        "",
        "## Current focus",
        "- continue clean fixture - archive: `.anamnesis/handoff/current.md`",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      ".anamnesis/handoff/current.md",
      "# Handoff - current\n\n## Goal\ncurrent\n\n## Next steps\n1. Continue\n",
    );
    writeFile(
      project,
      ".anamnesis/ontology/base.enriched.yaml",
      [
        'schema_version: "anamnesis.enriched.v1"',
        "entities:",
        "  - id: api",
        '    name: "API"',
        "relationships:",
        "  - id: api-db",
        "    from: { kind: Service, name: api }",
        "    to: { kind: Database, name: primary }",
        "",
      ].join("\n"),
    );
    writeFile(project, "docs/DOCTOR.md", "# Doctor\n");
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
        artifacts: {
          markdown: "docs/DOCTOR.md",
        },
      })}\n`,
    );

    const result = contextDiagnostics({ projectRoot: project });

    expect(result.ok).toBe(true);
    expect(result.summary.issues).toBe(0);
  });

  it("reports semantic freshness issues in active handoff state", () => {
    const project = tmpDir("anamnesis-context-diagnostics-handoff-freshness-");
    writeFile(
      project,
      ".anamnesis/handoff/active.md",
      [
        "# Active handoff index",
        "",
        "## Current focus",
        "- [completed] finished cleanup - archive: `.anamnesis/handoff/closed.md`",
        "",
        "## Active tasks",
        "- continue missing-file work - next: inspect `docs/MISSING.md` - archive: `.anamnesis/handoff/current.md`",
        "- continue superseded work - archive: `.anamnesis/handoff/superseded.md`",
        "",
        "## Recently completed",
        "- already moved here - archive: `.anamnesis/handoff/closed.md`",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      ".anamnesis/handoff/current.md",
      "# Handoff - current\n\n## Goal\ncurrent\n\n## Next steps\n1. Continue\n",
    );
    writeFile(
      project,
      ".anamnesis/handoff/closed.md",
      [
        "---",
        "handoff_status: closed",
        "retention_tier: cold",
        "---",
        "",
        "# Handoff - closed",
        "",
        "## Goal",
        "closed",
        "",
        "## Next steps",
        "1. None",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      ".anamnesis/handoff/superseded.md",
      [
        "---",
        "handoff_status: superseded",
        "retention_tier: deprecated",
        "superseded_by: .anamnesis/handoff/current.md",
        "---",
        "",
        "# Handoff - superseded",
        "",
        "## Goal",
        "superseded",
        "",
        "## Next steps",
        "1. None",
        "",
      ].join("\n"),
    );

    const result = contextDiagnostics({ projectRoot: project });

    expect(result.ok).toBe(false);
    expect(result.summary.byCode["handoff-active-completed-entry"]).toBe(1);
    expect(result.summary.byCode["handoff-active-file-missing"]).toBe(1);
    expect(result.summary.byCode["handoff-active-archive-inactive"]).toBe(2);
    expect(result.summary.byCode["handoff-archive-missing"]).toBe(0);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "handoff-active-file-missing",
          related: ["docs/MISSING.md"],
        }),
        expect.objectContaining({
          code: "handoff-active-archive-inactive",
          related: expect.arrayContaining([
            ".anamnesis/handoff/superseded.md",
            ".anamnesis/handoff/current.md",
          ]),
        }),
      ]),
    );
  });

  it("reports explicit docs-vs-bootstrap fact contradictions", () => {
    const project = tmpDir("anamnesis-context-diagnostics-docs-bootstrap-");
    writeFile(
      project,
      ".anamnesis/ontology/nextjs.bootstrap.yaml",
      [
        'schema_version: "anamnesis.bootstrap.v1"',
        "generator:",
        "  name: anamnesis",
        '  version: "1.0.0"',
        "  introspector: nextjs",
        "facts:",
        "  routes:",
        "    - path: /api/current",
        "      file: app/api/current/route.ts",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      "docs/PROJECT-CONTEXT.md",
      [
        "# Project Context",
        "",
        "- anamnesis-fact: facts.routes[0].path = /api/legacy",
        "- anamnesis-fact: facts.routes[0].file = app/api/current/route.ts",
        "",
      ].join("\n"),
    );

    const result = contextDiagnostics({ projectRoot: project });

    expect(result.ok).toBe(false);
    expect(result.summary.byCode["docs-bootstrap-conflict"]).toBe(1);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "docs-bootstrap-conflict",
          source_path: "docs/PROJECT-CONTEXT.md",
          stable_ref: "line:3:facts.routes[0].path",
          message: expect.stringContaining("/api/current"),
          related: expect.arrayContaining([
            ".anamnesis/ontology/nextjs.bootstrap.yaml facts.routes[0].path='/api/current'",
          ]),
        }),
      ]),
    );
  });
});
