import * as fs from "node:fs";
import * as path from "node:path";
import { resolveWorkStateRoot } from "../core/work_storage.js";
import type { DoctorIssue } from "./doctor.js";
import { readWorkLedger } from "../core/work_ledger.js";
import { resolveWorkPolicy } from "../core/work_policy.js";
import { foldWorkProjection } from "../core/work_projection.js";
import { driftReport, WorkPolicyDriftState } from "./work_policy_resolution.js";
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
	WorkDriftUnchecked: "work-policy-drift-unchecked",
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
	issues.push(...openWorkDriftIssues(projectRoot, env));
	issues.push({
		severity: "info",
		code: WorkPolicyDoctorCode.Sources,
		message: WORK_POLICY_SECTIONS.map(
			(section) => `${section}=${sources[section]}`,
		).join(" "),
	});
	return issues;
}

function openWorkDriftIssues(
	projectRoot: string,
	env: NodeJS.ProcessEnv,
): DoctorIssue[] {
	let stateRoot: string;
	try {
		stateRoot = resolveWorkStateRoot(projectRoot).state_root;
	} catch {
		return [];
	}
	const unitsDir = path.join(stateRoot, "work-units");
	if (!fs.existsSync(unitsDir)) return [];
	let currentPolicy: ReturnType<typeof resolveWorkPolicy>;
	try {
		currentPolicy = resolveWorkPolicy(collectWorkPolicyLayers(projectRoot, env));
	} catch (error) {
		return [
			{
				severity: "warning",
				code: WorkPolicyDoctorCode.WorkDriftUnchecked,
				message: `cannot resolve the current Work policy: ${(error as Error).message}`,
				target: "Agentfile settings.work_policy",
			},
		];
	}
	return fs
		.readdirSync(unitsDir, { withFileTypes: true })
		.filter((entry) =>
			fs.existsSync(path.join(unitsDir, entry.name, "ledger.jsonl")),
		)
		.flatMap((entry): DoctorIssue[] => {
			let report: ReturnType<typeof driftReport>;
			try {
				report = driftReport(
					foldWorkProjection(
						readWorkLedger(path.join(unitsDir, entry.name, "ledger.jsonl"))
							.records,
					),
					currentPolicy,
				);
			} catch (error) {
				return [
					{
						severity: "warning",
						code: WorkPolicyDoctorCode.WorkDriftUnchecked,
						message: `cannot check the Work policy: ${(error as Error).message}`,
						target: entry.name,
					},
				];
			}
			if (report.state === WorkPolicyDriftState.Drifted)
				return [
					{
						severity: "warning",
						code: WorkPolicyDoctorCode.WorkDrift,
						message:
							"open Work uses a frozen policy that differs from the current policy; the next contract revision applies the current policy",
						target: entry.name,
						...(report.resolve_command ? { repair: report.resolve_command } : {}),
					},
				];
			if (report.state === WorkPolicyDriftState.DriftedHeld)
				return [
					{
						severity: "warning",
						code: WorkPolicyDoctorCode.WorkDrift,
						message:
							"open Work keeps a required review gate that the current policy lowers; a revision does not lower it",
						target: entry.name,
						repair: "restore the required review gate in the project or user policy; a revision keeps the frozen gate until then",
					},
				];
			return [];
		});
}
