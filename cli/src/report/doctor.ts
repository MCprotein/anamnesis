import * as path from "node:path";
import {
	type DoctorIssue,
	type DoctorResult,
	doctorHumanPresentation,
} from "../commands/doctor.js";
import {
	collectGenerationBoundaryStatus,
	formatGenerationBoundaryLines,
} from "../core/generation-boundary.js";
import { CHIP, createTui, LEVEL, type Tui } from "../core/tui.js";
import {
	type Finding,
	type HumanReportOptions,
	metric,
	moreLine,
	ontologyFinding,
	plural,
	printFindingSection,
	printLines,
} from "./common.js";
import { reportCodexHookTrustInspection } from "./hooks.js";

export function reportDoctor(
	result: DoctorResult,
	opts: HumanReportOptions = {},
): void {
	const ui = createTui();
	const verbose = opts.verbose === true;
	const presentation = doctorHumanPresentation(result, verbose);
	const { errors, warnings, info } = presentation.summary;
	const level =
		errors > 0 ? LEVEL.failed : warnings > 0 ? LEVEL.attention : LEVEL.ready;
	const trust = result.codexHookTrust?.summary;
	printLines([
		...ui.heading("anamnesis doctor", path.basename(result.projectRoot)),
		...ui.level(
			level,
			level === LEVEL.ready
				? "managed surfaces and runtime checks passed"
				: `repair required: ${plural(errors, "error")}, ${plural(warnings, "warning")}`,
		),
		"",
		...ui.table(
			[
				["errors", metric(ui, errors, errors === 0, "danger"), ""],
				["warnings", metric(ui, warnings, warnings === 0), ""],
				[
					"info",
					String(info),
					presentation.hiddenInfo > 0
						? ui.style("hidden; use --verbose", "muted")
						: "",
				],
				...(trust
					? [
							[
								"Codex hooks",
								metric(
									ui,
									`${trust.trusted + trust.managed}/${trust.registered}`,
									trust.untrusted + trust.modified + trust.unknown === 0,
								),
								ui.style(
									`runnable; ${trust.untrusted} untrusted, ${trust.modified} modified, ${trust.unknown} unknown`,
									"muted",
								),
							],
						]
					: []),
			],
			[{}, { right: true }],
		),
	]);
	const ontology = ontologyFinding(result.ontologyRecommendation);
	const issueGroups = doctorFindings(presentation.issues, verbose);
	printFindingSection(
		ui,
		"Issues",
		issueGroups,
		issueGroups.length === presentation.issues.length
			? issueGroups.length
			: `${plural(issueGroups.length, "group")}, ${plural(presentation.issues.length, "finding")}`,
	);
	printFindingSection(ui, "Notes", ontology ? [ontology] : []);
	if (verbose && result.codexHookTrust) {
		printLines(ui.section("Codex hooks"));
		reportCodexHookTrustInspection(result.codexHookTrust, opts);
	}
	if (verbose) {
		printLines(ui.section("Generation boundary"));
		printLines(
			formatGenerationBoundaryLines(
				collectGenerationBoundaryStatus(result.projectRoot),
			),
		);
	}
	printEvidence(ui, result);
	if (!verbose) {
		printLines([
			...ui.section("Next"),
			...ui.commandRows([
				{
					command: "anamnesis doctor --verbose",
					description:
						"show informational findings, hook keys, and generation details",
				},
			]),
		]);
	}
}

function doctorFindings(issues: DoctorIssue[], verbose: boolean): Finding[] {
	const groups = new Map<string, DoctorIssue[]>();
	for (const issue of issues) {
		const key = JSON.stringify([
			issue.severity,
			issue.code,
			issue.repair ?? "",
		]);
		groups.set(key, [...(groups.get(key) ?? []), issue]);
	}
	return [...groups.values()].map((group) => {
		const first = group[0] as DoctorIssue;
		const chip =
			first.severity === "error"
				? CHIP.fail
				: first.severity === "warning"
					? CHIP.warn
					: CHIP.info;
		const repair = first.repair ? [`fix: ${first.repair}`] : [];
		const target = issueTarget(first);
		if (group.length === 1) {
			return {
				chip,
				topic: first.code,
				detail: target || first.message,
				more: [...(target ? [first.message] : []), ...repair],
			};
		}
		const shown = verbose ? group : group.slice(0, 5);
		return {
			chip,
			topic: first.code,
			detail: plural(group.length, "finding"),
			more: [
				...shown.map((issue) =>
					verbose && issueTarget(issue)
						? `${issueTarget(issue)}: ${issue.message}`
						: issueTarget(issue) || issue.message,
				),
				...moreLine(group.length - shown.length),
				...repair,
			],
		};
	});
}

function issueTarget(issue: DoctorIssue): string {
	return [issue.scopePath ? `[${issue.scopePath}]` : "", issue.target ?? ""]
		.filter(Boolean)
		.join(" ");
}

function printEvidence(ui: Tui, result: DoctorResult): void {
	const rows = [
		...(result.appendedPath ? [["appended", result.appendedPath]] : []),
		...(result.evidencePath ? [["evidence", result.evidencePath]] : []),
	];
	if (rows.length === 0) return;
	printLines([...ui.section("Evidence"), ...ui.table(rows)]);
}
