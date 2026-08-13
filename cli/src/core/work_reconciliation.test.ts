import { describe, expect, it } from "vitest";
import { sha256 } from "../util/hash.js";
import { normalizeWorkPolicyConfig } from "./work_policy.js";
import {
	calculateWorkProgress,
	type WorkProjection,
} from "./work_projection.js";
import {
	buildWorkBriefingSnapshot,
	confirmReconciliationDelivery,
	emptyWorkCursorReconciliationState,
	evaluateReconciliationDue,
	noteMeaningfulReconciliationAction,
	observeInjectedReconciliation,
	prepareReconciliationDelivery,
} from "./work_reconciliation.js";

function projection(overrides: Partial<WorkProjection> = {}): WorkProjection {
	return {
		schema_version: "anamnesis.work-projection.v1",
		work_id: "wu_one",
		title: "Ship Work continuity",
		completion_contract: "All accepted requirements are verified",
		contract_revision: 3,
		lifecycle: "open",
		boundary_hash: sha256("contract"),
		contract_hash: sha256("real-contract"),
		policy_hash: sha256("policy"),
		policy_snapshot: null,
		configured_required_gates: ["planning", "completion", "planning"],
		ledger_head: sha256("ledger"),
		last_event_id: "lev_latest",
		requirements: [
			{
				id: "req_b",
				summary: "agent-authored display text",
				status: "blocked",
				source_event_ids: ["src_2"],
				evidence_refs: [],
				updated_at: "2026-08-13T00:00:02.000Z",
			},
			{
				id: "req_a",
				summary: "another normalized summary",
				status: "verified",
				source_event_ids: ["src_1"],
				evidence_refs: ["test:one"],
				updated_at: "2026-08-13T00:00:01.000Z",
			},
		],
		conflicts: ["conflict_z"],
		diagnostics: [],
		progress: {
			applicable: 2,
			pending: 0,
			in_progress: 0,
			verified: 1,
			implemented_unverified: 0,
			blocked: 1,
			waived: 0,
			percent: 50,
			weighted: false,
			denominator_empty: false,
		},
		requirements_ready: false,
		projection_hash: sha256("projection"),
		...overrides,
	};
}

