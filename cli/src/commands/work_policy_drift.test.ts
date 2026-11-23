import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import { userPolicyPath } from "../core/anamnesis_home.js";
import { stripAnsi } from "../core/tui.js";
import { reportWorkStatus } from "../report/work.js";
import { workPolicyDoctorIssues, WorkPolicyDoctorCode } from "./doctor_work_policy.js";
import { amendWork, createWork, statusWork, type WorkMutationInput } from "./work.js";
import {
	driftReport,
	inspectPolicyDrift,
	resolveCommandPolicy,
	WorkPolicyDriftState,
} from "./work_policy_resolution.js";

let root: string;
let project: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-policy-drift-")));
	project = path.join(root, "project");
	fs.mkdirSync(project);
	env = { ANAMNESIS_HOME: path.join(root, "home") };
	vi.stubEnv("ANAMNESIS_HOME", env.ANAMNESIS_HOME);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	fs.rmSync(root, { recursive: true, force: true });
});

function writeProjectPolicy(workPolicy: unknown): void {
	fs.writeFileSync(
		path.join(project, "Agentfile"),
		YAML.stringify({
			version: 2,
			project: { name: "drift" },
			tools: ["codex"],
			fragments: [],
			settings: workPolicy ? { work_policy: workPolicy } : {},
		}),
	);
}

function writeUserPolicy(content: string): void {
	fs.mkdirSync(path.dirname(userPolicyPath(env)), { recursive: true });
	fs.writeFileSync(userPolicyPath(env), content);
}

function draft(sourceEventId: string, classification = "new_unit"): Buffer {
	return Buffer.from(
		YAML.stringify({
			work: { title: "Drift Work", completion_contract: "Verify it" },
			boundary: {
				state: "accepted",
				classification,
				reason_codes: ["same_deliverable"],
				confidence: "high",
			},
			requirements: [
				{ id: "req_a", summary: "Keep policy current", source_event_ids: [...new Set(["src_create", sourceEventId])] },
			],
			open_conflicts: [],
		}),
	);
}

function mutation(overrides: Partial<WorkMutationInput> = {}): WorkMutationInput {
	return {
		project_root: project,
		work_id: "wu_drift",
		event_id: "evt_create",
		occurred_at: "2026-11-24T00:00:00.000Z",
		draft: draft("src_create"),
		source_stdin: {
			event_id: "src_create",
			captured_at: "2026-11-24T00:00:00.000Z",
			client: "codex",
			content_type: "text/plain; charset=utf-8",
			fidelity: "native_exact",
			allocation_status: "allocated",
			body: Buffer.from("fixture source"),
		},
		...overrides,
	} as WorkMutationInput;
}

function amend(): void {
	amendWork(
		mutation({
			event_id: "evt_amend",
			occurred_at: "2026-11-24T00:01:00.000Z",
			expected_head: statusWork({ project_root: project, work_id: "wu_drift" }).projection.ledger_head,
			draft: draft("src_amend", "same_unit"),
			source_stdin: {
				...mutation().source_stdin!,
				event_id: "src_amend",
				body: Buffer.from("amend source"),
			},
		}),
	);
}

function status() {
	return statusWork({ project_root: project, work_id: "wu_drift" });
}

const RECOMMENDED = {
	reconciliation: {
		preset: "custom",
		triggers: ["work_resume", "compaction_resume", "contract_revision", "before_work_close"],
	},
	review: { preset: "advisory" },
	delegation: { parallelism: "auto", max_agents: 4 },
};

