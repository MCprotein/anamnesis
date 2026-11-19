import type { StatusResult } from "../commands/status.js";
import {
	collectGenerationBoundaryStatus,
	formatGenerationBoundaryLines,
} from "../core/generation-boundary.js";
import { CHIP, createTui, LEVEL } from "../core/tui.js";
import {
	type Finding,
	findingLevel,
	formatAge,
	formatFragmentLine,
	type HumanReportOptions,
	metric,
	moreLine,
	plural,
	printFindingSection,
	printLines,
	printOntologyRecommendation,
} from "./common.js";
import {
	codexHookTrustFindings,
	reportCodexHookTrustInspection,
} from "./hooks.js";

export function reportStatus(
	result: StatusResult,
	projectRoot: string,
	opts: HumanReportOptions = {},
): void {
	const ui = createTui();
	const { agentfile, scopes, declined, summary } = result;
	const drifted = result.entries.filter((entry) => entry.drift !== "clean");
	const trust = result.codexHookTrust?.summary;
	const hookTrustNeedsAttention =
		trust !== undefined && trust.untrusted + trust.modified + trust.unknown > 0;
	const attention = statusAttention(result, opts);
	const notes = statusNotes(result);
	const level = findingLevel([...attention, ...notes]);

	printLines([
		...ui.heading("anamnesis status", agentfile.project.name),
		...ui.level(
			level,
			level === LEVEL.attention
				? `${plural(attention.length, "item")} need review`
				: level === LEVEL.notice
					? `everything is in sync; ${plural(notes.length, "note")}`
					: "project memory and agent surfaces are in sync",
		),
		"",
		...ui.table(
			[
				[
					"managed",
					metric(
						ui,
						`${summary.entriesClean}/${result.entries.length}`,
						drifted.length === 0,
					),
					ui.style("clean", "muted"),
					ui.style(plural(summary.fragmentTotal, "fragment"), "muted"),
				],
				[
					"continuity",
					metric(
						ui,
						`${result.continuity.passed}/${result.continuity.total}`,
						result.continuity.ready,
					),
					ui.style("checks", "muted"),
					"",
				],
				...(trust
					? [
							[
								"Codex hooks",
								metric(
									ui,
									`${trust.trusted + trust.managed}/${trust.registered}`,
									!hookTrustNeedsAttention,
								),
								ui.style("runnable", "muted"),
								ui.style(
									`${trust.untrusted} untrusted, ${trust.modified} modified, ${trust.unknown} unknown`,
									"muted",
								),
							],
						]
					: []),
				[
					"documents",
					metric(ui, result.documents.summary.pages, true),
					ui.style("pages", "muted"),
					`${metric(ui, result.documents.summary.brokenLinks, result.documents.summary.brokenLinks === 0)} ${ui.style("broken links", "muted")}`,
				],
			],
			[{}, { right: true }],
		),
	]);

	printFindingSection(ui, "Attention", attention);
	printFindingSection(ui, "Notes", notes);

	if (opts.verbose) {
		if (result.codexHookTrust) {
			printLines(ui.section("Codex hooks"));
			reportCodexHookTrustInspection(result.codexHookTrust, opts);
		}
		printLines(ui.section(`Fragments (${summary.fragmentTotal})`));
		for (const scope of scopes) {
			if (scopes.length > 1) console.log(`  [${scope.path}]`);
			for (const fragment of scope.fragments)
				console.log(`    ${formatFragmentLine(fragment)}`);
		}
		if (declined.length > 0) {
			printLines(ui.section("Declined"));
			for (const item of declined)
				console.log(
					`    ${item.id} [${item.matched ? "active" : "stale"}]${item.reason ? `: ${item.reason}` : ""}`,
				);
		}
		printLines(ui.section("Diagnostics"));
		console.log(`  tools: ${agentfile.tools.join(", ")}`);
		console.log(
			`  session context: ${result.sessionContextBudget.estimatedTokens}/${result.sessionContextBudget.maxTokens} tokens, ${result.sessionContextBudget.sourcePointers} pointers`,
		);
		if (result.evidence.latest) {
			console.log(
				`  evidence: ${result.evidence.total} records, latest ${result.evidence.latest.kind} at ${result.evidence.latest.generated_at}`,
			);
			for (const kind of result.evidence.byKind)
				console.log(
					`    ${kind.kind}: ${kind.total}, ${formatAge(kind.latest_age_ms)} old${kind.stale ? "; stale" : ""}`,
				);
		}
		printOntologyRecommendation(ui, result.ontologyRecommendation, {
			label: "ontology next",
			includeOk: true,
		});
		for (const line of formatGenerationBoundaryLines(
			collectGenerationBoundaryStatus(projectRoot),
		))
			console.log(line);
	}
	printLines(ui.section("Next"));
	printLines(
		ui.commandRows([
			...(level === LEVEL.attention
				? [
						{
							command: "anamnesis doctor",
							description:
								"check install integrity after resolving the items above",
						},
					]
				: []),
			...(opts.verbose
				? []
				: [
						{
							command: "anamnesis status --verbose",
							description:
								"show fragments, hashes, evidence, and generation details",
						},
					]),
		]),
	);
	if (level !== LEVEL.attention && opts.verbose)
		console.log(ui.note("no action required"));
}

