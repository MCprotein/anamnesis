import {
	publicWorkExecutionMutation,
	type WorkBriefResult,
	type WorkMutationResult,
	type WorkPromptResolutionResult,
	type WorkStatusResult,
} from "../commands/work.js";
import { CHIP, type Chip, createTui, LEVEL } from "../core/tui.js";
import type { WorkRequirementState } from "../core/work_projection.js";
import {
	type Finding,
	findingLines,
	type HumanReportOptions,
	metric,
	printFindingSection,
	printLines,
} from "./common.js";

export function reportWorkMutation(result: WorkMutationResult): void {
	const ui = createTui();
	printLines([
		...ui.title("anamnesis work", result.work_id),
		...ui.verdict({
			label: "Work updated",
			summary: `${result.projection.progress.percent}% complete`,
			tone: result.projection.lifecycle === "completed" ? "ready" : "info",
		}),
		...ui.statusRows([
			{ label: "revision", value: String(result.projection.contract_revision) },
			{ label: "lifecycle", value: result.projection.lifecycle },
			{
				label: "progress",
				value: `${result.projection.progress.percent}%`,
				tone: "accent",
			},
			{
				label: "source",
				value:
					result.allocation?.source.envelope.event_id ??
					"evidence-only transition",
			},
		]),
	]);
}

export function reportWorkExecutionMutation(result: WorkMutationResult): void {
	const output = publicWorkExecutionMutation(result);
	const contract = output.execution_contract;
	console.log(`Work ${output.work_id}`);
	console.log(`  ledger head: ${output.ledger_head ?? "(none)"}`);
	console.log(`  contract: ${contract.kind}`);
	for (const [key, value] of Object.entries(contract)) {
		if (key === "kind") continue;
		if (Array.isArray(value)) {
			console.log(`  ${key}: ${value.length > 0 ? value.join(", ") : "none"}`);
		} else if (typeof value === "object" && value !== null) {
			const ref = value as { provider?: string; ref?: string };
			console.log(
				`  ${key}: ${ref.provider ?? "unknown"}:${ref.ref ?? "unknown"}`,
			);
		} else {
			console.log(`  ${key}: ${String(value)}`);
		}
	}
	if (output.readiness) {
		console.log(
			`  readiness: ${output.readiness.allowed ? "allowed" : "blocked"}`,
		);
	}
}

export function reportWorkPromptResolution(
	result: WorkPromptResolutionResult,
): void {
	const ui = createTui();
	printLines([
		...ui.title("anamnesis work prompt", result.capture_id),
		...ui.verdict({
			label: "Prompt resolved",
			summary: result.outcome.outcome,
			tone: "ready",
		}),
		...ui.statusRows([
			{ label: "resolution", value: result.resolution },
			{ label: "outcome", value: result.outcome.outcome },
			...(result.work_id ? [{ label: "work", value: result.work_id }] : []),
		]),
	]);
	if (result.projection) {
		printLines(
			ui.statusRows([
				{
					label: "revision",
					value: String(result.projection.contract_revision),
				},
				{
					label: "progress",
					value: `${result.projection.progress.percent}%`,
					tone: "accent",
				},
			]),
		);
	}
}

export function reportWorkStatus(
	result: WorkStatusResult,
	opts: HumanReportOptions = {},
): void {
	const projection = result.projection;
	const verbose = opts.verbose === true;
	const ui = createTui();
	const complete = projection.lifecycle === "completed";
	const blocked = projection.progress.blocked > 0;
	const level = complete
		? LEVEL.ready
		: blocked
			? LEVEL.attention
			: LEVEL.notice;
	const progressDetail = projection.progress.weighted
		? `${projection.progress.verified_weight ?? 0}/${projection.progress.applicable_weight ?? 0} verified weight`
		: `${projection.progress.verified}/${projection.progress.applicable} verified requirements`;
	printLines([
		...ui.heading("anamnesis work status", projection.work_id),
		...ui.level(level, projection.title ?? projection.work_id),
		"",
		...ui.table([
			[
				"progress",
				`${metric(ui, `${projection.progress.percent}%`, !blocked)}  ${ui.style(progressDetail, "muted")}`,
			],
			["revision", String(projection.contract_revision)],
			["lifecycle", projection.lifecycle],
			...(verbose
				? [
						["contract", projection.completion_contract ?? "(none)"],
						[
							"gates",
							projection.configured_required_gates.join(", ") || "none",
						],
					]
				: []),
		]),
	]);
	printFindingSection(ui, "Checks", workChecks(result, verbose));
	const open = projection.requirements.filter(
		(requirement) =>
			requirement.status !== "verified" && requirement.status !== "waived",
	);
	const visible = verbose ? projection.requirements : open;
	printLines(ui.section("Requirements", visible.length));
	printLines(
		findingLines(
			ui,
			visible.length === 0
				? [
						{
							chip: CHIP.ok,
							topic: "verified",
							detail: "all applicable requirements",
						},
					]
				: visible.map((requirement) => ({
						chip: requirementChip(requirement.status),
						topic: requirement.id,
						detail: requirement.summary,
						more: requirement.status === "pending" ? [] : [requirement.status],
					})),
		),
	);
	if (!verbose) {
		const next = open[0];
		printLines([
			...ui.section("Next"),
			ui.note(
				complete
					? "no action required"
					: next
						? `${next.id}: ${next.summary}`
						: "review readiness and close the Work",
				complete ? "success" : blocked ? "warning" : "accent",
			),
		]);
	}
}

