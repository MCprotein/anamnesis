import type { StatusResult } from "../commands/status.js";
import {
	collectGenerationBoundaryStatus,
	formatGenerationBoundaryLines,
} from "../core/generation-boundary.js";
import { createTui } from "../core/tui.js";
import {
	formatAge,
	formatFragmentLine,
	type HumanReportOptions,
	printLines,
	printOntologyRecommendation,
	printWrapped,
	verdictTone,
} from "./common.js";
import { reportCodexHookTrustInspection } from "./hooks.js";

export function reportStatus(
	result: StatusResult,
	projectRoot: string,
	opts: HumanReportOptions = {},
): void {
  const ui = createTui();
  const { agentfile, scopes, suggested, declined, summary } = result;
	const drifted = result.entries.filter((entry) => entry.drift !== "clean");
	const fragmentProblems = result.fragments.filter(
		(fragment) =>
			fragment.status === "update-available" ||
			fragment.status === "library-missing",
	);
	const trust = result.codexHookTrust?.summary;
	const codexHooksRelevant =
		agentfile.tools.includes("codex") ||
		result.codexHooks.summary.total > 0 ||
		(!result.codexHooks.readable &&
			!result.codexHooks.parseError?.endsWith(" is missing"));
	const hookTrustNeedsAttention =
		trust !== undefined && trust.untrusted + trust.modified + trust.unknown > 0;
	const hasAttention =
		drifted.length > 0 ||
		fragmentProblems.length > 0 ||
		suggested.length > 0 ||
		result.partialAdoptions.length > 0 ||
		!result.dependencies.ready ||
		!result.continuity.ready ||
		result.sessionContextBudget.capExceeded ||
		result.sessionContextBudget.warnings.length > 0 ||
		(codexHooksRelevant && !result.codexHooks.readable) ||
		(codexHooksRelevant && result.codexHooks.summary.warnings > 0) ||
		hookTrustNeedsAttention ||
		result.ontology.summary.warnings > 0 ||
		result.evidence.invalid > 0 ||
		result.evidence.latest_stale === true ||
		result.documents.summary.brokenLinks > 0 ||
		result.documents.summary.missingOntologyRefs > 0 ||
		!result.contextDiagnostics.ok ||
		!result.executableSecurity.ok ||
		!result.agentConfigDamage.ok;

  printLines([
    ...ui.title("anamnesis status", agentfile.project.name),
		...ui.verdict({
			label: hasAttention ? "Attention needed" : "Ready",
			summary: hasAttention
				? "review the exceptions below"
				: "project memory and agent surfaces are in sync",
			tone: hasAttention ? "warning" : "ready",
		}),
		...ui.statusRows([
			{
				label: "managed",
				value: `${summary.entriesClean}/${result.entries.length} clean`,
				tone: verdictTone(drifted.length === 0),
				summary: `${summary.fragmentTotal} fragments`,
			},
			{
				label: "continuity",
				value: `${result.continuity.passed}/${result.continuity.total} checks`,
				tone: verdictTone(result.continuity.ready),
			},
			...(trust
				? [
      {
							label: "Codex hooks",
							value: `${trust.trusted + trust.managed}/${trust.registered} runnable`,
							tone: verdictTone(!hookTrustNeedsAttention),
							summary: `${trust.untrusted} untrusted, ${trust.modified} modified`,
						},
					]
				: []),
			{
				label: "documents",
				value: `${result.documents.summary.pages} pages, ${result.documents.summary.brokenLinks} broken links`,
				tone: verdictTone(result.documents.summary.brokenLinks === 0),
      },
    ]),
  ]);

	if (hasAttention) printLines(ui.section("Attention"));
	if (drifted.length > 0) {
      console.log(
			ui.note(
				`${drifted.length} managed entr${drifted.length === 1 ? "y has" : "ies have"} drift`,
				"warning",
			),
      );
		for (const entry of drifted.slice(0, opts.verbose ? drifted.length : 3)) {
			const target =
				entry.target === "region"
					? `${entry.file} [region:${entry.regionId}]`
					: entry.path;
			console.log(`    ${entry.drift.padEnd(15)} ${target}`);
      }
    }
	if (fragmentProblems.length > 0) {
		console.log(
			ui.note(`${fragmentProblems.length} fragment update issue(s)`, "warning"),
		);
		for (const fragment of fragmentProblems) {
			console.log(`    ${formatFragmentLine(fragment)}`);
		}
	}
	for (const check of result.continuity.checks.filter(
		(item) => item.status === "fail",
	)) {
		console.log(`    fail ${check.label}: ${check.detail}`);
      }
	if (result.sessionContextBudget.capExceeded) {
		console.log(
			ui.note(
				`session context over budget (${result.sessionContextBudget.estimatedTokens}/${result.sessionContextBudget.maxTokens} tokens)`,
				"warning",
			),
		);
    }
	for (const warning of result.sessionContextBudget.warnings) {
		console.log(`    warning ${warning}`);
  }
  if (suggested.length > 0) {
		console.log(
			ui.note(
				`${suggested.length} fragment suggestion(s) available`,
				"warning",
			),
		);
		for (const item of suggested)
			console.log(`    ${item.suggest}: ${item.reason}`);
  }
  if (result.partialAdoptions.length > 0) {
		console.log(
			ui.note(
				`${result.partialAdoptions.length} partial upgrade(s) need review`,
				"warning",
			),
		);
		for (const item of result.partialAdoptions) {
      console.log(
				`    ${item.fragmentId}@${item.installedVersion} -> ${item.libraryVersion}: ${item.reasons.join(", ")}`,
      );
    }
  }
  if (!result.dependencies.ready) {
		console.log(
			ui.note(
				`${result.dependencies.summary.total} dependency issue(s)`,
				"warning",
			),
		);
    for (const problem of result.dependencies.problems.slice(0, 5)) {
        console.log(
				`    ${problem.kind} ${problem.scopePath}: ${problem.fragmentId ?? problem.cycle?.join(" -> ")}`,
        );
      }
    }
	if (codexHooksRelevant && !result.codexHooks.readable) {
    console.log(
			ui.note(
				`Codex hook registry unavailable: ${result.codexHooks.parseError}`,
				"warning",
			),
    );
	} else {
		for (const warning of result.codexHooks.warnings.slice(0, 3)) {
			console.log(`    hook warning ${warning.kind}: ${warning.detail}`);
  }
  }
	if (result.codexHookTrust && (opts.verbose || hookTrustNeedsAttention))
		reportCodexHookTrustInspection(result.codexHookTrust, opts);
	if (hookTrustNeedsAttention) {
      console.log(
			ui.note("installed untrusted/modified hooks may not execute", "warning"),
      );
      }
	if (result.ontology.summary.warnings > 0) {
        console.log(
			ui.note(
				`${result.ontology.summary.warnings} ontology warning(s)`,
				"warning",
			),
        );
		for (const gap of result.ontology.gaps.filter(
			(item) => item.severity === "warning",
		)) {
			console.log(`    ${gap.fragmentId}:${gap.kind} — ${gap.detail}`);
			console.log(`      next: ${gap.next}`);
    }
  }
	if (result.evidence.invalid > 0 || result.evidence.latest_stale) {
      console.log(
			ui.note(
				`evidence: ${result.evidence.invalid} invalid line(s)${result.evidence.latest_stale ? ", latest is stale" : ""}`,
				"warning",
			),
      );
    }
	if (
		result.documents.summary.brokenLinks > 0 ||
		result.documents.summary.missingOntologyRefs > 0
	) {
    console.log(
			ui.note(
				`documents: ${result.documents.summary.brokenLinks} broken link(s), ${result.documents.summary.missingOntologyRefs} missing ontology ref(s)`,
				"warning",
			),
    );
  }
	for (const [label, diagnostic] of [
		["context diagnostics", result.contextDiagnostics],
		["executable security", result.executableSecurity],
		["agent config", result.agentConfigDamage],
	] as const) {
		if (!diagnostic.ok)
      console.log(
				ui.note(
					`${label}: ${diagnostic.summary.warnings} warning(s)`,
					"warning",
				),
      );
    }
	for (const [label, diagnostic] of [
		["executable security", result.executableSecurity],
		["agent config", result.agentConfigDamage],
	] as const) {
		if (diagnostic.ok) continue;
		const issues = diagnostic.issues.slice(
			0,
			opts.verbose ? diagnostic.issues.length : 3,
		);
		for (const issue of issues) {
			console.log(`    ${label} ${issue.code} ${issue.target}`);
			console.log(`      ${issue.message}`);
		}
		if (!opts.verbose && diagnostic.issues.length > issues.length) {
			console.log(
				`    ${diagnostic.issues.length - issues.length} more; use --verbose`,
			);
		}
	}

	if (opts.verbose) {
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
	} else {
		printLines(ui.section("Next"));
		printWrapped(
			ui,
			hasAttention
				? "resolve the items above, then run `anamnesis doctor`"
				: "no action required",
			{ tone: hasAttention ? "warning" : "success" },
		);
		printWrapped(
			ui,
			"use `--verbose` for fragments, hashes, evidence, and generation details",
		);
  }
}
