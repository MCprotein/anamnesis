import * as fs from "node:fs";
import * as path from "node:path";
import { anamnesisHome, userPolicyPath } from "../core/anamnesis_home.js";
import {
	parseUserWorkPolicy,
	stringifyUserWorkPolicy,
	UserWorkPolicyError,
	type WorkPolicyBundlePreset,
	workPolicyBundle,
} from "../core/user_work_policy.js";
import { hashWorkPolicyValue } from "../core/work_policy.js";

export const PolicyScope = {
	User: "user",
} as const;
export type PolicyScope = (typeof PolicyScope)[keyof typeof PolicyScope];

export function parsePolicyScope(value: unknown): PolicyScope {
	const scopes = Object.values(PolicyScope) as string[];
	if (typeof value === "string" && scopes.includes(value))
		return value as PolicyScope;
	throw new UserWorkPolicyError(
		`unsupported policy scope: ${String(value ?? "(none)")} (expected: ${scopes.join(", ")})`,
	);
}

export const PolicyWriteStatus = {
	Created: "created",
	Updated: "updated",
	Unchanged: "unchanged",
	Blocked: "blocked",
} as const;
export type PolicyWriteStatus =
	(typeof PolicyWriteStatus)[keyof typeof PolicyWriteStatus];

export interface ConfigurePolicyOptions {
	scope: PolicyScope;
	preset: WorkPolicyBundlePreset;
	dryRun: boolean;
	force: boolean;
	env?: NodeJS.ProcessEnv;
	now?: Date;
}

export interface ConfigurePolicyResult {
	scope: PolicyScope;
	preset: WorkPolicyBundlePreset;
	path: string;
	status: PolicyWriteStatus;
	written: boolean;
	backupPath: string | null;
	content: string;
	reason?: string;
}

export function configurePolicy(
	opts: ConfigurePolicyOptions,
): ConfigurePolicyResult {
	const filePath = userPolicyPath(opts.env);
	const config = workPolicyBundle(opts.preset);
	const content = stringifyUserWorkPolicy(config);
	const base = {
		scope: opts.scope,
		preset: opts.preset,
		path: filePath,
		content,
		backupPath: null,
	};
	const status = plannedStatus(filePath, hashWorkPolicyValue(config), opts.force);
	if (status === PolicyWriteStatus.Blocked) {
		return {
			...base,
			status,
			written: false,
			reason: "policy.yaml has different values; re-run with --force to replace it",
		};
	}
	const shouldWrite = !opts.dryRun && status !== PolicyWriteStatus.Unchanged;
	const backupPath =
		shouldWrite && status === PolicyWriteStatus.Updated
			? backupUserPolicy(filePath, opts.env, opts.now ?? new Date())
			: null;
	if (shouldWrite) {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, "utf8");
	}
	return { ...base, status, written: shouldWrite, backupPath };
}

function backupUserPolicy(
	filePath: string,
	env: NodeJS.ProcessEnv | undefined,
	now: Date,
): string {
	const backupPath = path.join(
		anamnesisHome(env),
		"backups",
		now.toISOString().replace(/[:.]/g, "-"),
		path.basename(filePath),
	);
	fs.mkdirSync(path.dirname(backupPath), { recursive: true });
	fs.copyFileSync(filePath, backupPath);
	return backupPath;
}

function plannedStatus(
	filePath: string,
	nextHash: string,
	force: boolean,
): PolicyWriteStatus {
	if (!fs.existsSync(filePath)) return PolicyWriteStatus.Created;
	let currentHash: string | null = null;
	try {
		currentHash = hashWorkPolicyValue(
			parseUserWorkPolicy(fs.readFileSync(filePath, "utf8"), filePath),
		);
	} catch (error) {
		if (!(error instanceof UserWorkPolicyError)) throw error;
	}
	if (currentHash === nextHash) return PolicyWriteStatus.Unchanged;
	return force ? PolicyWriteStatus.Updated : PolicyWriteStatus.Blocked;
}
