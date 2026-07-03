import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { init } from "./init.js";
import { update } from "./update.js";
import { upgradePlan } from "./upgrade_plan.js";
import { upsertRegion } from "../core/regions.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeLibrary(opts: { version: number; hook?: boolean }): string {
  const lib = tmpDir("anamnesis-upgrade-plan-lib-");
  const baseDir = path.join(lib, "base");
  fs.mkdirSync(path.join(baseDir, "content"), { recursive: true });
  if (opts.hook === true) {
    fs.mkdirSync(path.join(baseDir, "hooks"), { recursive: true });
    fs.writeFileSync(
      path.join(baseDir, "hooks", "base.sh"),
      "#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n",
    );
  }
  fs.writeFileSync(
    path.join(baseDir, "fragment.yaml"),
    `id: base
version: ${opts.version}
capabilities:
  - type: project_memory
    source: content/base.md
    region: anamnesis-base
${opts.hook === true ? `  - type: executable_hook
    event: Stop
    source: hooks/base.sh
    adapters_supported: [claude-code]
` : ""}`,
  );
  fs.writeFileSync(
    path.join(baseDir, "content", "base.md"),
    `## Base\n\nv${opts.version} rules.\n`,
  );
  fs.writeFileSync(path.join(lib, "rulebook.md"), "");
  return lib;
}

function installProject(library: string): string {
  const project = tmpDir("anamnesis-upgrade-plan-proj-");
  init({
    projectRoot: project,
    libraryRoot: library,
    dryRun: false,
    allowExecAdapters: false,
    noBootstrap: true,
  });
  return project;
}

describe("upgrade plan", () => {
  it("combines package, project status, update dry-run, and doctor summaries", () => {
    const v1Library = makeLibrary({ version: 1 });
    const project = installProject(v1Library);
    const v2Library = makeLibrary({ version: 2, hook: true });

    const result = upgradePlan({
      projectRoot: project,
      libraryRoot: v2Library,
      currentVersion: "1.8.0",
      latestVersion: "1.9.0",
      now: () => new Date("2026-07-03T00:00:00.000Z"),
    });

    expect(result.generatedAt).toBe("2026-07-03T00:00:00.000Z");
    expect(result.package).toMatchObject({
      status: "update-available",
      updateAvailable: true,
      applied: false,
    });
    expect(result.project.kind).toBe("managed");
    expect(result.project.agentfilePath).toBe("Agentfile");
    expect(result.project.statusSummary).toMatchObject({
      fragmentUpdatesAvailable: 1,
    });
    expect(result.project.updateSummary).toMatchObject({
      blocked: 1,
    });
    expect(result.project.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "package-update-available" }),
        expect.objectContaining({
          kind: "fragment-updates-available",
          next: expect.stringContaining("Preview all project changes"),
        }),
        expect.objectContaining({
          kind: "executable-adapter-gate",
          next: expect.stringContaining("Codex wrappers"),
        }),
      ]),
    );
    expect(result.project.commands).toEqual(
      expect.arrayContaining([
        "npm install -g @mcprotein/anamnesis@1.9.0 --registry=https://registry.npmjs.org --@mcprotein:registry=https://registry.npmjs.org --fetch-timeout=10000 --fetch-retries=0",
        "anamnesis update --dry-run --allow-exec-adapters",
        "anamnesis doctor",
      ]),
    );
  });

  it("reports partial adoption gates after update preserves local managed edits", () => {
    const v1Library = makeLibrary({ version: 1 });
    const project = installProject(v1Library);
    const agentsPath = path.join(project, "AGENTS.md");
    fs.writeFileSync(
      agentsPath,
      upsertRegion(fs.readFileSync(agentsPath, "utf8"), {
        id: "anamnesis-base",
        fragmentId: "base",
        fragmentVersion: 1,
        content: "USER BASE RULES\n",
      }),
    );
    const v2Library = makeLibrary({ version: 2 });
    update({
      projectRoot: project,
      libraryRoot: v2Library,
      apply: true,
      allowExecAdapters: false,
    });

    const result = upgradePlan({
      projectRoot: project,
      libraryRoot: v2Library,
      currentVersion: "1.9.0",
      latestVersion: "1.9.0",
    });

    expect(result.project.statusSummary).toMatchObject({
      partialAdoptions: 1,
    });
    expect(result.project.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "partial-adoption" }),
        expect.objectContaining({
          kind: "user-modified-managed-surfaces",
          next: expect.stringContaining("Compare the dry-run output"),
        }),
        expect.objectContaining({
          kind: "doctor-issues",
          next: expect.stringContaining("resolve errors before applying"),
        }),
      ]),
    );
  });

  it("returns an unmanaged project plan without running project diagnostics", () => {
    const project = tmpDir("anamnesis-upgrade-plan-unmanaged-");
    const library = makeLibrary({ version: 1 });

    const result = upgradePlan({
      projectRoot: project,
      libraryRoot: library,
      currentVersion: "1.9.0",
      latestVersion: "1.9.0",
    });

    expect(result.project.kind).toBe("unmanaged");
    expect(result.project).not.toHaveProperty("statusSummary");
    expect(result.project).not.toHaveProperty("doctorSummary");
    expect(result.project.gates).toEqual([
      expect.objectContaining({ kind: "project-unmanaged" }),
    ]);
  });
});