function statusAttention(
	result: StatusResult,
	opts: HumanReportOptions,
): Finding[] {
	const findings: Finding[] = [];
	const limit = (total: number) => (opts.verbose ? total : 3);
	const drifted = result.entries.filter((entry) => entry.drift !== "clean");
	const shownDrift = drifted.slice(0, limit(drifted.length));
	shownDrift.forEach((entry, index) => {
		const target =
			entry.target === "region"
				? `${entry.file} [region:${entry.regionId}]`
				: entry.path;
		findings.push({
			chip: CHIP.warn,
			topic: "drift",
			detail: `${entry.drift} ${target}`,
			more:
				index === shownDrift.length - 1
					? moreLine(drifted.length - shownDrift.length)
					: [],
		});
	});
	for (const fragment of result.fragments.filter(
		(item) =>
			item.status === "update-available" || item.status === "library-missing",
	)) {
		findings.push({
			chip: CHIP.warn,
			topic: "fragment",
			detail: formatFragmentLine(fragment),
		});
	}
	for (const check of result.continuity.checks.filter(
		(item) => item.status === "fail",
	)) {
		if (check.id === "managed-drift" && drifted.length > 0) continue;
		findings.push({
			chip: CHIP.warn,
			topic: "continuity",
			detail: `${check.label}: ${check.detail}`,
		});
	}
	const budget = result.sessionContextBudget;
	if (budget.capExceeded) {
		findings.push({
			chip: CHIP.warn,
			topic: "session context",
			detail: `over budget: ${budget.estimatedTokens}/${budget.maxTokens} tokens`,
		});
	}
	for (const warning of budget.warnings)
		findings.push({
			chip: CHIP.warn,
			topic: "session context",
			detail: warning,
		});
	for (const item of result.suggested)
		findings.push({
			chip: CHIP.warn,
			topic: "suggestion",
			detail: `${item.suggest}: ${item.reason}`,
		});
	for (const item of result.partialAdoptions) {
		findings.push({
			chip: CHIP.warn,
			topic: "partial upgrade",
			detail: `${item.fragmentId}@${item.installedVersion} -> ${item.libraryVersion}: ${item.reasons.join(", ")}`,
		});
	}
	if (!result.dependencies.ready) {
		for (const problem of result.dependencies.problems.slice(0, 5)) {
			findings.push({
				chip: CHIP.warn,
				topic: "dependency",
				detail: `${problem.kind} ${problem.scopePath}: ${problem.fragmentId ?? problem.cycle?.join(" -> ")}`,
			});
		}
		if (result.dependencies.problems.length === 0)
			findings.push({
				chip: CHIP.warn,
				topic: "dependency",
				detail: plural(result.dependencies.summary.total, "issue"),
			});
	}
	const codexHooksRelevant =
		result.agentfile.tools.includes("codex") ||
		result.codexHooks.summary.total > 0 ||
		(!result.codexHooks.readable &&
			!result.codexHooks.parseError?.endsWith(" is missing"));
	if (codexHooksRelevant && !result.codexHooks.readable) {
		findings.push({
			chip: CHIP.warn,
			topic: "hook registry",
			detail: `unavailable: ${result.codexHooks.parseError}`,
		});
	} else {
		for (const warning of result.codexHooks.warnings.slice(0, 3))
			findings.push({
				chip: CHIP.warn,
				topic: "hook registry",
				detail: `${warning.kind}: ${warning.detail}`,
			});
	}
	const trust = result.codexHookTrust;
	if (
		trust &&
		trust.summary.untrusted + trust.summary.modified + trust.summary.unknown > 0
	)
		findings.push(...codexHookTrustFindings(trust));
	for (const gap of result.ontology.gaps.filter(
		(item) => item.severity === "warning",
	)) {
		findings.push({
			chip: CHIP.warn,
			topic: "ontology",
			detail: `${gap.fragmentId}:${gap.kind} ${gap.detail}`,
			more: [`next: ${gap.next}`],
		});
	}
	if (result.evidence.invalid > 0) {
		findings.push({
			chip: CHIP.warn,
			topic: "evidence",
			detail: `${plural(result.evidence.invalid, "invalid line")}`,
		});
	}
	if (
		result.documents.summary.brokenLinks > 0 ||
		result.documents.summary.missingOntologyRefs > 0
	) {
		findings.push({
			chip: CHIP.warn,
			topic: "documents",
			detail: `${plural(result.documents.summary.brokenLinks, "broken link")}, ${plural(result.documents.summary.missingOntologyRefs, "missing ontology ref")}`,
		});
	}
	for (const [label, diagnostic] of [
		["context diagnostics", result.contextDiagnostics],
		["executable security", result.executableSecurity],
		["agent config", result.agentConfigDamage],
	] as const) {
		if (diagnostic.ok) continue;
		const issues = "issues" in diagnostic ? diagnostic.issues : [];
		const shown = issues.slice(0, limit(issues.length));
		findings.push({
			chip: CHIP.warn,
			topic: label,
			detail: plural(diagnostic.summary.warnings, "warning"),
			more: [
				...shown.map(
					(issue) => `${issue.code} ${issue.target}: ${issue.message}`,
				),
				...moreLine(issues.length - shown.length),
			],
		});
	}
	return findings;
}

function statusNotes(result: StatusResult): Finding[] {
	if (!result.evidence.latest_stale || result.evidence.invalid > 0) return [];
	const age = result.evidence.latest_age_ms;
	return [
		{
			chip: CHIP.info,
			topic: "evidence",
			detail:
				age === undefined
					? "latest record is stale"
					: `latest record is ${formatAge(age)} old`,
		},
	];
}
