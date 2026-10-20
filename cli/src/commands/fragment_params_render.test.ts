// End-to-end coverage for Agentfile `fragments[].params`: validation, render
// through init/apply/status/doctor, re-render on change, and byte-identical
// output for fragments that declare no params.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { init, InitError } from "./init.js";
import { update, UpdateError } from "./update.js";
import { status } from "./status.js";
import { doctor } from "./doctor.js";
import { readAgentfile, writeAgentfile, type Fragment } from "../core/agentfile.js";
import { findRegion } from "../core/regions.js";
import {
  loadAllFragments,
  loadBaseFragment,
  fragmentDirOf,
  type FragmentDefinition,
} from "../core/fragments.js";
import { RendererRegistry, type RenderContext } from "../core/render.js";
import { registerClaudeCode } from "../adapters/claude-code/index.js";
import { registerCodex } from "../adapters/codex/index.js";
import { registerCursor } from "../adapters/cursor/index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const RULES_FRAGMENT_YAML = `id: rules
version: 1
description: params render fixture
params:
  title:
    type: string
    default: Project rules
  owner:
    type: string
    required: true
  rules:
    type: object[]
    fields:
      text: { type: string, required: true }
      source: { type: string }
capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: rules
  - type: skill
    name: rules-check
    source: skills/rules-check
