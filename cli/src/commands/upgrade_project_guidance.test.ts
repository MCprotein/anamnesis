import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectUpgradeProjectGuidance,
  formatUpgradeProjectGuidance,
} from "./upgrade_project_guidance.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("upgrade project guidance", () => {
  it("detects a managed project and prints update/doctor next steps", () => {
    const project = tmpProject();
    fs.writeFileSync(path.join(project, "Agentfile"), "version: 1\n", "utf8");

    const guidance = detectUpgradeProjectGuidance(project);
    expect(guidance).toMatchObject({
      kind: "managed",
      agentfilePath: "Agentfile",
    });

    const lines = formatUpgradeProjectGuidance(
      { applied: true, updateAvailable: true, status: "update-available" },
      guidance,
    );

    expect(lines).toContain("    managed project: yes (Agentfile)");
    expect(lines).toContain(
      "      preview: anamnesis apply --dry-run --allow-exec-adapters",
    );
    expect(lines).toContain("      verify:  anamnesis doctor");
    expect(lines.join("\n")).toContain(
      "project-managed files are unchanged until project apply runs",
    );
  });

  it("tells users to cd into a managed project when no Agentfile exists", () => {
    const project = tmpProject();

    const guidance = detectUpgradeProjectGuidance(project);
    expect(guidance).toMatchObject({ kind: "unmanaged" });

    const lines = formatUpgradeProjectGuidance(
      { applied: false, updateAvailable: false, status: "up-to-date" },
      guidance,
    );

    expect(lines).toContain(
      "    managed project: no Agentfile found in the current directory",
    );
    expect(lines).toContain("      cd into an anamnesis-managed project");
    expect(lines).toContain("      or initialize here: anamnesis init --dry-run");
  });

  it("keeps upgrade reporting non-fatal when Agentfile discovery is ambiguous", () => {
    const project = tmpProject();
    fs.mkdirSync(path.join(project, ".anamnesis"), { recursive: true });
    fs.writeFileSync(path.join(project, "Agentfile"), "version: 1\n", "utf8");
    fs.writeFileSync(
      path.join(project, ".anamnesis", "agentfile.yaml"),
      "version: 1\n",
      "utf8",
    );

    const guidance = detectUpgradeProjectGuidance(project);
    expect(guidance).toMatchObject({ kind: "unknown" });

    const lines = formatUpgradeProjectGuidance(
      { applied: false, updateAvailable: true, status: "update-available" },
      guidance,
    );

    expect(lines).toContain(
      "    managed project: could not inspect current directory",
    );
    expect(lines.join("\n")).toContain("Multiple Agentfile variants");
    expect(lines).toContain("      verify: anamnesis doctor");
  });
});

function tmpProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-upgrade-"));
  tmpRoots.push(root);
  return root;
}
