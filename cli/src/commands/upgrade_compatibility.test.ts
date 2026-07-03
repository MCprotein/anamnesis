import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { init } from "./init.js";
import { update } from "./update.js";
import { upgrade } from "./upgrade.js";
import { doctor } from "./doctor.js";
import { readAgentfile, writeAgentfile } from "../core/agentfile.js";
import { findRegion, upsertRegion } from "../core/regions.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeUpgradeLibrary(
  opts: {
    featureVersion: number;
    featureContent: string;
    includeFeatureHook?: boolean;
  },
): string {
  const lib = tmpDir("anamnesis-upgrade-compat-lib-");

  const baseDir = path.join(lib, "base");
  fs.mkdirSync(path.join(baseDir, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(baseDir, "fragment.yaml"),
    `id: base
version: 1
capabilities:
  - type: project_memory
    source: content/base.md
    region: anamnesis-base
`,
  );
  fs.writeFileSync(
    path.join(baseDir, "content", "base.md"),
    "## anamnesis baseline\n",
  );

  const featureDir = path.join(lib, "fragments", "feature");
  fs.mkdirSync(path.join(featureDir, "content"), { recursive: true });
  if (opts.includeFeatureHook === true) {
    fs.mkdirSync(path.join(featureDir, "hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(featureDir, "hooks", "feature.sh"),
      "#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n",
    );
  }
  fs.writeFileSync(
    path.join(featureDir, "fragment.yaml"),
    `id: feature
version: ${opts.featureVersion}
capabilities:
  - type: project_memory
    source: content/feature.md
    region: feature
${opts.includeFeatureHook === true ? `  - type: executable_hook
    event: Stop
    source: hooks/feature.sh
    adapters_supported: [claude-code]
` : ""}`,
  );
  fs.writeFileSync(
    path.join(featureDir, "content", "feature.md"),
    opts.featureContent,
  );

  fs.writeFileSync(
    path.join(lib, "rulebook.md"),
    `## feature
- trigger: \`file_exists: feature.flag\`
- suggest: fragments/feature
- reason: compatibility fixture.
`,
  );

  return lib;
}

function installOldProject(library: string): string {
  const project = tmpDir("anamnesis-upgrade-compat-proj-");
  fs.writeFileSync(path.join(project, "feature.flag"), "");
  init({
    projectRoot: project,
    libraryRoot: library,
    dryRun: false,
    allowExecAdapters: false,
    noBootstrap: true,
  });

  const agentfile = readAgentfile(project);
  delete agentfile.settings;
  writeAgentfile(project, agentfile);
  return project;
}

describe("upgrade compatibility matrix", () => {
  it("upgrades a clean old project through preview, apply, and doctor", () => {
    const v1Library = makeUpgradeLibrary({
      featureVersion: 1,
      featureContent: "## Feature\n\nv1 rules.\n",
    });
    const project = installOldProject(v1Library);
    const v2Library = makeUpgradeLibrary({
      featureVersion: 2,
      featureContent: "## Feature\n\nv2 rules.\n",
    });

    const packageUpgrade = upgrade({
      currentVersion: "1.7.0",
      latestVersion: "1.8.0",
    });
    expect(packageUpgrade.status).toBe("update-available");

    const preview = update({
      projectRoot: project,
      libraryRoot: v2Library,
      apply: false,
      allowExecAdapters: false,
    });
    expect(preview.writtenToDisk).toBe(false);
    expect(preview.changes.some((change) => change.status === "update")).toBe(
      true,
    );

    update({
      projectRoot: project,
      libraryRoot: v2Library,
      apply: true,
      allowExecAdapters: false,
    });

    const agentfile = readAgentfile(project);
    expect(agentfile.settings).toBeUndefined();
    expect(agentfile.fragments.find((f) => f.id === "feature")).toMatchObject({
      version: 2,
    });
    expect(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8")).toContain(
      "v2 rules",
    );

    const health = doctor({ projectRoot: project, libraryRoot: v2Library });
    expect(health.issues.filter((issue) => issue.severity === "error")).toEqual(
      [],
    );
  });

  it("preserves user-edited managed regions without marking the fragment current", () => {
    const v1Library = makeUpgradeLibrary({
      featureVersion: 1,
      featureContent: "## Feature\n\nv1 rules.\n",
    });
    const project = installOldProject(v1Library);
    const agentsPath = path.join(project, "AGENTS.md");
    const edited = upsertRegion(fs.readFileSync(agentsPath, "utf8"), {
      id: "feature",
      fragmentId: "feature",
      fragmentVersion: 1,
      content: "USER FEATURE RULES\n",
    });
    fs.writeFileSync(agentsPath, edited);

    const v2Library = makeUpgradeLibrary({
      featureVersion: 2,
      featureContent: "## Feature\n\nv2 rules.\n",
    });

    const preview = update({
      projectRoot: project,
      libraryRoot: v2Library,
      apply: false,
      allowExecAdapters: false,
    });
    expect(preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fragmentId: "feature",
          status: "user-modified",
        }),
      ]),
    );

    update({
      projectRoot: project,
      libraryRoot: v2Library,
      apply: true,
      allowExecAdapters: false,
    });

    const afterText = fs.readFileSync(agentsPath, "utf8");
    expect(findRegion(afterText, "feature")?.content).toContain(
      "USER FEATURE RULES",
    );
    expect(readAgentfile(project).fragments.find((f) => f.id === "feature"))
      .toMatchObject({ version: 1 });
  });

  it("keeps executable-adapter additions gated until explicitly allowed", () => {
    const v1Library = makeUpgradeLibrary({
      featureVersion: 1,
      featureContent: "## Feature\n\nv1 rules.\n",
    });
    const project = installOldProject(v1Library);
    const v2Library = makeUpgradeLibrary({
      featureVersion: 2,
      featureContent: "## Feature\n\nv2 rules.\n",
      includeFeatureHook: true,
    });

    const gated = update({
      projectRoot: project,
      libraryRoot: v2Library,
      apply: true,
      allowExecAdapters: false,
    });
    expect(gated.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fragmentId: "feature",
          status: "blocked",
        }),
      ]),
    );
    expect(
      fs.existsSync(path.join(project, ".claude", "hooks", "feature.sh")),
    ).toBe(false);
    expect(readAgentfile(project).fragments.find((f) => f.id === "feature"))
      .toMatchObject({ version: 1 });

    update({
      projectRoot: project,
      libraryRoot: v2Library,
      apply: true,
      allowExecAdapters: true,
    });
    expect(
      fs.existsSync(path.join(project, ".claude", "hooks", "feature.sh")),
    ).toBe(true);
    expect(readAgentfile(project).fragments.find((f) => f.id === "feature"))
      .toMatchObject({ version: 2 });
  });
});
