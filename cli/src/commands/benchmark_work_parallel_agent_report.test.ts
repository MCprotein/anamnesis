import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	publishParallelArtifacts,
} from "./benchmark_work_parallel_agent.js";
import {
	tempRoot,
} from "./benchmark_work_parallel_agent.test-support.js";

describe("real parallel-agent benchmark", () => {
	it("publishes atomically and rejects escaping or symlink destinations", () => {
		const root = tempRoot();
		const result = {
			project_root: root,
			artifacts: {},
			markdown: "safe",
			model: "test<&>",
			runs_per_condition: 1,
			harness_validity: { ok: true, checks: {} },
			summary: {
				disabled: { total_tokens: 10, final_accuracy_pct: 100 },
				enabled: { total_tokens: 9, final_accuracy_pct: 100 },
				delta: { total_tokens_pct: -10, critical_path_pct: 5 },
				paired: {
					total_tokens_pct_p50: -10,
					critical_path_pct_p50: 5,
				},
			},
			quality: {
				enabled_ready: true,
				disabled_passes: 1,
				enabled_passes: 1,
				total_per_condition: 1,
			},
			comparison: {
				verdict: "INCONCLUSIVE",
				delta_points: 0,
			},
		} as Parameters<typeof publishParallelArtifacts>[0];
		const artifacts = publishParallelArtifacts(result);
		expect(fs.existsSync(path.join(root, artifacts.json!))).toBe(true);
		const artifactPaths = [
			artifacts.markdown!,
			artifacts.summary_svg!,
			artifacts.json!,
		];
		const original = artifactPaths.map((relativePath) =>
			fs.readFileSync(path.join(root, relativePath), "utf8"),
		);
		expect(original[1]).toContain("Work A/B benchmark");
		expect(original[1]).toContain("product verdict INCONCLUSIVE");
		expect(original[1]).toContain("Stage token gate");
		expect(original[1]).not.toContain("directional verdict");
		let renames = 0;
		expect(() =>
			publishParallelArtifacts(
				{ ...result, markdown: "replacement" },
				undefined,
				{
					renameSync: (from, to) => {
						renames += 1;
						if (renames === 2) throw new Error("injected publish failure");
						fs.renameSync(from, to);
					},
					rmSync: fs.rmSync,
				},
			),
		).toThrow(/injected publish failure/iu);
		expect(
			artifactPaths.map((relativePath) =>
				fs.readFileSync(path.join(root, relativePath), "utf8"),
			),
		).toEqual(original);
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), "parallel-outside-"));
		expect(() =>
			publishParallelArtifacts(result, "../parallel-outside"),
		).toThrow(/escapes/iu);
		const link = path.join(root, "link");
		fs.symlinkSync(outside, link, "dir");
		expect(() => publishParallelArtifacts(result, "link")).toThrow(/symlink/iu);
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	});

	it("fails closed if the private staging directory changes during publication", () => {
		const root = tempRoot();
		const outside = fs.mkdtempSync(
			path.join(os.tmpdir(), "parallel-stage-race-"),
		);
		const result = {
			project_root: root,
			artifacts: {},
			markdown: "safe",
			model: "test",
			runs_per_condition: 1,
			harness_validity: { ok: true, checks: {} },
			summary: {
				disabled: { total_tokens: 10, final_accuracy_pct: 100 },
				enabled: { total_tokens: 9, final_accuracy_pct: 100 },
				delta: { total_tokens_pct: -10, critical_path_pct: 5 },
				paired: {
					total_tokens_pct_p50: -10,
					critical_path_pct_p50: 5,
				},
			},
			quality: {
				enabled_ready: true,
				disabled_passes: 1,
				enabled_passes: 1,
				total_per_condition: 1,
			},
			comparison: {
				verdict: "INCONCLUSIVE",
				delta_points: 0,
			},
		} as Parameters<typeof publishParallelArtifacts>[0];
		let replaced = false;
		expect(() =>
			publishParallelArtifacts(result, undefined, {
				renameSync: (from, to) => {
					fs.renameSync(from, to);
					if (replaced) return;
					replaced = true;
					const stagedDir = path.dirname(from);
					fs.renameSync(stagedDir, `${stagedDir}.moved`);
					fs.symlinkSync(outside, stagedDir, "dir");
				},
				rmSync: fs.rmSync,
			}),
		).toThrow(/artifact publish failed|changed during publication/iu);
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	});
});
