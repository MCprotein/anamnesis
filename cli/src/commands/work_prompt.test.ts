import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkLedger } from "../core/work_ledger.js";
import { normalizeWorkPromptCapturePolicy } from "../core/work_prompt_policy.js";
import {
	deriveWorkPromptCaptureId,
	stageWorkPrompt,
} from "../core/work_prompt_stage.js";
import {
	allocateStagedPromptToNewWork,
	allocateStagedPromptToSameWork,
	discardStagedPrompt,
	retainStagedPromptProvisional,
} from "./work.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function fixture() {
	const project = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-work-prompt-command-"));
	roots.push(project);
	execFileSync("git", ["-C", project, "init"], { stdio: "ignore" });
	fs.writeFileSync(
		path.join(project, ".gitignore"),
		".anamnesis/work-prompt-stage/\n.anamnesis/work-inputs/\n",
	);
	const stateRoot = path.join(project, ".anamnesis");
	const policy = normalizeWorkPromptCapturePolicy({ preset: "bounded" });
	return { project, stateRoot, policy };
}

function stage(
	fixture: ReturnType<typeof fixture>,
	boundaryId: string,
	body: string,
) {
	const identity = {
		client: "codex",
		sessionId: "session-work-prompt",
		boundaryId,
	};
	const staged = stageWorkPrompt({
		projectRoot: fixture.project,
		stateRoot: fixture.stateRoot,
		policy: fixture.policy,
		...identity,
		capturedAt: "2026-08-14T00:00:00.000Z",
		contentType: "text/plain; charset=utf-8",
		fidelity: "client_exact",
		body: Buffer.from(body, "utf8"),
	});
	return {
		...staged,
		captureId: deriveWorkPromptCaptureId(identity),
	};
}

function draft(
	classification: "new_unit" | "same_unit",
	requirements: Array<{
		id: string;
		summary: string;
		sourceIds: string[];
	}>,
): Buffer {
	return Buffer.from(
		[
			"work:",
			"  title: Prompt ledger",
			"  completion_contract: Every requested behavior is verified",
			"boundary:",
			"  state: accepted",
			`  classification: ${classification}`,
			"  reason_codes: [explicit_user_requirement]",
			"  confidence: high",
			"requirements:",
			...requirements.flatMap((requirement) => [
				`  - id: ${requirement.id}`,
				`    summary: ${requirement.summary}`,
				"    source_event_ids:",
				...requirement.sourceIds.map((id) => `      - ${JSON.stringify(id)}`),
			]),
			"open_conflicts: []",
			"",
		].join("\n"),
		"utf8",
	);
}

describe("staged Work prompt commands", () => {
	it("allocates one raw prompt to a new Work and retries idempotently", () => {
		const item = fixture();
		const captured = stage(item, "turn-one", "원문 요구사항\r\n그대로");
		const input = {
			project_root: item.project,
			work_id: "wu_prompt",
			capture_id: captured.captureId,
			occurred_at: "2026-08-14T00:01:00.000Z",
			draft: draft("new_unit", [
				{ id: "r1", summary: "Preserve the first prompt", sourceIds: ["@staged"] },
			]),
			expected_head: null,
			expected_contract_revision: null,
			expected_contract_hash: null,
		};
		const first = allocateStagedPromptToNewWork(input);
		const retry = allocateStagedPromptToNewWork({
			...input,
			occurred_at: "2026-08-14T00:02:00.000Z",
		});
		expect(first.projection?.requirements.map((entry) => entry.id)).toEqual(["r1"]);
		expect(retry.projection?.projection_hash).toBe(first.projection?.projection_hash);
		expect(readWorkLedger(first.ledger_path!).records).toHaveLength(1);
		expect(
			fs.readFileSync(
				path.join(item.stateRoot, "work-inputs/objects", `${first.outcome.source_event_id}.txt`),
			),
		).toEqual(captured.body);
	});

	it("appends a later prompt to the same Work using exact observed truth", () => {
		const item = fixture();
		const firstCapture = stage(item, "turn-one", "first");
		const first = allocateStagedPromptToNewWork({
			project_root: item.project,
			work_id: "wu_prompt",
			capture_id: firstCapture.captureId,
			occurred_at: "2026-08-14T00:01:00.000Z",
			draft: draft("new_unit", [
				{ id: "r1", summary: "First", sourceIds: ["@staged"] },
			]),
			expected_head: null,
			expected_contract_revision: null,
			expected_contract_hash: null,
		});
		const secondCapture = stage(item, "turn-two", "second");
		const before = readWorkLedger(first.ledger_path!);
		const second = allocateStagedPromptToSameWork({
			project_root: item.project,
			work_id: "wu_prompt",
			capture_id: secondCapture.captureId,
			occurred_at: "2026-08-14T00:02:00.000Z",
			draft: draft("same_unit", [
				{
					id: "r1",
					summary: "First",
					sourceIds: [first.outcome.source_event_id!],
				},
				{ id: "r2", summary: "Second", sourceIds: ["@staged"] },
			]),
			expected_head: before.head,
			expected_contract_revision: first.projection!.contract_revision,
			expected_contract_hash: first.projection!.contract_hash,
		});
		expect(second.projection?.contract_revision).toBe(2);
		expect(second.projection?.requirements.map((entry) => entry.id)).toEqual([
			"r1",
			"r2",
		]);
	});

	it("retains provisional provenance, binds it once, and rejects another Work", () => {
		const item = fixture();
		const captured = stage(item, "turn-provisional", "unclear boundary");
		const retained = retainStagedPromptProvisional({
			project_root: item.project,
			capture_id: captured.captureId,
			resolved_at: "2026-08-14T00:01:00.000Z",
			draft: Buffer.from(
				"boundary:\n  state: needs_user\n  classification: new_unit\n  reason_codes: [ambiguous_scope]\n  confidence: low\nquestion: Is this a new Work?\n",
			),
		});
		expect(retained.outcome.outcome).toBe("provisional");
		const bound = allocateStagedPromptToNewWork({
			project_root: item.project,
			work_id: "wu_bound",
			capture_id: captured.captureId,
			occurred_at: "2026-08-14T00:02:00.000Z",
			draft: draft("new_unit", [
				{ id: "r1", summary: "Resolved requirement", sourceIds: ["@staged"] },
			]),
			expected_head: null,
			expected_contract_revision: null,
			expected_contract_hash: null,
		});
		expect(bound.projection?.work_id).toBe("wu_bound");
		expect(() =>
			allocateStagedPromptToNewWork({
				project_root: item.project,
				work_id: "wu_other",
				capture_id: captured.captureId,
				occurred_at: "2026-08-14T00:03:00.000Z",
				draft: draft("new_unit", [
					{ id: "r1", summary: "Other", sourceIds: ["@staged"] },
				]),
				expected_head: null,
				expected_contract_revision: null,
				expected_contract_hash: null,
			}),
		).toThrow(/binding|assertion conflict/);
	});

	it("discards interruptions without a source object", () => {
		const item = fixture();
		const captured = stage(item, "turn-discard", "just answer this");
		const result = discardStagedPrompt({
			project_root: item.project,
			capture_id: captured.captureId,
			resolved_at: "2026-08-14T00:01:00.000Z",
			reason: "interruption",
		});
		expect(result.outcome).toMatchObject({
			outcome: "discarded",
			reason: "interruption",
		});
		expect(fs.existsSync(path.join(item.stateRoot, "work-inputs"))).toBe(false);
	});
});
