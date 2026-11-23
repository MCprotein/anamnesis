import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAgentfile } from "../core/agentfile.js";
import { userPolicyPath } from "../core/anamnesis_home.js";
import { registerProject } from "../core/project_registry.js";
import { WorkPolicyBundlePreset } from "../core/user_work_policy.js";
import {
	configurePolicy,
	PolicyScope,
	PolicyWriteStatus,
} from "./context_policy.js";
import { WorkPolicyDoctorCode, workPolicyDoctorIssues } from "./doctor_work_policy.js";
import { init, InitError } from "./init.js";
import { InitWorkPolicyPlacement } from "./init_work_policy.js";
import { migratePolicy, PolicyMigrationOutcome } from "./migrate_policy.js";

const LIBRARY_ROOT = path.resolve(import.meta.dirname, "../../..");

let root: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
	root = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-policy-cmd-")),
	);
	env = { ANAMNESIS_HOME: path.join(root, "home", ".anamnesis") };
	vi.stubEnv("HOME", path.join(root, "home"));
	vi.stubEnv("ANAMNESIS_HOME", env.ANAMNESIS_HOME);
	vi.stubEnv("ANAMNESIS_STATE_HOME", path.join(root, "state"));
});

afterEach(() => {
	vi.unstubAllEnvs();
	fs.rmSync(root, { recursive: true, force: true });
});

function configure(overrides: { dryRun?: boolean; force?: boolean } = {}) {
	return configurePolicy({
		scope: PolicyScope.User,
		preset: WorkPolicyBundlePreset.Recommended,
		dryRun: overrides.dryRun ?? false,
		force: overrides.force ?? false,
		env,
	});
}

const INIT_DEFAULT_BLOCK = `    reconciliation:
      preset: adaptive
    review:
      preset: advisory
    delegation:
      parallelism: auto
`;

function makeProject(name: string, workPolicy?: string): string {
	const project = path.join(root, name);
	fs.mkdirSync(project, { recursive: true });
	fs.writeFileSync(
		path.join(project, "Agentfile"),
		`# keep this comment\nversion: 2\nproject:\n  name: ${name}\ntools: [claude-code]\nfragments: []\nsettings:\n  ontology_file: system_graph.yaml\n${workPolicy === undefined ? "" : `  work_policy:\n${workPolicy}`}`,
	);
	return project;
}

describe("context policy configure", () => {
	it("creates policy.yaml under ANAMNESIS_HOME and is idempotent", () => {
		const dry = configure({ dryRun: true });
		expect(dry.status).toBe(PolicyWriteStatus.Created);
		expect(dry.written).toBe(false);
		expect(fs.existsSync(userPolicyPath(env))).toBe(false);

		const created = configure();
		expect(created.status).toBe(PolicyWriteStatus.Created);
		expect(created.path).toBe(userPolicyPath(env));
		expect(fs.readFileSync(userPolicyPath(env), "utf8")).toContain(
			"before_work_close",
		);
		expect(configure().status).toBe(PolicyWriteStatus.Unchanged);
	});

	it("does not replace a different policy.yaml without --force", () => {
		fs.mkdirSync(path.dirname(userPolicyPath(env)), { recursive: true });
		fs.writeFileSync(userPolicyPath(env), "review:\n  preset: strict\n");
		const blocked = configure();
		expect(blocked.status).toBe(PolicyWriteStatus.Blocked);
		expect(fs.readFileSync(userPolicyPath(env), "utf8")).toContain("strict");
		const forced = configurePolicy({
			scope: PolicyScope.User,
			preset: WorkPolicyBundlePreset.Recommended,
			dryRun: false,
			force: true,
			env,
			now: new Date("2026-11-24T01:02:03.004Z"),
		});
		expect(forced.status).toBe(PolicyWriteStatus.Updated);
		expect(forced.backupPath).toBe(
			path.join(env.ANAMNESIS_HOME!, "backups", "2026-11-24T01-02-03-004Z", "policy.yaml"),
		);
		expect(fs.readFileSync(forced.backupPath!, "utf8")).toBe("review:\n  preset: strict\n");
		expect(fs.readFileSync(userPolicyPath(env), "utf8")).toContain("advisory");
		expect(configure().backupPath).toBeNull();
	});
});

