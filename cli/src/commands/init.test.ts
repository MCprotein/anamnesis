import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { init, InitError, summarizeChanges } from "./init.js";
import { readAgentfile } from "../core/agentfile.js";
import { readManifest } from "../core/manifest.js";
import { findRegion } from "../core/regions.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Build a minimal anamnesis library with a `prisma` fragment and a
 * rulebook that suggests it when `prisma/schema.prisma` exists.
 *
 * If `withBase` is true, also creates a `base/` fragment that init() will
 * auto-include.
 */
function makeLibrary(opts: { withBase?: boolean } = {}): string {
  const lib = tmpDir("anamnesis-lib-");

  // Rulebook with one rule → prisma fragment.
  fs.writeFileSync(
    path.join(lib, "rulebook.md"),
    `## prisma
- trigger: \`file_exists: prisma/schema.prisma\`
- suggest: fragments/prisma
- reason: test fixture.
`,
  );

  // Fragment with project_memory capability.
  const prismaDir = path.join(lib, "fragments", "prisma");
  fs.mkdirSync(path.join(prismaDir, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(prismaDir, "fragment.yaml"),
    `id: prisma
version: 1
capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: prisma
`,
  );
  fs.writeFileSync(
    path.join(prismaDir, "content", "agents.snippet.md"),
    "## Prisma\n\nrun `prisma migrate deploy` before production rollout.\n",
  );

  if (opts.withBase) {
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
  }

  return lib;
}

describe("init", () => {
  let project: string;
  let library: string;

  beforeEach(() => {
    project = tmpDir("anamnesis-proj-");
    library = makeLibrary();
  });

  it("creates an empty Agentfile when no rules match", () => {
    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });
    expect(result.selectedFragments).toHaveLength(0);
    expect(result.changes).toHaveLength(0);

    const af = readAgentfile(project);
    expect(af.fragments).toHaveLength(0);
    expect(af.tools).toEqual(["claude-code"]);

    const m = readManifest(project);
    expect(m.regions).toHaveLength(0);
    expect(m.files).toHaveLength(0);
  });

  it("honors an explicit first-install tool list", () => {
    const withBase = makeLibrary({ withBase: true });
    const result = init({
      projectRoot: project,
      libraryRoot: withBase,
      dryRun: false,
      allowExecAdapters: false,
      tools: ["codex", "cursor"],
    });

    expect(result.agentfile.tools).toEqual(["codex", "cursor"]);
    const af = readAgentfile(project);
    expect(af.tools).toEqual(["codex", "cursor"]);
    expect(fs.existsSync(path.join(project, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(project, "CLAUDE.md"))).toBe(false);
  });

  it("can install all current adapter surfaces during init", () => {
    const result = init({
      projectRoot: project,
      libraryRoot: process.cwd(),
      dryRun: false,
      allowExecAdapters: true,
      tools: ["claude-code", "codex", "cursor"],
      noBootstrap: true,
    });

    expect(result.agentfile.tools).toEqual(["claude-code", "codex", "cursor"]);
    const af = readAgentfile(project);
    expect(af.tools).toEqual(["claude-code", "codex", "cursor"]);
    expect(fs.existsSync(path.join(project, "CLAUDE.md"))).toBe(true);
    expect(
      fs.existsSync(path.join(project, ".claude/commands/handoff-prepare.md")),
    ).toBe(true);

    const agentsMd = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("codex-cmd-handoff-prepare");
    expect(agentsMd).toContain("codex-skill-ontology-enrich");
    expect(
      fs.existsSync(path.join(project, ".cursor/rules/handoff-prepare-cmd.mdc")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(project, ".cursor/rules/ontology-enrich.mdc")),
    ).toBe(true);
  });

  it("installs a matching fragment end-to-end", () => {
    // Make the project look like a prisma project.
    fs.mkdirSync(path.join(project, "prisma"));
    fs.writeFileSync(
      path.join(project, "prisma", "schema.prisma"),
      "generator client { provider = \"prisma-client-js\" }\n",
    );

    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });

    expect(result.selectedFragments).toHaveLength(1);
    expect(result.selectedFragments[0]!.id).toBe("prisma");
    expect(result.writtenToDisk).toBe(true);

    // Agentfile has the installed fragment.
    const af = readAgentfile(project);
    expect(af.fragments).toEqual([{ id: "prisma", version: 1 }]);

    // AGENTS.md has the region with snippet content.
    const agentsMd = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("anamnesis:region id=prisma fragment=prisma@1");
    expect(findRegion(agentsMd, "prisma")?.content).toContain(
      "prisma migrate deploy",
    );
    const claudeMd = fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain(
      "anamnesis:region id=anamnesis-claude-code-entrypoint",
    );
    expect(claudeMd).toContain("`AGENTS.md` is the canonical");
    expect(claudeMd).toContain("/ontology-enrich");

    // Manifest tracks the region.
    const m = readManifest(project);
    expect(m.regions).toHaveLength(2);
    expect(m.regions[0]!.fragment_id).toBe("prisma");
  });

  it("adds the Claude Code entrypoint without overwriting existing CLAUDE.md prose", () => {
    fs.mkdirSync(path.join(project, "prisma"));
    fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");
    fs.writeFileSync(
      path.join(project, "CLAUDE.md"),
      "# Existing Claude notes\n\nKeep this sentence.\n",
    );

    init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });

    const claudeMd = fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("Keep this sentence.");
    expect(claudeMd).toContain(
      "anamnesis:region id=anamnesis-claude-code-entrypoint",
    );
  });

  it("dry-run does not write any files", () => {
    fs.mkdirSync(path.join(project, "prisma"));
    fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");

    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: true,
      allowExecAdapters: false,
    });

    expect(result.writtenToDisk).toBe(false);
    expect(result.changes).toHaveLength(2);
    expect(result.changes.every((change) => change.status === "create")).toBe(
      true,
    );

    // Nothing on disk.
    expect(fs.existsSync(path.join(project, "Agentfile"))).toBe(false);
    expect(fs.existsSync(path.join(project, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(project, "CLAUDE.md"))).toBe(false);
    expect(
      fs.existsSync(path.join(project, ".anamnesis/manifest.json")),
    ).toBe(false);
  });

  it("refuses when Agentfile already exists", () => {
    fs.writeFileSync(
      path.join(project, "Agentfile"),
      "version: 1\nproject: { name: x }\ntools: [claude-code]\nfragments: []\n",
    );
    expect(() =>
      init({
        projectRoot: project,
        libraryRoot: library,
        dryRun: false,
        allowExecAdapters: false,
      }),
    ).toThrow(/already present/);
  });

  it("errors when rulebook suggests a fragment missing from the library", () => {
    // Re-write rulebook to reference a nonexistent fragment.
    fs.writeFileSync(
      path.join(library, "rulebook.md"),
      `## ghost
- trigger: \`file_exists: package.json\`
- suggest: fragments/ghost
- reason: test.
`,
    );
    fs.writeFileSync(path.join(project, "package.json"), "{}");

    expect(() =>
      init({
        projectRoot: project,
        libraryRoot: library,
        dryRun: false,
        allowExecAdapters: false,
      }),
    ).toThrow(/not found in library/);
  });

  it("uses directory basename as default project name", () => {
    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });
    expect(result.agentfile.project.name).toBe(path.basename(project));
  });

  it("honors an explicit projectName override", () => {
    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
      projectName: "my-custom-name",
    });
    expect(result.agentfile.project.name).toBe("my-custom-name");
    const af = readAgentfile(project);
    expect(af.project.name).toBe("my-custom-name");
  });

  it("exec-adapter paths are blocked without the flag", () => {
    // Extend the library with a hook capability that would land in .claude/hooks.
    const prismaDir = path.join(library, "fragments", "prisma");
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
version: 1
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
    fs.mkdirSync(path.join(project, "prisma"));
    fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");

    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });

    const blocked = result.changes.find((c) => c.status === "blocked");
    expect(blocked).toBeDefined();
    // Hook was NOT written.
    expect(
      fs.existsSync(path.join(project, ".claude/hooks/prisma.sh")),
    ).toBe(false);
    // But AGENTS.md region was still written (non-exec capability).
    expect(fs.existsSync(path.join(project, "AGENTS.md"))).toBe(true);
  });

  it("allows exec-adapter writes with allowExecAdapters=true", () => {
    const prismaDir = path.join(library, "fragments", "prisma");
    fs.mkdirSync(path.join(prismaDir, "adapters/claude-code/hooks"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(prismaDir, "adapters/claude-code/hooks/prisma.sh"),
      "#!/bin/sh\necho hi\n",
    );
    fs.writeFileSync(
      path.join(prismaDir, "fragment.yaml"),
      `id: prisma
version: 1
capabilities:
  - type: executable_hook
    event: PostToolUse:Edit
    source: adapters/claude-code/hooks/prisma.sh
    adapters_supported: [claude-code]
`,
    );
    fs.mkdirSync(path.join(project, "prisma"));
    fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");

    init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: true,
    });

    const fp = path.join(project, ".claude/hooks/prisma.sh");
    expect(fs.existsSync(fp)).toBe(true);
    const mode = fs.statSync(fp).mode & 0o777;
    expect(mode).toBe(0o755);
  });
});

