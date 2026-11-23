import * as path from "node:path";
import {
	type ConfigurePolicyResult,
	PolicyWriteStatus,
} from "../commands/context_policy.js";
import {
	type MigratePolicyResult,
	PolicyMigrationOutcome,
	type ProjectPolicyMigration,
} from "../commands/migrate_policy.js";
import { type Chip, CHIP, createTui, LEVEL, type Level } from "../core/tui.js";
import { type Finding, findingLines, plural, printLines } from "./common.js";

const WRITE_STATUS_VIEW: Record<PolicyWriteStatus, { chip: Chip; level: Level }> =
	{
		[PolicyWriteStatus.Created]: { chip: CHIP.ok, level: LEVEL.ready },
		[PolicyWriteStatus.Updated]: { chip: CHIP.ok, level: LEVEL.ready },
		[PolicyWriteStatus.Unchanged]: { chip: CHIP.info, level: LEVEL.ready },
		[PolicyWriteStatus.Blocked]: { chip: CHIP.warn, level: LEVEL.attention },
	};

export function reportConfigurePolicy(result: ConfigurePolicyResult): void {
	const ui = createTui();
	const view = WRITE_STATUS_VIEW[result.status];
	const preview = !result.written && result.status !== PolicyWriteStatus.Unchanged;
	printLines([
		...ui.heading("anamnesis context policy configure", `${result.scope} scope`),
		...ui.level(
			view.level,
			result.reason ??
				`${preview && result.status !== PolicyWriteStatus.Blocked ? "preview: would be " : ""}${result.status}`,
		),
		"",
		...ui.table([
			["preset", result.preset],
			["file", result.path],
		]),
		...ui.section("Policy"),
		...result.content
			.trimEnd()
			.split("\n")
			.map((line) => `  ${line}`),
	]);
}

const MIGRATION_VIEW: Record<
	PolicyMigrationOutcome,
	{ chip: Chip; detail: string }
> = {
	[PolicyMigrationOutcome.Removed]: {
		chip: CHIP.ok,
		detail: "removed init-default work_policy; the user layer now applies",
	},
	[PolicyMigrationOutcome.WouldRemove]: {
		chip: CHIP.todo,
		detail: "init-default work_policy would be removed",
	},
	[PolicyMigrationOutcome.KeptCustomized]: {
		chip: CHIP.warn,
		detail: "kept: work_policy differs from every init default",
	},
	[PolicyMigrationOutcome.KeptNoUserPolicy]: {
		chip: CHIP.warn,
		detail: "kept: no user policy.yaml; removal would turn Work policies off",
	},
	[PolicyMigrationOutcome.NoProjectPolicy]: {
		chip: CHIP.info,
		detail: "no project work_policy",
	},
	[PolicyMigrationOutcome.NoAgentfile]: {
		chip: CHIP.info,
		detail: "no Agentfile",
	},
	[PolicyMigrationOutcome.Failed]: { chip: CHIP.fail, detail: "failed" },
};

export function reportMigratePolicy(result: MigratePolicyResult): void {
	const ui = createTui();
	const findings = result.projects.map(migrationFinding);
	const failed = result.projects.some(
		(project) => project.outcome === PolicyMigrationOutcome.Failed,
	);
	const pending = result.projects.filter(
		(project) => project.outcome === PolicyMigrationOutcome.WouldRemove,
	).length;
	printLines([
		...ui.heading("anamnesis migrate policy", plural(result.projects.length, "project")),
		...ui.level(
			failed ? LEVEL.failed : result.userPolicyPresent ? LEVEL.ready : LEVEL.attention,
			result.dryRun
				? `dry-run: ${plural(pending, "block")} would be removed`
				: `${plural(result.projects.filter((p) => p.outcome === PolicyMigrationOutcome.Removed).length, "block")} removed`,
		),
		"",
		...ui.table([
			["user policy", result.userPolicyPresent ? result.userPolicyPath : "missing"],
		]),
		...ui.section("Projects", result.projects.length),
		...findingLines(ui, findings),
	]);
	if (!result.userPolicyPresent) {
		printLines([
			...ui.section("Next"),
			...ui.commandRows([
				{
					command: "anamnesis context policy configure --scope user --preset recommended",
					description: "create the user policy first",
				},
			]),
		]);
	}
}

function migrationFinding(project: ProjectPolicyMigration): Finding {
	const view = MIGRATION_VIEW[project.outcome];
	return {
		chip: view.chip,
		topic: path.basename(project.projectRoot),
		detail: project.reason ? `${view.detail}: ${project.reason}` : view.detail,
		more: [
			project.projectRoot,
			...(project.backupPath ? [`backup: ${project.backupPath}`] : []),
		],
	};
}
