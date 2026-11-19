import {
	type ParallelConditionRun,
	type ParallelPairRun,
	type ParallelRequirement,
	type ParallelReviewAudit,
	type ParallelScenarioFamily,
	type ParallelStage,
	type ParallelStageRecord,
	type ParallelSummary,
	STAGES,
} from "./benchmark_work_parallel_agent_types.js";

export function reviewAuditStageIntegrity(
	stages: ParallelStageRecord[],
): boolean {
	const audits = stages.filter((stage) => stage.stage === "review-audit");
	if (audits.length !== 1) return false;
	const audit = audits[0];
	const summary = audit?.review_audit_summary;
	if (!audit || !summary) return false;
	const counts = [
		summary.missing,
		summary.duplicate,
		summary.unexpected,
		summary.misassigned,
		summary.status_mismatch,
		summary.summary_mismatch,
		summary.malformed_rows,
	];
	const zeroIssues = counts.every((count) => count === 0) && summary.order_ok;
	const digestPattern = /^[a-f0-9]{64}$/u;
	return (
		audit.execution_mode === "deterministic" &&
		audit.execution_ok &&
		audit.token_accounting_complete &&
		audit.input_bytes_complete &&
		audit.input_bytes > 0 &&
		audit.elapsed_ms >= 0 &&
		audit.start_offset_ms >= 0 &&
		audit.end_offset_ms >= audit.start_offset_ms &&
		Object.values(audit.tokens).every((tokens) => tokens === 0) &&
		counts.every((count) => Number.isInteger(count) && count >= 0) &&
		summary.verdict === (zeroIssues ? "accept" : "repair") &&
		typeof summary.actual_digest === "string" &&
		digestPattern.test(summary.actual_digest) &&
		typeof summary.oracle_digest === "string" &&
		digestPattern.test(summary.oracle_digest)
	);
}

interface RequirementScore {
	accuracyPct: number;
	exact: boolean;
	expectedRequirements: number;
	exactRequirements: number;
	unexpectedRows: number;
	duplicateIds: number;
	malformedRows: number;
}

export function countFinalRequirementDefects(
	score: Pick<
		RequirementScore,
		| "expectedRequirements"
		| "exactRequirements"
		| "unexpectedRows"
		| "duplicateIds"
	>,
): number {
	return (
		Math.max(0, score.expectedRequirements - score.exactRequirements) +
		score.unexpectedRows +
		score.duplicateIds
	);
}

export function scoreRequirements(
	value: unknown,
	expected: ParallelRequirement[],
): RequirementScore {
	const rawRows = Array.isArray(value) ? value : [];
	const rows = rawRows.filter(
		(item): item is Record<string, unknown> =>
			item !== null && typeof item === "object" && !Array.isArray(item),
	);
	const malformedRows =
		(Array.isArray(value) ? 0 : 1) + rawRows.length - rows.length;
	const expectedIds = new Set(expected.map((requirement) => requirement.id));
	const idCounts = new Map<string, number>();
	for (const row of rows) {
		if (typeof row.id !== "string") continue;
		idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1);
	}
	const exactRequirements = expected.filter((requirement) => {
		if (idCounts.get(requirement.id) !== 1) return false;
		return rows.some(
			(row) =>
				row.id === requirement.id &&
				row.status === requirement.status &&
				row.summary === requirement.summary,
		);
	}).length;
	const unexpectedRows =
		malformedRows +
		rows.filter((row) => typeof row.id !== "string" || !expectedIds.has(row.id))
			.length;
	const duplicateIds = [...idCounts.values()].reduce(
		(total, count) => total + Math.max(0, count - 1),
		0,
	);
	const orderedExact =
		rawRows.length === expected.length &&
		malformedRows === 0 &&
		rawRows.every((item, index) => {
			if (!item || typeof item !== "object" || Array.isArray(item))
				return false;
			const row = item as Record<string, unknown>;
			const wanted = expected[index];
			return (
				row.id === wanted?.id &&
				row.status === wanted.status &&
				row.summary === wanted.summary
			);
		});
	return {
		accuracyPct: round(
			expected.length > 0 ? (exactRequirements * 100) / expected.length : 100,
		),
		exact:
			orderedExact &&
			unexpectedRows === 0 &&
			duplicateIds === 0 &&
			exactRequirements === expected.length,
		expectedRequirements: expected.length,
		exactRequirements,
		unexpectedRows,
		duplicateIds,
		malformedRows,
	};
}

