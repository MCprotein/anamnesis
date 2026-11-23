import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	appendParallelPaidAttemptLocked,
	parallelPaidAttemptIndexPath,
	workParallelAgentBenchmark,
} from "./benchmark_work_parallel_agent.js";
import {
	runner,
	tempRoot,
} from "./benchmark_work_parallel_agent.test-support.js";

describe("real parallel-agent benchmark", () => {
	it("refuses a second paid attempt for the same implementation SHA", () => {
		const root = tempRoot();
		const indexPath = parallelPaidAttemptIndexPath(root);
		expect(indexPath).toBe(
			path.join(
				root,
				"docs/benchmark-evidence/work-parallel-agent-ab/v10-attempts.jsonl",
			),
		);
		expect(
			appendParallelPaidAttemptLocked(
				indexPath,
				{
					phase: "started",
					implementation_git_sha: "abc123",
				},
				"abc123",
			),
		).toBe(0);
		expect(() =>
			appendParallelPaidAttemptLocked(
				indexPath,
				{
					phase: "started",
					implementation_git_sha: "abc123",
				},
				"abc123",
			),
		).toThrow(/already ran/iu);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("recovers only a stale paid-attempt lock owned by a dead process", () => {
		const root = tempRoot();
		const indexPath = parallelPaidAttemptIndexPath(root);
		fs.mkdirSync(path.dirname(indexPath), { recursive: true });
		const lockPath = `${indexPath}.lock`;
		fs.writeFileSync(
			lockPath,
			JSON.stringify({
				pid: 2_147_483_647,
				created_at: "2000-01-01T00:00:00.000Z",
			}),
		);
		expect(
			appendParallelPaidAttemptLocked(indexPath, {
				phase: "started",
				implementation_git_sha: "recovered-sha",
			}),
		).toBe(0);
		expect(fs.existsSync(lockPath)).toBe(false);
		fs.writeFileSync(
			lockPath,
			JSON.stringify({
				pid: process.pid,
				created_at: "2000-01-01T00:00:00.000Z",
			}),
		);
		expect(() =>
			appendParallelPaidAttemptLocked(indexPath, {
				phase: "started",
				implementation_git_sha: "blocked-sha",
			}),
		).toThrow(/another paid benchmark attempt/iu);
		expect(fs.existsSync(lockPath)).toBe(true);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("refuses an unrecorded or uncommitted claim-eligible final run", async () => {
		const root = tempRoot();
		await expect(
			workParallelAgentBenchmark({
				projectRoot: root,
				protocol: "final",
				runner: runner(),
			}),
		).rejects.toThrow(/requires the real Codex runner/iu);
		await expect(
			workParallelAgentBenchmark({
				projectRoot: root,
				protocol: "final",
				scenarioFamilies: ["clean-partition"],
			}),
		).rejects.toThrow(/scenario families cannot override/iu);
		await expect(
			workParallelAgentBenchmark({ projectRoot: root, protocol: "final" }),
		).rejects.toThrow(/requires --write/iu);
		await expect(
			workParallelAgentBenchmark({
				projectRoot: root,
				protocol: "final",
				write: true,
			}),
		).rejects.toThrow(/requires a Git commit/iu);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("requires a committed clean worktree for a paid shadow run", async () => {
		const root = tempRoot();
		await expect(
			workParallelAgentBenchmark({
				projectRoot: root,
				protocol: "shadow",
				runner: runner(),
			}),
		).rejects.toThrow(/requires the real Codex runner/iu);
		await expect(
			workParallelAgentBenchmark({ projectRoot: root, protocol: "shadow" }),
		).rejects.toThrow(/requires --write/iu);
		await expect(
			workParallelAgentBenchmark({
				projectRoot: root,
				protocol: "shadow",
				write: true,
			}),
		).rejects.toThrow(/requires a Git commit/iu);
		fs.rmSync(root, { recursive: true, force: true });
	});
});
