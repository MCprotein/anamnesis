import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  collectGenerationBoundaryStatus,
  formatBootstrapGenerationBoundaryLines,
  formatGenerationBoundaryLines,
} from "./generation-boundary.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-boundary-"));
}

function write(root: string, rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, "utf8");
}

describe("generation boundary guidance", () => {
  it("classifies CLI-generated and agent-generated ontology files", () => {
    const root = tmpProject();
    write(
      root,
      "AGENTS.md",
      "<!-- anamnesis:region id=anamnesis-base fragment=base@6 -->\nmanaged\n<!-- /anamnesis:region -->\n",
    );
    write(
      root,
      "CLAUDE.md",
      "<!-- anamnesis:region id=anamnesis-claude-code-entrypoint fragment=anamnesis-claude-code@1 -->\nmanaged\n<!-- /anamnesis:region -->\n",
    );
    write(root, ".anamnesis/ontology/base.yaml", "managed_by: anamnesis\n");
    write(root, ".anamnesis/ontology/k8s.bootstrap.yaml", "services: []\n");
    write(root, ".anamnesis/ontology/k8s.enriched.yaml", "flows: []\n");
    write(root, ".anamnesis/handoff/active.md", "# active\n");
    write(
      root,
      ".anamnesis/backups/old/.anamnesis/ontology/ignored.bootstrap.yaml",
      "ignored: true\n",
    );

    const status = collectGenerationBoundaryStatus(root);

    expect(status.hasManagedAgentsMd).toBe(true);
    expect(status.hasManagedClaudeMd).toBe(true);
    expect(status.staticOntologyFiles).toEqual([
      ".anamnesis/ontology/base.yaml",
    ]);
    expect(status.bootstrapOntologyFiles).toEqual([
      ".anamnesis/ontology/k8s.bootstrap.yaml",
    ]);
    expect(status.enrichedOntologyFiles).toEqual([
      ".anamnesis/ontology/k8s.enriched.yaml",
    ]);
    expect(status.hasActiveHandoff).toBe(true);
  });

  it("formats next steps when semantic ontology is missing", () => {
    const lines = formatGenerationBoundaryLines({
      hasManagedAgentsMd: true,
      hasManagedClaudeMd: true,
      staticOntologyFiles: [".anamnesis/ontology/base.yaml"],
      bootstrapOntologyFiles: [".anamnesis/ontology/k8s.bootstrap.yaml"],
      enrichedOntologyFiles: [],
      hasActiveHandoff: false,
    });

    expect(lines.join("\n")).toContain("cli-generated");
    expect(lines.join("\n")).toContain("agent-required");
    expect(lines.join("\n")).toContain("/ontology-enrich");
    expect(lines.join("\n")).toContain("/handoff-prepare");
  });

  it("formats bootstrap as Layer A facts only", () => {
    const lines = formatBootstrapGenerationBoundaryLines({
      writtenToDisk: true,
      entries: [
        {
          scopePath: ".",
          fragmentId: "k8s",
          outcome: "written",
          path: ".anamnesis/ontology/k8s.bootstrap.yaml",
        },
        {
          scopePath: ".",
          fragmentId: "base",
          outcome: "skipped-no-introspector",
        },
      ],
    });

    expect(lines.join("\n")).toContain("Layer A deterministic facts only");
    expect(lines.join("\n")).toContain("1 .bootstrap.yaml fact file");
    expect(lines.join("\n")).toContain(".enriched.yaml");
  });
});
