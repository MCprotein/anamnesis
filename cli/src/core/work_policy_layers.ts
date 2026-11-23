import { findAgentfile, readAgentfile } from "./agentfile.js";
import { readUserWorkPolicy, userWorkPolicyLayer } from "./user_work_policy.js";
import {
	hashWorkPolicyValue,
	normalizeWorkPolicyConfig,
	WORK_POLICY_LAYER_PRECEDENCE,
	type WorkPolicyConfig,
	type WorkPolicyLayer,
	type WorkPolicyLayerKind,
} from "./work_policy.js";

export const WorkPolicySection = {
	Reconciliation: "reconciliation",
	Review: "review",
	Delegation: "delegation",
} as const;
export type WorkPolicySection =
	(typeof WorkPolicySection)[keyof typeof WorkPolicySection];
export const WORK_POLICY_SECTIONS: readonly WorkPolicySection[] =
	Object.values(WorkPolicySection);

export interface InitWorkPolicyDefault {
	since: string;
	config: WorkPolicyConfig;
}

export const INIT_WORK_POLICY_DEFAULTS: readonly InitWorkPolicyDefault[] = [
	{
		since: "1.19.0",
		config: {
			reconciliation: { preset: "adaptive" },
			review: { preset: "advisory" },
			delegation: { parallelism: "auto" },
		},
	},
];

export function currentInitWorkPolicy(): WorkPolicyConfig {
	const latest = INIT_WORK_POLICY_DEFAULTS[INIT_WORK_POLICY_DEFAULTS.length - 1];
	if (!latest) throw new Error("init work policy defaults are empty");
	return structuredClone(latest.config);
}

export function normalizedWorkPolicyHash(config: WorkPolicyConfig): string {
	return hashWorkPolicyValue(normalizeWorkPolicyConfig(config));
}

export function matchingInitWorkPolicyDefault(
	config: WorkPolicyConfig,
): InitWorkPolicyDefault | null {
	const hash = normalizedWorkPolicyHash(config);
	return (
		INIT_WORK_POLICY_DEFAULTS.find(
			(entry) => normalizedWorkPolicyHash(entry.config) === hash,
		) ?? null
	);
}

export function projectWorkPolicyConfig(
	projectRoot: string,
): WorkPolicyConfig | undefined {
	if (!findAgentfile(projectRoot)) return undefined;
	const agentfile = readAgentfile(projectRoot);
	return agentfile.version === 2 ? agentfile.settings?.work_policy : undefined;
}

export function collectWorkPolicyLayers(
	projectRoot: string,
	env: NodeJS.ProcessEnv = process.env,
): WorkPolicyLayer[] {
	const layers: WorkPolicyLayer[] = [];
	const agentfilePath = findAgentfile(projectRoot);
	const projectConfig = projectWorkPolicyConfig(projectRoot);
	if (agentfilePath && projectConfig) {
		layers.push({
			kind: "project",
			config: projectConfig,
			source_refs: [{ source: "agentfile", ref: agentfilePath }],
		});
	}
	const user = readUserWorkPolicy(env);
	if (user) layers.push(userWorkPolicyLayer(user));
	return layers;
}

export type WorkPolicySectionSources = Record<
	WorkPolicySection,
	WorkPolicyLayerKind
>;

export function workPolicySectionSources(
	layers: readonly WorkPolicyLayer[],
): WorkPolicySectionSources {
	const ordered = [...layers].sort(
		(a, b) =>
			WORK_POLICY_LAYER_PRECEDENCE.indexOf(a.kind) -
			WORK_POLICY_LAYER_PRECEDENCE.indexOf(b.kind),
	);
	const sourceOf = (section: WorkPolicySection): WorkPolicyLayerKind =>
		ordered.find((layer) => layer.config?.[section] !== undefined)?.kind ??
		"product";
	return {
		reconciliation: sourceOf(WorkPolicySection.Reconciliation),
		review: sourceOf(WorkPolicySection.Review),
		delegation: sourceOf(WorkPolicySection.Delegation),
	};
}

export function shadowedUserSections(
	projectConfig: WorkPolicyConfig | undefined,
	userConfig: WorkPolicyConfig | undefined,
): WorkPolicySection[] {
	if (!projectConfig || !userConfig) return [];
	return WORK_POLICY_SECTIONS.filter(
		(section) =>
			projectConfig[section] !== undefined && userConfig[section] !== undefined,
	);
}
