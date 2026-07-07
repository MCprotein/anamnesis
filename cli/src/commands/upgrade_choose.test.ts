import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { init } from "./init.js";
import {
  buildUpgradeChoiceMenu,
  renderUpgradeChoiceMenu,
  selectUpgradeChoice,
  upgradeChoose,
  UpgradeChooseError,
} from "./upgrade_choose.js";
import { upgradePlan } from "./upgrade_plan.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeLibrary(version: number): string {
  const lib = tmpDir("anamnesis-upgrade-choose-lib-");
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
  const project = tmpDir("anamnesis-upgrade-choose-proj-");
  init({
    projectRoot: project,
    libraryRoot: library,
    dryRun: false,
    allowExecAdapters: false,
    noBootstrap: true,
  });
  return project;
}

describe("upgrade choose", () => {
  it("renders and selects upgrade choices by number or id", () => {
    const v1Library = makeLibrary(1);
    const project = installProject(v1Library);
    const v2Library = makeLibrary(2);
    const plan = upgradePlan({
      projectRoot: project,
      libraryRoot: v2Library,
      currentVersion: "1.10.0",
      latestVersion: "1.10.0",
    });
    const menu = buildUpgradeChoiceMenu(plan);

    expect(menu.length).toBeGreaterThan(0);
    expect(renderUpgradeChoiceMenu(menu)).toContain("Enter a number or choice id");
    expect(selectUpgradeChoice(menu, "1")?.id).toBe(menu[0]?.id);
    expect(selectUpgradeChoice(menu, "apply-content-only-update")?.id).toBe(
      "apply-content-only-update",
    );
    expect(selectUpgradeChoice(menu, "not-a-choice")).toBeUndefined();
  });

  it("refuses to prompt in non-interactive mode without a selected choice", async () => {
    const library = makeLibrary(1);
    const project = installProject(library);

    await expect(
      upgradeChoose({
        projectRoot: project,
        libraryRoot: library,
        currentVersion: "1.10.0",
        latestVersion: "1.10.0",
        inputIsTTY: false,
      }),
    ).rejects.toThrow(UpgradeChooseError);
  });

  it("delegates selected choices to the safe apply-choice executor", async () => {
    const v1Library = makeLibrary(1);
    const project = installProject(v1Library);
    const agentsPath = path.join(project, "AGENTS.md");
    const before = fs.readFileSync(agentsPath, "utf8");
    const v2Library = makeLibrary(2);

    const result = await upgradeChoose({
      choiceInput: "apply-content-only-update",
      projectRoot: project,
      libraryRoot: v2Library,
      currentVersion: "1.10.0",
      latestVersion: "1.10.0",
    });

    expect(result.interactive).toBe(false);
    expect(result.selectedChoiceId).toBe("apply-content-only-update");
    expect(result.execution.status).toBe("preview-required");
    expect(result.execution.previewCommand).toBe("anamnesis update --dry-run");
    expect(fs.readFileSync(agentsPath, "utf8")).toBe(before);
  });

  it("can select through an injected prompt", async () => {
    const library = makeLibrary(1);
    const project = installProject(library);

    const result = await upgradeChoose({
      projectRoot: project,
      libraryRoot: library,
      currentVersion: "1.10.0",
      latestVersion: "1.10.0",
      prompt: async (question) => {
        expect(question).toContain("Choose one upgrade plan choice");
        return "keep-implicit-setting-defaults";
      },
    });

    expect(result.interactive).toBe(true);
    expect(result.selectedChoiceId).toBe("keep-implicit-setting-defaults");
    expect(result.execution.status).toBe("manual");
  });
});
