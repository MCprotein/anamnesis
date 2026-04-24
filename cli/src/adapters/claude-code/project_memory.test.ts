import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { projectMemoryRenderer } from "./project_memory.js";
import { RenderError, type RenderContext } from "../../core/render.js";
import type { FragmentDefinition } from "../../core/fragments.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeFragment(
  overrides: Partial<FragmentDefinition> = {},
): FragmentDefinition {
  return {
    id: "prisma",
    version: 1,
    requires: [],
    conflicts: [],
    owns: [],
    capabilities: [
      { type: "project_memory", source: "content/agents.snippet.md", region: "prisma" },
    ],
    ...overrides,
  };
}

function makeContext(
  fragmentDir: string,
  fragment = makeFragment(),
  settingsOverride: Partial<RenderContext["settings"]> = {},
): RenderContext {
  return {
    fragment,
    fragmentDir,
    projectRoot: "/tmp/project",
    settings: {
      ontology_file: "system_graph.yaml",
      agents_md_path: "AGENTS.md",
      claude_md_path: "CLAUDE.md",
      ...settingsOverride,
    },
    params: {},
  };
}

describe("projectMemoryRenderer (claude-code)", () => {
  let fragmentDir: string;

  beforeEach(() => {
    fragmentDir = tmpDir("anamnesis-pm-");
    fs.mkdirSync(path.join(fragmentDir, "content"), { recursive: true });
  });

  it("produces a RegionAction targeting AGENTS.md", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "content", "agents.snippet.md"),
      "## Prisma\nuse prisma migrate before deploy.\n",
    );
    const actions = projectMemoryRenderer.plan(
      { type: "project_memory", source: "content/agents.snippet.md", region: "prisma" },
      makeContext(fragmentDir),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("region");
    if (actions[0]!.kind === "region") {
      expect(actions[0]!.file).toBe("AGENTS.md");
      expect(actions[0]!.regionId).toBe("prisma");
      expect(actions[0]!.fragmentId).toBe("prisma");
      expect(actions[0]!.fragmentVersion).toBe(1);
      expect(actions[0]!.content).toContain("use prisma migrate");
    }
  });

  it("honors custom agents_md_path from settings", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "content", "agents.snippet.md"),
      "hello\n",
    );
    const actions = projectMemoryRenderer.plan(
      { type: "project_memory", source: "content/agents.snippet.md", region: "prisma" },
      makeContext(fragmentDir, undefined, { agents_md_path: "custom/AGENTS.md" }),
    );
    expect(actions[0]!.kind).toBe("region");
    if (actions[0]!.kind === "region") {
      expect(actions[0]!.file).toBe("custom/AGENTS.md");
    }
  });

  it("throws when source file is missing", () => {
    expect(() =>
      projectMemoryRenderer.plan(
        { type: "project_memory", source: "content/missing.md", region: "prisma" },
        makeContext(fragmentDir),
      ),
    ).toThrow(RenderError);
  });

  it("throws when given a non-project_memory capability", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "content", "agents.snippet.md"),
      "x\n",
    );
    expect(() =>
      projectMemoryRenderer.plan(
        { type: "ontology", source: "o.yaml" },
        makeContext(fragmentDir),
      ),
    ).toThrow(/wrong capability type/);
  });

  it("preserves source content byte-for-byte (passed to regions applier)", () => {
    const original = "# Section\n\n- item 1\n- item 2\n\n```ts\nconst x = 1;\n```\n";
    fs.writeFileSync(
      path.join(fragmentDir, "content", "agents.snippet.md"),
      original,
    );
    const actions = projectMemoryRenderer.plan(
      { type: "project_memory", source: "content/agents.snippet.md", region: "prisma" },
      makeContext(fragmentDir),
    );
    if (actions[0]!.kind === "region") {
      expect(actions[0]!.content).toBe(original);
    }
  });
});
