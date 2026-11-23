import * as fs from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { userPolicyPath } from "./anamnesis_home.js";
import {
	hashWorkPolicyValue,
	type WorkPolicyConfig,
	type WorkPolicyLayer,
	workPolicyConfigSchema,
} from "./work_policy.js";

export const USER_POLICY_SOURCE = "user:policy.yaml";

export const WorkPolicyBundlePreset = {
	Recommended: "recommended",
} as const;
export type WorkPolicyBundlePreset =
	(typeof WorkPolicyBundlePreset)[keyof typeof WorkPolicyBundlePreset];

const WORK_POLICY_BUNDLES: Readonly<
	Record<WorkPolicyBundlePreset, WorkPolicyConfig>
> = {
	[WorkPolicyBundlePreset.Recommended]: {
		reconciliation: {
			preset: "custom",
			triggers: [
				"work_resume",
				"compaction_resume",
				"contract_revision",
				"before_work_close",
			],
		},
		review: { preset: "advisory" },
		delegation: { parallelism: "auto", max_agents: 4 },
	},
};

export class UserWorkPolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UserWorkPolicyError";
	}
}

export function parseWorkPolicyBundlePreset(
	value: unknown,
): WorkPolicyBundlePreset {
	const presets = Object.values(WorkPolicyBundlePreset) as string[];
	if (typeof value === "string" && presets.includes(value))
		return value as WorkPolicyBundlePreset;
	throw new UserWorkPolicyError(
		`unknown policy preset: ${String(value)} (expected one of: ${presets.join(", ")})`,
	);
}

export function workPolicyBundle(
	preset: WorkPolicyBundlePreset,
): WorkPolicyConfig {
	return structuredClone(WORK_POLICY_BUNDLES[preset]);
}

export interface UserWorkPolicy {
	path: string;
	config: WorkPolicyConfig;
	content_hash: string;
}

export function parseUserWorkPolicy(
	content: string,
	filePath: string,
): WorkPolicyConfig {
	let raw: unknown;
	try {
		raw = parseYaml(content);
	} catch (error) {
		throw new UserWorkPolicyError(
			`${filePath}: YAML parse error: ${(error as Error).message}`,
		);
	}
	const parsed = workPolicyConfigSchema.safeParse(raw ?? {});
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
			.join("; ");
		throw new UserWorkPolicyError(`${filePath}: invalid work policy: ${issues}`);
	}
	return parsed.data;
}

export function readUserWorkPolicy(
	env: NodeJS.ProcessEnv = process.env,
): UserWorkPolicy | null {
	const filePath = userPolicyPath(env);
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw new UserWorkPolicyError(
			`${filePath}: cannot read: ${(error as Error).message}`,
		);
	}
	const config = parseUserWorkPolicy(content, filePath);
	return {
		path: filePath,
		config,
		content_hash: hashWorkPolicyValue(config),
	};
}

export function userWorkPolicyLayer(policy: UserWorkPolicy): WorkPolicyLayer {
	return {
		kind: "user",
		config: policy.config,
		source_refs: [{ source: USER_POLICY_SOURCE, ref: policy.content_hash }],
	};
}

export function stringifyUserWorkPolicy(config: WorkPolicyConfig): string {
	return stringifyYaml(workPolicyConfigSchema.parse(config), {
		indent: 2,
		lineWidth: 100,
	});
}
