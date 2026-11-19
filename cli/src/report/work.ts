import {
	publicWorkExecutionMutation,
	type WorkBriefResult,
	type WorkMutationResult,
	type WorkPromptResolutionResult,
	type WorkStatusResult,
} from "../commands/work.js";
import { createTui } from "../core/tui.js";
import { type HumanReportOptions, printLines, printWrapped } from "./common.js";

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

export function reportWorkPromptResolution(result: WorkPromptResolutionResult): void {
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
	const ui = createTui();
	const complete = projection.lifecycle === "completed";
	printLines([
		...ui.title(
			"anamnesis work status",
			projection.title ?? projection.work_id,
		),
		...ui.verdict({
			label: complete
				? "Work complete"
				: projection.progress.blocked > 0
					? "Work blocked"
					: "Work active",
			summary: `${projection.progress.percent}% · ${projection.work_id}`,
			tone: complete
				? "ready"
				: projection.progress.blocked > 0
					? "warning"
					: "info",
		}),
		...ui.statusRows([
			{ label: "revision", value: String(projection.contract_revision) },
			{ label: "lifecycle", value: projection.lifecycle },
			{
				label: "progress",
				value: `${projection.progress.percent}%`,
				tone: complete ? "success" : "accent",
			},
		]),
	]);
	if (opts.verbose) {
		printWrapped(
			ui,
			`completion contract: ${projection.completion_contract ?? "(none)"}`,
		);
		printWrapped(
			ui,
			`configured required gates: ${projection.configured_required_gates.join(", ") || "none"}`,
		);
	}
	for (const gate of projection.review_gates) {
		if (gate.enforcement === "off") continue;
		printWrapped(
			ui,
			opts.verbose
				? `  review ${gate.gate}: ${gate.state}; next=${gate.next_provider ?? "none"}; reviewers=${gate.passing_reviewer_refs.map((item) => `${item.provider}:${item.ref}`).join(",") || "none"}; findings=${gate.finding_refs.join(",") || "none"}; failures=${gate.failure_refs.join(",") || "none"}`
				: `review ${gate.gate}: ${gate.state}`,
		);
	}
	if (projection.parallelism.mode !== "off") {
		printWrapped(
			ui,
			opts.verbose
				? `  delegation: ${projection.parallelism.recorded_state}; assessment=${projection.parallelism.assessment_id ?? "none"}; next=${projection.parallelism.next_provider ?? "none"}; failures=${projection.parallelism.failure_refs.join(",") || "none"}`
				: `delegation: ${projection.parallelism.recorded_state}`,
		);
	}
	if (result.readiness) console.log(`  readiness: ${result.readiness}`);
  if (result.policy_drift?.drifted) {
		console.log(
			"  policy drift: current project policy differs; frozen Work policy retained",
		);
  }
	const visibleRequirements = opts.verbose
		? projection.requirements
		: projection.requirements.filter(
				(requirement) =>
					requirement.status !== "verified" && requirement.status !== "waived",
			);
  console.log("  requirements:");
	if (visibleRequirements.length === 0) console.log("    all applicable requirements verified");
  for (const requirement of visibleRequirements) {
		printWrapped(
			ui,
			`- ${requirement.id} [${requirement.status}] — ${requirement.summary}`,
			{ indent: 4 },
		);
  }
  const progressDetail = projection.progress.weighted
    ? `${projection.progress.verified_weight ?? 0}/${projection.progress.applicable_weight ?? 0} verified weight`
    : `${projection.progress.verified}/${projection.progress.applicable} verified requirements`;
	console.log(
		`  progress: ${projection.progress.percent}% (${progressDetail})`,
	);
	if (!opts.verbose) {
		printLines(ui.section("Next"));
		const next = projection.requirements.find(
			(requirement) =>
				requirement.status !== "verified" && requirement.status !== "waived",
		);
		const nextMessage = complete
			? "no action required"
			: next
				? `${next.id}: ${next.summary}`
				: "review readiness and close the Work";
		printWrapped(ui, nextMessage, {
			tone: complete
				? "success"
				: projection.progress.blocked > 0
					? "warning"
					: "accent",
		});
	}
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
