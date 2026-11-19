import { summarizeChanges } from "../commands/init.js";
import type { UpdateResult } from "../commands/update.js";
import { createTui } from "../core/tui.js";
import {
	changeSummaryLine,
	countTone,
	printLines,
	printOntologyRecommendation,
	printWrapped,
	reportChangeDetails,
	reportWorkspaceProfile,
} from "./common.js";

export function printUpdateDeprecationWarning(): void {
  console.error(
    "warning: `anamnesis update` is deprecated; use `anamnesis apply --dry-run` to preview project changes or `anamnesis apply` to write reviewed changes. `update --apply` remains available for compatibility.",
  );
}

export function reportUpdate(
  result: UpdateResult,
  opts: {
		commandName?: "apply" | "update";
		projectRoot?: string;
		verbose?: boolean;
	} = {},
): void {
  const ui = createTui();
  const commandName = opts.commandName ?? "update";
  const s = summarizeChanges(result.changes);
	const fragIds =
		result.agentfile.fragments.map((f) => f.id).join(", ") || "(none)";
  const pending = s.create + s.update + s.blocked + s.userModified;
  const mode = result.writtenToDisk
    ? "applied"
    : pending > 0
      ? "preview"
      : "no changes";
  printLines([
    ...ui.title(`anamnesis ${commandName}`, result.agentfile.project.name),
		...ui.verdict({
			label: result.writtenToDisk
				? "Changes applied"
				: pending > 0
					? "Preview ready"
					: "Already current",
			summary:
				s.blocked > 0
					? `${s.blocked} protected write(s) blocked`
					: `${pending} pending change(s)`,
			tone:
				s.blocked > 0
					? "warning"
					: result.writtenToDisk || pending === 0
						? "ready"
						: "info",
		}),
		...ui.statusRows([
			{
				label: "mode",
				value: mode,
				tone: result.writtenToDisk ? "success" : "accent",
			},
			{ label: "fragments", value: fragIds },
			{
				label: "changes",
				value: changeSummaryLine(s),
				tone: countTone(s.blocked),
			},
    ]),
  ]);
	if (opts.verbose) reportChangeDetails(ui, result.changes);
  if (result.suggested.length > 0) {
    const ids = result.suggested.map((r) => r.suggest).join(", ");
		printLines(ui.section("Suggested"));
		printWrapped(ui, ids);
		printWrapped(
			ui,
			"add to Agentfile.fragments[] and re-run, or list under 'declined' to silence",
		);
  }
  if (s.userModified > 0) {
		printWrapped(
			ui,
			`${s.userModified} user-modified: your edits are preserved; library updates skipped for those`,
			{ tone: "warning" },
		);
  }
  if (s.blocked > 0) {
		printWrapped(
			ui,
			"some writes blocked; re-run with --allow-exec-adapters to include hooks/commands/skills",
			{ tone: "warning" },
		);
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
  const showOntologyRecommendation =
    result.ontologyRecommendation.action !== "none" &&
    (result.writtenToDisk || result.ontologyRecommendation.action !== "apply");
  if (showOntologyRecommendation) {
    printOntologyRecommendation(ui, result.ontologyRecommendation, {
      label: result.writtenToDisk ? "ontology next" : "after apply",
    });
  }
  if (result.writtenToDisk) {
    if (opts.verbose && result.backedUpFiles && result.backedUpFiles.length > 0) {
      console.log(`  backup: ${result.backupDir}`);
    }
    if (opts.verbose && result.prunedBackupDirs && result.prunedBackupDirs.length > 0) {
      console.log(`  pruned backups: ${result.prunedBackupDirs.length}`);
    }
    if (opts.verbose && result.evidencePath) {
      console.log(`  evidence: ${result.evidencePath}`);
    }
  } else {
    if (opts.verbose && opts.projectRoot) {
      reportWorkspaceProfile(opts.projectRoot);
    }
    if (commandName === "apply") {
			printWrapped(
				ui,
				"dry-run: re-run without --dry-run to actually write",
			);
    } else {
			printWrapped(
				ui,
				"dry-run: use `anamnesis apply` to write; `update --apply` remains available for compatibility",
			);
    }
  }
}
