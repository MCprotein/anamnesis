import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { update, UpdateError } from "./update.js";
import { init } from "./init.js";
import { readAgentfile, writeAgentfile } from "../core/agentfile.js";
import { readManifest } from "../core/manifest.js";
import { findRegion, upsertRegion } from "../core/regions.js";
import {
  EVIDENCE_LOG_PATH,
  readEvidenceRecords,
} from "../core/evidence.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Library with a `base` fragment (always-installed) plus a `prisma` fragment
 * suggested by `prisma/schema.prisma`. Mirrors the smaller fixture in
 * init.test.ts but includes base so update tests exercise the full path.
 */
function makeLibrary(opts: {
  prismaContent?: string;
  prismaVersion?: number;
} = {}): string {
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
    "## anamnesis baseline\n\nproject managed by anamnesis.\n",
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
`,
  );
  fs.writeFileSync(
    path.join(prismaDir, "content", "agents.snippet.md"),
    opts.prismaContent ?? "## Prisma\n\nrun migrate before deploy.\n",
  );

  return lib;
}

function makeAdapterOverrideLibrary(): string {
  const lib = tmpDir("anamnesis-lib-");

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

  const opsDir = path.join(lib, "fragments", "ops");
  fs.mkdirSync(path.join(opsDir, "skills", "check"), { recursive: true });
  fs.writeFileSync(
    path.join(opsDir, "fragment.yaml"),
    `id: ops
version: 1
capabilities:
  - type: skill
    name: check
    source: skills/check
`,
  );
  fs.writeFileSync(
    path.join(opsDir, "skills", "check", "SKILL.md"),
    "# check\n\nRun the project check procedure.\n",
  );

  fs.writeFileSync(path.join(lib, "rulebook.md"), "");
  return lib;
}

function addPrismaArchive(
  library: string,
  opts: { version: number; content: string },
): void {
  const archiveDir = path.join(
    library,
    "fragments",
    "prisma",
    ".versions",
    String(opts.version),
  );
  fs.mkdirSync(path.join(archiveDir, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(archiveDir, "fragment.yaml"),
    `id: prisma
version: ${opts.version}
capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: prisma
`,
  );
  fs.writeFileSync(
    path.join(archiveDir, "content", "agents.snippet.md"),
    opts.content,
  );
}

function setupPrismaProject(library: string): {
  project: string;
  library: string;
} {
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

describe("update — preconditions", () => {
  it("errors when no Agentfile is present", () => {
    const project = tmpDir("anamnesis-proj-");
    const library = makeLibrary();
    expect(() =>
      update({
        projectRoot: project,
        libraryRoot: library,
        apply: false,
        allowExecAdapters: false,
      }),
    ).toThrow(/no Agentfile found/);
  });

  it("errors when Agentfile references a fragment missing from the library", () => {
    const library = makeLibrary();
    const { project } = setupPrismaProject(library);
    // Remove prisma from the library after init.
    fs.rmSync(path.join(library, "fragments", "prisma"), { recursive: true });
    expect(() =>
      update({
        projectRoot: project,
        libraryRoot: library,
        apply: false,
        allowExecAdapters: false,
      }),
    ).toThrow(/not found in library/);
  });
});

// ---------------------------------------------------------------------------

describe("update — fresh-install re-run", () => {
  it("reports all changes as noop when nothing has drifted", () => {
    const library = makeLibrary();
    const { project } = setupPrismaProject(library);
    const result = update({
      projectRoot: project,
      libraryRoot: library,
      apply: false,
      allowExecAdapters: false,
    });
    // base + prisma → 2 region actions, both already applied → 2 noops.
    expect(result.changes.every((c) => c.status === "noop")).toBe(true);
    expect(result.writtenToDisk).toBe(false);
  });

  it("dry-run does not modify Agentfile / manifest / files", () => {
    const library = makeLibrary();
    const { project } = setupPrismaProject(library);

    const before = {
      agentfile: fs.readFileSync(path.join(project, "Agentfile"), "utf8"),
      manifest: fs.readFileSync(
        path.join(project, ".anamnesis/manifest.json"),
        "utf8",
      ),
      agentsMd: fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"),
    };

    update({
      projectRoot: project,
      libraryRoot: library,
      apply: false,
      allowExecAdapters: false,
    });

    expect(fs.readFileSync(path.join(project, "Agentfile"), "utf8")).toBe(
      before.agentfile,
    );
    expect(
      fs.readFileSync(path.join(project, ".anamnesis/manifest.json"), "utf8"),
    ).toBe(before.manifest);
    expect(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8")).toBe(
      before.agentsMd,
    );
  });
});

// ---------------------------------------------------------------------------

describe("update — library version bump", () => {
  it("classifies content change as update and bumps Agentfile on apply", () => {
    const v1Lib = makeLibrary();
    const { project } = setupPrismaProject(v1Lib);

    // Library publishes v2 of prisma with new content.
    const v2Lib = makeLibrary({
      prismaVersion: 2,
      prismaContent: "## Prisma\n\nv2 — use prisma generate after edits.\n",
    });
    // The project keeps using base from v1Lib via an explicit library path,
    // so we simply re-point update at v2Lib (single library root model).
    const evidenceBeforeDryRun = readEvidenceRecords(project);

    const dry = update({
      projectRoot: project,
      libraryRoot: v2Lib,
      apply: false,
      allowExecAdapters: false,
    });
    expect(dry.evidencePath).toBeUndefined();
    expect(readEvidenceRecords(project).total).toBe(evidenceBeforeDryRun.total);
    const prismaChange = dry.changes.find(
      (c) => c.target === "region" && c.status === "update",
    );
    expect(prismaChange).toBeDefined();

    // Apply
    const applied = update({
      projectRoot: project,
      libraryRoot: v2Lib,
      apply: true,
      allowExecAdapters: false,
      now: () => new Date("2026-05-07T12:34:56.000Z"),
    });
    expect(applied.writtenToDisk).toBe(true);
    expect(applied.evidencePath).toBe(EVIDENCE_LOG_PATH);

    const af = readAgentfile(project);
    const prismaEntry = af.fragments.find((f) => f.id === "prisma")!;
    expect(prismaEntry.version).toBe(2);

    const agentsMd = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("v2 — use prisma generate after edits");

    const evidence = readEvidenceRecords(project);
    expect(evidence.total).toBe(evidenceBeforeDryRun.total + 1);
    const updateEvidence = evidence.records.at(-1)!;
    expect(updateEvidence).toMatchObject({
      kind: "update-apply",
      generated_at: "2026-05-07T12:34:56.000Z",
      command: ["anamnesis", "update", "--apply"],
      project: { name: path.basename(project) },
      summary: {
        schema_version: "anamnesis.update_apply.v1",
        written_to_disk: true,
        changes: {
          update: 1,
          blocked: 0,
          user_modified: 0,
        },
        suggested_count: 0,
        backup: {
          created: true,
          files: 1,
          pruned: 0,
        },
        flags: {
          allow_exec_adapters: false,
          bump_pinned: false,
        },
      },
      details: {
        backup: {
          files: ["AGENTS.md"],
        },
      },
    });
    expect(updateEvidence.details?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_type: "region",
          target: "AGENTS.md#prisma",
          status: "update",
        }),
      ]),
    );
  });

  it("renders pinned fragments from archived versions and preserves Agentfile version", () => {
    const v1Lib = makeLibrary();
    const { project } = setupPrismaProject(v1Lib);
    const af = readAgentfile(project);
    af.fragments = af.fragments.map((f) =>
      f.id === "prisma" ? { ...f, pinned: true } : f,
    );
    writeAgentfile(project, af);

    const v2Lib = makeLibrary({
      prismaVersion: 2,
      prismaContent: "## Prisma\n\nv2 current content.\n",
    });
    addPrismaArchive(v2Lib, {
      version: 1,
      content: "## Prisma\n\nv1 archived content.\n",
    });

    update({
      projectRoot: project,
      libraryRoot: v2Lib,
      apply: true,
      allowExecAdapters: false,
    });

    const updated = readAgentfile(project);
    const prisma = updated.fragments.find((f) => f.id === "prisma")!;
    expect(prisma).toMatchObject({ version: 1, pinned: true });

    const agentsMd = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("v1 archived content");
    expect(agentsMd).not.toContain("v2 current content");
  });

  it("bumps pinned fragments only when --bump-pinned is set", () => {
    const v1Lib = makeLibrary();
    const { project } = setupPrismaProject(v1Lib);
    const af = readAgentfile(project);
    af.fragments = af.fragments.map((f) =>
      f.id === "prisma" ? { ...f, pinned: true } : f,
    );
    writeAgentfile(project, af);

    const v2Lib = makeLibrary({
      prismaVersion: 2,
      prismaContent: "## Prisma\n\nv2 current content.\n",
    });
    addPrismaArchive(v2Lib, {
      version: 1,
      content: "## Prisma\n\nv1 archived content.\n",
    });

    update({
      projectRoot: project,
      libraryRoot: v2Lib,
      apply: true,
      allowExecAdapters: false,
      bumpPinned: true,
    });

    const updated = readAgentfile(project);
    const prisma = updated.fragments.find((f) => f.id === "prisma")!;
    expect(prisma).toMatchObject({ version: 2, pinned: true });

    const agentsMd = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("v2 current content");
  });

  it("errors when a pinned historical version is missing from the archive", () => {
    const v1Lib = makeLibrary();
    const { project } = setupPrismaProject(v1Lib);
    const af = readAgentfile(project);
    af.fragments = af.fragments.map((f) =>
      f.id === "prisma" ? { ...f, pinned: true } : f,
    );
    writeAgentfile(project, af);

    const v2Lib = makeLibrary({
      prismaVersion: 2,
      prismaContent: "## Prisma\n\nv2 current content.\n",
    });

    expect(() =>
      update({
        projectRoot: project,
        libraryRoot: v2Lib,
        apply: false,
        allowExecAdapters: false,
      }),
    ).toThrow(/pinned fragment 'prisma@1' not found/);
  });
});

// ---------------------------------------------------------------------------

describe("update — user-modified preservation", () => {
  it("does not overwrite a region the user has edited", () => {
    const library = makeLibrary();
    const { project } = setupPrismaProject(library);

    // User edits the prisma region directly on disk.
    const agentsPath = path.join(project, "AGENTS.md");
    const original = fs.readFileSync(agentsPath, "utf8");
    const edited = upsertRegion(original, {
      id: "prisma",
      fragmentId: "prisma",
      fragmentVersion: 1,
      content: "USER HAND-EDITED — do not overwrite.",
    });
    fs.writeFileSync(agentsPath, edited);

    // Library bumps prisma. Update should detect drift and refuse to overwrite.
    const v2Lib = makeLibrary({
      prismaVersion: 2,
      prismaContent: "library v2 attempt.",
    });
    const result = update({
      projectRoot: project,
      libraryRoot: v2Lib,
      apply: true,
      allowExecAdapters: false,
    });

    const userMod = result.changes.find(
      (c) => c.target === "region" && c.status === "user-modified",
    );
    expect(userMod).toBeDefined();

    // After apply: user's text is preserved on disk.
    const afterApply = fs.readFileSync(agentsPath, "utf8");
    const region = findRegion(afterApply, "prisma");
    expect(region?.content).toContain("USER HAND-EDITED");
  });
});

// ---------------------------------------------------------------------------

describe("update — backup", () => {
  function setBackupRetention(project: string, retention: number): void {
    const af = readAgentfile(project);
    af.settings = {
      ontology_file: "system_graph.yaml",
      agents_md_path: "AGENTS.md",
      claude_md_path: "CLAUDE.md",
      commit_on_apply: false,
      backup_retention: retention,
    };
    writeAgentfile(project, af);
  }

  function writeOldBackup(
    project: string,
    name: string,
    mtime: Date,
  ): string {
    const dir = path.join(project, ".anamnesis", "backups", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENTS.md"), `backup ${name}\n`);
    fs.utimesSync(dir, mtime, mtime);
    return dir;
  }

  it("creates a timestamped backup of files about to be updated", () => {
    const v1Lib = makeLibrary();
    const { project } = setupPrismaProject(v1Lib);
    const v2Lib = makeLibrary({
      prismaVersion: 2,
      prismaContent: "library v2.",
    });

    const result = update({
      projectRoot: project,
      libraryRoot: v2Lib,
      apply: true,
      allowExecAdapters: false,
    });

    expect(result.backupDir).toBeDefined();
    expect(result.backedUpFiles).toBeDefined();
    expect(result.backedUpFiles).toContain("AGENTS.md");
    // Backup file content matches the pre-update AGENTS.md.
    const backedUp = fs.readFileSync(
      path.join(result.backupDir!, "AGENTS.md"),
      "utf8",
    );
    expect(backedUp).toContain("run migrate before deploy");
  });

  it("prunes old backup directories according to Agentfile backup_retention", () => {
    const v1Lib = makeLibrary();
    const { project } = setupPrismaProject(v1Lib);
    setBackupRetention(project, 1);
    const oldA = writeOldBackup(
      project,
      "2026-01-01T00-00-00-000Z",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const oldB = writeOldBackup(
      project,
      "2026-01-02T00-00-00-000Z",
      new Date("2026-01-02T00:00:00.000Z"),
    );
    const v2Lib = makeLibrary({
      prismaVersion: 2,
      prismaContent: "library v2.",
    });

    const result = update({
      projectRoot: project,
      libraryRoot: v2Lib,
      apply: true,
      allowExecAdapters: false,
    });

    expect(result.backedUpFiles).toContain("AGENTS.md");
    expect(result.prunedBackupDirs).toEqual([
      ".anamnesis/backups/2026-01-02T00-00-00-000Z",
      ".anamnesis/backups/2026-01-01T00-00-00-000Z",
    ]);
    expect(fs.existsSync(oldA)).toBe(false);
    expect(fs.existsSync(oldB)).toBe(false);
    expect(fs.existsSync(result.backupDir!)).toBe(true);
  });

  it("keeps all backup directories when backup_retention is 0", () => {
    const v1Lib = makeLibrary();
    const { project } = setupPrismaProject(v1Lib);
    setBackupRetention(project, 0);
    const old = writeOldBackup(
      project,
      "2026-01-01T00-00-00-000Z",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const v2Lib = makeLibrary({
      prismaVersion: 2,
      prismaContent: "library v2.",
    });

    const result = update({
      projectRoot: project,
      libraryRoot: v2Lib,
      apply: true,
      allowExecAdapters: false,
    });

    expect(result.prunedBackupDirs).toEqual([]);
    expect(fs.existsSync(old)).toBe(true);
    expect(fs.existsSync(result.backupDir!)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("update — new rulebook suggestions", () => {
  it("reports newly matching rules as `suggested`, does not auto-install", () => {
    const library = makeLibrary();
    // Project has no schema.prisma initially.
    const project = tmpDir("anamnesis-proj-");
    init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });

    // After init, user adds Prisma to their project.
    fs.mkdirSync(path.join(project, "prisma"));
    fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");

    const result = update({
      projectRoot: project,
      libraryRoot: library,
      apply: false,
      allowExecAdapters: false,
    });

    // prisma should appear in `suggested` — but NOT auto-added to changes.
    expect(result.suggested.map((r) => r.suggest)).toContain("prisma");
    const af = readAgentfile(project);
    expect(af.fragments.some((f) => f.id === "prisma")).toBe(false);
  });

  it("does not suggest a fragment listed in `declined`", () => {
    const library = makeLibrary();
    const project = tmpDir("anamnesis-proj-");
    init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });
    // Manually add a declined entry.
    const af = readAgentfile(project);
    af.declined = [{ id: "prisma", reason: "test", declined_at: "2026-01-01" }];
    fs.writeFileSync(
      path.join(project, "Agentfile"),
      JSON.stringify(af),
      "utf8",
    );
    // (writeAgentfile would prefer YAML but JSON parses too via the `yaml` lib.)

    fs.mkdirSync(path.join(project, "prisma"));
    fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");

    const result = update({
      projectRoot: project,
      libraryRoot: library,
      apply: false,
      allowExecAdapters: false,
    });
    expect(result.suggested.map((r) => r.suggest)).not.toContain("prisma");
  });
});

// ---------------------------------------------------------------------------

describe("update — Codex adapter co-existence", () => {
  it("dedupes identical region actions when both claude-code and codex active", () => {
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

    // Add codex to tools manually (init only writes claude-code).
    const af = readAgentfile(project);
    af.tools = ["claude-code", "codex"];
    writeAgentfile(project, af);

    const result = update({
      projectRoot: project,
      libraryRoot: library,
      apply: false,
      allowExecAdapters: false,
    });

    // Each tracked region should appear exactly once in changes — both
    // adapters emit the same project_memory action; dedupe collapses them.
    const regionKeys = result.changes
      .filter((c) => c.target === "region")
      .map((c) => `${c.file}|${c.regionId}`);
    const uniqueKeys = new Set(regionKeys);
    expect(regionKeys.length).toBe(uniqueKeys.size);

    // All file changes are similarly unique by path.
    const fileKeys = result.changes
      .filter((c) => c.target === "file")
      .map((c) => c.path);
    expect(fileKeys.length).toBe(new Set(fileKeys).size);
  });

  it("works with only codex in tools (no claude-code)", () => {
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
    const af = readAgentfile(project);
    af.tools = ["codex"];
    writeAgentfile(project, af);

    const result = update({
      projectRoot: project,
      libraryRoot: library,
      apply: false,
      allowExecAdapters: false,
    });
    // Codex still produces project_memory + ontology actions; everything
    // else is silently skipped because Codex doesn't register those
    // capabilities.
    expect(
      result.changes.some(
        (c) => c.target === "region" && c.regionId === "prisma",
      ),
    ).toBe(true);
  });
});

describe("update — per-fragment adapter overrides", () => {
  it("does not render root fragments on adapters disabled in Agentfile", () => {
    const library = makeAdapterOverrideLibrary();
    const project = tmpDir("anamnesis-proj-");
    fs.writeFileSync(
      path.join(project, "Agentfile"),
      `version: 1
project:
  name: adapter-overrides
tools:
  - claude-code
  - codex
  - cursor
fragments:
  - id: ops
    version: 1
    adapters:
      cursor: false
`,
    );

    const result = update({
      projectRoot: project,
      libraryRoot: library,
      apply: true,
      allowExecAdapters: true,
    });

    expect(
      result.changes.some(
        (c) => c.target === "file" && c.path === ".cursor/rules/check.mdc",
      ),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(project, ".claude/skills/check/SKILL.md")),
    ).toBe(true);
    expect(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8")).toContain(
      "codex-skill-check",
    );
    expect(
      fs.existsSync(path.join(project, ".cursor/rules/check.mdc")),
    ).toBe(false);
  });

  it("applies adapter overrides to scope fragment additions", () => {
    const library = makeAdapterOverrideLibrary();
    const project = tmpDir("anamnesis-proj-");
    fs.mkdirSync(path.join(project, "apps/web"), { recursive: true });
    fs.writeFileSync(
      path.join(project, "Agentfile"),
      `version: 1
project:
  name: adapter-overrides
  scopes:
    - path: .
    - path: apps/web
      extends: .
      overrides:
        tools:
          - cursor
        fragments_add:
          - id: ops
            version: 1
            adapters:
              cursor: false
tools:
  - cursor
fragments: []
`,
    );

    const result = update({
      projectRoot: project,
      libraryRoot: library,
      apply: true,
      allowExecAdapters: true,
    });

    expect(
      result.changes.some(
        (c) => c.target === "file" && c.path === ".cursor/rules/check.mdc",
      ),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(project, ".cursor/rules/check.mdc")),
    ).toBe(false);
  });
});

describe("update — multi-scope monorepo", () => {
  function makeMonorepoLibrary(): string {
    const lib = tmpDir("anamnesis-lib-");

    // base
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

    // nextjs (uses ontology + project_memory)
    const nextDir = path.join(lib, "fragments", "nextjs");
    fs.mkdirSync(path.join(nextDir, "content"), { recursive: true });
    fs.writeFileSync(
      path.join(nextDir, "fragment.yaml"),
      `id: nextjs
version: 1
capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: nextjs
  - type: ontology
    source: content/ontology.snippet.yaml
`,
    );
    fs.writeFileSync(
      path.join(nextDir, "content", "agents.snippet.md"),
      "## Next.js\nuse next/image.\n",
    );
    fs.writeFileSync(
      path.join(nextDir, "content", "ontology.snippet.yaml"),
      "nextjs: { router: app }\n",
    );

    // fastapi
    const fastDir = path.join(lib, "fragments", "fastapi");
    fs.mkdirSync(path.join(fastDir, "content"), { recursive: true });
    fs.writeFileSync(
      path.join(fastDir, "fragment.yaml"),
      `id: fastapi
version: 1
capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: fastapi
  - type: ontology
    source: content/ontology.snippet.yaml
`,
    );
    fs.writeFileSync(
      path.join(fastDir, "content", "agents.snippet.md"),
      "## FastAPI\nuse Depends.\n",
    );
    fs.writeFileSync(
      path.join(fastDir, "content", "ontology.snippet.yaml"),
      "fastapi: { di: Depends }\n",
    );

    // empty rulebook (we manually construct Agentfile, no auto-detect needed)
    fs.writeFileSync(path.join(lib, "rulebook.md"), "");
    return lib;
  }

  function setupMonorepo(library: string): string {
    const project = tmpDir("anamnesis-proj-");
    fs.mkdirSync(path.join(project, "apps/api"), { recursive: true });
    fs.mkdirSync(path.join(project, "apps/web"), { recursive: true });
    // Multi-scope Agentfile written by hand.
    fs.writeFileSync(
      path.join(project, "Agentfile"),
      `version: 1
project:
  name: monorepo
  scopes:
    - path: .
    - path: apps/api
      extends: .
      overrides:
        fragments_add:
          - { id: fastapi, version: 1 }
    - path: apps/web
      extends: .
      overrides:
        fragments_add:
          - { id: nextjs, version: 1 }
tools:
  - claude-code
fragments: []
`,
    );
    return project;
  }

  it("renders per-scope: base in root, fastapi in apps/api, nextjs in apps/web", () => {
    const library = makeMonorepoLibrary();
    const project = setupMonorepo(library);

    const result = update({
      projectRoot: project,
      libraryRoot: library,
      apply: true,
      allowExecAdapters: false,
    });

    expect(result.writtenToDisk).toBe(true);

    // Root AGENTS.md has anamnesis-base
    expect(
      fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"),
    ).toContain("anamnesis-base");

    // apps/api/AGENTS.md has fastapi region; apps/api/.anamnesis/ontology/fastapi.yaml exists
    expect(
      fs.readFileSync(path.join(project, "apps/api/AGENTS.md"), "utf8"),
    ).toContain("fastapi");
    expect(
      fs.existsSync(
        path.join(project, "apps/api/.anamnesis/ontology/fastapi.yaml"),
      ),
    ).toBe(true);

    // apps/web/AGENTS.md has nextjs region; apps/web/.anamnesis/ontology/nextjs.yaml exists
    expect(
      fs.readFileSync(path.join(project, "apps/web/AGENTS.md"), "utf8"),
    ).toContain("nextjs");
    expect(
      fs.existsSync(
        path.join(project, "apps/web/.anamnesis/ontology/nextjs.yaml"),
      ),
    ).toBe(true);
  });

  it("re-running update is idempotent across all scopes", () => {
    const library = makeMonorepoLibrary();
    const project = setupMonorepo(library);

    update({
      projectRoot: project,
      libraryRoot: library,
      apply: true,
      allowExecAdapters: false,
    });

    const second = update({
      projectRoot: project,
      libraryRoot: library,
      apply: false,
      allowExecAdapters: false,
    });

    // All changes (regions + ontology files in 3 scopes) should be noop on re-run.
    expect(second.changes.every((c) => c.status === "noop")).toBe(true);
  });

  it("inheritance + add: child sees inherited base AND its own fragment", () => {
    const library = makeMonorepoLibrary();
    const project = setupMonorepo(library);

    const result = update({
      projectRoot: project,
      libraryRoot: library,
      apply: true,
      allowExecAdapters: false,
    });

    // apps/api inherits base from root, adds fastapi.
    // → apps/api/AGENTS.md has both `anamnesis-base` AND `fastapi` regions.
    const apiAgents = fs.readFileSync(
      path.join(project, "apps/api/AGENTS.md"),
      "utf8",
    );
    expect(apiAgents).toContain("anamnesis-base");
    expect(apiAgents).toContain("fastapi");
    // No nextjs leak.
    expect(apiAgents).not.toContain("region id=nextjs");
  });
});

describe("update — exec-adapter gate", () => {
  it("blocks new exec-adapter writes during update without the flag", () => {
    // Library v1 has only project_memory. Library v2 adds an executable_hook.
    const v1Lib = makeLibrary();
    const { project } = setupPrismaProject(v1Lib);

    // v2 lib: add a hook capability to prisma fragment.
    const v2Lib = makeLibrary({ prismaVersion: 2 });
    const prismaDir = path.join(v2Lib, "fragments", "prisma");
    fs.mkdirSync(path.join(prismaDir, "adapters/claude-code/hooks"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(prismaDir, "adapters/claude-code/hooks/prisma.sh"),
      "#!/bin/sh\n",
    );
    fs.writeFileSync(
      path.join(prismaDir, "fragment.yaml"),
      `id: prisma
version: 2
capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: prisma
  - type: executable_hook
    event: PostToolUse:Edit
    source: adapters/claude-code/hooks/prisma.sh
    adapters_supported: [claude-code]
`,
    );

    const result = update({
      projectRoot: project,
      libraryRoot: v2Lib,
      apply: true,
      allowExecAdapters: false,
    });

    const blocked = result.changes.find((c) => c.status === "blocked");
    expect(blocked).toBeDefined();
    // Hook NOT written.
    expect(
      fs.existsSync(path.join(project, ".claude/hooks/prisma.sh")),
    ).toBe(false);
  });
});
