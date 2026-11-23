import { type InitResult, summarizeChanges } from "../commands/init.js";
import { InitWorkPolicyPlacement } from "../commands/init_work_policy.js";
import {
	INIT_BLOCKED_STEP_LABEL,
	initNextSteps,
} from "../core/init_next_steps.js";
import { CHIP, createTui, LEVEL, type Tui } from "../core/tui.js";
import {
	type Finding,
	type HumanReportOptions,
	plural,
	printFindingSection,
	printLines,
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
	const verbose = opts.verbose === true;
	const s = summarizeChanges(result.changes);
	const fragIds =
		result.selectedFragments.map((f) => f.id).join(", ") || "(none)";
	const steps = initNextSteps({
		writtenToDisk: result.writtenToDisk,
		blockedWrites: s.blocked,
		tools: result.agentfile.tools,
		execAdaptersEnabled,
	});
	const notes = initNotes(result, s.blocked, verbose, steps);
	const level =
		s.blocked > 0 || result.registrationError || result.bootstrapError
			? LEVEL.attention
			: result.writtenToDisk
				? LEVEL.ready
				: LEVEL.notice;
	printLines([
		...ui.heading("anamnesis init", result.agentfile.project.name),
		...ui.level(
			level,
			`${result.writtenToDisk ? "initialized" : "preview ready"}${s.blocked > 0 ? `; ${s.blocked} protected writes blocked` : ""}`,
		),
		"",
		...ui.table([
			["mode", result.writtenToDisk ? "applied" : "preview"],
			["tools", result.agentfile.tools.join(", ")],
			["fragments", fragIds],
			["changes", changeCounts(ui, s)],
		]),
	]);
	if (verbose) reportChangeDetails(ui, result.changes);
	const monorepo = result.monorepoDetection;
	if (monorepo?.isMonorepo) {
		printLines([
			...ui.section("Workspace Profile", monorepo.scopes.length),
			...ui.table(
				verbose
					? [
							...monorepo.scopes.map((scope) => [
								scope.path,
								scope.matchedRules.map((r) => r.suggest).join(", ") || "(none)",
							]),
							...(monorepo.emptyScopes.length > 0
								? [["(no rule match)", monorepo.emptyScopes.join(", ")]]
								: []),
						]
					: [
							[
								"detected",
								`monorepo via ${monorepo.declaredVia}: ${plural(monorepo.scopes.length, "scope")}`,
							],
						],
			),
		]);
	}
	if (!result.writtenToDisk && verbose) reportWorkspaceProfile(projectRoot);
	printFindingSection(ui, "Notes", notes);
	const commands = new Map<string, string[]>();
	for (const step of steps) {
		if (!step.command) continue;
		commands.set(step.value, [...(commands.get(step.value) ?? []), step.label]);
	}
	printLines([
		...ui.section("Next steps"),
		...ui.commandRows(
			[...commands].map(([command, labels]) => ({
				command,
				description: labels.join("; "),
			})),
		),
	]);
}

function changeCounts(ui: Tui, s: ReturnType<typeof summarizeChanges>): string {
	return [
		[s.create, "create", true],
		[s.update, "update", true],
		[s.noop, "noop", true],
		[s.blocked, "blocked", s.blocked === 0],
		[s.userModified, "user-modified", s.userModified === 0],
	]
		.map(
			([value, label, ok]) =>
				`${ui.style(String(value), ok ? "success" : "warning")} ${ui.style(String(label), "muted")}`,
		)
		.join(", ");
}