describe("Work reconciliation snapshot", () => {
	it("builds stable status groups, authority pointers, blockers, denominator, and next IDs", () => {
		const snapshot = buildWorkBriefingSnapshot({
			projection: projection(),
		});
		expect(snapshot.requirement_ids_by_status).toMatchObject({
			verified: ["req_a"],
			blocked: ["req_b"],
		});
		expect(snapshot.requirement_authority).toEqual([
			{ requirement_id: "req_a", source_event_ids: ["src_1"] },
			{ requirement_id: "req_b", source_event_ids: ["src_2"] },
		]);
		expect(snapshot.work).toEqual({
			title: "Ship Work continuity",
			completion_contract: "All accepted requirements are verified",
		});
		expect(snapshot.requirements).toEqual([
			{
				id: "req_a",
				summary: "another normalized summary",
				status: "verified",
				source_event_ids: ["src_1"],
				evidence_refs: ["test:one"],
			},
			{
				id: "req_b",
				summary: "agent-authored display text",
				status: "blocked",
				source_event_ids: ["src_2"],
				evidence_refs: [],
			},
		]);
		expect(snapshot.blockers).toEqual({
			requirement_ids: ["req_b"],
			conflict_ids: ["conflict_z"],
		});
		expect(snapshot.progress).toMatchObject({
			mode: "count",
			denominator: 2,
			percent: 50,
		});
		expect(snapshot.configured_required_gates).toEqual([
			"completion",
			"planning",
		]);
		expect(snapshot.next_requirement_ids).toEqual(["req_b"]);
		expect(snapshot.baseline_available).toBe(false);
		expect(snapshot.delta.added_requirement_ids).toEqual(["req_a", "req_b"]);
	});

	it("rejects forged projection authority and non-finite briefing progress", () => {
		for (const invalid of [
			projection({ contract_revision: -1 }),
			projection({ contract_revision: 1.5 }),
			projection({ contract_hash: "not-a-hash" }),
			projection({ policy_hash: "not-a-hash" }),
			projection({ lifecycle: "closed" as WorkProjection["lifecycle"] }),
			projection({
				configured_required_gates: [
					"bogus" as WorkProjection["configured_required_gates"][number],
				],
			}),
			projection({
				progress: { ...projection().progress, percent: Number.NaN },
			}),
		]) {
			expect(() => buildWorkBriefingSnapshot({ projection: invalid })).toThrow();
		}
	});

	it("rejects inconsistent progress and duplicate requirement IDs", () => {
		expect(() =>
			buildWorkBriefingSnapshot({
				projection: projection({
					progress: {
						...projection().progress,
						pending: 0,
						verified: 2,
						blocked: 0,
						percent: 100,
					},
				}),
			}),
		).toThrow(/does not match/);

		const duplicate = projection();
		duplicate.requirements.push({ ...duplicate.requirements[0]! });
		expect(() =>
			buildWorkBriefingSnapshot({ projection: duplicate }),
		).toThrow(/duplicate briefing requirement ID/);
	});

	it("fingerprints user-visible Work and requirement meaning while excluding delivery noise", () => {
		const first = buildWorkBriefingSnapshot({ projection: projection() });
		const noisy = projection({
			ledger_head: sha256("other-ledger"),
			last_event_id: "lev_other",
			projection_hash: sha256("other-projection"),
			requirements: projection()
				.requirements.slice()
				.reverse()
				.map((requirement) => ({
					...requirement,
					source_event_ids: [`other_${requirement.id}`],
					updated_at: "2099-01-01T00:00:00.000Z",
				})),
		});
		const second = buildWorkBriefingSnapshot({ projection: noisy });
		expect(second.semantic_fingerprint).toBe(first.semantic_fingerprint);

		const meaningChanged = buildWorkBriefingSnapshot({
			projection: projection({
				title: "Changed Work title",
				requirements: projection().requirements.map((requirement) =>
					requirement.id === "req_a"
						? { ...requirement, summary: "changed requirement meaning" }
						: requirement,
				),
			}),
		});
		expect(meaningChanged.semantic_fingerprint).not.toBe(
			first.semantic_fingerprint,
		);

		const evidenceChanged = projection({
			requirements: projection().requirements.map((requirement) =>
				requirement.id === "req_a"
					? { ...requirement, evidence_refs: ["test:two"] }
					: requirement,
			),
		});
		expect(
			buildWorkBriefingSnapshot({ projection: evidenceChanged })
				.semantic_fingerprint,
		).not.toBe(first.semantic_fingerprint);
	});

	it("diffs only against a valid confirmed same-Work baseline", () => {
		const previous = buildWorkBriefingSnapshot({ projection: projection() });
		const changedProjection = projection({
			requirements: [
				{
					...projection().requirements[0]!,
					status: "verified",
					superseded_by: "req_c",
				},
				projection().requirements[1]!,
				{
					id: "req_c",
					summary: "new",
					status: "pending",
					source_event_ids: ["src_3"],
					evidence_refs: [],
					updated_at: "2026-08-13T00:00:03.000Z",
				},
			],
			conflicts: ["conflict_new"],
			progress: {
				applicable: 3,
				pending: 1,
				in_progress: 0,
				verified: 2,
				implemented_unverified: 0,
				blocked: 0,
				waived: 0,
				percent: 66.67,
				weighted: false,
				denominator_empty: false,
			},
		});
		const current = buildWorkBriefingSnapshot({
			projection: changedProjection,
			previous_confirmed: previous,
		});
		expect(current.baseline_available).toBe(true);
		expect(current.delta).toEqual({
			added_requirement_ids: ["req_c"],
			status_changed: [
				{ requirement_id: "req_b", from: "blocked", to: "verified" },
			],
			superseded: [{ requirement_id: "req_b", superseded_by: "req_c" }],
			conflicts_added: ["conflict_new"],
			conflicts_resolved: ["conflict_z"],
		});

		const tampered = { ...previous, semantic_fingerprint: sha256("fake") };
		expect(
			buildWorkBriefingSnapshot({
				projection: changedProjection,
				previous_confirmed: tampered,
			}).baseline_available,
		).toBe(false);
	});

	it("rejects future or same-revision hash-mismatched baselines but accepts older revisions and progress-only changes", () => {
		const currentProjection = projection();
		const future = buildWorkBriefingSnapshot({
			projection: projection({ contract_revision: 4 }),
		});
		const mismatchedContract = buildWorkBriefingSnapshot({
			projection: projection({ contract_hash: sha256("other-contract") }),
		});
		const mismatchedPolicy = buildWorkBriefingSnapshot({
			projection: projection({ policy_hash: sha256("other-policy") }),
		});
		for (const previous_confirmed of [
			future,
			mismatchedContract,
			mismatchedPolicy,
		]) {
			expect(
				buildWorkBriefingSnapshot({
					projection: currentProjection,
					previous_confirmed,
				}).baseline_available,
			).toBe(false);
		}

		const older = buildWorkBriefingSnapshot({
			projection: projection({
				contract_revision: 2,
				contract_hash: sha256("old-contract"),
				policy_hash: sha256("old-policy"),
			}),
		});
		expect(
			buildWorkBriefingSnapshot({
				projection: currentProjection,
				previous_confirmed: older,
			}).baseline_available,
		).toBe(true);

		const progressOnlyRequirements = currentProjection.requirements.map(
			(requirement) =>
				requirement.id === "req_b"
					? ({ ...requirement, status: "pending" } as const)
					: requirement,
		);
		const progressOnly = buildWorkBriefingSnapshot({
			projection: projection({
				requirements: progressOnlyRequirements,
				progress: calculateWorkProgress(progressOnlyRequirements),
			}),
		});
		expect(
			buildWorkBriefingSnapshot({
				projection: currentProjection,
				previous_confirmed: progressOnly,
			}).baseline_available,
		).toBe(true);
	});

	it("makes the weighted denominator explicit", () => {
		const weightedRequirements = projection().requirements.map(
			(requirement) => ({
				...requirement,
				weight: requirement.id === "req_a" ? 1 : 3,
			}),
		);
		const weighted = buildWorkBriefingSnapshot({
			projection: projection({
				requirements: weightedRequirements,
				progress: calculateWorkProgress(weightedRequirements),
			}),
		});
		expect(weighted.progress).toMatchObject({
			mode: "weighted",
			denominator: 4,
		});
	});
});

