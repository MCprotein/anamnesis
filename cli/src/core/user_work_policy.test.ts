import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
	vi.stubEnv("HOME", path.join(root, "os-home"));
	vi.stubEnv("ANAMNESIS_HOME", env.ANAMNESIS_HOME);
	vi.stubEnv("ANAMNESIS_STATE_HOME", path.join(root, "state"));
});

afterEach(() => {
	vi.unstubAllEnvs();
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
		expect(anamnesisHome({})).toBe(path.join(root, "os-home", ".anamnesis"));
	});

	it("detects a project root that would share the user settings folder", () => {
		expect(isUserHomeProjectRoot(root, env)).toBe(true);
		expect(isUserHomeProjectRoot(os.homedir(), env)).toBe(true);
		const project = path.join(root, "project");
		fs.mkdirSync(project);
		expect(isUserHomeProjectRoot(project, env)).toBe(false);
	});
});

describe("home folder case", () => {
	const project = () => path.join(root, "Projects");
	const caseInsensitive = () => {
		fs.mkdirSync(project(), { recursive: true });
		return fs.existsSync(path.join(root, "PROJECTS"));
	};

	it("rejects a home path written with other letter case", (context) => {
		if (!caseInsensitive()) context.skip();
		const caseEnv = { ANAMNESIS_HOME: path.join(project(), ".anamnesis") };
		expect(isUserHomeProjectRoot(path.join(root, "PROJECTS"), caseEnv)).toBe(true);
		expect(isUserHomeProjectRoot(path.join(root, "projects"), caseEnv)).toBe(true);
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

	it("reports an unreadable policy.yaml as a policy error", () => {
		fs.mkdirSync(userPolicyPath(env), { recursive: true });
		expect(() => readUserWorkPolicy(env)).toThrow(UserWorkPolicyError);
	});

	it("rejects an invalid policy.yaml with its path", () => {
		writePolicy("review:\n  preset: loud\n");
		expect(() => readUserWorkPolicy(env)).toThrow(/policy\.yaml.*review\.preset/);
		writePolicy("review: [\n  secret-line-text\n");
		expect(() => readUserWorkPolicy(env)).toThrow(/line \d+, column \d+$/);
		expect(() => readUserWorkPolicy(env)).not.toThrow(/secret-line-text/);
	});
});