export function applyRequirementScore(
	record: ParallelStageRecord,
	score: RequirementScore,
): void {
	record.requirement_accuracy_pct = score.accuracyPct;
	record.expected_requirements = score.expectedRequirements;
	record.exact_requirements = score.exactRequirements;
	record.unexpected_requirement_rows = score.unexpectedRows;
	record.duplicate_requirement_ids = score.duplicateIds;
	record.malformed_requirement_rows = score.malformedRows;
}

export function perturbReviewInputs(
	family: ParallelScenarioFamily,
	childA: unknown,
	childB: unknown,
): { childA: unknown; childB: unknown } {
	const left = structuredClone(childA);
	const right = structuredClone(childB);
	if (
		family !== "review-gate-recovery" ||
		!Array.isArray(left) ||
		!Array.isArray(right) ||
		left.length < 4
	) {
		return { childA: left, childB: right };
	}
	const omitted = left.shift();
	const duplicate = left[0];
	if (duplicate !== undefined) left.splice(1, 0, structuredClone(duplicate));
	const stale = left[2];
	if (stale && typeof stale === "object" && !Array.isArray(stale)) {
		const row = stale as Record<string, unknown>;
		row.status = row.status === "verified" ? "pending" : "verified";
	}
	const misassigned = left.splice(3, 1)[0];
	if (misassigned !== undefined) right.unshift(misassigned);
	void omitted;
	return { childA: left, childB: right };
}

export function auditParallelReviewConsistency(input: {
	reviewerRequirements: unknown;
	childA: unknown;
	childB: unknown;
	childAAssignment: string[];
	childBAssignment: string[];
}): ParallelReviewAudit {
	const expectedChildA = input.childAAssignment.flatMap((id) => {
		const requirement = requirementFromRow(input.reviewerRequirements, id);
		return requirement === undefined ? [] : [requirement];
	});
	const expectedChildB = input.childBAssignment.flatMap((id) => {
		const requirement = requirementFromRow(input.reviewerRequirements, id);
		return requirement === undefined ? [] : [requirement];
	});
	return analyzeChildReports(
		input.childA,
		input.childB,
		expectedChildA,
		expectedChildB,
	);
}