describe("reconciliation due evaluation", () => {
	const frequent = {
		reconciliation: normalizeWorkPolicyConfig({
			reconciliation: { preset: "frequent" },
		}).reconciliation,
	};

	it("observes exact thresholds only at a safe boundary and requires changed semantics", () => {
		const base = {
			policy: frequent,
			lifecycle: "open" as const,
			trigger: null,
			now: "2026-08-13T00:05:00.000Z",
			last_confirmed_at: "2026-08-13T00:00:00.000Z",
			current_fingerprint: sha256("current"),
			confirmed_fingerprint: sha256("old"),
		};
		expect(
			evaluateReconciliationDue({
				...base,
				safe_boundary: false,
				meaningful_actions_since_confirmed: 5,
			}),
		).toMatchObject({ due: false, visible_emission: false });
		expect(
			evaluateReconciliationDue({
				...base,
				safe_boundary: true,
				meaningful_actions_since_confirmed: 4,
			}),
		).toMatchObject({
			due: true,
			reasons: ["max_silence"],
		});
		expect(
			evaluateReconciliationDue({
				...base,
				now: "2026-08-13T00:04:59.999Z",
				safe_boundary: true,
				meaningful_actions_since_confirmed: 5,
			}),
		).toMatchObject({
			due: true,
			reasons: ["meaningful_actions"],
		});
		expect(
			evaluateReconciliationDue({
				...base,
				safe_boundary: true,
				meaningful_actions_since_confirmed: 99,
				current_fingerprint: base.confirmed_fingerprint,
			}),
		).toMatchObject({
			due: true,
			reasons: ["meaningful_actions", "max_silence"],
		});
	});

	it("allows the same observed fingerprint to become due again by silence", () => {
		const fingerprint = sha256("same");
		expect(
			evaluateReconciliationDue({
				policy: frequent,
				lifecycle: "open",
				safe_boundary: true,
				trigger: "work_resume",
				now: "2026-08-13T00:05:00.000Z",
				last_confirmed_at: "2026-08-13T00:00:00.000Z",
				meaningful_actions_since_confirmed: 0,
				current_fingerprint: fingerprint,
				confirmed_fingerprint: null,
				last_observed_fingerprint: fingerprint,
			}),
		).toMatchObject({ due: true, reasons: ["max_silence"] });
	});

	it("is clock-rollback safe, off is silent, and terminal Works never auto-continue", () => {
		expect(
			evaluateReconciliationDue({
				policy: frequent,
				lifecycle: "open",
				safe_boundary: true,
				trigger: null,
				now: "2026-08-12T23:59:00.000Z",
				last_confirmed_at: "2026-08-13T00:00:00.000Z",
				meaningful_actions_since_confirmed: 0,
				current_fingerprint: sha256("new"),
				confirmed_fingerprint: sha256("old"),
			}),
		).toMatchObject({ due: false });

		const off = { reconciliation: normalizeWorkPolicyConfig().reconciliation };
		expect(
			evaluateReconciliationDue({
				policy: off,
				lifecycle: "open",
				safe_boundary: true,
				trigger: "work_resume",
				now: "2026-08-13T00:00:00.000Z",
				last_confirmed_at: null,
				meaningful_actions_since_confirmed: 50,
				current_fingerprint: sha256("new"),
				confirmed_fingerprint: null,
			}),
		).toEqual({
			due: false,
			visible_emission: false,
			auto_continue: false,
			reasons: [],
		});

		for (const lifecycle of ["completed", "abandoned", "superseded"] as const) {
			expect(
				evaluateReconciliationDue({
					policy: frequent,
					lifecycle,
					safe_boundary: true,
					trigger: "work_resume",
					now: "2026-08-13T00:00:00.000Z",
					last_confirmed_at: null,
					meaningful_actions_since_confirmed: 0,
					current_fingerprint: sha256("new"),
					confirmed_fingerprint: null,
				}),
			).toMatchObject({ due: true, auto_continue: false });
		}
	});

	it("rejects forged fingerprints, timestamps, trigger, lifecycle, boundary, and duration", () => {
		const valid = {
			policy: frequent,
			lifecycle: "open" as const,
			safe_boundary: true,
			trigger: "work_resume" as const,
			now: "2026-08-13T00:00:00.000Z",
			last_confirmed_at: null,
			meaningful_actions_since_confirmed: 0,
			current_fingerprint: sha256("new"),
			confirmed_fingerprint: sha256("old"),
		};
		for (const invalid of [
			{ ...valid, current_fingerprint: "not-a-hash" },
			{ ...valid, confirmed_fingerprint: "not-a-hash" },
			{ ...valid, now: "2026-08-13T09:00:00+09:00" },
			{ ...valid, now: "2026-02-31T00:00:00.000Z" },
			{ ...valid, last_confirmed_at: "2026-08-13" },
			{ ...valid, trigger: "timer" },
			{ ...valid, lifecycle: "closed" },
			{ ...valid, safe_boundary: "yes" },
			{
				...valid,
				policy: {
					reconciliation: {
						...frequent.reconciliation,
						due_after: {
							...frequent.reconciliation.due_after,
							max_silence: "5m",
						},
					},
				},
			},
			{
				...valid,
				policy: {
					reconciliation: {
						...frequent.reconciliation,
						triggers: ["BOGUS"],
						detail: "wat",
						compact_target_tokens: -1,
						full_chunk_target_tokens: -1,
						after_briefing: "stop",
					},
				},
			},
		]) {
			expect(() =>
				evaluateReconciliationDue(
					invalid as Parameters<typeof evaluateReconciliationDue>[0],
				),
			).toThrow();
		}
	});
});

