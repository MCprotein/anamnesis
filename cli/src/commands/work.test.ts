import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";

import {
	amendWork,
	assertProgressRetryIsAppendCompatible,
	briefWork,
	confirmWorkBrief,
	createWork,
	statusWork,
	switchWork,
	transitionWork,
	type WorkMutationInput,
} from "./work.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function root(): string {
	const value = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-work-command-"),
	);
	roots.push(value);
	return value;
}

function contractDraft(
	sourceEventId: string,
	additions: string[] = [],
	classification: "new_unit" | "same_unit" | "interruption" = "new_unit",
): Buffer {
	return Buffer.from(
		YAML.stringify({
			work: {
				title: "한국어 🚀 Work",
				completion_contract: "All requirements verified",
			},
			boundary: {
				state: "accepted",
				classification,
				reason_codes: ["same_deliverable"],
				confidence: "high",
			},
			requirements: [
				{
					id: "req_a",
					summary: "Preserve raw prompt",
					source_event_ids: ["src_create"],
				},
				...additions.map((id) => ({
					id,
					summary: id,
					source_event_ids: [sourceEventId],
				})),
			],
			open_conflicts: [],
		}),
	);
}

function mutation(
	projectRoot: string,
	overrides: Partial<WorkMutationInput> = {},
): WorkMutationInput {
	return {
		project_root: projectRoot,
		work_id: "wu_one",
		event_id: "evt_create",
		occurred_at: "2026-08-13T00:00:00.000Z",
		draft: contractDraft("src_create"),
		source_stdin: {
			event_id: "src_create",
			captured_at: "2026-08-13T00:00:00.000Z",
			client: "codex",
			content_type: "text/plain; charset=utf-8",
			fidelity: "native_exact",
			allocation_status: "allocated",
			body: Buffer.from("첫 줄\r\n둘째 줄 🚀\r\n", "utf8"),
		},
		...overrides,
	};
}

