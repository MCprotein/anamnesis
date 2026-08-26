import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
	publishParallelArtifacts,
	workParallelAgentBenchmark,
	type ParallelRequirement,
	type ParallelRunner,
} from "./benchmark_work_parallel_agent.js";

const REQUIREMENTS: ParallelRequirement[] = [
	"REQ-A",
	"REQ-B",
	"REQ-C",
	"REQ-D",
].map((id, index) => ({
	id,
	status: index === 3 ? "pending" : "verified",
	summary: `sanitized parallel condition ${index + 1}`,
}));

function tempRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "parallel-agent-test-"));
}
function output(
	data: Record<string, unknown>,
	tokens = 10,
	usage?: Record<string, unknown>,
): string {
	return `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(data) } })}\n${JSON.stringify({ type: "turn.completed", usage: usage ?? { input_tokens: tokens - 2, cached_input_tokens: 0, output_tokens: 2, total_tokens: tokens } })}`;
}
function runner(
	opts: { malformedUsage?: boolean; overlap?: boolean; wrong?: boolean } = {},
): ParallelRunner {
	let active = 0;
	let sawOverlap = false;
	return async (request) => {
		const stage = request.prompt.match(/\[parallel-stage:([^\]]+)/u)?.[1];
		active += 1;
		if (active > 1) sawOverlap = true;
		await new Promise((resolve) =>
			setTimeout(
				resolve,
				opts.overlap === false
					? 0
					: stage === "child-a"
						? 12
						: stage === "child-b"
							? 6
							: 1,
			),
		);
		active -= 1;
		const ids = ["REQ-A", "REQ-B", "REQ-C", "REQ-D"];
		let data: Record<string, unknown>;
		const req = (id: string) => ({
			id,
			status: id === "REQ-D" ? "pending" : "verified",
			summary: `sanitized parallel condition ${ids.indexOf(id) + 1}`,
		});
		if (stage === "leader-plan")
			data = { child_a: ids.slice(0, 2), child_b: ids.slice(2) };
		else if (stage === "child-a")
			data = {
				requirements: (opts.wrong ? [ids[0]] : ids.slice(0, 2)).map(req),
			};
		else if (stage === "child-b")
			data = { requirements: ids.slice(2).map(req) };
		else if (stage === "reviewer")
			data = { union_complete: !opts.wrong, duplicates: 0, conflicts: 0 };
		else data = { requirements: (opts.wrong ? ids.slice(0, 3) : ids).map(req) };
		return {
			status: 0,
			stdout: opts.malformedUsage
				? `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(data) } })}\n${JSON.stringify({ type: "turn.completed", usage: {} })}`
				: output(data),
			stderr: sawOverlap ? "" : "",
			elapsedMs: 1,
		};
	};
}

describe("real parallel-agent benchmark", () => {
	it("runs child stages concurrently and aggregates all five stage token costs", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			model: "test",
			runner: runner(),
			requirements: REQUIREMENTS,
		});
		expect(result.planned_initial_invocations).toBe(30);
		expect(result.actual_invocations).toBe(30);
		expect(result.runs[0]?.disabled.children_overlap_ms).toBeGreaterThan(0);
		expect(result.runs[0]?.enabled.children_overlap_ms).toBeGreaterThan(0);
		expect(result.runs[0]?.disabled.tokens.total_tokens).toBe(50);
		expect(result.runs.map((r) => r.order[0])).toEqual([
			"disabled",
			"enabled",
			"disabled",
		]);
		expect(result.harness_validity.ok).toBe(true);
		expect(result.product_contract.ok).toBe(true);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("fails validity when a stage is incorrect without excluding the run", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ wrong: true }),
			requirements: REQUIREMENTS,
		});
		expect(result.ok).toBe(false);
		expect(result.harness_validity.checks.no_excluded_conditions).toBe(true);
		expect(result.product_contract.disabled_passes).toBe(0);
		expect(result.product_contract.enabled_passes).toBe(0);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("fails token-accounting validity when a usage event is malformed", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ malformedUsage: true }),
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.checks.full_token_accounting).toBe(false);
		expect(result.harness_validity.ok).toBe(false);
		expect(result.runs[0]?.disabled.token_accounting_complete).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

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
				disabled: { total_tokens: 10 },
				enabled: { total_tokens: 9 },
				delta: { total_tokens_pct: -10, critical_path_pct: 5 },
			},
			product_contract: {
				ok: true,
				disabled_passes: 1,
				enabled_passes: 1,
				total_per_condition: 1,
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
				disabled: { total_tokens: 10 },
				enabled: { total_tokens: 9 },
				delta: { total_tokens_pct: -10, critical_path_pct: 5 },
			},
			product_contract: {
				ok: true,
				disabled_passes: 1,
				enabled_passes: 1,
				total_per_condition: 1,
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
