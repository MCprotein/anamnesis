import { spawnSync } from "node:child_process";
import type { RegisteredProjectsResult } from "./projects.js";
import { syncRegisteredProjects } from "./projects.js";
import { UpgradeError, type UpgradeResult } from "./upgrade.js";

interface ChildResult {
	status: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
	error?: Error;
}

type ChildRunner = (executable: string, args: string[]) => ChildResult;

export interface SyncProjectsAfterUpgradeOptions {
	registryPath?: string;
	libraryRoot: string;
	executable?: string;
	runner?: ChildRunner;
}

export function syncProjectsAfterUpgrade(
	result: UpgradeResult,
	input: SyncProjectsAfterUpgradeOptions,
): RegisteredProjectsResult {
	if (!result.applied) {
		return syncRegisteredProjects({
			libraryRoot: input.libraryRoot,
			registryPath: input.registryPath,
			apply: true,
		});
	}

	const executable =
		input.executable ?? process.env.ANAMNESIS_BIN ?? "anamnesis";
	const args = ["projects", "apply", "--json"];
	if (input.registryPath) args.push("--registry-file", input.registryPath);
	const runner = input.runner ?? runChild;
	try {
		const child = runner(executable, args);
		if (child.error) throw child.error;
		if (child.signal || child.status !== 0) {
			const detail = child.stderr.trim();
			throw new Error(
				`new CLI exited ${child.signal ? `with signal ${child.signal}` : `with status ${child.status}`}${detail ? `: ${detail}` : ""}`,
			);
		}
		const parsed = JSON.parse(child.stdout) as RegisteredProjectsResult;
		if (!parsed || !Array.isArray(parsed.projects)) {
			throw new Error("new CLI returned an invalid registered-project result");
		}
		return parsed;
	} catch (error) {
		throw new UpgradeError(
			`CLI package was upgraded, but registered-project synchronization failed: ${(error as Error).message}. Run \`anamnesis projects apply\` to retry.`,
		);
	}
}

function runChild(executable: string, args: string[]): ChildResult {
	const child = spawnSync(executable, args, {
		encoding: "utf8",
		timeout: 5 * 60_000,
	});
	return {
		status: child.status,
		signal: child.signal,
		stdout: child.stdout,
		stderr: child.stderr,
		...(child.error ? { error: child.error } : {}),
	};
}
