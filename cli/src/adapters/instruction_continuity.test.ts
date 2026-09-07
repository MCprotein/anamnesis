import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolName } from "../core/agentfile.js";
import { loadBaseFragment } from "../core/fragments.js";
import {
  RendererRegistry,
  type FileAction,
  type RegionAction,
  type RenderAction,
  type RenderContext,
} from "../core/render.js";
import { registerClaudeCode } from "./claude-code/index.js";
import { registerCodex } from "./codex/index.js";
import { registerCursor } from "./cursor/index.js";

const SETTINGS = {
  ontology_file: "system_graph.yaml",
  agents_md_path: "AGENTS.md",
  claude_md_path: "CLAUDE.md",
};

function renderBase(adapter: ToolName): RenderAction[] {
  const libraryRoot = process.cwd();
  const fragment = loadBaseFragment(libraryRoot);
  expect(fragment).not.toBeNull();

  const registry = new RendererRegistry();
  registerClaudeCode(registry);
  registerCodex(registry);
  registerCursor(registry);

  const context: RenderContext = {
    fragment: fragment!,
    fragmentDir: path.join(libraryRoot, "base"),
    projectRoot: "/tmp/anamnesis-instruction-continuity",
    scopePath: ".",
    settings: SETTINGS,
    params: {},
  };
  return registry.planFragment(context, adapter);
}

function file(actions: RenderAction[], target: string): FileAction {
  const action = actions.find(
    (candidate): candidate is FileAction =>
      candidate.kind === "file" && candidate.path === target,
  );
  expect(action, `missing file ${target}`).toBeDefined();
  return action!;
}

function region(actions: RenderAction[], id: string): RegionAction {
  const action = actions.find(
    (candidate): candidate is RegionAction =>
      candidate.kind === "region" && candidate.regionId === id,
  );
  expect(action, `missing region ${id}`).toBeDefined();
  return action!;
}

function expectContinuityContract(text: string): void {
  expect(text).toContain("standalone");
  expect(text).toContain("auxiliary");
  expect(text).toContain("continue the original task");
  expect(text).toContain("does not broaden the user's request");
}

describe("instruction continuity contract", () => {
  it.each<ToolName>(["claude-code", "codex", "cursor"])(
    "%s receives the shared stale-handoff and authorization boundaries",
    (adapter) => {
      const agents = region(renderBase(adapter), "anamnesis-base").content;
      expect(agents).toContain(
        "이미 완료됐음이 명확하면 stale handoff 를 별도 확인 없이 무시",
      );
      expect(agents).toContain("경계가 불명확하면 사용자에게 확인");
      expect(agents).toContain("현재 요청의 권한이나 범위를 넓히지 않음");
      expect(agents).toContain("reminder 자체는 handoff 작성 요청이 아니므로");
    },
  );

  it("keeps standalone and auxiliary behavior in Claude Code command sources", () => {
    const actions = renderBase("claude-code");
    expectContinuityContract(
      file(actions, ".claude/commands/load-context.md").content,
    );

    const handoff = file(
      actions,
      ".claude/commands/handoff-prepare.md",
    ).content;
    expectContinuityContract(handoff);
    expect(handoff).toContain("preserve user-owned");
    expect(handoff).toContain("ask the user before changing that entry");
    expect(handoff).toContain(
      "must not create or update handoff files automatically",
    );
  });

  it("propagates the command and skill contract to Codex fallbacks and Cursor rules", () => {
    const codex = renderBase("codex");
    const cursor = renderBase("cursor");

    expectContinuityContract(region(codex, "codex-cmd-load-context").content);
    expectContinuityContract(
      region(codex, "codex-cmd-handoff-prepare").content,
    );
    expectContinuityContract(region(codex, "codex-skill-load-context").content);
    expectContinuityContract(
      file(codex, ".codex/skills/load-context/SKILL.md").content,
    );

    expectContinuityContract(
      file(cursor, ".cursor/rules/load-context-cmd.mdc").content,
    );
    expectContinuityContract(
      file(cursor, ".cursor/rules/handoff-prepare-cmd.mdc").content,
    );
    expectContinuityContract(
      file(cursor, ".cursor/rules/load-context.mdc").content,
    );
  });
});
