import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectWorkspaceProfile,
  formatWorkspaceProfileLines,
} from "./workspace_profile.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-profile-"));
}

describe("workspace profile", () => {
  it("summarizes supported stacks, unsupported signals, artifacts, agents, and verification", () => {
    const project = tmpProject();
    fs.mkdirSync(path.join(project, "prisma"), { recursive: true });
    fs.mkdirSync(path.join(project, "docs"), { recursive: true });
    fs.mkdirSync(path.join(project, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(project, "prisma/schema.prisma"), "model User { id Int @id }\n");
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify(
        {
          scripts: { test: "vitest", lint: "biome lint .", typecheck: "tsc" },
          dependencies: { next: "1.0.0", vite: "1.0.0" },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(project, "AGENTS.md"), "# agents\n");
    fs.writeFileSync(path.join(project, ".codex", "config.toml"), "[features]\n");
    fs.writeFileSync(path.join(project, "vite.config.ts"), "export default {}\n");
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(project, "docs", `doc-${i}.md`), "# doc\n");
    }

    const profile = detectWorkspaceProfile(project);
    const lines = formatWorkspaceProfileLines(profile);

    expect(profile.knownStacks).toEqual(expect.arrayContaining(["nextjs", "prisma"]));
    expect(profile.unsupportedSignals).toContain("vite");
    expect(profile.artifactSignals.join(" ")).toContain("docs/");
    expect(profile.agentSurfaces).toEqual(expect.arrayContaining(["AGENTS.md", ".codex/"]));
    expect(profile.verificationSignals).toEqual(
      expect.arrayContaining(["npm test", "npm run lint", "npm run typecheck"]),
    );
    expect(lines.join("\n")).toContain("known stacks");
    expect(lines.join("\n")).toContain("unsupported signals");
  });
});