export function analyzeChildReports(
	childA: unknown,
	childB: unknown,
	expectedChildA: ParallelRequirement[],
	expectedChildB: ParallelRequirement[],
): ParallelReviewAudit {
	const rawChildValues = [childA, childB];
	const rawRowsByChild = rawChildValues.map((value) =>
		Array.isArray(value) ? value : [],
	);
	const rowsByChild = rawRowsByChild.map((rows) =>
		rows.filter(
			(item): item is Record<string, unknown> =>
				item !== null && typeof item === "object" && !Array.isArray(item),
		),
	);
	const malformedRows = rawRowsByChild.reduce(
		(total, rawRows, index) =>
			total +
			(Array.isArray(rawChildValues[index]) ? 0 : 1) +
			rawRows.length -
			rowsByChild[index]!.length,
		0,
	);
	const rows = rowsByChild.flat();
	const expected = [...expectedChildA, ...expectedChildB];
	const expectedById = new Map(
		expected.map((requirement) => [requirement.id, requirement]),
	);
	const byId = new Map<string, Record<string, unknown>[]>();
	for (const row of rows) {
		if (typeof row.id !== "string") continue;
		const current = byId.get(row.id) ?? [];
		current.push(row);
		byId.set(row.id, current);
	}
	const missingIds = expected
		.filter((requirement) => !byId.has(requirement.id))
		.map((requirement) => requirement.id);
	const duplicateIds = expected
		.filter((requirement) => (byId.get(requirement.id)?.length ?? 0) > 1)
		.map((requirement) => requirement.id);
	const unexpectedIds = [...byId.keys()].filter((id) => !expectedById.has(id));
	const expectedAIds = new Set(
		expectedChildA.map((requirement) => requirement.id),
	);
	const expectedBIds = new Set(
		expectedChildB.map((requirement) => requirement.id),
	);
	const misassignedIds = [
		...rowsByChild[0]!
			.filter(
				(row) =>
					typeof row.id === "string" &&
					expectedById.has(row.id) &&
					!expectedAIds.has(row.id),
			)
			.map((row) => row.id as string),
		...rowsByChild[1]!
			.filter(
				(row) =>
					typeof row.id === "string" &&
					expectedById.has(row.id) &&
					!expectedBIds.has(row.id),
			)
			.map((row) => row.id as string),
	].filter((id, index, values) => values.indexOf(id) === index);
	const statusMismatchIds = expected
		.filter((requirement) =>
			(byId.get(requirement.id) ?? []).some(
				(row) => row.status !== requirement.status,
			),
		)
		.map((requirement) => requirement.id);
	const summaryMismatchIds = expected
		.filter((requirement) =>
			(byId.get(requirement.id) ?? []).some(
				(row) => row.summary !== requirement.summary,
			),
		)
		.map((requirement) => requirement.id);
	const orderOk =
		equalStringArrays(
			rowsByChild[0]!.map((row) => row.id),
			expectedChildA.map((requirement) => requirement.id),
		) &&
		equalStringArrays(
			rowsByChild[1]!.map((row) => row.id),
			expectedChildB.map((requirement) => requirement.id),
		);
	const hasIssues =
		!orderOk ||
		[
			missingIds,
			duplicateIds,
			unexpectedIds,
			misassignedIds,
			statusMismatchIds,
			summaryMismatchIds,
		].some((values) => values.length > 0);
	const requiresRepair = hasIssues || malformedRows > 0;
	return {
		verdict: requiresRepair ? "repair" : "accept",
		missingIds,
		duplicateIds,
		unexpectedIds,
		misassignedIds,
		statusMismatchIds,
		summaryMismatchIds,
		malformedRows,
		orderOk,
	};
}

function requirementFromRow(
	value: unknown,
	id: string,
): ParallelRequirement | undefined {
	if (!Array.isArray(value)) return undefined;
	const row = value.find(
		(item): item is Record<string, unknown> =>
			item !== null &&
			typeof item === "object" &&
			!Array.isArray(item) &&
			item.id === id,
	);
	if (
		!row ||
		(row.status !== "verified" && row.status !== "pending") ||
		typeof row.summary !== "string"
	) {
		return undefined;
	}
	return { id, status: row.status, summary: row.summary };
}

export function expectedChildRequirements(
	requirements: ParallelRequirement[],
	assignment: string[],
): ParallelRequirement[] {
	const byId = new Map(
		requirements.map((requirement) => [requirement.id, requirement]),
	);
	return assignment.flatMap((id) => {
		const requirement = byId.get(id);
		return requirement === undefined ? [] : [requirement];
	});
}

export function reviewAuditEqual(
	actual: ReturnType<typeof analyzeChildReports>,
	expected: ReturnType<typeof analyzeChildReports>,
): boolean {
	return (
		actual.verdict === expected.verdict &&
		equalStringArrays(actual.missingIds, expected.missingIds) &&
		equalStringArrays(actual.duplicateIds, expected.duplicateIds) &&
		equalStringArrays(actual.unexpectedIds, expected.unexpectedIds) &&
		equalStringArrays(actual.misassignedIds, expected.misassignedIds) &&
		equalStringArrays(actual.statusMismatchIds, expected.statusMismatchIds) &&
		equalStringArrays(actual.summaryMismatchIds, expected.summaryMismatchIds) &&
		actual.malformedRows === expected.malformedRows &&
		actual.orderOk === expected.orderOk
	);
}

function stringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
		? value
		: undefined;
}

export function equalStringArrays(value: unknown, expected: string[]): boolean {
	const actual = stringArray(value);
	return (
		actual !== undefined &&
		actual.length === expected.length &&
		actual.every((item, index) => item === expected[index])
	);
}

