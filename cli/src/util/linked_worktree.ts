import * as fs from "node:fs";
import * as path from "node:path";

/**
 * True when `dir` is the root of a linked Git worktree: its `.git` entry is
 * a file whose `gitdir:` points into a `worktrees/` directory. Agent
 * runtimes create such checkouts inside the project (for example
 * `.claude/worktrees/<name>`); their `.anamnesis/` files are copies of
 * another checkout, not sub-scopes of this project. A submodule also has a
 * `.git` file, but its gitdir (under `modules/`) has no `commondir` file,
 * so it stays included even when its path contains `worktrees/`.
 */
export function isLinkedGitWorktreeRoot(dir: string): boolean {
	const marker = path.join(dir, ".git");
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(marker);
	} catch {
		return false;
	}
	if (!stat.isFile() || stat.size > 4_096) return false;
	let content: string;
	try {
		content = fs.readFileSync(marker, "utf8");
	} catch {
		return false;
	}
	const match = /^gitdir:\s*(.+?)\s*$/mu.exec(content);
	if (!match) return false;
	const gitdir = path.resolve(dir, match[1]!);
	if (!/(?:^|[\\/])worktrees[\\/][^\\/]+[\\/]?$/u.test(gitdir)) return false;
	// Only a linked worktree's private gitdir has `commondir`.
	return fs.existsSync(path.join(gitdir, "commondir"));
}
