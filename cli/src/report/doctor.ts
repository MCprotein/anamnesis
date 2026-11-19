import * as path from "node:path";
import {
	doctorHumanPresentation,
	type DoctorResult,
} from "../commands/doctor.js";
import {
	collectGenerationBoundaryStatus,
	formatGenerationBoundaryLines,
} from "../core/generation-boundary.js";
import { createTui } from "../core/tui.js";
import {
	type HumanReportOptions,
	printLines,
	printOntologyRecommendation,
	printWrapped,
	reportAppendEvidence,
} from "./common.js";
import { reportCodexHookTrustInspection } from "./hooks.js";

export function reportDoctor(
	result: DoctorResult,
	opts: HumanReportOptions = {},
): void {
  const ui = createTui();
  const presentation = doctorHumanPresentation(result, opts.verbose === true);
  printLines([
    ...ui.title("anamnesis doctor", path.basename(result.projectRoot)),
		...ui.verdict({
			label: result.ok ? "Installation healthy" : "Repair required",
			summary: result.ok
				? "managed surfaces and runtime checks passed"
				: `${presentation.summary.errors} errors and ${presentation.summary.warnings} warnings found`,
			tone: result.ok
				? "ready"
				: presentation.summary.errors > 0
					? "error"
					: "warning",
		}),
		...ui.statusRows([
      {
				label: "findings",
				value: `${presentation.summary.errors} error(s), ${presentation.summary.warnings} warning(s), ${presentation.summary.info} info`,
				tone:
					presentation.summary.errors > 0 || presentation.summary.warnings > 0
						? "warning"
						: "success",
      },
    ]),
  ]);
  printOntologyRecommendation(ui, result.ontologyRecommendation, {
    label: "ontology next",
  });
  if (result.codexHookTrust) {
		reportCodexHookTrustInspection(result.codexHookTrust, opts);
  }
  if (presentation.issues.length === 0) {
		if (opts.verbose) {
    for (const line of formatGenerationBoundaryLines(
      collectGenerationBoundaryStatus(result.projectRoot),
			))
      console.log(line);
		} else if (presentation.hiddenInfo > 0) {
			console.log(
				ui.note(
					`${presentation.hiddenInfo} informational finding(s) hidden; use --verbose`,
				),
			);
		} else {
			console.log(ui.note("use `--verbose` for full diagnostic context"));
    }
    reportAppendEvidence(result.appendedPath, result.evidencePath);
    return;
  }
  printLines(ui.section("Issues"));
	for (const issue of presentation.issues) {
    const scope = issue.scopePath ? ` [${issue.scopePath}]` : "";
    const target = issue.target ? ` ${issue.target}` : "";
		printWrapped(
			ui,
			`${issue.severity.padEnd(7)} ${issue.code}${scope}${target}`,
		);
		printWrapped(ui, issue.message, { indent: 4 });
    if (issue.repair) {
			printWrapped(ui, `repair: ${issue.repair}`, {
				indent: 4,
				tone: "warning",
			});
    }
  }
	if (opts.verbose) {
  for (const line of formatGenerationBoundaryLines(
    collectGenerationBoundaryStatus(result.projectRoot),
		))
    console.log(line);
	} else if (presentation.hiddenInfo > 0) {
		console.log(
			ui.note(
				`${presentation.hiddenInfo} informational finding(s) hidden; use --verbose`,
			),
		);
  }
  reportAppendEvidence(result.appendedPath, result.evidencePath);
}