export function summarize(runs: ParallelConditionRun[]): ParallelSummary {
	const stage_tokens = Object.fromEntries(
		STAGES.map((stage) => [
			stage,
			round(
				average(
					runs.flatMap((run) =>
						run.stages
							.filter((record) => record.stage === stage)
							.map((record) => record.tokens.total_tokens),
					),
				),
			),
		]),
	) as Record<ParallelStage, number>;
	const stage_input_bytes = Object.fromEntries(
		STAGES.map((stage) => [
			stage,
			round(
				average(
					runs.flatMap((run) =>
						run.stages
							.filter((record) => record.stage === stage)
							.map((record) => record.input_bytes),
					),
				),
			),
		]),
	) as Record<ParallelStage, number>;
	return {
		runs: runs.length,
		complete_passes: runs.filter((run) => run.product_pass).length,
		product_pass_pct: round(
			(runs.filter((run) => run.product_pass).length * 100) / runs.length,
		),
		process_perfect_pct: round(
			(runs.filter((run) => run.stages.every((stage) => stage.output_correct))
				.length *
				100) /
				runs.length,
		),
		child_accuracy_pct: round(
			average(runs.map((run) => run.child_accuracy_pct)),
		),
		reviewer_accuracy_pct: round(
			average(runs.map((run) => run.reviewer_accuracy_pct)),
		),
		final_accuracy_pct: round(
			average(runs.map((run) => run.final_accuracy_pct)),
		),
		critical_path_ms: round(average(runs.map((run) => run.critical_path_ms))),
		agent_elapsed_ms: round(average(runs.map((run) => run.agent_elapsed_ms))),
		children_overlap_ms: round(
			average(runs.map((run) => run.children_overlap_ms)),
		),
		total_tokens: round(average(runs.map((run) => run.tokens.total_tokens))),
		stage_tokens,
		stage_input_bytes,
	};
}

export function stageTokens(
	run: ParallelConditionRun,
	stages: ParallelStage[],
): number {
	const selected = new Set(stages);
	return run.stages.reduce(
		(total, stage) =>
			total + (selected.has(stage.stage) ? stage.tokens.total_tokens : 0),
		0,
	);
}

function average(values: number[]): number {
	return values.length > 0
		? values.reduce((sum, value) => sum + value, 0) / values.length
		: 0;
}

export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return round(
		sorted.length % 2 === 1
			? sorted[middle]!
			: (sorted[middle - 1]! + sorted[middle]!) / 2,
	);
}

export function medianAbsoluteDeviation(values: number[]): number {
	const center = median(values);
	return median(values.map((value) => Math.abs(value - center)));
}

export function stratifiedBootstrapUpper90(
	pairs: ParallelPairRun[],
	metric: (pair: ParallelPairRun) => number,
): number {
	if (pairs.length === 0) return 0;
	const strata = [...new Set(pairs.map((pair) => pair.scenario_id))].map(
		(family) => pairs.filter((pair) => pair.scenario_id === family),
	);
	let state = 0x6d2b79f5;
	const randomIndex = (length: number): number => {
		state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
		state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
		return Math.floor((((state ^ (state >>> 14)) >>> 0) / 2 ** 32) * length);
	};
	const samples: number[] = [];
	for (let iteration = 0; iteration < 5_000; iteration += 1) {
		const selected = strata.flatMap((stratum) =>
			Array.from(
				{ length: stratum.length },
				() => stratum[randomIndex(stratum.length)]!,
			),
		);
		samples.push(average(selected.map(metric)));
	}
	samples.sort((left, right) => left - right);
	return round(samples[Math.ceil(samples.length * 0.9) - 1] ?? 0);
}

export function exactOneSidedSignPValue(wins: number, losses: number): number {
	const n = wins + losses;
	if (n === 0) return 1;
	let tail = 0;
	for (let k = wins; k <= n; k += 1) tail += binomial(n, k) / 2 ** n;
	return round(Math.min(1, tail));
}

function binomial(n: number, k: number): number {
	if (k < 0 || k > n) return 0;
	let value = 1;
	for (let i = 1; i <= Math.min(k, n - k); i += 1)
		value = (value * (n - i + 1)) / i;
	return value;
}

export function percent(before: number, after: number): number {
	return before === 0 ? 0 : round(((after - before) * 100) / before);
}

export function round(value: number): number {
	return Math.round(value * 100) / 100;
}
