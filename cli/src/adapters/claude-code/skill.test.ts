import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { skillRenderer } from "./skill.js";
import { RenderError, type RenderContext } from "../../core/render.js";
import type { FragmentDefinition } from "../../core/fragments.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-skill-"));
}

function makeContext(fragmentDir: string): RenderContext {
  const fragment: FragmentDefinition = {
    id: "prisma",
    version: 1,
    requires: [],
    conflicts: [],
    owns: [],
    capabilities: [
      { type: "skill", name: "prisma-helper", source: "skills/prisma-helper" },
    ],
  };
  return {
    fragment,
    fragmentDir,
    projectRoot: "/tmp/project",
    settings: {
      ontology_file: "system_graph.yaml",
      agents_md_path: "AGENTS.md",
      claude_md_path: "CLAUDE.md",
    },
    params: {},
  };
}

describe("skillRenderer (claude-code)", () => {
  let fragmentDir: string;

  beforeEach(() => {
    fragmentDir = tmpDir();
    fs.mkdirSync(path.join(fragmentDir, "skills/prisma-helper/refs"), {
      recursive: true,
    });
  });

  it("emits FileActions for SKILL.md and nested files", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "skills/prisma-helper/SKILL.md"),
      "# Prisma Helper\n",
    );
    fs.writeFileSync(
      path.join(fragmentDir, "skills/prisma-helper/refs/cheatsheet.md"),
      "- migrate\n",
    );
    const actions = skillRenderer.plan(
      { type: "skill", name: "prisma-helper", source: "skills/prisma-helper" },
      makeContext(fragmentDir),
    );
    const paths = actions.map((a) => (a.kind === "file" ? a.path : ""));
    expect(paths).toContain(".claude/skills/prisma-helper/SKILL.md");
    expect(paths).toContain(".claude/skills/prisma-helper/refs/cheatsheet.md");
    expect(actions).toHaveLength(2);
  });

  it("preserves content of each file", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "skills/prisma-helper/SKILL.md"),
      "# Prisma Helper\n\nbody text\n",
    );
    const actions = skillRenderer.plan(
      { type: "skill", name: "prisma-helper", source: "skills/prisma-helper" },
      makeContext(fragmentDir),
    );
    const skillMd = actions.find(
      (a) => a.kind === "file" && a.path.endsWith("SKILL.md"),
    );
    expect(skillMd?.kind).toBe("file");
    if (skillMd?.kind === "file") {
      expect(skillMd.content).toContain("body text");
    }
  });

  it("throws when SKILL.md is missing", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "skills/prisma-helper/other.md"),
      "x\n",
    );
    expect(() =>
      skillRenderer.plan(
        { type: "skill", name: "prisma-helper", source: "skills/prisma-helper" },
        makeContext(fragmentDir),
      ),
    ).toThrow(/missing SKILL\.md/);
  });

  it("throws when source is not a directory", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "skills/not-a-dir"),
      "just a file",
    );
    expect(() =>
      skillRenderer.plan(
        { type: "skill", name: "nope", source: "skills/not-a-dir" },
        makeContext(fragmentDir),
      ),
    ).toThrow(/must be a directory/);
  });

  it("throws when source does not exist", () => {
    expect(() =>
      skillRenderer.plan(
        { type: "skill", name: "ghost", source: "skills/ghost" },
        makeContext(fragmentDir),
      ),
    ).toThrow(/not found/);
  });
});
