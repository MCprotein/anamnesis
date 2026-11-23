import type { DoctorIssue } from "./doctor.js";
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
	issues.push({
		severity: "info",
		code: WorkPolicyDoctorCode.Sources,
		message: WORK_POLICY_SECTIONS.map(
			(section) => `${section}=${sources[section]}`,
		).join(" "),
	});
	return issues;
}
