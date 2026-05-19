import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { registerClaudeCode } from "./claude-code/index.js";
import { registerCodex } from "./codex/index.js";
import { registerCursor } from "./cursor/index.js";
import type { ToolName } from "../core/agentfile.js";
import { codexNativeNodeCommand } from "../core/codex_native.js";
import { loadBaseFragment } from "../core/fragments.js";
import {
  RendererRegistry,
  type FileAction,
  type RegionAction,
  type RenderAction,
  type RenderContext,
} from "../core/render.js";

const SETTINGS = {
  ontology_file: "system_graph.yaml",
  agents_md_path: "AGENTS.md",
  claude_md_path: "CLAUDE.md",
};

function renderBase(adapter: ToolName): RenderAction[] {
  const libraryRoot = process.cwd();
  const fragmentDir = path.join(libraryRoot, "base");
  const fragment = loadBaseFragment(libraryRoot);
  expect(fragment).not.toBeNull();

  const registry = new RendererRegistry();
  registerClaudeCode(registry);
  registerCodex(registry);
  registerCursor(registry);

  const ctx: RenderContext = {
    fragment: fragment!,
    fragmentDir,
    projectRoot: "/tmp/anamnesis-continuity-project",
    scopePath: ".",
    settings: SETTINGS,
    params: {},
  };

  return registry.planFragment(ctx, adapter);
}

function regionById(actions: RenderAction[], id: string): RegionAction {
  const action = actions.find(
    (a): a is RegionAction => a.kind === "region" && a.regionId === id,
  );
  expect(action, `missing region ${id}`).toBeDefined();
  return action!;
}

function fileByPath(actions: RenderAction[], filePath: string): FileAction {
  const action = actions.find(
    (a): a is FileAction => a.kind === "file" && a.path === filePath,
  );
  expect(action, `missing file ${filePath}`).toBeDefined();
  return action!;
}

function expectContainsAll(text: string, needles: string[]): void {
  for (const needle of needles) {
    expect(text).toContain(needle);
  }
}

