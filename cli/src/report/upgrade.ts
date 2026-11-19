import type { UpgradeResult } from "../commands/upgrade.js";
import type {
	UpgradeApplyChoiceResult,
} from "../commands/upgrade_apply_choice.js";
import type { UpgradeChooseResult } from "../commands/upgrade_choose.js";
import type { UpgradePlanResult } from "../commands/upgrade_plan.js";
import {
	detectUpgradeProjectGuidance,
	formatUpgradeProjectGuidance,
} from "../commands/upgrade_project_guidance.js";
import { createTui } from "../core/tui.js";
import { printLines } from "./common.js";

export function reportUpgrade(
	result: UpgradeResult,
	projectRoot: string = process.cwd(),
): void {
  const ui = createTui();
  printLines([
    ...ui.title("anamnesis upgrade", result.packageName),
		...ui.verdict({
			label: result.updateAvailable
				? "Update available"
				: result.status === "up-to-date"
					? "Up to date"
					: "Review upgrade state",
			summary: `${result.currentVersion} → ${result.latestVersion}`,
			tone: result.updateAvailable
				? "warning"
				: result.status === "up-to-date"
					? "ready"
					: "info",
		}),
		...ui.statusRows([
			{ label: "registry", value: result.registry },
			{
				label: "version",
				value: `${result.currentVersion} -> ${result.latestVersion}`,
			},
      {
				label: "status",
        value: result.status,
        tone: result.updateAvailable ? "warning" : "success",
      },
    ]),
  ]);
  if (result.updateAvailable) {
    console.log(`  command: ${result.installCommand.join(" ")}`);
    if (!result.applied) {
      console.log(ui.note("dry-run: re-run with --apply to install"));
    }
  } else if (result.status === "local-ahead") {
		console.log(
			ui.note("local package.json is ahead of the registry; no downgrade run"),
		);
  } else if (result.status === "up-to-date") {
    console.log(ui.note("already up to date", "success"));
  } else {
		console.log(
			ui.note(
				"could not compare versions; inspect the registry result before applying",
				"warning",
			),
		);
  }
  for (const line of formatUpgradeProjectGuidance(
    result,
    detectUpgradeProjectGuidance(projectRoot),
  )) {
    console.log(line);
  }
}

export function reportUpgradePlan(result: UpgradePlanResult): void {
  const ui = createTui();
  printLines([
    ...ui.title("anamnesis upgrade plan", result.package.packageName),
    ...ui.keyValues([
      { key: "generated", value: result.generatedAt },
      { key: "registry", value: result.package.registry },
      {
        key: "package",
        value: `${result.package.currentVersion} -> ${result.package.latestVersion} [${result.package.status}]`,
        tone: result.package.updateAvailable ? "warning" : "success",
      },
    ]),
  ]);
  if (result.package.updateAvailable) {
    console.log(`    command: ${result.package.installCommand.join(" ")}`);
  }

  const project = result.project;
  printLines([
    ...ui.section("Project"),
    ...ui.keyValues([{ key: "kind", value: project.kind }]),
  ]);
  if (project.agentfilePath) {
    console.log(`    Agentfile: ${project.agentfilePath}`);
  }
  if (project.schema) {
    console.log(
      `    schema: ${project.schema.currentVersion} -> ${project.schema.supportedVersion}` +
				(project.schema.migrationRequired
					? " (migration required)"
					: " (supported)"),
    );
  }
  if (project.settingsPolicy) {
    const materialized = project.settingsPolicy.defaults.filter(
      (entry) => entry.materialized,
    ).length;
    console.log(
      `    settings: ${project.settingsPolicy.materialization} (${materialized}/${project.settingsPolicy.defaults.length} defaults materialized)`,
    );
    console.log(`      ${project.settingsPolicy.message}`);
    console.log(`      next: ${project.settingsPolicy.next}`);
  }
  if (project.statusSummary) {
    console.log(
      `    fragments: updates=${project.statusSummary.fragmentUpdatesAvailable}, pinned=${project.statusSummary.fragmentPinned}, missing=${project.statusSummary.fragmentLibraryMissing}`,
    );
    console.log(
      `    drift: clean=${project.statusSummary.entriesClean}, user-modified=${project.statusSummary.entriesUserModified}, missing=${project.statusSummary.entriesMissing}`,
    );
    console.log(
      `    partial upgrades: ${project.statusSummary.partialAdoptions}`,
    );
  }
  if (project.updateSummary) {
    console.log(
      `    apply preview (safe mode, executable adapters blocked unless allowed): create=${project.updateSummary.create} update=${project.updateSummary.update} blocked=${project.updateSummary.blocked} user-modified=${project.updateSummary.userModified}`,
    );
  }
  if (project.doctorSummary) {
    console.log(
      `    doctor: errors=${project.doctorSummary.errors} warnings=${project.doctorSummary.warnings} info=${project.doctorSummary.info}`,
    );
  }
  if (project.error) {
    console.log(`    error: ${project.error}`);
  }

  if (project.gates.length > 0) {
    printLines(ui.section("Gates"));
    for (const gate of project.gates) {
			console.log(
				`    ${gate.severity.padEnd(7)} ${gate.kind}: ${gate.message}`,
			);
      console.log(`      next: ${gate.next}`);
    }
  } else {
    printLines([...ui.section("Gates"), ui.note("none", "success")]);
  }

  if (project.choices.length > 0) {
    printLines(ui.section("Choices"));
    for (const choice of project.choices) {
      const recommended = choice.recommended ? " recommended" : "";
      console.log(
        `    ${choice.id} [${choice.effect}${recommended}]: ${choice.label}`,
      );
      if (choice.command) {
        console.log(`      command: ${choice.command}`);
      }
      console.log(`      outcome: ${choice.outcome}`);
    }
  } else {
    printLines([...ui.section("Choices"), ui.note("none")]);
  }

  printLines(ui.section("Next Commands"));
  for (const command of project.commands) {
    console.log(`    ${command}`);
  }
}

export function reportUpgradeApplyChoice(result: UpgradeApplyChoiceResult): void {
  const ui = createTui();
  printLines([
    ...ui.title("anamnesis upgrade apply-choice", result.choiceId),
    ...ui.keyValues([
      {
        key: "status",
        value: result.status,
        tone: result.status === "applied" ? "success" : "accent",
      },
      { key: "effect", value: result.choice.effect },
      { key: "operation", value: result.operation },
      { key: "label", value: result.choice.label },
    ]),
  ]);
  if (result.command) {
    console.log(`  command: ${result.command}`);
  }
  if (result.previewCommand) {
    console.log(`  preview: ${result.previewCommand}`);
  }
  console.log(`  message: ${result.message}`);
  if (result.summary.length > 0) {
    printLines(ui.section("Summary"));
    for (const line of result.summary) {
      console.log(`    ${line}`);
    }
  }
}

export function reportUpgradeChoose(result: UpgradeChooseResult): void {
  console.log(`anamnesis upgrade choose — ${result.selectedChoiceId}`);
  console.log(`  interactive: ${result.interactive}`);
  console.log(`  choices: ${result.menu.length}`);
  console.log("");
  reportUpgradeApplyChoice(result.execution);
}
