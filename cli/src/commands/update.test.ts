import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { update, UpdateError } from "./update.js";
import { init } from "./init.js";
import { readAgentfile } from "../core/agentfile.js";
import { readManifest } from "../core/manifest.js";
import { findRegion, upsertRegion } from "../core/regions.js";

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

    const dry = update({
      projectRoot: project,
      libraryRoot: v2Lib,
      apply: false,
      allowExecAdapters: false,
    });
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
    });
    expect(applied.writtenToDisk).toBe(true);

    const af = readAgentfile(project);
    const prismaEntry = af.fragments.find((f) => f.id === "prisma")!;
    expect(prismaEntry.version).toBe(2);

    const agentsMd = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("v2 — use prisma generate after edits");
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
