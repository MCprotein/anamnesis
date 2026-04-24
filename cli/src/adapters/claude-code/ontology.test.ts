import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ontologyRenderer } from "./ontology.js";
import { RenderError, type RenderContext } from "../../core/render.js";
import type { FragmentDefinition } from "../../core/fragments.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-ont-"));
}

function makeContext(
  fragmentDir: string,
  fragment: FragmentDefinition = {
    id: "k8s",
    version: 2,
    requires: [],
    conflicts: [],
    owns: [],
    capabilities: [{ type: "ontology", source: "content/ontology.snippet.yaml" }],
  },
): RenderContext {
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

describe("ontologyRenderer (claude-code)", () => {
  let fragmentDir: string;

  beforeEach(() => {
    fragmentDir = tmpDir();
    fs.mkdirSync(path.join(fragmentDir, "content"), { recursive: true });
  });

  it("emits FileAction under .anamnesis/ontology/<fragment-id>.yaml", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "content", "ontology.snippet.yaml"),
      "kubernetes:\n  namespace_style: workload-per-namespace\n",
    );
    const actions = ontologyRenderer.plan(
      { type: "ontology", source: "content/ontology.snippet.yaml" },
      makeContext(fragmentDir),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]!.kind).toBe("file");
    if (actions[0]!.kind === "file") {
      expect(actions[0]!.path).toBe(".anamnesis/ontology/k8s.yaml");
      expect(actions[0]!.fragmentId).toBe("k8s");
      expect(actions[0]!.fragmentVersion).toBe(2);
      expect(actions[0]!.content).toContain("workload-per-namespace");
    }
  });

  it("throws when source file is missing", () => {
    expect(() =>
      ontologyRenderer.plan(
        { type: "ontology", source: "content/missing.yaml" },
        makeContext(fragmentDir),
      ),
    ).toThrow(RenderError);
  });

  it("throws when given a non-ontology capability", () => {
    fs.writeFileSync(
      path.join(fragmentDir, "content", "ontology.snippet.yaml"),
      "k: v\n",
    );
    expect(() =>
      ontologyRenderer.plan(
        { type: "skill", name: "x", source: "s" },
        makeContext(fragmentDir),
      ),
    ).toThrow(/wrong capability type/);
  });
});