describe("cross-agent context continuity acceptance", () => {
  it.each<ToolName>(["claude-code", "codex", "cursor"])(
    "%s renders the shared context and handoff contract",
    (adapter) => {
      const actions = renderBase(adapter);

      const agents = regionById(actions, "anamnesis-base");
      expect(agents.file).toBe("AGENTS.md");
      expectContainsAll(agents.content, [
        ".anamnesis/ontology/*.yaml",
        "system_graph.yaml",
        ".anamnesis/handoff/",
        ".anamnesis/handoff/active.md",
        "frontmatter",
        "Goal / Done / In flight / Decisions / Open questions / Next steps",
        "stale",
        "git log",
        "Claude Code",
        "Codex",
        "Cursor",
        "anamnesis update --dry-run",
        "--allow-exec-adapters",
      ]);

      const ontology = fileByPath(actions, ".anamnesis/ontology/base.yaml");
      expectContainsAll(ontology.content, [
        "managed_by: anamnesis",
        "ontology_dir: .anamnesis/ontology/",
      ]);
    },
  );

  it("renders Claude Code native hooks, commands, and skills", () => {
    const actions = renderBase("claude-code");

    const injectOntology = fileByPath(
      actions,
      ".claude/hooks/inject-ontology.sh",
    );
    expect(injectOntology.mode).toBe(0o755);
    expect(injectOntology.settingsHook).toEqual({ event: "SessionStart" });
    expect(injectOntology.content).toContain(".anamnesis/ontology");

    const injectHandoff = fileByPath(
      actions,
      ".claude/hooks/inject-handoff.sh",
    );
    expect(injectHandoff.mode).toBe(0o755);
    expect(injectHandoff.settingsHook).toEqual({ event: "SessionStart" });
    expect(injectHandoff.content).toContain(".anamnesis/handoff");

    const handoffReminder = fileByPath(
      actions,
      ".claude/hooks/handoff-reminder.sh",
    );
    expect(handoffReminder.mode).toBe(0o755);
    expect(handoffReminder.settingsHook).toEqual({ event: "Stop" });
    expect(handoffReminder.content).toContain("handoff");

    const uncommittedReminder = fileByPath(
      actions,
      ".claude/hooks/remind-uncommitted.sh",
    );
    expect(uncommittedReminder.mode).toBe(0o755);
    expect(uncommittedReminder.settingsHook).toEqual({
      event: "PostToolUse",
      matcher: "Edit",
    });

    expectContainsAll(
      fileByPath(actions, ".claude/commands/load-context.md").content,
      [".anamnesis/ontology/", "system_graph.yaml"],
    );
    expectContainsAll(
      fileByPath(actions, ".claude/commands/handoff-prepare.md").content,
      [".anamnesis/handoff/active.md", "next agent"],
    );
    expectContainsAll(
      fileByPath(actions, ".claude/skills/load-context/SKILL.md").content,
      ["every fresh session starts from zero project context"],
    );
    expectContainsAll(
      fileByPath(actions, ".claude/skills/ontology-enrich/SKILL.md").content,
      [
        "Layer B",
        "enriched.yaml",
        "schema_version",
        "anamnesis.enriched.v1",
        "supersedes",
        "open_questions",
      ],
    );
    expectContainsAll(
      fileByPath(actions, ".claude/skills/anamnesis-init/SKILL.md").content,
      [
        "multiple-choice question",
        "--scaffold-docs",
        "--enhance-docs",
      ],
    );
  });

  it("renders Codex native hooks plus AGENTS.md fallbacks", () => {
    const actions = renderBase("codex");

    const sessionStart = fileByPath(
      actions,
      ".anamnesis/codex-native-hooks/session-start.mjs",
    );
    expect(sessionStart.mode).toBe(0o755);
    expect(sessionStart.codexHook).toEqual({
      event: "SessionStart",
      matcher: "startup|resume|clear",
      command: codexNativeNodeCommand(
        ".anamnesis/codex-native-hooks/session-start.mjs",
      ),
    });
    expectContainsAll(sessionStart.content, [
      "hookSpecificOutput",
      ".anamnesis",
      "ontology",
      "handoff",
    ]);

    const dirtyReminder = fileByPath(
      actions,
      ".anamnesis/codex-native-hooks/base-PostToolUse-Edit-remind-uncommitted.mjs",
    );
    expect(dirtyReminder.codexHook).toEqual({
      event: "PostToolUse",
      matcher: "Edit|Write|apply_patch",
      command: codexNativeNodeCommand(
        ".anamnesis/codex-native-hooks/base-PostToolUse-Edit-remind-uncommitted.mjs",
      ),
      statusMessage: "Running anamnesis PostToolUse hook",
    });

    const stopReminder = fileByPath(
      actions,
      ".anamnesis/codex-native-hooks/base-Stop-handoff-reminder.mjs",
    );
    expect(stopReminder.codexHook).toEqual({
      event: "Stop",
      command: codexNativeNodeCommand(
        ".anamnesis/codex-native-hooks/base-Stop-handoff-reminder.mjs",
      ),
      statusMessage: "Running anamnesis Stop hook",
    });

    expectContainsAll(regionById(actions, "codex-cmd-load-context").content, [
      "/load-context",
      ".anamnesis/ontology/",
      "system_graph.yaml",
    ]);
    expectContainsAll(
      regionById(actions, "codex-cmd-handoff-prepare").content,
      ["/handoff-prepare", ".anamnesis/handoff/active.md", "next agent"],
    );
    expectContainsAll(regionById(actions, "codex-skill-load-context").content, [
      "Skill: `load-context`",
      "every fresh session starts from zero project context",
    ]);
    expectContainsAll(
      regionById(actions, "codex-skill-ontology-enrich").content,
      [
        "Skill: `ontology-enrich`",
        "Layer B",
        "enriched.yaml",
        "anamnesis.enriched.v1",
        "supersedes",
      ],
    );
    expectContainsAll(regionById(actions, "codex-skill-anamnesis-init").content, [
      "Skill: `anamnesis-init`",
      "multiple-choice question",
      "--scaffold-docs",
      "--enhance-docs",
    ]);
  });

  it("renders Cursor rule fallbacks for commands and skills", () => {
    const actions = renderBase("cursor");

    expectContainsAll(
      fileByPath(actions, ".cursor/rules/load-context-cmd.mdc").content,
      ["agentRequested: true", "/load-context", ".anamnesis/ontology/"],
    );
    expectContainsAll(
      fileByPath(actions, ".cursor/rules/handoff-prepare-cmd.mdc").content,
      [
        "agentRequested: true",
        "/handoff-prepare",
        ".anamnesis/handoff/active.md",
      ],
    );
    expectContainsAll(
      fileByPath(actions, ".cursor/rules/load-context.mdc").content,
      [
        "agentRequested: true",
        "every fresh session starts from zero project context",
      ],
    );
    expectContainsAll(
      fileByPath(actions, ".cursor/rules/ontology-enrich.mdc").content,
      [
        "agentRequested: true",
        "Layer B",
        "enriched.yaml",
        "anamnesis.enriched.v1",
        "open_questions",
      ],
    );
    expectContainsAll(
      fileByPath(actions, ".cursor/rules/anamnesis-init.mdc").content,
      [
        "agentRequested: true",
        "multiple-choice question",
        "--scaffold-docs",
        "--enhance-docs",
      ],
    );
  });
});
