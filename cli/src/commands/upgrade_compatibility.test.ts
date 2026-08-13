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
    featureHookAdapters?: Array<"claude-code" | "codex">;
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
    adapters_supported: [${(opts.featureHookAdapters ?? ["claude-code"]).join(", ")}]
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

function addFeatureArchive(
  library: string,
  opts: { version: number; content: string },
): void {
  const archiveDir = path.join(
    library,
    "fragments",
    "feature",
    ".versions",
    String(opts.version),
  );
  fs.mkdirSync(path.join(archiveDir, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(archiveDir, "fragment.yaml"),
    `id: feature
version: ${opts.version}
capabilities:
  - type: project_memory
    source: content/feature.md
    region: feature
`,
  );
  fs.writeFileSync(
    path.join(archiveDir, "content", "feature.md"),
    opts.content,
  );
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
  it("gates representative v1.4, v1.5, and v1.7 Agentfiles on schema migration", () => {
    const v1Library = makeUpgradeLibrary({
      featureVersion: 1,
      featureContent: "## Feature\n\nv1 rules.\n",
    });
    const v2Library = makeUpgradeLibrary({
      featureVersion: 2,
      featureContent: "## Feature\n\nv2 rules.\n",
    });
    const cases = [
      {
        label: "v1.4 claude-only with no settings block",
        agentfile: {
          version: 1,
          project: { name: "v14-legacy" },
          tools: ["claude-code"],
          fragments: [
            { id: "base", version: 1 },
            { id: "feature", version: 1 },
          ],
        },
      },
      {
        label: "v1.5 compact-session partial settings block",
        agentfile: {
          version: 1,
          project: { name: "v15-compact" },
          tools: ["claude-code"],
          fragments: [
            { id: "base", version: 1 },
            { id: "feature", version: 1 },
          ],
          settings: {
            ontology_file: "system_graph.yaml",
            agents_md_path: "AGENTS.md",
            claude_md_path: "CLAUDE.md",
            max_warm_handoff_archives: 3,
          },
        },
      },
      {
        label: "v1.7 all-adapter project with partial fragment adapter choice",
        agentfile: {
          version: 1,
          project: { name: "v17-all-adapter" },
          tools: ["claude-code", "codex", "cursor"],
          fragments: [
            { id: "base", version: 1 },
            {
              id: "feature",
              version: 1,
              adapters: { "claude-code": true, codex: false, cursor: true },
            },
          ],
        },
      },
    ];

    for (const fixture of cases) {
      const project = installOldProject(v1Library);
      fs.writeFileSync(
        path.join(project, "Agentfile"),
        JSON.stringify(fixture.agentfile, null, 2),
        "utf8",
      );

      expect(() =>
        update({
          projectRoot: project,
          libraryRoot: v2Library,
          apply: false,
          allowExecAdapters: true,
        }),
      ).toThrow(/Agentfile schema migration is required before update/);
      expect(readAgentfile(project).fragments.find((f) => f.id === "feature"))
        .toMatchObject({ version: 1 });
    }
  });

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

  it("keeps pinned historical fragments on archived content until explicitly bumped", () => {
    const v1Library = makeUpgradeLibrary({
      featureVersion: 1,
      featureContent: "## Feature\n\nv1 rules.\n",
    });
    const project = installOldProject(v1Library);
    const agentfile = readAgentfile(project);
    agentfile.fragments = agentfile.fragments.map((fragment) =>
      fragment.id === "feature"
        ? { ...fragment, pinned: true }
        : fragment,
    );
    writeAgentfile(project, agentfile);

    const v2Library = makeUpgradeLibrary({
      featureVersion: 2,
      featureContent: "## Feature\n\nv2 current rules.\n",
    });
    addFeatureArchive(v2Library, {
      version: 1,
      content: "## Feature\n\nv1 archived rules.\n",
    });

    update({
      projectRoot: project,
      libraryRoot: v2Library,
      apply: true,
      allowExecAdapters: false,
    });

    expect(readAgentfile(project).fragments.find((f) => f.id === "feature"))
      .toMatchObject({ version: 1, pinned: true });
    const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(agents).toContain("v1 archived rules");
    expect(agents).not.toContain("v2 current rules");
  });

  it("preserves partial adapter choices when a newer fragment adds hook surfaces", () => {
    const v1Library = makeUpgradeLibrary({
      featureVersion: 1,
      featureContent: "## Feature\n\nv1 rules.\n",
    });
    const project = installOldProject(v1Library);
    const agentfile = readAgentfile(project);
    agentfile.tools = ["claude-code", "codex"];
    agentfile.fragments = agentfile.fragments.map((fragment) =>
      fragment.id === "feature"
        ? {
            ...fragment,
            adapters: { "claude-code": true, codex: false },
          }
        : fragment,
    );
    writeAgentfile(project, agentfile);
    const v2Library = makeUpgradeLibrary({
      featureVersion: 2,
      featureContent: "## Feature\n\nv2 rules.\n",
      includeFeatureHook: true,
      featureHookAdapters: ["claude-code", "codex"],
    });

    update({
      projectRoot: project,
      libraryRoot: v2Library,
      apply: true,
      allowExecAdapters: true,
    });

    expect(fs.existsSync(path.join(project, ".claude/hooks/feature.sh")))
      .toBe(true);
    expect(
      fs.existsSync(
        path.join(
          project,
          ".anamnesis/codex-native-hooks/feature-Stop-feature.mjs",
        ),
      ),
    ).toBe(false);
    expect(fs.existsSync(path.join(project, ".codex/hooks.json"))).toBe(false);
    expect(readAgentfile(project).fragments.find((f) => f.id === "feature"))
      .toMatchObject({
        version: 2,
        adapters: { "claude-code": true, codex: false },
      });
  });

  it("refreshes stale Codex hook registrations while preserving user hook config", () => {
    const v1Library = makeUpgradeLibrary({
      featureVersion: 1,
      featureContent: "## Feature\n\nv1 rules.\n",
    });
    const project = installOldProject(v1Library);
    const agentfile = readAgentfile(project);
    agentfile.tools = ["claude-code", "codex"];
    writeAgentfile(project, agentfile);
    fs.mkdirSync(path.join(project, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(project, ".claude/settings.json"),
      JSON.stringify(
        {
          theme: "user-owned",
          hooks: {
            Stop: [
              {
                hooks: [
                  { type: "command", command: "./user-stop-hook.sh" },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.mkdirSync(path.join(project, ".codex"), { recursive: true });
    fs.writeFileSync(
      path.join(project, ".codex/config.toml"),
      "[features]\ncodex_hooks = true\nmodel_reasoning_effort = \"high\"\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(project, ".codex/hooks.json"),
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [
                  { type: "command", command: "node ./user-codex-hook.mjs" },
                  {
                    type: "command",
                    command:
                      'node ".anamnesis/codex-native-hooks/feature-Stop-feature.mjs"',
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const v2Library = makeUpgradeLibrary({
      featureVersion: 2,
      featureContent: "## Feature\n\nv2 rules.\n",
      includeFeatureHook: true,
      featureHookAdapters: ["claude-code", "codex"],
    });

    const result = update({
      projectRoot: project,
      libraryRoot: v2Library,
      apply: true,
      allowExecAdapters: true,
    });

    const claudeSettings = JSON.parse(
      fs.readFileSync(path.join(project, ".claude/settings.json"), "utf8"),
    ) as {
      theme?: string;
      hooks?: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    expect(claudeSettings.theme).toBe("user-owned");
    expect(claudeSettings.hooks?.Stop?.[0]?.hooks.map((h) => h.command))
      .toContain("./user-stop-hook.sh");
    expect(
      claudeSettings.hooks?.Stop?.flatMap((entry) =>
        entry.hooks.map((hook) => hook.command),
      ),
    ).toContain(".claude/hooks/feature.sh");

    const codexConfig = fs.readFileSync(
      path.join(project, ".codex/config.toml"),
      "utf8",
    );
    expect(codexConfig).toContain("hooks = true");
    expect(codexConfig).toContain('model_reasoning_effort = "high"');
    expect(codexConfig).not.toContain("codex_hooks");

    const codexHooks = fs.readFileSync(
      path.join(project, ".codex/hooks.json"),
      "utf8",
    );
    expect(codexHooks).toContain("node ./user-codex-hook.mjs");
    expect(codexHooks).toContain("git rev-parse --show-toplevel");
    expect(codexHooks).toContain(
      ".anamnesis/codex-native-hooks/feature-Stop-feature.mjs",
    );
    expect(codexHooks).not.toContain(
      'node ".anamnesis/codex-native-hooks/feature-Stop-feature.mjs"',
    );
    expect(result.codexHookRegistrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "create",
          registration: expect.objectContaining({ event: "Stop" }),
        }),
      ]),
    );
  });

  it("keeps suggested-but-declined fragments suppressed for old projects", () => {
    const library = makeUpgradeLibrary({
      featureVersion: 1,
      featureContent: "## Feature\n\nv1 rules.\n",
    });
    const project = tmpDir("anamnesis-upgrade-compat-declined-");
    init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
      noBootstrap: true,
    });
    const agentfile = readAgentfile(project);
    agentfile.declined = [
      {
        id: "feature",
        reason: "not part of this service",
        declined_at: "2026-06-01",
      },
    ];
    writeAgentfile(project, agentfile);
    fs.writeFileSync(path.join(project, "feature.flag"), "");

    const preview = update({
      projectRoot: project,
      libraryRoot: library,
      apply: false,
      allowExecAdapters: false,
    });

    expect(preview.suggested.map((rule) => rule.suggest)).not.toContain(
      "feature",
    );
    expect(readAgentfile(project).fragments.map((f) => f.id)).toEqual([
      "base",
    ]);
  });
});