describe("migrate policy", () => {
	it("keeps the init default block while no user policy exists", () => {
		const project = makeProject("alpha", INIT_DEFAULT_BLOCK);
		const result = migratePolicy({ projectRoot: project, all: false, dryRun: false, env });
		expect(result.projects[0]?.outcome).toBe(PolicyMigrationOutcome.KeptNoUserPolicy);
		expect(readAgentfile(project).version === 2 && readAgentfile(project).settings?.work_policy).toBeTruthy();
	});

	it("previews, then removes only the init default block with a backup", () => {
		configure();
		const project = makeProject("alpha", INIT_DEFAULT_BLOCK);
		const before = fs.readFileSync(path.join(project, "Agentfile"), "utf8");

		const dry = migratePolicy({ projectRoot: project, all: false, dryRun: true, env });
		expect(dry.projects[0]?.outcome).toBe(PolicyMigrationOutcome.WouldRemove);
		expect(fs.readFileSync(path.join(project, "Agentfile"), "utf8")).toBe(before);

		const applied = migratePolicy({
			projectRoot: project,
			all: false,
			dryRun: false,
			env,
			now: new Date("2026-11-24T00:00:00.000Z"),
		});
		const entry = applied.projects[0]!;
		expect(entry.outcome).toBe(PolicyMigrationOutcome.Removed);
		expect(entry.matchedDefaultSince).toBe("1.19.0");
		expect(fs.readFileSync(entry.backupPath!, "utf8")).toBe(before);
		const after = fs.readFileSync(path.join(project, "Agentfile"), "utf8");
		expect(after).toContain("# keep this comment");
		expect(after).toContain("ontology_file: system_graph.yaml");
		expect(after).not.toContain("work_policy");
	});

	it("keeps the block when policy.yaml does not cover every section", () => {
		fs.mkdirSync(path.dirname(userPolicyPath(env)), { recursive: true });
		fs.writeFileSync(userPolicyPath(env), "review:\n  preset: advisory\n");
		const project = makeProject("alpha", INIT_DEFAULT_BLOCK);
		const result = migratePolicy({ projectRoot: project, all: false, dryRun: false, env });
		expect(result.projects[0]).toMatchObject({
			outcome: PolicyMigrationOutcome.KeptUserPolicyIncomplete,
			reason: "policy.yaml has no reconciliation, delegation",
		});
		expect(fs.readFileSync(path.join(project, "Agentfile"), "utf8")).toContain("work_policy");
	});

	it("keeps a customized block and reports it", () => {
		configure();
		const project = makeProject(
			"beta",
			"    review:\n      preset: strict\n",
		);
		const result = migratePolicy({ projectRoot: project, all: false, dryRun: false, env });
		expect(result.projects[0]?.outcome).toBe(PolicyMigrationOutcome.KeptCustomized);
		expect(fs.readFileSync(path.join(project, "Agentfile"), "utf8")).toContain("strict");
	});

	it("visits every registered project with --all", () => {
		configure();
		const registryPath = path.join(root, "state", "projects.json");
		const alpha = makeProject("alpha", INIT_DEFAULT_BLOCK);
		const beta = makeProject("beta");
		for (const project of [alpha, beta]) {
			registerProject({
				projectRoot: project,
				projectName: path.basename(project),
				tools: ["claude-code"],
				allowExecAdapters: false,
				registryPath,
			});
		}
		const result = migratePolicy({
			projectRoot: root,
			all: true,
			dryRun: true,
			registryPath,
			env,
		});
		expect(result.projects.map((entry) => [path.basename(entry.projectRoot), entry.outcome])).toEqual([
			["alpha", PolicyMigrationOutcome.WouldRemove],
			["beta", PolicyMigrationOutcome.NoProjectPolicy],
		]);
	});
});

