import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	detectPolicyDrift,
	resolveCommandPolicy,
} from "../commands/work_policy_resolution.js";
import type { WorkProjection } from "./work_projection.js";
import { userPolicyPath } from "./anamnesis_home.js";
import { USER_POLICY_SOURCE } from "./user_work_policy.js";
import { createWorkPolicySnapshot, resolveWorkPolicy } from "./work_policy.js";
import {
	collectWorkPolicyLayers,
	currentInitWorkPolicy,
	matchingInitWorkPolicyDefault,
	shadowedUserSections,
	workPolicySectionSources,
} from "./work_policy_layers.js";

let root: string;
let project: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-policy-layers-"));
	project = path.join(root, "project");
	fs.mkdirSync(project);
	env = { ANAMNESIS_HOME: path.join(root, "home") };
});

afterEach(() => {
	vi.unstubAllEnvs();
	fs.rmSync(root, { recursive: true, force: true });
});

function writeUserPolicy(content: string): void {
	fs.mkdirSync(path.dirname(userPolicyPath(env)), { recursive: true });
	fs.writeFileSync(userPolicyPath(env), content);
}

function writeAgentfile(version: number, workPolicy = ""): void {
	fs.writeFileSync(
		path.join(project, "Agentfile"),
		`version: ${version}\nproject:\n  name: demo\ntools: [claude-code]\nfragments: []\n${workPolicy ? `settings:\n  work_policy:\n${workPolicy}` : ""}`,
	);
}

const USER_RECOMMENDED = `reconciliation:
  preset: custom
  triggers: [work_resume, compaction_resume, contract_revision, before_work_close]
review:
  preset: advisory
delegation:
  parallelism: auto
  max_agents: 4
`;

describe("user work policy layer", () => {
	it("applies user values when the project Agentfile has no work_policy", () => {
		writeAgentfile(2);
		writeUserPolicy(USER_RECOMMENDED);
		const resolved = resolveWorkPolicy(collectWorkPolicyLayers(project, env));
		expect(resolved.contributing_layers).toEqual(["user"]);
		expect(resolved.reconciliation.preset).toBe("custom");
		expect(resolved.review.preset).toBe("advisory");
		expect(resolved.delegation.parallelism).toBe("auto");
		expect(resolved.source_refs).toEqual([
			{ source: USER_POLICY_SOURCE, ref: expect.stringMatching(/^sha256:/) },
		]);
	});

	it("applies the user layer to a v1 Agentfile", () => {
		writeAgentfile(1);
		writeUserPolicy(USER_RECOMMENDED);
		expect(
			resolveWorkPolicy(collectWorkPolicyLayers(project, env)).review.preset,
		).toBe("advisory");
	});

	it("lets a project section win over the same user section only", () => {
		writeAgentfile(2, "    review:\n      preset: strict\n");
		writeUserPolicy(USER_RECOMMENDED);
		const layers = collectWorkPolicyLayers(project, env);
		const resolved = resolveWorkPolicy(layers);
		expect(resolved.review.preset).toBe("strict");
		expect(resolved.reconciliation.preset).toBe("custom");
		expect(workPolicySectionSources(layers)).toEqual({
			reconciliation: "user",
			review: "project",
			delegation: "user",
		});
	});

	it("reports product defaults when no layer sets a section", () => {
		writeAgentfile(2);
		expect(
			workPolicySectionSources(collectWorkPolicyLayers(project, env)),
		).toEqual({
			reconciliation: "product",
			review: "product",
			delegation: "product",
		});
	});

	it("reads the user layer through resolveCommandPolicy", () => {
		writeAgentfile(2);
		vi.stubEnv("ANAMNESIS_HOME", env.ANAMNESIS_HOME);
		writeUserPolicy(USER_RECOMMENDED);
		const resolved = resolveCommandPolicy({ project_root: project });
		expect(resolved.contributing_layers).toEqual(["user"]);
		expect(JSON.stringify(resolved.source_refs)).not.toContain(root);
	});
});

describe("policy drift with an invalid user policy", () => {
	it("returns null instead of failing work status", () => {
		writeAgentfile(2);
		vi.stubEnv("ANAMNESIS_HOME", env.ANAMNESIS_HOME);
		const projection = {
			policy_snapshot: createWorkPolicySnapshot(1, resolveWorkPolicy([])),
		} as unknown as WorkProjection;
		writeUserPolicy("review: { preset: loud }\n");
		expect(detectPolicyDrift(project, projection)).toBeNull();
		writeUserPolicy(USER_RECOMMENDED);
		expect(detectPolicyDrift(project, projection)?.drifted).toBe(true);
	});
});

describe("init default matching", () => {
	it("matches the init default by normalized policy, not by text", () => {
		expect(matchingInitWorkPolicyDefault(currentInitWorkPolicy())?.since).toBe(
			"1.19.0",
		);
		expect(
			matchingInitWorkPolicyDefault({
				reconciliation: {
					preset: "adaptive",
					triggers: [
						"work_resume",
						"contract_revision",
						"compaction_resume",
						"meaningful_milestone",
						"before_work_close",
					],
				},
				review: { preset: "advisory" },
				delegation: { parallelism: "auto", max_agents: 4 },
			}),
		).not.toBeNull();
		expect(
			matchingInitWorkPolicyDefault({
				...currentInitWorkPolicy(),
				delegation: { parallelism: "auto", max_agents: 2 },
			}),
		).toBeNull();
	});

	it("lists only sections that both layers set", () => {
		expect(
			shadowedUserSections(
				{ review: { preset: "strict" } },
				{ review: { preset: "advisory" }, delegation: { parallelism: "auto" } },
			),
		).toEqual(["review"]);
		expect(shadowedUserSections(undefined, { review: { preset: "off" } })).toEqual(
			[],
		);
	});
});
