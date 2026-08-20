import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEvidenceRecords } from "../core/evidence.js";
import {
	WorkContinuityBenchmarkError,
	workContinuityBenchmark,
} from "./benchmark_work.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function root(): string {
	const value = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-work-continuity-benchmark-"),
	);
	roots.push(value);
	return value;
}

describe("work continuity benchmark", () => {
	it("compares the same compacted scenario with Work disabled and enabled", () => {
		const projectRoot = root();
		const result = workContinuityBenchmark({
			projectRoot,
			runs: 2,
			requirements: 10,
			compactFactWindow: 4,
			write: true,
			append: true,
			now: () => new Date("2026-08-20T00:00:00.000Z"),
		});

		expect(result.ok).toBe(true);
		expect(result.scenario.comparison_mode).toBe("retention-stress");
		expect(result.summary).toMatchObject({
			runs: 2,
			requirements: 10,
			verified_requirements: 5,
			compact_fact_window: 4,
			disabled: {
				requirements_recovered: 4,
				requirement_recall_pct: 40,
				status_accuracy_pct: 100,
				progress_pct: 0,
				progress_error_points: 50,
			},
			enabled: {
				requirements_recovered: 10,
				requirement_recall_pct: 100,
				status_accuracy_pct: 100,
				progress_pct: 50,
				progress_error_points: 0,
			},
			delta: {
				requirement_recall_points: 60,
				status_accuracy_points: 0,
				progress_error_points: -50,
			},
		});
		expect(result.summary.enabled.storage_bytes).toBeGreaterThan(0);
		expect(result.summary.disabled.storage_bytes).toBeGreaterThan(0);
		expect(result.summary.enabled.resume_ms).toBeGreaterThanOrEqual(0);
		expect(result.summary.latency.enabled.resume_ms).toMatchObject({
			average: result.summary.enabled.resume_ms,
		});
		expect(result.markdown).toContain("Same sanitized scenario");
		expect(result.markdown).toContain("not measured model intelligence");
		for (const artifact of [result.artifacts.json, result.artifacts.markdown]) {
			expect(artifact).toBeDefined();
			expect(fs.existsSync(path.join(projectRoot, artifact!))).toBe(true);
		}
		const evidence = readEvidenceRecords(projectRoot);
		expect(evidence.records).toHaveLength(1);
		expect(evidence.records[0]).toMatchObject({
			kind: "work-continuity-benchmark",
			summary: {
				runs: 2,
				disabled_recall_pct: 40,
				enabled_recall_pct: 100,
			},
		});
	});

	it("uses equal complete information by default", () => {
		const result = workContinuityBenchmark({
			projectRoot: root(),
			runs: 1,
			requirements: 10,
		});
		expect(result.summary.compact_fact_window).toBe(10);
		expect(result.scenario.comparison_mode).toBe("equal-facts");
		expect(result.summary.disabled).toMatchObject({
			requirement_recall_pct: 100,
			status_accuracy_pct: 100,
			progress_error_points: 0,
		});
		expect(result.summary.enabled).toMatchObject({
			requirement_recall_pct: 100,
			status_accuracy_pct: 100,
			progress_error_points: 0,
		});
	});

	it("rejects invalid scenario bounds", () => {
		const projectRoot = root();
		expect(() => workContinuityBenchmark({ projectRoot, runs: 0 })).toThrow(
			WorkContinuityBenchmarkError,
		);
		expect(() =>
			workContinuityBenchmark({ projectRoot, requirements: 101 }),
		).toThrow("at most 100");
	});
});