describe("init — base fragment auto-inclusion", () => {
  let project: string;
  let library: string;

  beforeEach(() => {
    project = tmpDir("anamnesis-proj-");
    library = makeLibrary({ withBase: true });
  });

  it("includes base fragment even when no rules match", () => {
    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });
    expect(result.selectedFragments.map((f) => f.id)).toEqual(["base"]);
    const af = readAgentfile(project);
    expect(af.fragments).toEqual([{ id: "base", version: 1 }]);
    const agentsMd = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("anamnesis baseline");
  });

  it("includes base + rule-matched fragments together", () => {
    fs.mkdirSync(path.join(project, "prisma"));
    fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");
    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });
    const ids = result.selectedFragments.map((f) => f.id);
    expect(ids).toContain("base");
    expect(ids).toContain("prisma");
    // base must come first (no requires/conflicts; ordering preserved).
    expect(ids[0]).toBe("base");
    const agentsMd = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("anamnesis baseline");
    expect(agentsMd).toContain("prisma migrate deploy");
  });

  it("does not include base if a rule explicitly suggests it (no double-add)", () => {
    // Edge: someone adds a `## base` rule. Selection must dedupe.
    fs.appendFileSync(
      path.join(library, "rulebook.md"),
      `\n## base-rule\n- trigger: \`file_exists: package.json\`\n- suggest: fragments/base\n- reason: test.\n`,
    );
    fs.writeFileSync(path.join(project, "package.json"), "{}");
    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });
    const baseCount = result.selectedFragments.filter(
      (f) => f.id === "base",
    ).length;
    expect(baseCount).toBe(1);
  });

  it("works without a base/ directory (back-compat)", () => {
    const noBaseLib = makeLibrary({ withBase: false });
    const result = init({
      projectRoot: project,
      libraryRoot: noBaseLib,
      dryRun: false,
      allowExecAdapters: false,
    });
    expect(result.selectedFragments).toHaveLength(0);
  });
});

