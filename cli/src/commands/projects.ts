import * as path from "node:path";
import { readAgentfile } from "../core/agentfile.js";
import {
	defaultProjectRegistryPath,
	pruneStaleProjects,
	readProjectRegistry,
	registerProject,
	removeRegisteredProject,
	validateRegisteredProject,
	type RegisteredProject,
} from "../core/project_registry.js";
import { update } from "./update.js";
import { summarizePlannedChanges, type ChangeSummary } from "./upgrade_plan.js";

export type RegisteredProjectSyncStatus =
	| "current"
	| "ready"
	| "applied"
	| "blocked"
	| "user-modified"
	| "stale"
	| "error";

export interface RegisteredProjectSyncResult {
	project: RegisteredProject;
	status: RegisteredProjectSyncStatus;
	eligible: boolean;
	applied: boolean;
	summary?: ChangeSummary;
	error?: string;
}

export interface RegisteredProjectsResult {
	registry_path: string;
	apply: boolean;
	projects: RegisteredProjectSyncResult[];
	summary: {
		total: number;
		current: number;
		ready: number;
		applied: number;
		skipped: number;
		stale: number;
		errors: number;
	};
}

export interface RegisteredProjectsOptions {
	libraryRoot: string;
	registryPath?: string;
	apply?: boolean;
}

export class ProjectsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProjectsError";
	}
}

export function listRegisteredProjects(
	input: { registryPath?: string } = {},
): Array<{ project: RegisteredProject; valid: boolean }> {
	return readProjectRegistry({ registryPath: input.registryPath }).projects.map(
		(project) => ({ project, valid: validateRegisteredProject(project) }),
	);
}

export function registerManagedProject(input: {
	projectRoot: string;
	allowExecAdapters: boolean;
	registryPath?: string;
	now?: Date;
}): RegisteredProject {
	const projectRoot = path.resolve(input.projectRoot);
	const agentfile = readAgentfile(projectRoot);
	return registerProject({
		projectRoot,
		projectName: agentfile.project.name,
		tools: agentfile.tools,
		allowExecAdapters: input.allowExecAdapters,
		registryPath: input.registryPath,
		now: input.now,
	});
}

export function unregisterManagedProject(input: {
	idOrRoot: string;
	registryPath?: string;
}): boolean {
	return removeRegisteredProject(input);
}

export function pruneRegisteredProjects(
	input: { registryPath?: string } = {},
): RegisteredProject[] {
	return pruneStaleProjects(input);
}

export function syncRegisteredProjects(
	input: RegisteredProjectsOptions,
): RegisteredProjectsResult {
	const registry = readProjectRegistry({ registryPath: input.registryPath });
	const projects = registry.projects.map((project) =>
		syncOneProject(project, input),
	);
	return {
		registry_path: input.registryPath ?? defaultProjectRegistryPath(),
		apply: input.apply === true,
		projects,
		summary: summarizeProjects(projects),
	};
}

function syncOneProject(
	project: RegisteredProject,
	input: RegisteredProjectsOptions,
): RegisteredProjectSyncResult {
	if (!validateRegisteredProject(project)) {
		return {
			project,
			status: "stale",
			eligible: false,
			applied: false,
			error:
				"registered path is missing, moved, replaced, or no longer has the same filesystem identity",
		};
	}

	try {
		const preview = update({
			projectRoot: project.canonical_root,
			libraryRoot: input.libraryRoot,
			apply: false,
			allowExecAdapters: project.allow_exec_adapters,
		});
		const summary = summarizePlannedChanges(preview.changes);
		if (summary.userModified > 0) {
			return {
				project,
				status: "user-modified",
				eligible: false,
				applied: false,
				summary,
			};
		}
		if (summary.blocked > 0) {
			return {
				project,
				status: "blocked",
				eligible: false,
				applied: false,
				summary,
			};
		}
		const hasChanges = summary.create > 0 || summary.update > 0;
		if (!hasChanges) {
			return {
				project,
				status: "current",
				eligible: true,
				applied: false,
				summary,
			};
		}
		if (input.apply !== true) {
			return {
				project,
				status: "ready",
				eligible: true,
				applied: false,
				summary,
			};
		}
		if (!validateRegisteredProject(project)) {
			return {
				project,
				status: "stale",
				eligible: false,
				applied: false,
				summary,
				error: "project identity changed after preview",
			};
		}
		const applied = update({
			projectRoot: project.canonical_root,
			libraryRoot: input.libraryRoot,
			apply: true,
			allowExecAdapters: project.allow_exec_adapters,
		});
		const appliedSummary = summarizePlannedChanges(applied.changes);
		if (appliedSummary.userModified > 0 || appliedSummary.blocked > 0) {
			return {
				project,
				status: appliedSummary.userModified > 0 ? "user-modified" : "blocked",
				eligible: false,
				applied: false,
				summary: appliedSummary,
				error: "project changed after preview; unsafe changes were preserved",
			};
		}
		return {
			project,
			status: "applied",
			eligible: true,
			applied: true,
			summary: appliedSummary,
		};
	} catch (error) {
		return {
			project,
			status: "error",
			eligible: false,
			applied: false,
			error: (error as Error).message,
		};
	}
}

function summarizeProjects(
	projects: readonly RegisteredProjectSyncResult[],
): RegisteredProjectsResult["summary"] {
	return {
		total: projects.length,
		current: projects.filter((project) => project.status === "current").length,
		ready: projects.filter((project) => project.status === "ready").length,
		applied: projects.filter((project) => project.status === "applied").length,
		skipped: projects.filter((project) =>
			["blocked", "user-modified"].includes(project.status),
		).length,
		stale: projects.filter((project) => project.status === "stale").length,
		errors: projects.filter((project) => project.status === "error").length,
	};
}
