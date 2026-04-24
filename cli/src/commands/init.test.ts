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
 */
function makeLibrary(): string {
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

    // Manifest tracks the region.
    const m = readManifest(project);
    expect(m.regions).toHaveLength(1);
    expect(m.regions[0]!.fragment_id).toBe("prisma");
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
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.status).toBe("create");

    // Nothing on disk.
    expect(fs.existsSync(path.join(project, "Agentfile"))).toBe(false);
    expect(fs.existsSync(path.join(project, "AGENTS.md"))).toBe(false);
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
