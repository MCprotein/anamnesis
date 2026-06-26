import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createTaskHarnessRenderer } from "./task_harness.js";
import type { FragmentDefinition } from "../core/fragments.js";
import type { RenderContext } from "../core/render.js";
import { RenderError } from "../core/render.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeContext(fragmentDir: string): RenderContext {
  const fragment: FragmentDefinition = {
    id: "base",
    version: 14,
    requires: [],
    conflicts: [],
    owns: [],
    capabilities: [],
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

describe("task_harness renderer", () => {
  it("renders a canonical repo-local task harness file", () => {
    const fragmentDir = tmpDir("anamnesis-task-harness-");
    fs.mkdirSync(path.join(fragmentDir, "task-harnesses"), { recursive: true });
    fs.writeFileSync(
      path.join(fragmentDir, "task-harnesses", "context-continuity.yaml"),
      [
        'schema_version: "anamnesis.task_harness.v1"',
        'id: "context-continuity"',
        'title: "Context continuity"',
        "",
      ].join("\n"),
      "utf8",
    );

    const actions = createTaskHarnessRenderer("codex").plan(
      {
        type: "task_harness",
        name: "context-continuity",
        source: "task-harnesses/context-continuity.yaml",
        lifecycle: "reusable",
      },
      makeContext(fragmentDir),
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "file",
      path: ".anamnesis/task-harnesses/context-continuity.yaml",
      fragmentId: "base",
      fragmentVersion: 14,
    });
    if (actions[0]?.kind === "file") {
      expect(actions[0].content).toContain("anamnesis.task_harness.v1");
      expect(actions[0].mode).toBeUndefined();
    }
  });

  it("rejects a missing task harness source", () => {
    const fragmentDir = tmpDir("anamnesis-task-harness-missing-");

    expect(() =>
      createTaskHarnessRenderer("claude-code").plan(
        {
          type: "task_harness",
          name: "context-continuity",
          source: "task-harnesses/context-continuity.yaml",
          lifecycle: "reusable",
        },
        makeContext(fragmentDir),
      ),
    ).toThrow(RenderError);
  });

  it("throws when given a non-task_harness capability", () => {
    const fragmentDir = tmpDir("anamnesis-task-harness-wrong-");

    expect(() =>
      createTaskHarnessRenderer("cursor").plan(
        { type: "ontology", source: "content/ontology.yaml" },
        makeContext(fragmentDir),
      ),
    ).toThrow(/wrong capability type/);
  });
});