describe("init — monorepo detection (--monorepo)", () => {
  let library: string;
  let project: string;

  beforeEach(() => {
    library = makeLibrary({ withBase: true });
    project = tmpDir("anamnesis-monorepo-");
  });

  function writePackageJson(
    dir: string,
    body: Record<string, unknown>,
  ): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(body, null, 2),
    );
  }

  it("falls back to single-scope when no monorepo declaration present", () => {
    fs.mkdirSync(path.join(project, "prisma"));
    fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");
    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
      monorepo: true, // requested but not present
    });
    expect(result.monorepoDetection?.isMonorepo).toBe(false);
    expect(result.agentfile.project.scopes).toBeUndefined();
  });

  it("builds multi-scope Agentfile from package.json workspaces", () => {
    writePackageJson(project, {
      name: "monorepo",
      workspaces: ["apps/*"],
    });
    // sub-project that triggers prisma rule (the test fixture's only rule)
    writePackageJson(path.join(project, "apps/api"), {
      name: "api",
      dependencies: { "@prisma/client": "^5" },
    });
    fs.mkdirSync(path.join(project, "apps/api/prisma"));
    fs.writeFileSync(
      path.join(project, "apps/api/prisma/schema.prisma"),
      "",
    );

    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
      monorepo: true,
    });

    expect(result.monorepoDetection?.isMonorepo).toBe(true);
    expect(result.agentfile.project.scopes).toBeDefined();
    expect(result.agentfile.project.scopes!.map((s) => s.path)).toEqual([
      ".",
      "apps/api",
    ]);

    // apps/api scope has fragments_add: prisma
    const apiScope = result.agentfile.project.scopes!.find(
      (s) => s.path === "apps/api",
    )!;
    expect(apiScope.extends).toBe(".");
    expect(apiScope.overrides?.fragments_add).toEqual([
      { id: "prisma", version: 1 },
    ]);
  });

  it("renders per-scope project_memory regions on disk", () => {
    writePackageJson(project, {
      name: "monorepo",
      workspaces: ["apps/*"],
    });
    writePackageJson(path.join(project, "apps/api"), {
      name: "api",
      dependencies: { "@prisma/client": "^5" },
    });
    fs.mkdirSync(path.join(project, "apps/api/prisma"));
    fs.writeFileSync(
      path.join(project, "apps/api/prisma/schema.prisma"),
      "",
    );

    init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
      monorepo: true,
    });

    // Root AGENTS.md has anamnesis-base region (and not prisma).
    const rootAgents = fs.readFileSync(
      path.join(project, "AGENTS.md"),
      "utf8",
    );
    expect(rootAgents).toContain("anamnesis-base");

    // apps/api/AGENTS.md has prisma region (per-scope).
    const apiAgents = fs.readFileSync(
      path.join(project, "apps/api/AGENTS.md"),
      "utf8",
    );
    expect(apiAgents).toContain("prisma");

    const rootClaude = fs.readFileSync(
      path.join(project, "CLAUDE.md"),
      "utf8",
    );
    expect(rootClaude).toContain("Claude Code entrypoint");
    const apiClaude = fs.readFileSync(
      path.join(project, "apps/api/CLAUDE.md"),
      "utf8",
    );
    expect(apiClaude).toContain("Claude Code entrypoint");
  });

  it("reports empty workspace dirs (no rule match) without installing", () => {
    writePackageJson(project, {
      name: "monorepo",
      workspaces: ["libs/*"],
    });
    writePackageJson(path.join(project, "libs/shared"), {
      name: "shared",
      dependencies: { lodash: "^4" }, // no fixture rule matches
    });

    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
      monorepo: true,
    });

    expect(result.monorepoDetection?.scopes).toEqual([]);
    expect(result.monorepoDetection?.emptyScopes).toEqual(["libs/shared"]);
    // Agentfile has NO scopes section (since no scope had matches).
    expect(result.agentfile.project.scopes).toBeUndefined();
  });

  it("avoids double-installing fragments already at root", () => {
    // Root has prisma trigger AND a sub-app also has it.
    fs.mkdirSync(path.join(project, "prisma"));
    fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");

    writePackageJson(project, {
      name: "monorepo",
      workspaces: ["apps/*"],
    });
    writePackageJson(path.join(project, "apps/api"), {
      name: "api",
      dependencies: { "@prisma/client": "^5" },
    });
    fs.mkdirSync(path.join(project, "apps/api/prisma"));
    fs.writeFileSync(
      path.join(project, "apps/api/prisma/schema.prisma"),
      "",
    );

    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
      monorepo: true,
    });

    // Root scope has prisma. Sub-scope inherits it via extends — no need
    // for fragments_add on the sub-scope (de-dup logic).
    const apiScope = result.agentfile.project.scopes!.find(
      (s) => s.path === "apps/api",
    )!;
    expect(apiScope.overrides?.fragments_add ?? []).toEqual([]);
  });
});

