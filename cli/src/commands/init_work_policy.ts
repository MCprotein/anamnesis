import { readUserWorkPolicy } from "../core/user_work_policy.js";
import type { WorkPolicyConfig } from "../core/work_policy.js";
import { currentInitWorkPolicy } from "../core/work_policy_layers.js";

export const InitWorkPolicyPlacement = {
	ProjectDefault: "project-default",
	ProjectFromUser: "project-from-user",
	UserLayer: "user-layer",
} as const;
export type InitWorkPolicyPlacement =
	(typeof InitWorkPolicyPlacement)[keyof typeof InitWorkPolicyPlacement];

export interface InitWorkPolicyPlan {
	placement: InitWorkPolicyPlacement;
	projectConfig?: WorkPolicyConfig;
}

export function planInitWorkPolicy(input: {
	projectPolicy: boolean;
	env?: NodeJS.ProcessEnv;
}): InitWorkPolicyPlan {
	const user = readUserWorkPolicy(input.env);
	if (!user) {
		return {
			placement: InitWorkPolicyPlacement.ProjectDefault,
			projectConfig: currentInitWorkPolicy(),
		};
	}
	if (input.projectPolicy) {
		return {
			placement: InitWorkPolicyPlacement.ProjectFromUser,
			projectConfig: structuredClone(user.config),
		};
	}
	return { placement: InitWorkPolicyPlacement.UserLayer };
}
