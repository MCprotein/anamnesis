import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { init } from "./init.js";
import {
  upgradeApplyChoice,
  UpgradeApplyChoiceError,
} from "./upgrade_apply_choice.js";
import { upgradePlan } from "./upgrade_plan.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeLibrary(version: number): string {
  const lib = tmpDir("anamnesis-upgrade-apply-choice-lib-");
  const baseDir = path.join(lib, "base");
  fs.mkdirSync(path.join(baseDir, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(baseDir, "fragment.yaml"),
    `id: base
version: ${version}
capabilities:
  - type: project_memory
    source: content/base.md
    region: anamnesis-base
`,
  );
  fs.writeFileSync(
    path.join(baseDir, "content", "base.md"),
    `## Base\n\nv${version} rules.\n`,
  );
  fs.writeFileSync(path.join(lib, "rulebook.md"), "");
  return lib;
}

function installProject(library: string): string {
  const project = tmpDir("anamnesis-upgrade-apply-choice-proj-");
  init({
    projectRoot: project,
    libraryRoot: library,
    dryRun: false,
    allowExecAdapters: false,
    noBootstrap: true,
  });
  return project;
}

describe("upgrade apply-choice", () => {
  it("adds a content-only apply choice when managed content can update", () => {
    const v1Library = makeLibrary(1);
    const project = installProject(v1Library);
    const v2Library = makeLibrary(2);

    const plan = upgradePlan({
      projectRoot: project,
      libraryRoot: v2Library,
      currentVersion: "1.10.0",
      latestVersion: "1.10.0",
    });

    expect(plan.project.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "apply-content-only-update",
          effect: "local-write",
          command: "anamnesis update --apply",
          recommended: false,
        }),
      ]),
    );
  });

  it("previews local-write choices by default and applies only with --apply", () => {
    const v1Library = makeLibrary(1);
    const project = installProject(v1Library);
    const agentsPath = path.join(project, "AGENTS.md");
    const before = fs.readFileSync(agentsPath, "utf8");
    const v2Library = makeLibrary(2);

    const preview = upgradeApplyChoice({
      choiceId: "apply-content-only-update",
      projectRoot: project,
      libraryRoot: v2Library,
      currentVersion: "1.10.0",
      latestVersion: "1.10.0",
    });

    expect(preview.status).toBe("preview-required");
    expect(preview.operation).toBe("update");
    expect(preview.previewCommand).toBe("anamnesis update --dry-run");
    expect(preview.summary).toEqual(
      expect.arrayContaining([expect.stringContaining("written: false")]),
    );
    expect(fs.readFileSync(agentsPath, "utf8")).toBe(before);

    const applied = upgradeApplyChoice({
      choiceId: "apply-content-only-update",
      projectRoot: project,
      libraryRoot: v2Library,
      currentVersion: "1.10.0",
      latestVersion: "1.10.0",
      apply: true,
    });

    expect(applied.status).toBe("applied");
    expect(applied.operation).toBe("update");
    expect(applied.command).toBe("anamnesis update --apply");
    expect(applied.summary).toEqual(
      expect.arrayContaining([expect.stringContaining("written: true")]),
    );
    expect(fs.readFileSync(agentsPath, "utf8")).toContain("v2 rules.");
  });

  it("executes read-only preview choices without writing", () => {
    const v1Library = makeLibrary(1);
    const project = installProject(v1Library);
    const agentsPath = path.join(project, "AGENTS.md");
    const before = fs.readFileSync(agentsPath, "utf8");
    const v2Library = makeLibrary(2);

    const result = upgradeApplyChoice({
      choiceId: "preview-content-only-update",
      projectRoot: project,
      libraryRoot: v2Library,
      currentVersion: "1.10.0",
      latestVersion: "1.10.0",
    });

    expect(result.status).toBe("executed-read-only");
    expect(result.operation).toBe("update");
    expect(result.command).toBe("anamnesis update --dry-run");
    expect(result.summary).toEqual(
      expect.arrayContaining([expect.stringContaining("written: false")]),
    );
    expect(fs.readFileSync(agentsPath, "utf8")).toBe(before);
  });

  it("does not execute manual choices", () => {
    const library = makeLibrary(1);
    const project = installProject(library);

    const result = upgradeApplyChoice({
      choiceId: "keep-implicit-setting-defaults",
      projectRoot: project,
      libraryRoot: library,
      currentVersion: "1.10.0",
      latestVersion: "1.10.0",
      apply: true,
    });

    expect(result.status).toBe("manual");
    expect(result.operation).toBe("none");
    expect(result.message).toContain("manual guidance");
  });

  it("keeps package install choices preview-only unless --apply is explicit", () => {
    const library = makeLibrary(1);
    const project = installProject(library);

    const result = upgradeApplyChoice({
      choiceId: "upgrade-cli-package",
      projectRoot: project,
      libraryRoot: library,
      currentVersion: "1.10.0",
      latestVersion: "1.11.0",
    });

    expect(result.status).toBe("preview-required");
    expect(result.operation).toBe("upgrade-package");
    expect(result.command).toContain("npm install -g");
    expect(result).not.toHaveProperty("execution");
  });

  it("reports available choice ids for unknown choices", () => {
    const library = makeLibrary(1);
    const project = installProject(library);

    expect(() =>
      upgradeApplyChoice({
        choiceId: "missing-choice",
        projectRoot: project,
        libraryRoot: library,
        currentVersion: "1.10.0",
        latestVersion: "1.10.0",
      }),
    ).toThrow(UpgradeApplyChoiceError);
  });
});