describe("summarizeChanges", () => {
  it("counts each status bucket", () => {
    const changes = [
      { target: "region", status: "create" } as never,
      { target: "file", status: "create" } as never,
      { target: "region", status: "update" } as never,
      { target: "file", status: "noop" } as never,
      { target: "file", status: "blocked" } as never,
      { target: "region", status: "user-modified" } as never,
    ];
    expect(summarizeChanges(changes)).toEqual({
      create: 2,
      update: 1,
      noop: 1,
      blocked: 1,
      userModified: 1,
    });
  });
});

describe("init — auto-bootstrap (Layer A)", () => {
  let project: string;
  let library: string;

  beforeEach(() => {
    project = tmpDir("anamnesis-proj-bootstrap-");
    library = makeLibrary();
    // Trigger prisma rule + give the prisma introspector something to parse.
    fs.mkdirSync(path.join(project, "prisma"), { recursive: true });
    fs.writeFileSync(
      path.join(project, "prisma", "schema.prisma"),
      `datasource db {
  provider = "postgresql"
}

model User {
  id Int @id
}
`,
      "utf8",
    );
  });

  it("runs ontology bootstrap by default and writes <id>.bootstrap.yaml", () => {
    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });
    expect(result.bootstrapError).toBeUndefined();
    expect(result.bootstrapResult).toBeDefined();
    const prismaEntry = result.bootstrapResult!.entries.find(
      (e) => e.fragmentId === "prisma",
    );
    expect(prismaEntry?.outcome).toBe("written");
    expect(
      fs.existsSync(
        path.join(project, ".anamnesis", "ontology", "prisma.bootstrap.yaml"),
      ),
    ).toBe(true);
  });

  it("skips bootstrap when noBootstrap=true", () => {
    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
      noBootstrap: true,
    });
    expect(result.bootstrapResult).toBeUndefined();
    expect(result.bootstrapError).toBeUndefined();
    expect(
      fs.existsSync(
        path.join(project, ".anamnesis", "ontology", "prisma.bootstrap.yaml"),
      ),
    ).toBe(false);
  });

  it("skips bootstrap on dry-run even without noBootstrap", () => {
    const result = init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: true,
      allowExecAdapters: false,
    });
    expect(result.bootstrapResult).toBeUndefined();
    expect(
      fs.existsSync(
        path.join(project, ".anamnesis", "ontology", "prisma.bootstrap.yaml"),
      ),
    ).toBe(false);
  });
});