function initNotes(
	result: InitResult,
	blocked: number,
	verbose: boolean,
	steps: ReturnType<typeof initNextSteps>,
): Finding[] {
	const notes: Finding[] = [];
	if (!result.writtenToDisk)
		notes.push({
			chip: CHIP.info,
			topic: "dry-run",
			detail: "no files written",
		});
	if (blocked > 0) {
		const step = steps.find((item) => item.label === INIT_BLOCKED_STEP_LABEL);
		notes.push({
			chip: CHIP.warn,
			topic: "blocked",
			detail: `${plural(blocked, "executable write")}; ${step?.value ?? "review hooks/commands/skills"}`,
		});
	}
	for (const step of steps) {
		if (step.command || step.label === INIT_BLOCKED_STEP_LABEL) continue;
		notes.push({ chip: CHIP.info, topic: step.label, detail: step.value });
	}
	if (result.bootstrapError) {
		notes.push({
			chip: CHIP.warn,
			topic: "ontology bootstrap",
			detail: `failed: ${result.bootstrapError}`,
		});
	} else if (result.bootstrapResult) {
		const entries = result.bootstrapResult.entries;
		const wrote = entries.filter((e) => e.outcome === "written").length;
		const skipped = entries.filter((e) =>
			e.outcome.startsWith("skipped"),
		).length;
		notes.push({
			chip: CHIP.info,
			topic: "ontology bootstrap",
			detail: `${plural(wrote, "fragment")} populated, ${skipped} skipped`,
		});
	}
	notes.push(workPolicyNote(result.workPolicyPlacement));
	const ctx = result.contextBootstrap;
	if (ctx) {
		notes.push({
			chip: CHIP.info,
			topic: "context bootstrap",
			detail:
				ctx.outcome === "written" || ctx.outcome === "planned"
					? `${ctx.outcome} ${ctx.path} (${plural(ctx.signals.length, "signal")})`
					: ctx.outcome,
		});
	}
	if (result.projectDocs) {
		const targets = result.projectDocs.targets;
		const planned = targets.filter(
			(target) => target.outcome !== "skipped-existing",
		).length;
		notes.push({
			chip: CHIP.info,
			topic: "project docs",
			detail: `${result.projectDocs.mode}: ${planned} planned, ${targets.length - planned} skipped`,
			more: verbose
				? targets.map((target) => `${target.outcome} ${target.path}`)
				: [],
		});
	}
	if (result.surfaceConflicts.length > 0) {
		notes.push({
			chip: CHIP.warn,
			topic: "existing surfaces",
			detail: `${result.surfaceConflicts.length} preserved`,
			more: verbose
				? result.surfaceConflicts.map(
						(conflict) =>
							`${conflict.outcome === "planned-preserve" ? "planned surface preserve" : "preserved surface"}: ${conflict.path} -> ${conflict.preservedAs}`,
					)
				: [],
		});
	}
	if (verbose && result.writtenToDisk && result.evidencePath)
		notes.push({
			chip: CHIP.info,
			topic: "evidence",
			detail: result.evidencePath,
		});
	if (result.registrationError) {
		notes.push({
			chip: CHIP.warn,
			topic: "project registry",
			detail: `registration failed: ${result.registrationError}`,
		});
	} else if (verbose && result.registration) {
		notes.push({
			chip: CHIP.info,
			topic: "project registry",
			detail: `registered ${result.registration.canonical_root}`,
		});
	}
	if (verbose) {
		notes.push({
			chip: CHIP.info,
			topic: "generation boundary",
			detail:
				"cli-generated: AGENTS.md managed context, optional docs regions, static ontology slices, and any .bootstrap.yaml facts above",
			more: [
				"agent-required: run /ontology-enrich for semantic ontology; run /handoff-prepare before switching agents with in-progress work",
			],
		});
	}
	return notes;
}

const WORK_POLICY_NOTE_DETAIL: Record<InitWorkPolicyPlacement, string> = {
	[InitWorkPolicyPlacement.ProjectDefault]:
		"Agentfile init default; set a user policy with anamnesis context policy configure --scope user --preset recommended",
	[InitWorkPolicyPlacement.ProjectFromUser]:
		"Agentfile copy of the user policy.yaml (--project-policy)",
	[InitWorkPolicyPlacement.UserLayer]:
		"user policy.yaml; Agentfile has no work_policy (add --project-policy to keep one in the project)",
};

function workPolicyNote(placement: InitWorkPolicyPlacement): Finding {
	return {
		chip: CHIP.info,
		topic: "work policy",
		detail: WORK_POLICY_NOTE_DETAIL[placement],
	};
}
