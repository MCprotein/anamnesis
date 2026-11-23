import * as fs from "node:fs";
import * as path from "node:path";
import { resolveWorkStateRoot } from "../core/work_storage.js";
import type { DoctorIssue } from "./doctor.js";
import { WorkPolicyDriftState } from "./work_policy_resolution.js";
import { statusWork } from "./work_status.js";
import {
	readUserWorkPolicy,
	type UserWorkPolicy,
	UserWorkPolicyError,
	USER_POLICY_SOURCE,
} from "../core/user_work_policy.js";
import {
	collectWorkPolicyLayers,
	matchingInitWorkPolicyDefault,
	projectWorkPolicyConfig,
	shadowedUserSections,
	WORK_POLICY_SECTIONS,
	workPolicySectionSources,
} from "../core/work_policy_layers.js";

export const WorkPolicyDoctorCode = {
	UserPolicyInvalid: "work-policy-user-invalid",
	UserPolicyShadowedByDefault: "work-policy-user-shadowed",
	UserPolicyOverriddenByProject: "work-policy-project-overrides-user",
	Sources: "work-policy-sources",
	WorkDrift: "work-policy-drift",
} as const;
export type WorkPolicyDoctorCode =
	(typeof WorkPolicyDoctorCode)[keyof typeof WorkPolicyDoctorCode];

export function workPolicyDoctorIssues(
	projectRoot: string,
	env: NodeJS.ProcessEnv = process.env,
): DoctorIssue[] {
	let user: UserWorkPolicy | null;
	try {
		user = readUserWorkPolicy(env);
	} catch (error) {
		if (!(error instanceof UserWorkPolicyError)) throw error;
		return [
			{
				severity: "error",
				code: WorkPolicyDoctorCode.UserPolicyInvalid,
				message: error.message,
				target: USER_POLICY_SOURCE,
				repair:
					"fix policy.yaml or re-create it with anamnesis context policy configure --scope user --preset recommended --force",
			},
		];
	}
	const issues: DoctorIssue[] = [];
	const projectConfig = projectWorkPolicyConfig(projectRoot);
	const shadowed = shadowedUserSections(projectConfig, user?.config);
	if (projectConfig && shadowed.length > 0) {
		const legacyDefault = matchingInitWorkPolicyDefault(projectConfig);
		issues.push(
			legacyDefault
				? {
						severity: "warning",
						code: WorkPolicyDoctorCode.UserPolicyShadowedByDefault,
						message: `Agentfile work_policy is the init default (since ${legacyDefault.since}) and hides the user policy for: ${shadowed.join(", ")}`,
						target: "Agentfile settings.work_policy",
						repair: "anamnesis migrate policy",
					}
				: {
						severity: "info",
						code: WorkPolicyDoctorCode.UserPolicyOverriddenByProject,
						message: `Agentfile work_policy overrides the user policy for: ${shadowed.join(", ")}`,
						target: "Agentfile settings.work_policy",
					},
		);
	}
	const sources = workPolicySectionSources(
		collectWorkPolicyLayers(projectRoot, env),
	);
	issues.push(...openWorkDriftIssues(projectRoot));
	issues.push({
		severity: "info",
		code: WorkPolicyDoctorCode.Sources,
		message: WORK_POLICY_SECTIONS.map(
			(section) => `${section}=${sources[section]}`,
		).join(" "),
	});
	return issues;
}

function openWorkDriftIssues(projectRoot: string): DoctorIssue[] {
	let unitsDir: string;
	try {
		unitsDir = path.join(
			resolveWorkStateRoot(projectRoot).state_root,
			"work-units",
		);
	} catch {
		return [];
	}
	if (!fs.existsSync(unitsDir)) return [];
	return fs
		.readdirSync(unitsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => {
			try {
				const result = statusWork({
					project_root: projectRoot,
					work_id: entry.name,
				});
				if (
					result.projection.lifecycle !== "open" ||
					result.policy_drift_state !== WorkPolicyDriftState.Drifted
				)
					return [];
				return [
					{
						severity: "warning" as const,
						code: WorkPolicyDoctorCode.WorkDrift,
						message:
							"open Work uses a frozen policy that differs from the current policy; the next contract revision applies the current policy",
						target: entry.name,
						...(result.policy_drift_resolve_command
							? { repair: result.policy_drift_resolve_command }
							: {}),
					},
				];
			} catch {
				return [];
			}
		});
}
