import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { emptyManifest } from "./manifest.js";
import {
  bootstrapProjectContext,
  resolveKnownSurfaceConflicts,
} from "./adoption.js";
import type { RenderAction } from "./render.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("project adoption helpers", () => {
  it("writes a conservative system_graph.yaml from safe local project signals", () => {
    const project = tmpDir("anamnesis-adoption-");
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({
        name: "slack-rag",
        description: "Slack RAG bot",
        type: "module",
        main: "dist/index.js",
        dependencies: {
          "@slack/bolt": "^4.0.0",
          "@supabase/supabase-js": "^2.0.0",
          "@aws-sdk/client-bedrock-runtime": "^3.0.0",
          "groq-sdk": "^0.1.0",
        },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf8",
    );
    fs.mkdirSync(path.join(project, "src", "slack"), { recursive: true });
    fs.mkdirSync(path.join(project, "src", "vectordb"), { recursive: true });
    fs.mkdirSync(path.join(project, "terraform"), { recursive: true });
    fs.writeFileSync(path.join(project, "terraform", "terraform.tfvars"), "token = \"secret\"\n");
    fs.writeFileSync(path.join(project, "README.md"), "# Slack RAG\n");

    const result = bootstrapProjectContext({ projectRoot: project, dryRun: false });

    expect(result).toMatchObject({
      outcome: "written",
      writtenToDisk: true,
      path: "system_graph.yaml",
    });
    expect(result.signals).toContain("package.json");
    const graph = fs.readFileSync(path.join(project, "system_graph.yaml"), "utf8");
    expect(graph).toContain("slack-bot");
    expect(graph).toContain("supabase");
    expect(graph).toContain("aws-bedrock");
    expect(graph).toContain("protect-secrets");
    expect(graph).not.toContain("token =");
    expect(graph).not.toContain("terraform.tfvars");
  });

  it("writes an open-question system_graph.yaml when no project signals exist", () => {
    const project = tmpDir("anamnesis-adoption-empty-");

    const result = bootstrapProjectContext({ projectRoot: project, dryRun: false });

    expect(result).toMatchObject({
      outcome: "written",
      writtenToDisk: true,
      path: "system_graph.yaml",
      signals: [],
    });
    const graph = parseYaml(
      fs.readFileSync(path.join(project, "system_graph.yaml"), "utf8"),
    ) as Record<string, unknown>;
    expect(graph.schema_version).toBe("anamnesis.system_graph.v1");
    expect(graph.evidence_sources).toEqual([]);
    expect(graph.entities).toBeUndefined();
    expect(graph.open_questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "project-purpose-and-entrypoints" }),
        expect.objectContaining({ id: "semantic-relationships-review" }),
      ]),
    );
  });

  it("preserves an existing project load-context skill before managed install", () => {
    const project = tmpDir("anamnesis-surface-conflict-");
    const skillDir = path.join(project, ".claude", "skills", "load-context");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# project context\n", "utf8");
    const actions: RenderAction[] = [
      {
        kind: "file",
        path: ".claude/skills/load-context/SKILL.md",
        fragmentId: "base",
        fragmentVersion: 10,
        content: "# anamnesis context\n",
      },
    ];

    const result = resolveKnownSurfaceConflicts({
      projectRoot: project,
      manifest: emptyManifest(),
      actions,
      dryRun: false,
    });

    expect(result).toEqual([
      expect.objectContaining({
        path: ".claude/skills/load-context/SKILL.md",
        preservedAs: ".claude/skills/project-load-context/SKILL.md",
        outcome: "preserved",
      }),
    ]);
    expect(
      fs.readFileSync(
        path.join(project, ".claude", "skills", "project-load-context", "SKILL.md"),
        "utf8",
      ),
    ).toContain("project context");
    expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(false);
  });
});