describe("reconciliation cursor transitions", () => {
	it("records hidden injection separately without advancing confirmation fields", () => {
		const initial = noteMeaningfulReconciliationAction(
			emptyWorkCursorReconciliationState(),
		);
		const delivery = {
			fingerprint: sha256("briefing"),
			ledger_head: sha256("head"),
			contract_revision: 2,
			contract_hash: sha256("contract"),
			policy_hash: sha256("policy"),
		};
		const observed = observeInjectedReconciliation(initial, {
			delivery,
			injected_at: "2026-08-13T00:00:00.000Z",
			boundary_id: sha256("boundary"),
			meaningful_actions_observed: 1,
		});
		expect(observed).toMatchObject({
			last_reconciled_head: null,
			last_reconciled_revision: null,
			last_reconciled_at: null,
			confirmed_delivery_fingerprint: null,
			pending_delivery: delivery,
			injected_unconfirmed: {
				delivery,
				boundary_id: sha256("boundary"),
				meaningful_actions_observed: 1,
			},
		});
	});

	it("does not advance a confirmed baseline until visible delivery is confirmed", () => {
		const fingerprint = sha256("briefing");
		const delivery = {
			fingerprint,
			ledger_head: sha256("head"),
			contract_revision: 4,
			contract_hash: sha256("contract"),
			policy_hash: sha256("policy"),
		};
		const acted = noteMeaningfulReconciliationAction(
			emptyWorkCursorReconciliationState(),
		);
		const pending = prepareReconciliationDelivery(acted, delivery);
		expect(pending).toMatchObject({
			meaningful_actions_since_confirmed: 1,
			pending_delivery: delivery,
			confirmed_delivery_fingerprint: null,
			last_reconciled_at: null,
		});
		const confirmed = confirmReconciliationDelivery(pending, {
			...delivery,
			confirmed_at: "2026-08-13T00:06:00.000Z",
		});
		expect(confirmed).toEqual({
			last_reconciled_head: sha256("head"),
			last_reconciled_revision: 4,
			last_reconciled_at: "2026-08-13T00:06:00.000Z",
			meaningful_actions_since_confirmed: 0,
			pending_delivery: null,
			confirmed_delivery_fingerprint: fingerprint,
			injected_unconfirmed: null,
			recent_meaningful_action_boundary_ids: [],
		});
	});

	it("resets the visible-confirmation counter while preserving the dedupe ring", () => {
		const delivery = {
			fingerprint: sha256("ring-briefing"),
			ledger_head: sha256("ring-head"),
			contract_revision: 1,
			contract_hash: sha256("ring-contract"),
			policy_hash: sha256("ring-policy"),
		};
		const boundary = sha256("recent-boundary");
		const state = prepareReconciliationDelivery(
			{
				...emptyWorkCursorReconciliationState(),
				meaningful_actions_since_confirmed: 5,
				recent_meaningful_action_boundary_ids: [boundary],
			},
			delivery,
		);
		expect(
			confirmReconciliationDelivery(state, {
				...delivery,
				confirmed_at: "2026-08-13T00:06:00.000Z",
			}),
		).toMatchObject({
			meaningful_actions_since_confirmed: 0,
			recent_meaningful_action_boundary_ids: [boundary],
		});
	});

	it("keeps unconfirmed retries and session states independent", () => {
		const original = emptyWorkCursorReconciliationState();
		const binding = (fingerprint: string) => ({
			fingerprint,
			ledger_head: sha256("head"),
			contract_revision: 1,
			contract_hash: sha256("contract"),
			policy_hash: sha256("policy"),
		});
		const sessionA = prepareReconciliationDelivery(
			original,
			binding(sha256("a")),
		);
		const sessionB = prepareReconciliationDelivery(
			original,
			binding(sha256("b")),
		);
		expect(original.pending_delivery).toBeNull();
		expect(sessionA.pending_delivery?.fingerprint).toBe(sha256("a"));
		expect(sessionB.pending_delivery?.fingerprint).toBe(sha256("b"));
		expect(() =>
			confirmReconciliationDelivery(sessionA, {
				...binding(sha256("wrong")),
				confirmed_at: "2026-08-13T00:00:00.000Z",
			}),
		).toThrow(/unprepared/);
	});

	it("binds confirmation to the exact prepared ledger, revision, contract, and policy tuple", () => {
		const prepared = prepareReconciliationDelivery(
			emptyWorkCursorReconciliationState(),
			{
				fingerprint: sha256("briefing"),
				ledger_head: sha256("head"),
				contract_revision: 2,
				contract_hash: sha256("contract"),
				policy_hash: sha256("policy"),
			},
		);
		const base = {
			fingerprint: sha256("briefing"),
			ledger_head: sha256("head"),
			contract_revision: 2,
			contract_hash: sha256("contract"),
			policy_hash: sha256("policy"),
			confirmed_at: "2026-08-13T00:00:00.000Z",
		};
		for (const mismatch of [
			{ ...base, ledger_head: sha256("other-head") },
			{ ...base, contract_revision: 3 },
			{ ...base, contract_hash: sha256("other-contract") },
			{ ...base, policy_hash: sha256("other-policy") },
		]) {
			expect(() => confirmReconciliationDelivery(prepared, mismatch)).toThrow(
				/unprepared/,
			);
		}
	});
});
