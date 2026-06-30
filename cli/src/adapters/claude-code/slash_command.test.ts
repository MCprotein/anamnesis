import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { slashCommandRenderer } from "./slash_command.js";
import { RenderError, type RenderContext } from "../../core/render.js";
import type { FragmentDefinition } from "../../core/fragments.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-cmd-"));
}

function makeContext(fragmentDir: string): RenderContext {
  const fragment: FragmentDefinition = {
    id: "base",
    version: 1,
    requires: [],
    conflicts: [],
    owns: [],
    capabilities: [
      { type: "slash_command", name: "load-context", source: "commands/load-context.md" },
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

describe("slashCommandRenderer (claude-code)", () => {
  let fragmentDir: string;

  beforeEach(() => {
    fragmentDir = tmpDir();
    fs.mkdirSync(path.join(fragmentDir, "commands"), { recursive: true });
  });

  it("emits FileAction to .claude/commands/<name>.md", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "commands", "load-context.md"),
      "# /load-context\n\nsummarize system_graph.yaml.\n",
    );
    const actions = slashCommandRenderer.plan(
      { type: "slash_command", name: "load-context", source: "commands/load-context.md" },
      makeContext(fragmentDir),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("file");
    if (actions[0]!.kind === "file") {
      expect(actions[0]!.path).toBe(".claude/commands/load-context.md");
      expect(actions[0]!.fragmentId).toBe("base");
      expect(actions[0]!.content).toContain("summarize");
    }
  });

  it("propagates declared command side effects", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "commands", "load-context.md"),
      "# /load-context\n",
    );
    const actions = slashCommandRenderer.plan(
      {
        type: "slash_command",
        name: "load-context",
        source: "commands/load-context.md",
        side_effects: ["read-only"],
      },
      makeContext(fragmentDir),
    );
    expect(actions[0]?.kind).toBe("file");
    if (actions[0]?.kind === "file") {
      expect(actions[0].sideEffects).toEqual(["read-only"]);
    }
  });

  it("throws when source is missing", () => {
    expect(() =>
      slashCommandRenderer.plan(
        { type: "slash_command", name: "x", source: "commands/missing.md" },
        makeContext(fragmentDir),
      ),
    ).toThrow(RenderError);
  });

  it("throws when given a non-slash_command capability", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "commands", "load-context.md"),
      "x\n",
    );
    expect(() =>
      slashCommandRenderer.plan(
        { type: "ontology", source: "o.yaml" },
        makeContext(fragmentDir),
      ),
    ).toThrow(/wrong capability type/);
  });
});
