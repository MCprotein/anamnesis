import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	anamnesisHome,
	isUserHomeProjectRoot,
	userPolicyPath,
} from "./anamnesis_home.js";
import {
	parseWorkPolicyBundlePreset,
	readUserWorkPolicy,
	stringifyUserWorkPolicy,
	USER_POLICY_SOURCE,
	userWorkPolicyLayer,
	UserWorkPolicyError,
	WorkPolicyBundlePreset,
	workPolicyBundle,
} from "./user_work_policy.js";
import { resolveWorkPolicy } from "./work_policy.js";

let root: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-user-policy-"));
	env = { ANAMNESIS_HOME: path.join(root, ".anamnesis") };
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

function writePolicy(content: string): void {
	fs.mkdirSync(anamnesisHome(env), { recursive: true });
	fs.writeFileSync(userPolicyPath(env), content);
}

describe("anamnesis home", () => {
	it("uses ANAMNESIS_HOME and keeps policy.yaml inside it", () => {
		expect(anamnesisHome(env)).toBe(path.join(root, ".anamnesis"));
		expect(userPolicyPath(env)).toBe(
			path.join(root, ".anamnesis", "policy.yaml"),
		);
	});

	it("defaults to ~/.anamnesis without the override", () => {
		expect(anamnesisHome({})).toBe(path.join(os.homedir(), ".anamnesis"));
	});

	it("detects a project root that would share the user settings folder", () => {
		expect(isUserHomeProjectRoot(root, env)).toBe(true);
		expect(isUserHomeProjectRoot(os.homedir(), env)).toBe(true);
		const project = path.join(root, "project");
		fs.mkdirSync(project);
		expect(isUserHomeProjectRoot(project, env)).toBe(false);
	});
});

describe("user work policy", () => {
	it("returns null when policy.yaml does not exist", () => {
		expect(readUserWorkPolicy(env)).toBeNull();
	});

	it("writes the recommended bundle from the plan", () => {
		expect(workPolicyBundle(WorkPolicyBundlePreset.Recommended)).toEqual({
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
		});
		const resolved = resolveWorkPolicy([
			{
				kind: "user",
				config: workPolicyBundle(WorkPolicyBundlePreset.Recommended),
				source_refs: [],
			},
		]);
		expect(resolved.review.gates.map((gate) => gate.enforcement)).toEqual([
			"advisory",
			"advisory",
		]);
		expect(resolved.reconciliation.triggers).not.toContain(
			"meaningful_milestone",
		);
		expect(resolved.reconciliation.due_after).toEqual({
			max_silence: null,
			meaningful_actions: null,
		});
	});

	it("rejects unknown presets", () => {
		expect(() => parseWorkPolicyBundlePreset("loud")).toThrow(
			UserWorkPolicyError,
		);
		expect(parseWorkPolicyBundlePreset("recommended")).toBe(
			WorkPolicyBundlePreset.Recommended,
		);
	});

	it("reads policy.yaml and records only a source name and a content hash", () => {
		writePolicy(
			stringifyUserWorkPolicy(
				workPolicyBundle(WorkPolicyBundlePreset.Recommended),
			),
		);
		const policy = readUserWorkPolicy(env);
		expect(policy).not.toBeNull();
		const layer = userWorkPolicyLayer(policy!);
		expect(layer.kind).toBe("user");
		expect(layer.source_refs).toEqual([
			{ source: USER_POLICY_SOURCE, ref: expect.stringMatching(/^sha256:/) },
		]);
		expect(JSON.stringify(layer.source_refs)).not.toContain(root);
	});

	it("keeps the same hash when only formatting changes", () => {
		writePolicy("review:\n  preset: advisory\n");
		const first = readUserWorkPolicy(env)!.content_hash;
		writePolicy("# note\nreview: { preset: advisory }\n");
		expect(readUserWorkPolicy(env)!.content_hash).toBe(first);
	});

	it("rejects an invalid policy.yaml with its path", () => {
		writePolicy("review:\n  preset: loud\n");
		expect(() => readUserWorkPolicy(env)).toThrow(/policy\.yaml.*review\.preset/);
		writePolicy("review: [\n");
		expect(() => readUserWorkPolicy(env)).toThrow(UserWorkPolicyError);
	});
});
