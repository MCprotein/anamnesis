import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { status, StatusError } from "./status.js";
import { init } from "./init.js";
import { writeAgentfile, readAgentfile } from "../core/agentfile.js";
import { upsertRegion } from "../core/regions.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Library with a `base` fragment + `prisma` fragment with a project_memory
 * region. Mirrors the smaller fixture pattern from update.test.ts.
 */
function makeLibrary(opts: { prismaVersion?: number; prismaContent?: string } = {}): string {
  const lib = tmpDir("anamnesis-lib-");

  // base/
  const baseDir = path.join(lib, "base");
  fs.mkdirSync(path.join(baseDir, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(baseDir, "fragment.yaml"),
    `id: base
version: 1
capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: anamnesis-base
`,
  );
  fs.writeFileSync(
    path.join(baseDir, "content", "agents.snippet.md"),
    "## anamnesis baseline\n",
  );

  // rulebook
  fs.writeFileSync(
    path.join(lib, "rulebook.md"),
    `## prisma
- trigger: \`file_exists: prisma/schema.prisma\`
- suggest: fragments/prisma
- reason: test fixture.
`,
  );

  // prisma/
  const prismaDir = path.join(lib, "fragments", "prisma");
  fs.mkdirSync(path.join(prismaDir, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(prismaDir, "fragment.yaml"),
    `id: prisma
version: ${opts.prismaVersion ?? 1}
capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: prisma
  - type: ontology
    source: content/ontology.snippet.yaml
`,
  );
  fs.writeFileSync(
    path.join(prismaDir, "content", "agents.snippet.md"),
    opts.prismaContent ?? "## Prisma\n\nrun migrate before deploy.\n",
  );
  fs.writeFileSync(
    path.join(prismaDir, "content", "ontology.snippet.yaml"),
    "prisma:\n  source: schema.prisma\n",
  );

  return lib;
}

function setupFreshlyInstalled(): { project: string; library: string } {
  const library = makeLibrary();
  const project = tmpDir("anamnesis-proj-");
  fs.mkdirSync(path.join(project, "prisma"));
  fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");
  init({
    projectRoot: project,
    libraryRoot: library,
    dryRun: false,
    allowExecAdapters: false,
  });
  return { project, library };
}

// ---------------------------------------------------------------------------

describe("status — preconditions", () => {
  it("errors when no Agentfile is present", () => {
    const project = tmpDir("anamnesis-proj-");
    const library = makeLibrary();
    expect(() =>
      status({ projectRoot: project, libraryRoot: library }),
    ).toThrow(/no Agentfile found/);
  });
});

// ---------------------------------------------------------------------------

describe("status — fresh-install state", () => {
  it("classifies all fragments as in-sync and all entries as clean", () => {
    const { project, library } = setupFreshlyInstalled();
    const r = status({ projectRoot: project, libraryRoot: library });
    expect(r.fragments.map((f) => f.status)).toEqual(["base", "prisma"].map(() => "in-sync"));
    expect(r.entries.every((e) => e.drift === "clean")).toBe(true);
    expect(r.suggested).toEqual([]);
    expect(r.declined).toEqual([]);
  });

  it("summary reflects clean state", () => {
    const { project, library } = setupFreshlyInstalled();
    const r = status({ projectRoot: project, libraryRoot: library });
    expect(r.summary.fragmentTotal).toBe(2);
    expect(r.summary.fragmentUpdatesAvailable).toBe(0);
    expect(r.summary.entriesUserModified).toBe(0);
    expect(r.summary.entriesMissing).toBe(0);
    expect(r.summary.suggestedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("status — library version drift", () => {
  it("flags update-available when library bumps a fragment", () => {
    const { project } = setupFreshlyInstalled();
    const v2Lib = makeLibrary({ prismaVersion: 2 });
    const r = status({ projectRoot: project, libraryRoot: v2Lib });
    const prisma = r.fragments.find((f) => f.id === "prisma")!;
    expect(prisma.status).toBe("update-available");
    expect(prisma.installedVersion).toBe(1);
    expect(prisma.libraryVersion).toBe(2);
    expect(r.summary.fragmentUpdatesAvailable).toBe(1);
  });

  it("flags pinned and does NOT show update", () => {
    const { project } = setupFreshlyInstalled();
    // Pin the prisma fragment in Agentfile.
    const af = readAgentfile(project);
    af.fragments = af.fragments.map((f) =>
      f.id === "prisma" ? { ...f, pinned: true } : f,
    );
    writeAgentfile(project, af);

    const v2Lib = makeLibrary({ prismaVersion: 2 });
    const r = status({ projectRoot: project, libraryRoot: v2Lib });
    const prisma = r.fragments.find((f) => f.id === "prisma")!;
    expect(prisma.status).toBe("pinned");
    expect(r.summary.fragmentUpdatesAvailable).toBe(0);
    expect(r.summary.fragmentPinned).toBe(1);
  });

  it("flags library-missing when fragment removed from library", () => {
    const { project, library } = setupFreshlyInstalled();
    fs.rmSync(path.join(library, "fragments", "prisma"), { recursive: true });
    const r = status({ projectRoot: project, libraryRoot: library });
    const prisma = r.fragments.find((f) => f.id === "prisma")!;
    expect(prisma.status).toBe("library-missing");
    expect(prisma.libraryVersion).toBeNull();
    expect(r.summary.fragmentLibraryMissing).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("status — entry drift", () => {
  it("detects user-modified region", () => {
    const { project, library } = setupFreshlyInstalled();
    const fp = path.join(project, "AGENTS.md");
    const original = fs.readFileSync(fp, "utf8");
    const edited = upsertRegion(original, {
      id: "prisma",
      fragmentId: "prisma",
      fragmentVersion: 1,
      content: "USER EDITED",
    });
    fs.writeFileSync(fp, edited);

    const r = status({ projectRoot: project, libraryRoot: library });
    const prismaRegion = r.entries.find(
      (e) => e.target === "region" && e.regionId === "prisma",
    );
    expect(prismaRegion?.drift).toBe("user-modified");
    expect(r.summary.entriesUserModified).toBe(1);
  });

  it("detects missing region (file deleted)", () => {
    const { project, library } = setupFreshlyInstalled();
    fs.unlinkSync(path.join(project, "AGENTS.md"));
    const r = status({ projectRoot: project, libraryRoot: library });
    const regions = r.entries.filter((e) => e.target === "region");
    expect(regions.every((e) => e.drift === "missing")).toBe(true);
    expect(r.summary.entriesMissing).toBeGreaterThanOrEqual(2);
  });

  it("detects user-modified file", () => {
    const { project, library } = setupFreshlyInstalled();
    const ontologyPath = path.join(project, ".anamnesis/ontology/prisma.yaml");
    fs.writeFileSync(ontologyPath, "user: modification");
    const r = status({ projectRoot: project, libraryRoot: library });
    const file = r.entries.find(
      (e) => e.target === "file" && e.path.endsWith("prisma.yaml"),
    );
    expect(file?.drift).toBe("user-modified");
  });
});

// ---------------------------------------------------------------------------

describe("status — suggested rulebook matches", () => {
  it("reports new rulebook matches not yet in Agentfile", () => {
    const library = makeLibrary();
    const project = tmpDir("anamnesis-proj-");
    init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });
    // Add prisma trigger AFTER init.
    fs.mkdirSync(path.join(project, "prisma"));
    fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");

    const r = status({ projectRoot: project, libraryRoot: library });
    expect(r.suggested.map((s) => s.suggest)).toContain("prisma");
    expect(r.summary.suggestedCount).toBeGreaterThanOrEqual(1);
  });

  it("does not suggest fragments listed in declined", () => {
    const library = makeLibrary();
    const project = tmpDir("anamnesis-proj-");
    init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });
    const af = readAgentfile(project);
    af.declined = [
      { id: "prisma", reason: "test", declined_at: "2026-01-01" },
    ];
    writeAgentfile(project, af);

    fs.mkdirSync(path.join(project, "prisma"));
    fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");

    const r = status({ projectRoot: project, libraryRoot: library });
    expect(r.suggested.map((s) => s.suggest)).not.toContain("prisma");
    expect(r.declined.map((d) => d.id)).toContain("prisma");
    expect(r.summary.declinedCount).toBe(1);
  });
});