describe("Work policy drift", () => {
	it("does not report drift when only the policy source changes", () => {
		writeProjectPolicy(RECOMMENDED);
		createWork(mutation());
		writeProjectPolicy(null);
		writeUserPolicy(YAML.stringify(RECOMMENDED));
		const result = status();
		expect(result.policy_drift_state).toBe(WorkPolicyDriftState.Current);
		expect(result.policy_drift).toMatchObject({
			drifted: false,
			policy_changed: false,
			provenance_changed: true,
		});
		expect(result.policy_drift_resolve_command).toBeNull();
	});

	it("reports drift with a resolve command and applies the current policy at the next revision", () => {
		writeProjectPolicy({ review: { preset: "off" } });
		createWork(mutation());
		writeProjectPolicy({ review: { preset: "advisory" } });
		const drifted = status();
		expect(drifted.policy_drift_state).toBe(WorkPolicyDriftState.Drifted);
		expect(drifted.policy_drift_resolve_command).toContain("anamnesis work amend --work wu_drift");
		expect(workPolicyDoctorIssues(project, env)).toContainEqual(
			expect.objectContaining({
				severity: "warning",
				code: WorkPolicyDoctorCode.WorkDrift,
				target: "wu_drift",
				repair: drifted.policy_drift_resolve_command,
			}),
		);

		amend();
		const resolved = status();
		expect(resolved.projection.contract_revision).toBe(2);
		expect(resolved.projection.policy_snapshot?.policy.review.preset).toBe("advisory");
		expect(resolved.policy_drift_state).toBe(WorkPolicyDriftState.Current);
		expect(workPolicyDoctorIssues(project, env).map((issue) => issue.code)).not.toContain(
			WorkPolicyDoctorCode.WorkDrift,
		);
	});

	it("keeps a required review gate when the current policy would lower it", () => {
		writeProjectPolicy({ review: { preset: "strict" } });
		createWork(mutation());
		writeProjectPolicy({ review: { preset: "advisory" } });
		amend();
		const result = status();
		expect(result.projection.policy_snapshot?.policy.review.preset).toBe("strict");
		expect(result.policy_drift_state).toBe(WorkPolicyDriftState.DriftedHeld);
		expect(result.policy_drift_resolve_command).toBeNull();
		expect(workPolicyDoctorIssues(project, env)).toContainEqual(
			expect.objectContaining({
				code: WorkPolicyDoctorCode.WorkDrift,
				repair: expect.stringContaining("restore the required review gate"),
			}),
		);
	});

	it("does not offer amend for a drifted Work that is no longer open", () => {
		writeProjectPolicy({ review: { preset: "off" } });
		createWork(mutation());
		writeProjectPolicy({ review: { preset: "advisory" } });
		const closed = { ...status().projection, lifecycle: "completed" as const };
		const report = driftReport(closed, resolveCommandPolicy({ project_root: project }));
		expect(report.state).toBe(WorkPolicyDriftState.DriftedClosed);
		expect(report.resolve_command).toBeNull();
	});

	it("reports an unreadable Work ledger in doctor", () => {
		writeProjectPolicy(null);
		createWork(mutation());
		const ledger = status().ledger_path;
		fs.writeFileSync(ledger, "not json\n");
		expect(workPolicyDoctorIssues(project, env)).toContainEqual(
			expect.objectContaining({
				code: WorkPolicyDoctorCode.WorkDriftUnchecked,
				target: "wu_drift",
			}),
		);
	});

	it("separates an invalid user policy from a missing snapshot", () => {
		writeProjectPolicy(null);
		createWork(mutation());
		writeUserPolicy("review: { preset: loud }\n");
		const result = status();
		expect(result.policy_drift_state).toBe(WorkPolicyDriftState.UserPolicyInvalid);
		expect(result.policy_drift).toBeNull();
		const legacy = { ...result.projection, policy_snapshot: null };
		expect(inspectPolicyDrift(project, legacy).state).toBe(WorkPolicyDriftState.NoSnapshot);
	});

	it("prints the resolve command under Next with chips on one column", () => {
		writeProjectPolicy({ review: { preset: "off" } });
		createWork(mutation());
		writeProjectPolicy({ review: { preset: "advisory" } });
		const lines: string[] = [];
		vi.spyOn(console, "log").mockImplementation((line: string) => {
			lines.push(stripAnsi(String(line)));
		});
		vi.stubEnv("COLUMNS", "200");
		reportWorkStatus(status());
		const output = lines.join("\n");
		expect(output).toMatch(/^ {2}\[WARN\] {2}policy drift {2}current policy values differ/m);
		const next = output.slice(output.indexOf("\nNext"));
		expect(next).toContain("anamnesis work amend --work wu_drift");
		const chipLines = lines.filter((line) => /^ {2}\[[ A-Z]{4}\] {2}\S/.test(line));
		expect(new Set(chipLines.map((line) => line.search(/\] {2}\S/))).size).toBe(1);
	});
});
