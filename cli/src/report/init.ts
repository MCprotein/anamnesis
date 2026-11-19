import { type InitResult, summarizeChanges } from "../commands/init.js";
import { initNextSteps } from "../core/init_next_steps.js";
import { createTui } from "../core/tui.js";
import {
	changeSummaryLine,
	countTone,
	type HumanReportOptions,
	printLines,
	printWrapped,
	reportChangeDetails,
	reportWorkspaceProfile,
} from "./common.js";

export function reportInit(
  result: InitResult,
  projectRoot: string,
  execAdaptersEnabled: boolean,
  opts: HumanReportOptions = {},
): void {
  const ui = createTui();
  const s = summarizeChanges(result.changes);
	const fragIds =
		result.selectedFragments.map((f) => f.id).join(", ") || "(none)";
  printLines([
    ...ui.title("anamnesis init", result.agentfile.project.name),
		...ui.verdict({
			label: result.writtenToDisk ? "Initialized" : "Preview ready",
			summary:
				s.blocked > 0
					? `${s.blocked} protected write(s) blocked`
					: "project adoption plan is ready",
			tone: s.blocked > 0 ? "warning" : result.writtenToDisk ? "ready" : "info",
		}),
		...ui.statusRows([
      {
				label: "mode",
        value: result.writtenToDisk ? "applied" : "preview",
        tone: result.writtenToDisk ? "success" : "accent",
      },
			{ label: "tools", value: result.agentfile.tools.join(", ") },
			{ label: "fragments", value: fragIds },
			{
				label: "changes",
				value: changeSummaryLine(s),
				tone: countTone(s.blocked),
			},
    ]),
  ]);
	if (opts.verbose) reportChangeDetails(ui, result.changes);
  if (result.monorepoDetection?.isMonorepo) {
    const det = result.monorepoDetection;
    printLines([
      ...ui.section("Workspace Profile"),
			ui.note(
				`monorepo detected via ${det.declaredVia}: ${det.scopes.length} scope(s)`,
			),
    ]);
    for (const scope of opts.verbose ? det.scopes : []) {
			const ids =
				scope.matchedRules.map((r) => r.suggest).join(", ") || "(none)";
      console.log(`    ${scope.path.padEnd(20)} ${ids}`);
    }
    if (opts.verbose && det.emptyScopes.length > 0) {
      console.log(
        `  empty workspace dirs (no rule match): ${det.emptyScopes.join(", ")}`,
      );
    }
  }
  if (!result.writtenToDisk) {
    console.log(ui.note("dry-run: no files written"));
    if (opts.verbose) reportWorkspaceProfile(projectRoot);
  }
  if (s.blocked > 0) {
		printWrapped(
			ui,
			"some writes blocked; re-run with --allow-exec-adapters to include hooks/commands/skills",
			{ tone: "warning" },
		);
  }
  if (result.bootstrapError) {
    console.log(`  ontology bootstrap: failed — ${result.bootstrapError}`);
  } else if (result.bootstrapResult) {
    const wrote = result.bootstrapResult.entries.filter(
      (e) => e.outcome === "written",
    ).length;
    const skipped = result.bootstrapResult.entries.filter((e) =>
      e.outcome.startsWith("skipped"),
    ).length;
    console.log(
      `  ontology bootstrap: ${wrote} fragment(s) populated, ${skipped} skipped`,
    );
  }
  if (result.contextBootstrap) {
    const ctx = result.contextBootstrap;
    if (ctx.outcome === "written" || ctx.outcome === "planned") {
      console.log(
        `  context bootstrap: ${ctx.outcome} ${ctx.path} (${ctx.signals.length} signal(s))`,
      );
    } else {
      console.log(`  context bootstrap: ${ctx.outcome}`);
    }
  }
  if (result.projectDocs) {
    const planned = result.projectDocs.targets.filter(
      (target) => target.outcome !== "skipped-existing",
    ).length;
    const skipped = result.projectDocs.targets.length - planned;
    console.log(
      `  project docs: ${result.projectDocs.mode} ${planned} planned, ${skipped} skipped`,
    );
    for (const target of opts.verbose ? result.projectDocs.targets : []) {
			printWrapped(ui, `${target.outcome.padEnd(16)} ${target.path}`, {
				indent: 4,
			});
    }
  }
  if (result.surfaceConflicts.length > 0) {
    console.log(
      ui.note(
        `${result.surfaceConflicts.length} existing surface(s) preserved`,
        "warning",
      ),
    );
  }
  for (const conflict of opts.verbose ? result.surfaceConflicts : []) {
    const label =
      conflict.outcome === "planned-preserve"
        ? "planned surface preserve"
        : "preserved surface";
		printWrapped(ui, `${label}: ${conflict.path} -> ${conflict.preservedAs}`);
  }
  if (opts.verbose && result.writtenToDisk && result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
	if (opts.verbose && result.registration) {
		console.log(
			`  project registry: registered ${result.registration.canonical_root}`,
		);
	} else if (result.registrationError) {
		console.log(
			ui.note(
				`project registry: registration failed — ${result.registrationError}`,
				"warning",
			),
		);
	}
  if (opts.verbose) {
    console.log("  generation boundary:");
    console.log(
      "    cli-generated: AGENTS.md managed context, optional docs regions, static ontology slices, and any .bootstrap.yaml facts above",
    );
    console.log(
      "    agent-required: run /ontology-enrich for semantic ontology; run /handoff-prepare before switching agents with in-progress work",
    );
  }
	printLines(ui.section("Next steps"));
  for (const step of initNextSteps({
    writtenToDisk: result.writtenToDisk,
    blockedWrites: s.blocked,
    tools: result.agentfile.tools,
    execAdaptersEnabled,
  })) {
		if (step.command) {
			printLines(
				ui.commandRows([{ command: step.value, description: step.label }]),
			);
		} else {
			printWrapped(ui, `${step.label}: ${step.value}`);
		}
  }
}
