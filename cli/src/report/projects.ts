import {
	listRegisteredProjects,
	type RegisteredProjectsResult,
} from "../commands/projects.js";
import { createTui } from "../core/tui.js";
import { changeSummaryLine, countTone, printLines } from "./common.js";

export function reportRegisteredProjects(
	result: ReturnType<typeof listRegisteredProjects>,
	registryPath?: string,
): void {
	const ui = createTui();
	printLines([
		...ui.title("anamnesis projects", "registered projects"),
		...ui.verdict({
			label: result.some((entry) => !entry.valid)
				? "Stale registrations found"
				: "Registry ready",
			summary: `${result.length} managed project(s)`,
			tone: result.some((entry) => !entry.valid) ? "warning" : "ready",
		}),
		...ui.statusRows([
			{ label: "registry", value: registryPath ?? "user state default" },
			{ label: "projects", value: String(result.length) },
		]),
	]);
	if (result.length === 0) {
		console.log(ui.note("no registered projects"));
		return;
	}
	for (const entry of result) {
		console.log(
			`  ${entry.valid ? "valid" : "stale"} ${entry.project.project_name} ${entry.project.canonical_root}`,
		);
	}
}

export function reportRegisteredProjectSync(result: RegisteredProjectsResult): void {
	const ui = createTui();
	printLines([
		...ui.title(
			result.apply ? "anamnesis projects apply" : "anamnesis projects plan",
			"registered projects",
		),
		...ui.verdict({
			label:
				result.summary.errors > 0
					? "Project sync needs attention"
					: result.apply
						? "Projects synchronized"
						: "Project plan ready",
			summary: `${result.summary.total} registered project(s)`,
			tone:
				result.summary.errors > 0
					? "error"
					: result.summary.stale > 0
						? "warning"
						: "ready",
		}),
		...ui.statusRows([
			{ label: "registry", value: result.registry_path },
			{ label: "projects", value: String(result.summary.total) },
			{
				label: "current",
				value: String(result.summary.current),
				tone: "success",
			},
			{ label: "ready", value: String(result.summary.ready), tone: "accent" },
			{
				label: "applied",
				value: String(result.summary.applied),
				tone: "success",
			},
			{ label: "skipped", value: String(result.summary.skipped) },
			{
				label: "stale",
				value: String(result.summary.stale),
				tone: countTone(result.summary.stale),
			},
			{
				label: "errors",
				value: String(result.summary.errors),
				tone: result.summary.errors > 0 ? "danger" : "success",
			},
		]),
	]);
	for (const entry of result.projects) {
		const changes = entry.summary ? ` ${changeSummaryLine(entry.summary)}` : "";
		console.log(
			`  ${entry.status.padEnd(13)} ${entry.project.project_name} ${entry.project.canonical_root}${changes}`,
		);
		if (entry.error) console.log(`    ${entry.error}`);
	}
}
