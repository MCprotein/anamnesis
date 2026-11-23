import { resolveWorkStateRoot, type WorkStateRoot } from "./work_storage.js";

export type WorkStateRootResolver = (
	projectRoot: string,
	override?: string,
) => WorkStateRoot;

export interface WorkStateRootOptions {
	state_root_resolver?: WorkStateRootResolver;
}

export function resolveStateRootFor(
	input: WorkStateRootOptions & { project_root: string; state_root?: string },
): WorkStateRoot {
	return (input.state_root_resolver ?? resolveWorkStateRoot)(
		input.project_root,
		input.state_root,
	);
}

export function createScopedWorkStateRootResolver(): WorkStateRootResolver {
	const resolved = new Map<string, WorkStateRoot>();
	return (projectRoot, override) => {
		const key = JSON.stringify([projectRoot, override ?? null]);
		const cached = resolved.get(key);
		if (cached) return cached;
		const state = resolveWorkStateRoot(projectRoot, override);
		resolved.set(key, state);
		return state;
	};
}