describe("doctor work policy findings", () => {
	it("warns when the init default hides the user policy", () => {
		configure();
		const project = makeProject("alpha", INIT_DEFAULT_BLOCK);
		const issues = workPolicyDoctorIssues(project, env);
		expect(issues).toContainEqual(
			expect.objectContaining({
				severity: "warning",
				code: WorkPolicyDoctorCode.UserPolicyShadowedByDefault,
				repair: "anamnesis migrate policy",
			}),
		);
		expect(issues).toContainEqual(
			expect.objectContaining({
				code: WorkPolicyDoctorCode.Sources,
				message: "reconciliation=project review=project delegation=project",
			}),
		);
	});

	it("reports a customized project override as info", () => {
		configure();
		const project = makeProject("beta", "    review:\n      preset: strict\n");
		const issues = workPolicyDoctorIssues(project, env);
		expect(issues).toContainEqual(
			expect.objectContaining({
				severity: "info",
				code: WorkPolicyDoctorCode.UserPolicyOverriddenByProject,
			}),
		);
		expect(issues).toContainEqual(
			expect.objectContaining({
				message: "reconciliation=user review=project delegation=user",
			}),
		);
	});

	it("reports an invalid policy.yaml as an error", () => {
		fs.mkdirSync(path.dirname(userPolicyPath(env)), { recursive: true });
		fs.writeFileSync(userPolicyPath(env), "review: { preset: loud }\n");
		const issues = workPolicyDoctorIssues(makeProject("gamma"), env);
		expect(issues).toEqual([
			expect.objectContaining({
				severity: "error",
				code: WorkPolicyDoctorCode.UserPolicyInvalid,
			}),
		]);
	});
});

describe("init work policy placement", () => {
	function dryInit(projectRoot: string, projectPolicy = false) {
		return init({
			projectRoot,
			libraryRoot: LIBRARY_ROOT,
			dryRun: true,
			allowExecAdapters: false,
			projectPolicy,
			env,
		});
	}

	function emptyProject(name: string): string {
		const project = path.join(root, name);
		fs.mkdirSync(project, { recursive: true });
		return project;
	}

	it("keeps the init default in the Agentfile without a user policy", () => {
		const result = dryInit(emptyProject("alpha"));
		expect(result.workPolicyPlacement).toBe(InitWorkPolicyPlacement.ProjectDefault);
		expect(result.agentfile.version === 2 && result.agentfile.settings?.work_policy).toEqual({
			reconciliation: { preset: "adaptive" },
			review: { preset: "advisory" },
			delegation: { parallelism: "auto" },
		});
	});

	it("leaves work_policy out when a user policy exists", () => {
		configure();
		const result = dryInit(emptyProject("beta"));
		expect(result.workPolicyPlacement).toBe(InitWorkPolicyPlacement.UserLayer);
		expect(result.agentfile.version === 2 && result.agentfile.settings?.work_policy).toBeUndefined();
	});

	it("copies the user policy into the Agentfile with --project-policy", () => {
		configure();
		const result = dryInit(emptyProject("gamma"), true);
		expect(result.workPolicyPlacement).toBe(InitWorkPolicyPlacement.ProjectFromUser);
		expect(
			result.agentfile.version === 2 && result.agentfile.settings?.work_policy?.delegation,
		).toEqual({ parallelism: "auto", max_agents: 4 });
	});

	it("refuses to init the folder that holds ANAMNESIS_HOME", () => {
		const home = path.dirname(env.ANAMNESIS_HOME!);
		fs.mkdirSync(home, { recursive: true });
		expect(() => dryInit(home)).toThrow(InitError);
		expect(() => dryInit(home)).toThrow(/home directory/);
	});
});
