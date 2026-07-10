import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { contextDocs } from "./context_docs.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(project: string, relPath: string, content: string): void {
  const absPath = path.join(project, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

function setupDocsProject(): string {
  const project = tmpDir("anamnesis-context-docs-");
  writeFile(
    project,
    ".anamnesis/docs/catalog.yaml",
    [
      "roots:",
      '  - "README.md"',
      '  - "docs"',
      '  - "specs"',
      "excludes:",
      '  - "docs/private.md"',
      "canonical:",
      '  - "README.md"',
      '  - "docs/guide.md"',
      "",
    ].join("\n"),
  );
  writeFile(
    project,
    "README.md",
    [
      "# Fixture",
      "",
      "See [Guide](docs/guide.md), [Spec](specs/api.md#contract), and [Missing](docs/missing.md).",
      "Check [Bad anchor](docs/guide.md#missing-heading), [Self](#fixture), and [Web](https://example.com).",
      "Top-level ontology lives in `system_graph.yaml`.",
      "",
    ].join("\n"),
  );
  writeFile(
    project,
    "docs/guide.md",
    [
      "# Guide",
      "",
      "`.anamnesis/ontology/example.bootstrap.yaml`:",
      "",
      "Back to [Home](../README.md).",
      "Ontology source: [Base](../.anamnesis/ontology/base.yaml).",
      "",
    ].join("\n"),
  );
  writeFile(
    project,
    "specs/api.md",
    [
      "# API",
      "",
      "## Contract",
      "",
      "The contract points back to [Guide](../docs/guide.md).",
      "",
    ].join("\n"),
  );
  writeFile(project, "docs/private.md", "# Private\n\n[Missing](missing.md)\n");
  writeFile(project, "docs/deprecated/old.md", "# Old\n\n[Missing](missing.md)\n");
  writeFile(
    project,
    "docs/benchmark-evidence/README.md",
    "# Evidence\n\n[Missing](missing.md)\n",
  );
  writeFile(project, "system_graph.yaml", 'schema_version: "anamnesis.system_graph.v1"\n');
  writeFile(
    project,
    ".anamnesis/ontology/base.yaml",
    'schema_version: "anamnesis.enriched.v1"\n',
  );
  return project;
}

describe("context docs", () => {
  it("summarizes a deterministic Markdown document graph", () => {
    const project = setupDocsProject();

    const result = contextDocs({
      projectRoot: project,
      now: () => new Date("2026-07-09T00:00:00.000Z"),
    });

    expect(result.schema_version).toBe("anamnesis.context_docs.v1");
    expect(result.projectRoot).toBe(".");
    expect(result.catalog.path).toBe(".anamnesis/docs/catalog.yaml");
    expect(result.catalog.ontology_reference_prefixes).toEqual([
      "system_graph.yaml",
      ".anamnesis/ontology/",
    ]);
    expect(result.summary).toMatchObject({
      pages: 3,
      canonicalPages: 2,
      headings: 4,
      links: 9,
      internalLinks: 8,
      externalLinks: 1,
      brokenLinks: 2,
      backlinks: 4,
      ontologyRefs: 2,
      missingOntologyRefs: 0,
      warnings: 0,
    });

    expect(result.pages.map((page) => page.source_path)).toEqual([
      "README.md",
      "docs/guide.md",
      "specs/api.md",
    ]);
    expect(result.pages.filter((page) => page.canonical).map((page) => page.source_path)).toEqual([
      "README.md",
      "docs/guide.md",
    ]);
    expect(result.pages.map((page) => page.source_hash)).toEqual(
      result.pages.map((page) => expect.stringMatching(/^sha256:[a-f0-9]{64}$/)),
    );

    expect(
      result.headings.map((heading) => [
        heading.source_path,
        heading.stable_ref,
        heading.title,
      ]),
    ).toContainEqual(["specs/api.md", "heading:contract", "Contract"]);

    const broken = result.links
      .filter((link) => link.status === "missing" || link.status === "missing-anchor")
      .map((link) => [link.source_path, link.target, link.status]);
    expect(broken).toEqual([
      ["README.md", "docs/missing.md", "missing"],
      ["README.md", "docs/guide.md#missing-heading", "missing-anchor"],
    ]);

    expect(
      result.backlinks.map((link) => [link.target_path, link.source_path]).sort(),
    ).toEqual([
      ["README.md", "docs/guide.md"],
      ["docs/guide.md", "README.md"],
      ["docs/guide.md", "specs/api.md"],
      ["specs/api.md", "README.md"],
    ]);

    expect(
      result.ontology_refs.map((ref) => [ref.source_path, ref.target, ref.status]),
    ).toEqual([
      ["README.md", "system_graph.yaml", "ok"],
      ["docs/guide.md", ".anamnesis/ontology/base.yaml", "ok"],
    ]);
  });

  it("falls back to default roots when no catalog exists", () => {
    const project = tmpDir("anamnesis-context-docs-default-");
    writeFile(
      project,
      "README.md",
      "# Root\n\nOptional user graph: `system_graph.yaml`.\n",
    );
    writeFile(project, "docs/guide.md", "# Guide\n");
    writeFile(project, "docs/deprecated/old.md", "# Old\n");
    writeFile(project, "docs/benchmark-evidence/README.md", "# Evidence\n");

    const result = contextDocs({ projectRoot: project });

    expect(result.catalog.path).toBeUndefined();
    expect(result.catalog.roots).toEqual([
      "README.md",
      "CLAUDE.md",
      "docs",
      "specs",
    ]);
    expect(result.catalog.ontology_reference_prefixes).toEqual([
      "system_graph.yaml",
      ".anamnesis/ontology/",
    ]);
    expect(result.pages.map((page) => page.source_path)).toEqual([
      "README.md",
      "docs/guide.md",
    ]);
    expect(result.summary.missingOntologyRefs).toBe(0);
    expect(result.ontology_refs).toEqual([
      expect.objectContaining({
        target: "system_graph.yaml",
        status: "optional-missing",
      }),
    ]);
  });

  it("supports reviewed monorepo ontology reference prefixes", () => {
    const project = tmpDir("anamnesis-context-docs-prefixes-");
    writeFile(
      project,
      ".anamnesis/docs/catalog.yaml",
      [
        "roots:",
        "  - docs",
        "allowed_ontology_reference_prefixes:",
        "  - apps/api/.anamnesis/ontology/",
        "  - ../outside/",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      "docs/architecture.md",
      [
        "# Architecture",
        "",
        "The API facts live in `apps/api/.anamnesis/ontology/http.yaml`.",
        "Ordinary YAML is `config/runtime.yaml`, not ontology.",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      "apps/api/.anamnesis/ontology/http.yaml",
      'schema_version: "anamnesis.ontology.v1"\n',
    );

    const result = contextDocs({ projectRoot: project });

    expect(result.catalog.ontology_reference_prefixes).toEqual([
      "system_graph.yaml",
      ".anamnesis/ontology/",
      "apps/api/.anamnesis/ontology/",
    ]);
    expect(result.ontology_refs).toEqual([
      expect.objectContaining({
        source_path: "docs/architecture.md",
        target: "apps/api/.anamnesis/ontology/http.yaml",
        status: "ok",
      }),
    ]);
    expect(result.warnings).toEqual([
      expect.stringContaining("ignored unsafe ontology reference prefix '../outside/'"),
    ]);
  });

  it("resolves GitHub-style duplicate heading anchors", () => {
    const project = tmpDir("anamnesis-context-docs-duplicate-headings-");
    writeFile(
      project,
      "README.md",
      [
        "# Fixture",
        "",
        "[Second setup](docs/guide.md#setup-1)",
        "[Missing third](docs/guide.md#setup-2)",
        "",
      ].join("\n"),
    );
    writeFile(
      project,
      "docs/guide.md",
      ["# Guide", "", "## Setup", "", "## Setup", ""].join("\n"),
    );

    const result = contextDocs({ projectRoot: project });

    expect(
      result.links.find((link) => link.target.endsWith("#setup-1"))?.status,
    ).toBe("ok");
    expect(
      result.links.find((link) => link.target.endsWith("#setup-1"))?.resolved_ref,
    ).toBe("heading:setup:2");
    expect(
      result.links.find((link) => link.target.endsWith("#setup-2"))?.status,
    ).toBe("missing-anchor");
    expect(
      result.headings
        .filter((heading) => heading.title === "Setup")
        .map((heading) => [heading.stable_ref, heading.slug]),
    ).toEqual([
      ["heading:setup", "setup"],
      ["heading:setup:2", "setup-1"],
    ]);
  });

  it("keeps catalog files and configured document paths inside the project", () => {
    const project = tmpDir("anamnesis-context-docs-catalog-safety-");
    writeFile(project, "README.md", "# Fixture\n");
    writeFile(
      project,
      ".anamnesis/docs/catalog.yaml",
      [
        "roots: docs",
        "excludes:",
        "  - ../outside",
        "  - 42",
        "canonical_docs:",
        "  - /absolute.md",
        "",
      ].join("\n"),
    );

    const configured = contextDocs({ projectRoot: project });
    expect(configured.pages.map((page) => page.source_path)).toEqual(["README.md"]);
    expect(configured.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("'roots' must be an array of strings"),
        expect.stringContaining("'excludes' ignored non-string entries"),
        expect.stringContaining("ignored unsafe exclude path '../outside'"),
        expect.stringContaining("ignored unsafe canonical path '/absolute.md'"),
      ]),
    );

    const escaped = contextDocs({
      projectRoot: project,
      catalogPath: "../outside.yaml",
    });
    expect(escaped.catalog.path).toBeUndefined();
    expect(escaped.warnings).toEqual([
      "ignored unsafe document catalog path '../outside.yaml'",
    ]);

    const nestedEscape = contextDocs({
      projectRoot: project,
      catalogPath: "nested/../../outside.yaml",
    });
    expect(nestedEscape.catalog.path).toBeUndefined();
    expect(nestedEscape.warnings).toEqual([
      "ignored unsafe document catalog path 'nested/../../outside.yaml'",
    ]);

    const outside = tmpDir("anamnesis-context-docs-outside-catalog-");
    writeFile(outside, "catalog.yaml", "roots:\n  - README.md\n");
    const symlinkPath = path.join(project, "catalog-link.yaml");
    fs.symlinkSync(path.join(outside, "catalog.yaml"), symlinkPath);
    const symlinkEscape = contextDocs({
      projectRoot: project,
      catalogPath: "catalog-link.yaml",
    });
    expect(symlinkEscape.catalog.path).toBeUndefined();
    expect(symlinkEscape.warnings).toEqual([
      "ignored unsafe document catalog path 'catalog-link.yaml'",
    ]);
  });
});