function requirementChip(status: WorkRequirementState): Chip {
	if (status === "verified" || status === "waived") return CHIP.ok;
	if (status === "blocked") return CHIP.fail;
	if (status === "pending") return CHIP.todo;
	return CHIP.work;
}

function workChecks(result: WorkStatusResult, verbose: boolean): Finding[] {
	const projection = result.projection;
	const findings: Finding[] = [];
	for (const gate of projection.review_gates) {
		if (gate.enforcement === "off") continue;
		findings.push({
			chip:
				gate.state === "passed" || gate.state === "waived"
					? CHIP.ok
					: gate.state === "changes_requested" ||
							gate.state === "blocked_unavailable"
						? CHIP.warn
						: CHIP.todo,
			topic: `review ${gate.gate}`,
			detail: gate.state,
			more: verbose
				? [
						`next=${gate.next_provider ?? "none"}; reviewers=${gate.passing_reviewer_refs.map((item) => `${item.provider}:${item.ref}`).join(",") || "none"}; findings=${gate.finding_refs.join(",") || "none"}; failures=${gate.failure_refs.join(",") || "none"}`,
					]
				: [],
		});
	}
	const parallelism = projection.parallelism;
	if (parallelism.mode !== "off") {
		findings.push({
			chip:
				parallelism.recorded_state === "blocked_unavailable"
					? CHIP.warn
					: CHIP.info,
			topic: "delegation",
			detail: parallelism.recorded_state,
			more: verbose
				? [
						`assessment=${parallelism.assessment_id ?? "none"}; next=${parallelism.next_provider ?? "none"}; failures=${parallelism.failure_refs.join(",") || "none"}`,
					]
				: [],
		});
	}
	if (result.readiness)
		findings.push({
			chip: CHIP.info,
			topic: "readiness",
			detail: result.readiness,
		});
	if (result.policy_drift?.drifted)
		findings.push({
			chip: CHIP.warn,
			topic: "policy drift",
			detail: "current project policy differs; frozen Work policy retained",
		});
	return findings;
}

export function formatWorkBrief(result: WorkBriefResult): string {
	const lines = [
		`Work briefing — ${result.briefing.work.title ?? result.work_id}`,
	];
	for (const section of result.sections) {
		lines.push("", `${section.label}:`);
		if (section.values.length === 0) lines.push("  - none");
		else lines.push(...section.values.map((value) => `  - ${value}`));
	}
	for (const gate of result.projection.review_gates) {
		if (gate.enforcement === "off") continue;
		lines.push(
			"",
			`Review ${gate.gate}: ${gate.state}`,
			`  refs: ${gate.passing_reviewer_refs.map((item) => `${item.provider}:${item.ref}`).join(", ") || "none"}`,
			`  findings: ${gate.finding_refs.join(", ") || "none"}`,
			`  failures: ${gate.failure_refs.join(", ") || "none"}`,
		);
	}
	if (result.projection.parallelism.mode !== "off") {
		lines.push(
			"",
			`Delegation: ${result.projection.parallelism.recorded_state}`,
			`  assessment: ${result.projection.parallelism.assessment_id ?? "none"}`,
			`  failures: ${result.projection.parallelism.failure_refs.join(", ") || "none"}`,
		);
	}
	if (result.readiness) lines.push("", `Readiness: ${result.readiness}`);
	lines.push(
		"",
		`Delivery: pending (${result.delivery_token})`,
		"Continue the active Work from the listed next requirements.",
	);
	return lines.join("\n");
}
