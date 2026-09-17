import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
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

function procedure(actions: RenderAction[], id: string): string {
	const routing = region(actions, id).content;
	const source = routing.match(
		/Full procedure and manual fallback[^\n]*`([^`]+)`/,
	);
	if (!source && id.startsWith("codex-cmd-")) return routing;
	expect(source, `missing procedure pointer for ${id}`).not.toBeNull();
	return file(actions, source![1]!).content;
}

function expectContinuityContract(text: string): void {
  expect(text).toContain("standalone");
  expect(text).toContain("auxiliary");
  expect(text).toContain("continue the original task");
  expect(text).toContain("does not broaden the user's request");
}

describe("instruction continuity contract", () => {
	it.each<ToolName>([
		"claude-code",
		"codex",
		"cursor",
	])("%s receives the shared stale-handoff and authorization boundaries", (adapter) => {
      const agents = region(renderBase(adapter), "anamnesis-base").content;
      expect(agents).toContain(
        "이미 완료됐음이 명확하면 stale handoff 를 별도 확인 없이 무시",
      );
      expect(agents).toContain("경계가 불명확하면 사용자에게 확인");
      expect(agents).toContain("현재 요청의 권한이나 범위를 넓히지 않음");
      expect(agents).toContain("reminder 자체는 handoff 작성 요청이 아니므로");
      expect(agents).toContain("읽기·수정 작업 모두 필요한 원문 경로");
      expect(agents).toContain("경로만 주어졌다고 근거가 충분한 것은 아님");
      expect(agents).toContain("필수 온톨로지·active handoff 확인은 유지함");
      expect(agents).toContain("수정 작업이라는 이유만으로 query 를 강제하지 않음");
      expect(agents).toContain("이미 완료된 native startup 탐색은 재실행하지 않음");
      expect(agents).toContain("근거 부족이 이미 명확하면");
      expect(agents).toContain("불필요한 사전 목록 탐색 없이");
      expect(agents).toContain("query 를 서로 독립적인 초기 확인과 같은 호출에 묶음");
      expect(agents).not.toContain("불충분하거나 파일을 수정하는 작업이면");
	});

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

		expectContinuityContract(procedure(codex, "codex-cmd-load-context"));
		expectContinuityContract(procedure(codex, "codex-cmd-handoff-prepare"));
		expectContinuityContract(procedure(codex, "codex-skill-load-context"));
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


describe("Claude startup source retrieval guidance", () => {
  it.each(["inject-ontology.sh", "inject-handoff.sh"])(
    "%s permits grounded edits without losing compact/full source boundaries",
    (hook) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-query-guidance-"));
      try {
        fs.mkdirSync(path.join(root, ".anamnesis/handoff"), { recursive: true });
        fs.writeFileSync(path.join(root, "system_graph.yaml"), "description: ORIGINAL_SOURCE_BODY\n");
        fs.writeFileSync(path.join(root, ".anamnesis/handoff/active.md"), "# Active handoff index\n\n## Notes\nORIGINAL_SOURCE_BODY\n");
        for (const mode of ["compact", "full"]) {
          const result = spawnSync("bash", [path.resolve("base/adapters/claude-code/hooks", hook)], {
            cwd: root,
            env: { ...process.env, CLAUDE_PROJECT_DIR: root, ANAMNESIS_SESSION_CONTEXT_MODE: mode },
            encoding: "utf8",
            timeout: 5000,
          });
          expect(result.status).toBe(0);
          expect(result.stderr).toBe("");
          if (mode === "compact") {
            expect(result.stdout).toContain("for read and edit tasks");
            expect(result.stdout).toContain("Editing alone does not require a query");
            expect(result.stdout).toContain("missing, unresolved, ambiguous, stale or insufficient");
            expect(result.stdout).toContain("read returned source_path/stable_ref");
            expect(result.stdout).toContain("batch that query with independent startup checks");
            expect(result.stdout).toContain("do not add a preliminary directory scan");
            expect(result.stdout).not.toContain("or the task edits files, run");
            expect(result.stdout).not.toContain("ORIGINAL_SOURCE_BODY");
          } else {
            expect(result.stdout).toContain("ORIGINAL_SOURCE_BODY");
          }
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