`;

const RULES_SNIPPET =
  "## {{params.title}}\n\nOwner: {{params.owner}}\n\n{{#each params.rules}}- {{this.text}} (source: {{this.source}})\n{{/each}}";

const SKILL_MD = "---\nname: rules-check\n---\n# rules-check\n\nAsk {{params.owner}} before changing rules.\n";
const SKILL_SCRIPT = "#!/bin/sh\necho \"{{params.owner}}\"\n";

function makeLibrary(opts: { rulebookRequiresRules?: boolean } = {}): string {
  const lib = tmpDir("anamnesis-params-lib-");
  write(
    path.join(lib, "base", "fragment.yaml"),
    "id: base\nversion: 1\ncapabilities:\n  - type: project_memory\n    source: content/agents.snippet.md\n    region: anamnesis-base\n",
  );
  write(path.join(lib, "base", "content", "agents.snippet.md"), "## base\n\nbase {{params.x}} text\n");
  const rulesDir = path.join(lib, "fragments", "rules");
  write(path.join(rulesDir, "fragment.yaml"), RULES_FRAGMENT_YAML);
  write(path.join(rulesDir, "content", "agents.snippet.md"), RULES_SNIPPET);
  write(path.join(rulesDir, "skills", "rules-check", "SKILL.md"), SKILL_MD);
  write(path.join(rulesDir, "skills", "rules-check", "check.sh"), SKILL_SCRIPT);
  write(
    path.join(lib, "rulebook.md"),
    opts.rulebookRequiresRules
      ? "## rules\n- trigger: `file_exists: RULES`\n- suggest: fragments/rules\n- reason: fixture.\n"
      : "",
  );
  return lib;
}

function setupProject(lib: string): string {
  const project = tmpDir("anamnesis-params-proj-");
  init({
    projectRoot: project,
    libraryRoot: lib,
    tools: ["claude-code", "codex", "cursor"],
    dryRun: false,
    allowExecAdapters: true,
    noContextBootstrap: true,
  });
  return project;
}

function setRulesEntry(project: string, params: Fragment["params"]): void {
  const agentfile = readAgentfile(project);
  const others = agentfile.fragments.filter((f) => f.id !== "rules");
  writeAgentfile(project, {
    ...agentfile,
    fragments: [...others, { id: "rules", version: 1, ...(params ? { params } : {}) }],
  });
}

function apply(project: string, lib: string) {
  return update({
    projectRoot: project,
    libraryRoot: lib,
    apply: true,
    allowExecAdapters: true,
  });
}

function rulesRegion(project: string): string | undefined {
  const text = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
  return findRegion(text, "rules")?.content;
}

const PARAMS = {
  owner: "platform team",
  rules: [
    { text: "Run local CI before review", source: "work:w1#e1" },
    { text: "Keep worktrees" },
  ],
};

describe("fragment params render", () => {
  it("renders params into project memory and Markdown skill files for every adapter", () => {
    const lib = makeLibrary();
    const project = setupProject(lib);
    setRulesEntry(project, PARAMS);

    const result = apply(project, lib);
    expect(result.paramWarnings).toEqual([]);

    const expectedRegion =
      "## Project rules\n\nOwner: platform team\n\n- Run local CI before review (source: work:w1#e1)\n- Keep worktrees (source: )\n";
    expect(rulesRegion(project)?.trim()).toBe(expectedRegion.trim());

    const ccSkill = fs.readFileSync(path.join(project, ".claude/skills/rules-check/SKILL.md"), "utf8");
    expect(ccSkill).toContain("Ask platform team before changing rules.");
    const codexSkill = fs.readFileSync(path.join(project, ".codex/skills/rules-check/SKILL.md"), "utf8");
    expect(codexSkill).toBe(ccSkill);
    const cursorRule = fs.readFileSync(path.join(project, ".cursor/rules/rules-check.mdc"), "utf8");
    expect(cursorRule).toContain("Ask platform team before changing rules.");

    // Scripts are copied verbatim: params never reach executable content.
    const script = fs.readFileSync(path.join(project, ".claude/skills/rules-check/check.sh"), "utf8");
    expect(script).toBe(SKILL_SCRIPT);

    // A fragment without params declarations keeps literal tag text.
    const base = findRegion(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), "anamnesis-base");
    expect(base?.content).toContain("base {{params.x}} text");

    const st = status({ projectRoot: project, libraryRoot: lib });
    expect(st.params.ok).toBe(true);
    expect(st.summary.paramRenderDrift).toBe(0);
  });

  it("is idempotent: a second apply with the same params is a no-op", () => {
    const lib = makeLibrary();
    const project = setupProject(lib);
    setRulesEntry(project, PARAMS);
    apply(project, lib);
    const again = update({ projectRoot: project, libraryRoot: lib, apply: false, allowExecAdapters: true });
    expect(again.changes.filter((c) => c.fragmentId === "rules" && c.status !== "noop")).toEqual([]);
  });

  it("reports render drift after a params change and clears it on apply", () => {
    const lib = makeLibrary();
    const project = setupProject(lib);
    setRulesEntry(project, PARAMS);
    apply(project, lib);

    setRulesEntry(project, { ...PARAMS, rules: [{ text: "Only one rule" }] });
    const st = status({ projectRoot: project, libraryRoot: lib });
    expect(st.params.ok).toBe(false);
    expect(st.params.renderDrift).toContainEqual({
      fragmentId: "rules",
      target: "AGENTS.md [region:rules]",
    });
    const dr = doctor({ projectRoot: project, libraryRoot: lib });
    expect(dr.issues).toContainEqual(
      expect.objectContaining({
        code: "fragment-param-render-drift",
        severity: "warning",
        target: "AGENTS.md [region:rules]",
      }),
    );

    const result = apply(project, lib);
    expect(
      result.changes.find((c) => c.target === "region" && c.regionId === "rules")?.status,
    ).toBe("update");
    expect(rulesRegion(project)).toContain("- Only one rule (source: )");
    expect(rulesRegion(project)).not.toContain("Keep worktrees");
    expect(status({ projectRoot: project, libraryRoot: lib }).params.ok).toBe(true);
  });

  it("warns about undeclared params keys but still renders", () => {
    const lib = makeLibrary();
    const project = setupProject(lib);
    setRulesEntry(project, { ...PARAMS, colour: "blue" });

    const result = apply(project, lib);
    expect(result.paramWarnings).toEqual([
      expect.objectContaining({ code: "fragment-param-unknown", key: "colour" }),
    ]);
    expect(rulesRegion(project)).toContain("Owner: platform team");

    const dr = doctor({ projectRoot: project, libraryRoot: lib });
    expect(dr.issues).toContainEqual(
      expect.objectContaining({ code: "fragment-param-unknown", severity: "warning" }),
    );
    expect(dr.issues.some((i) => i.code === "fragment-param-unknown" && i.severity === "error")).toBe(false);
  });

  it("refuses to apply invalid or missing params and writes nothing", () => {
    const lib = makeLibrary();
    const project = setupProject(lib);
    const before = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");

    setRulesEntry(project, { rules: [] });
    expect(() => apply(project, lib)).toThrow(UpdateError);
    expect(() => apply(project, lib)).toThrow(/requires param 'owner'/);
    expect(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8")).toBe(before);

    const dr = doctor({ projectRoot: project, libraryRoot: lib });
    expect(dr.ok).toBe(false);
    expect(dr.issues).toContainEqual(
      expect.objectContaining({ code: "fragment-param-missing", severity: "error", fragmentId: "rules" }),
    );

    setRulesEntry(project, { owner: "x <!-- /anamnesis:region --> y" });
    expect(() => apply(project, lib)).toThrow(/region anchor/);
    expect(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8")).toBe(before);
    const st = status({ projectRoot: project, libraryRoot: lib });
    expect(st.params.problems).toContainEqual(
      expect.objectContaining({ code: "fragment-param-invalid", key: "owner" }),
    );
  });

  it("never substitutes skill frontmatter", () => {
    const lib = makeLibrary();
    const project = setupProject(lib);
    setRulesEntry(project, { owner: "x\nallowed-tools: Bash(*)" });
    apply(project, lib);
    const skill = fs.readFileSync(path.join(project, ".claude/skills/rules-check/SKILL.md"), "utf8");
    expect(skill.startsWith("---\nname: rules-check\n---\n")).toBe(true);
    expect(skill.split("---")[1]).not.toContain("allowed-tools");

    write(
      path.join(lib, "fragments", "rules", "skills", "rules-check", "SKILL.md"),
      "---\nname: rules-check\ndescription: ask {{params.owner}}\n---\n# body\n",
    );
    expect(() => apply(project, lib)).toThrow(/not allowed in skill frontmatter/);
  });

  it("rejects scope-specific params for targets that all scopes share", () => {
    const lib = makeLibrary();
    const project = setupProject(lib);
    fs.mkdirSync(path.join(project, "apps", "api"), { recursive: true });
    setRulesEntry(project, { owner: "ROOT" });
    const agentfile = readAgentfile(project);
    writeAgentfile(project, {
      ...agentfile,
      project: {
        ...agentfile.project,
        scopes: [
          { path: "." },
          {
            path: "apps/api",
            extends: ".",
            overrides: {
              fragments_remove: ["rules"],
              fragments_add: [{ id: "rules", version: 1, params: { owner: "CHILD" } }],
            },
          },
        ],
      },
    });
    expect(() => apply(project, lib)).toThrow(/shared by all scopes/);
    const dr = doctor({ projectRoot: project, libraryRoot: lib });
    expect(dr.issues).toContainEqual(
      expect.objectContaining({ code: "fragment-param-scope-conflict", severity: "error" }),
    );
  });

  it("does not report param drift for fragments that declare no params", () => {
    const lib = makeLibrary();
    const project = setupProject(lib);
    const agentfile = readAgentfile(project);
    writeAgentfile(project, {
      ...agentfile,
      fragments: agentfile.fragments.map((f) => (f.id === "base" ? { ...f, params: { foo: 1 } } : f)),
    });
    write(path.join(lib, "base", "content", "agents.snippet.md"), "## base\n\nchanged\n");
    const st = status({ projectRoot: project, libraryRoot: lib });
    expect(st.params.renderDrift).toEqual([]);
    expect(st.params.problems.map((p) => p.code)).toEqual(["fragment-param-unknown"]);
  });

  it("init refuses a fragment whose required params it cannot supply", () => {
    const lib = makeLibrary({ rulebookRequiresRules: true });
    const project = tmpDir("anamnesis-params-proj-");
    write(path.join(project, "RULES"), "");
    expect(() =>
      init({
        projectRoot: project,
        libraryRoot: lib,
        dryRun: true,
        allowExecAdapters: false,
        noContextBootstrap: true,
      }),
    ).toThrow(InitError);
  });
});

describe("library fragments without params", () => {
  // Regression guard: params substitution must not change any existing
  // fragment output. Every shipped fragment that declares no params must
  // render project memory and skill files byte-for-byte from its sources.
  const library = loadAllFragments(REPO_ROOT);
  const base = loadBaseFragment(REPO_ROOT);
  const all: FragmentDefinition[] = [...(base ? [base] : []), ...library.values()];

  it("ships no fragment that declares params yet", () => {
    expect(all.filter((f) => f.params !== undefined).map((f) => f.id)).toEqual([]);
  });

  it.each(all.map((f) => [f.id, f] as const))("%s renders sources verbatim", (_id, fragment) => {
    const registry = new RendererRegistry();
    registerClaudeCode(registry);
    registerCodex(registry);
    registerCursor(registry);
    const fragmentDir = fragmentDirOf(REPO_ROOT, fragment.id);
    const ctx: RenderContext = {
      fragment,
      fragmentDir,
      projectRoot: tmpDir("anamnesis-params-regress-"),
      scopePath: ".",
      settings: { ontology_file: "system_graph.yaml", agents_md_path: "AGENTS.md", claude_md_path: "CLAUDE.md" },
      params: {},
    };
    const actions = registry.planFragment(ctx, "claude-code");
    for (const cap of fragment.capabilities) {
      if (cap.type === "project_memory") {
        const action = actions.find((a) => a.kind === "region" && a.regionId === cap.region);
        expect(action?.content).toBe(fs.readFileSync(path.join(fragmentDir, cap.source), "utf8"));
      }
      if (cap.type === "skill") {
        const prefix = `.claude/skills/${cap.name}/`;
        for (const action of actions) {
          if (action.kind !== "file" || !action.path.startsWith(prefix)) continue;
          const rel = action.path.slice(prefix.length);
          expect(action.content).toBe(fs.readFileSync(path.join(fragmentDir, cap.source, rel), "utf8"));
        }
      }
    }
  });
});