describe("Work command service", () => {
	it("creates with byte-exact raw source and the default all-off policy", () => {
		const projectRoot = root();
		fs.writeFileSync(
			path.join(projectRoot, "Agentfile"),
			YAML.stringify({
				version: 2,
				project: { name: "work-command-test" },
				tools: ["codex"],
				fragments: [],
				settings: {
					work_policy: {
						reconciliation: { preset: "off" },
						review: { preset: "off" },
						delegation: { parallelism: "off" },
					},
				},
			}),
		);
		const input = mutation(projectRoot);
		const result = createWork(input);
		expect(result.schema_version).toBe("anamnesis.work-command-result.v1");
		expect(result.projection.contract_revision).toBe(1);
		expect(result.projection.policy_snapshot?.policy.review.preset).toBe("off");
		expect(
			result.projection.policy_snapshot?.policy.delegation.parallelism,
		).toBe("off");
		expect(
			fs.readFileSync(
				path.join(projectRoot, ".anamnesis/work-inputs/objects/src_create.txt"),
			),
		).toEqual(input.source_stdin?.body);
	});

	it("amends the same Work and reports transition progress from a validated refold", () => {
		const projectRoot = root();
		createWork(mutation(projectRoot));
		const amended = amendWork(
			mutation(projectRoot, {
				event_id: "evt_amend",
				occurred_at: "2026-08-13T00:01:00.000Z",
				draft: contractDraft("src_amend", ["req_b"], "same_unit"),
				source_stdin: {
					...mutation(projectRoot).source_stdin!,
					event_id: "src_amend",
					body: Buffer.from("추가 요구사항", "utf8"),
				},
			}),
		);
		expect(amended.work_id).toBe("wu_one");
		expect(amended.projection.contract_revision).toBe(2);

		transitionWork(
			mutation(projectRoot, {
				event_id: "evt_verify",
				occurred_at: "2026-08-13T00:02:00.000Z",
				draft: Buffer.from(
					YAML.stringify({
						requirement_id: "req_a",
						status: "verified",
						evidence_refs: ["test:raw"],
					}),
				),
				source_stdin: undefined,
			}),
		);
		const status = statusWork({ project_root: projectRoot, work_id: "wu_one" });
		expect(status.projection.progress).toMatchObject({
			verified: 1,
			applicable: 2,
			percent: 50,
		});
		const brief = briefWork({
			project_root: projectRoot,
			work_id: "wu_one",
			cursor_id: "cursor_brief",
			client_session_ref: "session-a",
			occurred_at: "2026-08-13T00:03:00.000Z",
		});
		expect(brief.sections.map((section) => section.id)).toEqual([
			"work",
			"requirements",
			"done",
			"remaining",
			"blockers",
			"progress",
			"next",
		]);
		expect(brief.delivery_state).toBe("pending");
		expect(brief.sections[1]?.values[0]).toBe(
			"req_a: Preserve raw prompt [verified]",
		);
		expect(
			confirmWorkBrief({
				project_root: projectRoot,
				work_id: "wu_one",
				cursor_id: "cursor_brief",
				delivery_token: brief.delivery_token,
				confirmed_at: "2026-08-13T00:03:01.000Z",
			}).schema_version,
		).toBe("anamnesis.work-brief-confirmation.v1");
		expect(() =>
			confirmWorkBrief({
				project_root: projectRoot,
				work_id: "wu_one",
				cursor_id: "cursor_brief",
				delivery_token: "wrong",
				confirmed_at: "2026-08-13T00:03:02.000Z",
			}),
		).toThrow("token mismatch");
	});

	it("retries an already committed event idempotently", () => {
		const projectRoot = root();
		const input = mutation(projectRoot);
		createWork(input);
		const retried = createWork(input);
		expect(retried.allocation.ledger.idempotent).toBe(true);
		expect(
			statusWork({ project_root: projectRoot, work_id: "wu_one" }).projection
				.contract_revision,
		).toBe(1);
	});

	it("rejects an event-id retry when the draft changed", () => {
		const projectRoot = root();
		const input = mutation(projectRoot);
		createWork(input);
		expect(() =>
			createWork({
				...input,
				draft: Buffer.from(
					input.draft.toString("utf8").replace(
						"Preserve raw prompt",
						"Silently changed requirement",
					),
				),
			}),
		).toThrow("event ID collision");
		expect(
			statusWork({ project_root: projectRoot, work_id: "wu_one" }).projection
				.requirements[0]?.summary,
		).toBe("Preserve raw prompt");
		expect(() =>
			createWork({
				...input,
				draft: contractDraft("src_collision", ["req_collision"]),
				source_stdin: {
					...input.source_stdin!,
					event_id: "src_collision",
					body: Buffer.from("must not be orphaned"),
				},
			}),
		).toThrow("event ID collision");
		expect(
			fs.existsSync(
				path.join(
					projectRoot,
					".anamnesis/work-inputs/objects/src_collision.txt",
				),
			),
		).toBe(false);
	});

	it("enforces create/new_unit and amend/same_unit boundaries", () => {
		const projectRoot = root();
		expect(() =>
			createWork({
				...mutation(projectRoot),
				draft: contractDraft("src_create", [], "same_unit"),
			}),
		).toThrow("create requires boundary.classification=new_unit");
		const needsUser = YAML.parse(
			contractDraft("src_create").toString("utf8"),
		);
		needsUser.boundary.state = "needs_user";
		needsUser.boundary.confidence = "low";
		expect(() =>
			createWork({
				...mutation(projectRoot),
				draft: Buffer.from(YAML.stringify(needsUser)),
			}),
		).toThrow("create requires boundary.state=accepted");
		createWork(mutation(projectRoot));
		expect(() =>
			amendWork(
				mutation(projectRoot, {
					event_id: "evt_bad_boundary",
					source_stdin: {
						...mutation(projectRoot).source_stdin!,
						event_id: "src_bad_boundary",
					},
					draft: contractDraft("src_bad_boundary", ["req_b"], "new_unit"),
				}),
			),
		).toThrow("amend requires boundary.classification=same_unit");
	});

	it("preserves the frozen Work policy and reports later project drift", () => {
		const projectRoot = root();
		const writePolicy = (preset: "strict" | "off") =>
			fs.writeFileSync(
				path.join(projectRoot, "Agentfile"),
				YAML.stringify({
					version: 2,
					project: { name: "policy-drift" },
					tools: ["codex"],
					fragments: [],
					settings: { work_policy: { review: { preset } } },
				}),
			);
		writePolicy("strict");
		createWork(mutation(projectRoot));
		writePolicy("off");
		expect(createWork(mutation(projectRoot)).allocation?.ledger.idempotent).toBe(
			true,
		);
		const amendInput = mutation(projectRoot, {
				event_id: "evt_policy_drift",
				draft: contractDraft("src_policy_drift", ["req_b"], "same_unit"),
				source_stdin: {
					...mutation(projectRoot).source_stdin!,
					event_id: "src_policy_drift",
				},
			});
		const amended = amendWork(amendInput);
		expect(amended.projection.policy_snapshot?.policy.review.preset).toBe(
			"strict",
		);
		expect(amendWork(amendInput).allocation?.ledger.idempotent).toBe(true);
		const status = statusWork({ project_root: projectRoot, work_id: "wu_one" });
		expect(status.policy_drift).toMatchObject({
			drifted: true,
			policy_changed: true,
			revision_changed: false,
		});
	});

	it("classifies concurrent progress by requirement scope", () => {
		const record = (requirementId: string, eventId: string) =>
			({
				event_id: eventId,
				kind: "work_requirement_transitioned",
				payload: { requirement_id: requirementId },
			}) as never;
		expect(() =>
			assertProgressRetryIsAppendCompatible(
				[record("req_a", "evt_other")],
				"req_a",
				"evt_candidate",
			),
		).toThrow("concurrent Work requirement transition conflict");
		expect(() =>
			assertProgressRetryIsAppendCompatible(
				[record("req_b", "evt_other")],
				"req_a",
				"evt_candidate",
			),
		).not.toThrow();
	});

	it("fails closed on implementation entry while planning review evidence is unavailable", () => {
		const projectRoot = root();
		fs.writeFileSync(
			path.join(projectRoot, "Agentfile"),
			YAML.stringify({
				version: 2,
				project: { name: "strict-transition" },
				tools: ["codex"],
				fragments: [],
				settings: { work_policy: { review: { preset: "strict" } } },
			}),
		);
		createWork(mutation(projectRoot));
		expect(() =>
			transitionWork(
				mutation(projectRoot, {
					event_id: "evt_strict_start",
					draft: Buffer.from(
						YAML.stringify({
							requirement_id: "req_a",
							status: "in_progress",
							evidence_refs: [],
						}),
					),
					source_stdin: undefined,
				}),
			),
		).toThrow("implementation transition is blocked");
		expect(
			statusWork({ project_root: projectRoot, work_id: "wu_one" }).projection
				.requirements[0]?.status,
		).toBe("pending");
	});

	it("derives cursor delta by folding the confirmed ledger prefix", () => {
		const projectRoot = root();
		createWork(mutation(projectRoot));
		const first = briefWork({
			project_root: projectRoot,
			work_id: "wu_one",
			cursor_id: "cursor_delta",
			occurred_at: "2026-08-13T00:00:01.000Z",
		});
		confirmWorkBrief({
			project_root: projectRoot,
			work_id: "wu_one",
			cursor_id: "cursor_delta",
			delivery_token: first.delivery_token,
			confirmed_at: "2026-08-13T00:00:02.000Z",
		});
		amendWork(
			mutation(projectRoot, {
				event_id: "evt_delta_amend",
				occurred_at: "2026-08-13T00:01:00.000Z",
				draft: contractDraft("src_delta", ["req_b"], "same_unit"),
				source_stdin: {
					...mutation(projectRoot).source_stdin!,
					event_id: "src_delta",
					body: Buffer.from("delta requirement"),
				},
			}),
		);
		const second = briefWork({
			project_root: projectRoot,
			work_id: "wu_one",
			cursor_id: "cursor_delta",
			occurred_at: "2026-08-13T00:01:01.000Z",
		});
		expect(second.briefing.baseline_available).toBe(true);
		expect(second.briefing.delta.added_requirement_ids).toEqual(["req_b"]);
	});

	it("rejects ambiguous source input and drafts that omit the current source event", () => {
		const projectRoot = root();
		expect(() =>
			createWork({
				...mutation(projectRoot),
				source_file: mutation(projectRoot).source_stdin,
			}),
		).toThrow("exactly one");
		expect(() =>
			createWork({
				...mutation(projectRoot),
				draft: Buffer.from(
					YAML.stringify({
						work: { title: "x", completion_contract: "y" },
						boundary: {
							state: "accepted",
						classification: "new_unit",
							reason_codes: [],
							confidence: "high",
						},
						requirements: [
							{ id: "req_x", summary: "x", source_event_ids: ["src_other"] },
						],
						open_conflicts: [],
					}),
				),
			}),
		).toThrow("must reference the current source event");
	});

	it("keeps cursor integration behind a typed switch adapter seam", () => {
		const projectRoot = root();
		createWork(mutation(projectRoot));
		const result = switchWork(
			{
				project_root: projectRoot,
				work_id: "wu_one",
				cursor_id: "cursor_one",
				client_session_ref: "session-a",
				occurred_at: "2026-08-13T00:03:00.000Z",
			},
			{
				switchWork: (input) =>
					`${input.cursor_id}:${input.projection.contract_revision}`,
			},
		);
		expect(result).toBe("cursor_one:1");
	});
});
