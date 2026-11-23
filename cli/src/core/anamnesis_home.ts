import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const ANAMNESIS_HOME_ENV = "ANAMNESIS_HOME";
export const ANAMNESIS_HOME_DIRNAME = ".anamnesis";
export const USER_POLICY_FILENAME = "policy.yaml";

export function anamnesisHome(env: NodeJS.ProcessEnv = process.env): string {
	const override = env[ANAMNESIS_HOME_ENV];
	if (override) return path.resolve(override);
	return path.join(os.homedir(), ANAMNESIS_HOME_DIRNAME);
}

export function userPolicyPath(env: NodeJS.ProcessEnv = process.env): string {
	return path.join(anamnesisHome(env), USER_POLICY_FILENAME);
}

export function isUserHomeProjectRoot(
	projectRoot: string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const root = canonicalPath(projectRoot);
	const home = anamnesisHome(env);
	return (
		root === canonicalPath(os.homedir()) ||
		(path.basename(home) === ANAMNESIS_HOME_DIRNAME &&
			root === canonicalPath(path.dirname(home)))
	);
}

function canonicalPath(target: string): string {
	const absolute = path.resolve(target);
	try {
		return fs.realpathSync.native(absolute);
	} catch {
		return absolute;
	}
}
