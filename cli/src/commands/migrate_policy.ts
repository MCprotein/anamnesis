import * as fs from "node:fs";
import * as path from "node:path";
import { parseDocument } from "yaml";
import { findAgentfile, parseAgentfile } from "../core/agentfile.js";
import { userPolicyPath } from "../core/anamnesis_home.js";
import { readProjectRegistry } from "../core/project_registry.js";
import { readUserWorkPolicy } from "../core/user_work_policy.js";
import type { WorkPolicyConfig } from "../core/work_policy.js";
import {
	matchingInitWorkPolicyDefault,
	WORK_POLICY_SECTIONS,
} from "../core/work_policy_layers.js";
import { writeAgentfileBackup } from "./migrate.js";

export const PolicyMigrationOutcome = {
	Removed: "removed",
	WouldRemove: "would-remove",
	KeptCustomized: "kept-customized",
	KeptNoUserPolicy: "kept-no-user-policy",
	KeptUserPolicyIncomplete: "kept-user-policy-incomplete",
	NoProjectPolicy: "no-project-policy",
	NoAgentfile: "no-agentfile",
	Failed: "failed",
} as const;
export type PolicyMigrationOutcome =
	(typeof PolicyMigrationOutcome)[keyof typeof PolicyMigrationOutcome];

export interface ProjectPolicyMigration {
	projectRoot: string;
	agentfilePath: string | null;
	outcome: PolicyMigrationOutcome;
	matchedDefaultSince: string | null;
	backupPath: string | null;
	reason?: string;
}

export interface MigratePolicyOptions {
	projectRoot: string;
	all: boolean;
	dryRun: boolean;
	registryPath?: string;
	env?: NodeJS.ProcessEnv;
	now?: Date;
}

export interface MigratePolicyResult {
	userPolicyPath: string;
	userPolicyPresent: boolean;
	dryRun: boolean;
	projects: ProjectPolicyMigration[];
}

export function migratePolicy(opts: MigratePolicyOptions): MigratePolicyResult {
	const env = opts.env ?? process.env;
	const userConfig = readUserWorkPolicy(env)?.config ?? null;
	const userPolicyPresent = userConfig !== null;
	const roots = opts.all
		? readProjectRegistry({ registryPath: opts.registryPath }).projects.map(
				(project) => project.canonical_root,
			)
		: [path.resolve(opts.projectRoot)];
	const now = opts.now ?? new Date();
	return {
		userPolicyPath: userPolicyPath(env),
		userPolicyPresent,
		dryRun: opts.dryRun,
		projects: roots.map((projectRoot) =>
			migrateProjectPolicySafely({
				projectRoot,
				dryRun: opts.dryRun,
				userConfig,
				now,
			}),
		),
	};
}

interface ProjectPolicyMigrationInput {
	projectRoot: string;
	dryRun: boolean;
	userConfig: WorkPolicyConfig | null;
	now: Date;
}

function migrateProjectPolicySafely(
	input: ProjectPolicyMigrationInput,
): ProjectPolicyMigration {
	try {
		return migrateProjectPolicy(input);
	} catch (error) {
		return {
			projectRoot: input.projectRoot,
			agentfilePath: null,
			outcome: PolicyMigrationOutcome.Failed,
			matchedDefaultSince: null,
			backupPath: null,
			reason: (error as Error).message,
		};
	}
}

export function migrateProjectPolicy(
	input: ProjectPolicyMigrationInput,
): ProjectPolicyMigration {
	const agentfilePath = findAgentfile(input.projectRoot);
	const result = (
		outcome: PolicyMigrationOutcome,
		extra: Partial<ProjectPolicyMigration> = {},
	): ProjectPolicyMigration => ({
		projectRoot: input.projectRoot,
		agentfilePath,
		outcome,
		matchedDefaultSince: null,
		backupPath: null,
		...extra,
	});
	if (!agentfilePath) return result(PolicyMigrationOutcome.NoAgentfile);
	const content = fs.readFileSync(agentfilePath, "utf8");
	const agentfile = parseAgentfile(content);
	const config =
		agentfile.version === 2 ? agentfile.settings?.work_policy : undefined;
	if (!config) return result(PolicyMigrationOutcome.NoProjectPolicy);
	const matched = matchingInitWorkPolicyDefault(config);
	if (!matched) return result(PolicyMigrationOutcome.KeptCustomized);
	const matchedDefaultSince = matched.since;
	if (!input.userConfig)
		return result(PolicyMigrationOutcome.KeptNoUserPolicy, {
			matchedDefaultSince,
		});
	const userConfig = input.userConfig;
	const missing = WORK_POLICY_SECTIONS.filter(
		(section) => config[section] !== undefined && userConfig[section] === undefined,
	);
	if (missing.length > 0)
		return result(PolicyMigrationOutcome.KeptUserPolicyIncomplete, {
			matchedDefaultSince,
			reason: `policy.yaml has no ${missing.join(", ")}`,
		});
	if (input.dryRun)
		return result(PolicyMigrationOutcome.WouldRemove, { matchedDefaultSince });
	const nextContent = withoutProjectWorkPolicy(content);
	parseAgentfile(nextContent);
	const backupPath = writeAgentfileBackup({
		projectRoot: input.projectRoot,
		agentfilePath,
		content,
		now: input.now,
	});
	fs.writeFileSync(agentfilePath, nextContent, "utf8");
	return result(PolicyMigrationOutcome.Removed, {
		matchedDefaultSince,
		backupPath,
	});
}

function withoutProjectWorkPolicy(content: string): string {
	const document = parseDocument(content);
	document.deleteIn(["settings", "work_policy"]);
	return String(document);
}
