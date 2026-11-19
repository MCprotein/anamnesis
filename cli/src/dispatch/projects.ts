import type { ParsedArgs } from "../cli/args.js";
import { writeStdoutFully } from "../cli/stdout.js";
import {
	listRegisteredProjects,
	ProjectsError,
	pruneRegisteredProjects,
	registerManagedProject,
	syncRegisteredProjects,
	unregisterManagedProject,
} from "../commands/projects.js";
import { ProjectRegistryError } from "../core/project_registry.js";
import { resolveLibraryRoot } from "../library_root.js";
import {
	reportRegisteredProjects,
	reportRegisteredProjectSync,
} from "../report/projects.js";

export async function runProjects({ positional, flags }: ParsedArgs): Promise<number> {
	try {
		const action = positional[0] ?? "list";
		const registryPath = flags["registry-file"] as string | undefined;
		if (action === "list") {
			const result = listRegisteredProjects({ registryPath });
			if (flags.json === true) await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
			else reportRegisteredProjects(result, registryPath);
			return 0;
		}
		if (action === "register") {
			const registered = registerManagedProject({
				projectRoot:
					(flags["project-root"] as string | undefined) ?? process.cwd(),
				allowExecAdapters: flags["allow-exec-adapters"] === true,
				registryPath,
			});
			if (flags.json === true)
				console.log(JSON.stringify(registered, null, 2));
			else
				console.log(
					`registered: ${registered.project_name} (${registered.canonical_root})`,
				);
			return 0;
		}
		if (action === "unregister") {
			const target = positional[1] ?? process.cwd();
			const removed = unregisterManagedProject({
				idOrRoot: target,
				registryPath,
			});
			if (flags.json === true) {
				console.log(JSON.stringify({ target, removed }, null, 2));
			} else {
				console.log(
					removed ? `unregistered: ${target}` : `not registered: ${target}`,
				);
			}
			return removed ? 0 : 1;
		}
		if (action === "prune") {
			const stale = listRegisteredProjects({ registryPath })
				.filter((entry) => !entry.valid)
				.map((entry) => entry.project);
			const removed =
				flags.apply === true
					? pruneRegisteredProjects({ registryPath })
					: [];
			const result = {
				apply: flags.apply === true,
				stale,
				removed,
			};
			if (flags.json === true) await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
			else {
				console.log(`stale registrations: ${stale.length}`);
				console.log(
					flags.apply === true
						? `removed: ${removed.length}`
						: "preview only; re-run with --apply to remove them",
				);
			}
			return 0;
		}
		if (["plan", "apply", "sync"].includes(action)) {
			const apply = action === "apply" || flags.apply === true;
			const result = syncRegisteredProjects({
				libraryRoot:
					(flags.library as string | undefined) ?? resolveLibraryRoot(),
				registryPath,
				apply,
			});
			if (flags.json === true) await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
			else reportRegisteredProjectSync(result);
			return result.summary.errors > 0 ? 1 : 0;
		}
		throw new ProjectsError(
			`unknown projects action '${action}'; expected list, register, plan, apply, unregister, or prune`,
		);
	} catch (error) {
		if (
			error instanceof ProjectsError ||
			error instanceof ProjectRegistryError
		) {
			console.error(`error: ${error.message}`);
			return 1;
		}
		throw error;
	}
}
