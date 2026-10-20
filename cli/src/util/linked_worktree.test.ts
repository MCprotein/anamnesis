import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contextSubagentPreamble } from "../commands/context_resume.js";
import { sessionContextBudget } from "../commands/session_context_budget.js";
import { isLinkedGitWorktreeRoot } from "./linked_worktree.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

/**
 * A project with its own ontology, a linked worktree copy under
 * .claude/worktrees/, and a submodule-style sub-scope.
 */
function fixture(): string {
	const projectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-linked-worktree-"),
	);
	roots.push(projectRoot);
	const write = (rel: string, content: string) => {
		const abs = path.join(projectRoot, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content);
	};
	write(".anamnesis/ontology/base.yaml", "rules:\n  - never copy\n");
	write(
		".claude/worktrees/agent-1/.git",
		`gitdir: ${projectRoot}/.git/worktrees/agent-1\n`,
	);
	write(
		".claude/worktrees/agent-1/.anamnesis/ontology/base.yaml",
		"rules:\n  - copy\n",
	);
	write(".git/worktrees/agent-1/commondir", "../..\n");
	// A relative gitdir with CRLF and trailing spaces, like a hand-edited file.
	write(
		".claude/worktrees/agent-2/.git",
		"gitdir: ../../../.git/worktrees/agent-2  \r\n",
	);
	write(".git/worktrees/agent-2/commondir", "../..\n");
	write(
		".claude/worktrees/agent-2/.anamnesis/ontology/base.yaml",
		"rules:\n  - copy\n",
	);
	write("packages/sub/.git", "gitdir: ../../.git/modules/sub\n");
	// A submodule whose path contains worktrees/ is still a sub-scope.
	write("worktrees/lib/.git", "gitdir: ../../.git/modules/worktrees/lib\n");
	write(".git/modules/worktrees/lib/HEAD", "ref: refs/heads/main\n");
	write("worktrees/lib/.anamnesis/ontology/lib.yaml", "rules:\n  - lib\n");
	write("packages/sub/.anamnesis/ontology/sub.yaml", "rules:\n  - sub\n");
	return projectRoot;
}

describe("linked worktree exclusion", () => {
	it("recognizes linked worktree roots but not submodules or normal dirs", () => {
		const projectRoot = fixture();
		expect(
			isLinkedGitWorktreeRoot(
				path.join(projectRoot, ".claude/worktrees/agent-1"),
			),
		).toBe(true);
		expect(isLinkedGitWorktreeRoot(path.join(projectRoot, "packages/sub"))).toBe(
			false,
		);
		expect(isLinkedGitWorktreeRoot(projectRoot)).toBe(false);
		expect(
			isLinkedGitWorktreeRoot(
				path.join(projectRoot, ".claude/worktrees/agent-2"),
			),
		).toBe(true);
		expect(isLinkedGitWorktreeRoot(path.join(projectRoot, "worktrees/lib"))).toBe(
			false,
		);
	});

	it("keeps worktree ontology copies out of startup and preamble pointers", () => {
		const projectRoot = fixture();
		const budget = sessionContextBudget({ projectRoot });
		const paths = budget.sources.map((source) => source.path).sort();
		expect(paths).toEqual([
			".anamnesis/ontology/base.yaml",
			"packages/sub/.anamnesis/ontology/sub.yaml",
			"worktrees/lib/.anamnesis/ontology/lib.yaml",
		]);
		const preamble = contextSubagentPreamble({ projectRoot });
		expect(preamble.preamble).not.toContain(".claude/worktrees/");
		expect(preamble.summary.startupSourcePointers).toBe(3);
	});

	it("keeps worktree ontology copies out of the Claude SessionStart hook", () => {
		if (process.platform === "win32") return;
		const projectRoot = fixture();
		const result = spawnSync(
			"bash",
			[path.resolve("base/adapters/claude-code/hooks/inject-ontology.sh")],
			{
				cwd: projectRoot,
				env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
				encoding: "utf8",
			},
		);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain(".anamnesis/ontology/base.yaml");
		expect(result.stdout).toContain("packages/sub/.anamnesis/ontology/sub.yaml");
		expect(result.stdout).toContain("worktrees/lib/.anamnesis/ontology/lib.yaml");
		expect(result.stdout).not.toContain(".claude/worktrees/");
	});

	it("keeps worktree ontology copies out of the Codex SessionStart hook", () => {
		const projectRoot = fixture();
		const result = spawnSync(
			process.execPath,
			[path.resolve("base/adapters/codex/hooks/session-start.mjs")],
			{
				cwd: projectRoot,
				env: { ...process.env, ANAMNESIS_BIN: "/nonexistent-anamnesis" },
				input: JSON.stringify({ cwd: projectRoot, source: "startup" }),
				encoding: "utf8",
			},
		);
		expect(result.status, result.stderr).toBe(0);
		const context = JSON.parse(result.stdout).hookSpecificOutput
			.additionalContext as string;
		expect(context).toContain(".anamnesis/ontology/base.yaml");
		expect(context).toContain("packages/sub/.anamnesis/ontology/sub.yaml");
		expect(context).toContain("worktrees/lib/.anamnesis/ontology/lib.yaml");
		expect(context).not.toContain(".claude/worktrees/");
	});
});
