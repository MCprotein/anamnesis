import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendTypedWorkEvent,
	calculateWorkContractHash,
	calculateWorkDelegationContractHash,
	calculateWorkDelegationFailureFingerprint,
	childContractSchema,
	parseTypedWorkEvent,
	providerFailureInputSchema,
	repositoryScopeSchema,
	repositoryScopesOverlap,
	runtimeAttestedCapabilitySchema,
	runtimeAttestedInlineArtifactSchema,
	type TypedWorkEvent,
	validateWorkEventAppend,
	validateWorkLedgerSemantics,
	WORK_EXECUTION_LIMITS,
	type WorkContractDefinition,
	workDelegationOutcomePayloadSchema,
	workDelegationWaiverPayloadSchema,
	workParallelismAssessmentPayloadSchema,
	workParallelLaneSchema,
	workReviewAttemptPayloadSchema,
	workReviewRequestedPayloadSchema,
} from "./work_contract.js";
import {
	appendWorkLedger,
	readWorkLedger,
	type WorkLedgerRecord,
} from "./work_ledger.js";
import { createWorkPolicySnapshot, resolveWorkPolicy } from "./work_policy.js";
import {
	assertPublishedWorkSourceEvent,
	publishAndAppendCanonicalTypedWorkSourceEvent as publishAndAppendTypedWorkSourceEvent,
	publishAndAppendWorkSourceEvent,
	publishWorkSourceEvent,
} from "./work_storage.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function temporaryLedger(): { root: string; ledgerPath: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-contract-"));
	roots.push(root);
	return {
		root,
		ledgerPath: path.join(root, "work-units", "wu_one", "ledger.jsonl"),
	};
}

function contract(
	revision: number,
	summary = "preserve exact request",
): WorkContractDefinition {
	return {
		work: {
			id: "wu_one",
			title: "Typed Work",
			completion_contract: "All requirements verified",
		},
		boundary: {
			state: "accepted",
			classification: "same_unit",
			reason_codes: ["same_completion_contract"],
			confidence: "high",
		},
		policy_snapshot: createWorkPolicySnapshot(revision, resolveWorkPolicy([])),
		requirements: [{ id: "req_one", summary, source_event_ids: ["src_one"] }],
		open_conflicts: [],
	};
}

function creation(revision = 1): TypedWorkEvent {
	const definition = contract(revision);
	return {
		event_id: `lev_create_${revision}`,
		occurred_at: "2026-08-13T00:00:00.000Z",
		kind: "work_created",
		payload: {
			schema_version: "anamnesis.work-contract-event.v1",
			work_id: "wu_one",
			contract_revision: revision,
			previous_contract_revision: null,
			previous_contract_hash: null,
			contract_hash: calculateWorkContractHash(definition),
			contract: definition,
		},
	};
}

function publishedSourcePrecondition(root: string): () => void {
	const published = publishWorkSourceEvent({
		stateRoot: root,
		eventId: "src_one",
		capturedAt: "2026-08-13T00:00:00.000Z",
		client: "test",
		contentType: "text/plain",
		fidelity: "native_exact",
		allocationStatus: "allocated",
		body: "exact user request",
	});
	return () => assertPublishedWorkSourceEvent(published);
}

function appendContractSource(
	root: string,
	ledgerPath: string,
	event: TypedWorkEvent,
	expectedHead: string | null,
) {
	return publishAndAppendTypedWorkSourceEvent({
		source: {
			stateRoot: root,
			eventId: "src_one",
			capturedAt: "2026-08-13T00:00:00.000Z",
			client: "test",
			contentType: "text/plain",
			fidelity: "native_exact",
			allocationStatus: "allocated",
			body: "exact user request",
		},
		ledgerPath,
		ledgerEvent: event,
		expectedHead,
	}).ledger;
}

function ledgerRecord(
	event: TypedWorkEvent,
	previous_hash: string | null,
): WorkLedgerRecord {
	return {
		...event,
		schema_version: "anamnesis.work-ledger.v1",
		previous_hash,
		record_hash: `sha256:${event.event_id.padEnd(64, "0").slice(0, 64)}`,
	};
}

describe("typed Work contract", () => {
	it("accepts exact +1 revisions and separates progress from contract revision", () => {
		const { root, ledgerPath } = temporaryLedger();
		const created = creation();
		const first = appendContractSource(root, ledgerPath, created, null);
		const revisedContract = contract(2);
		revisedContract.boundary.reason_codes.push("reviewed");
		const revisedHash = calculateWorkContractHash(revisedContract);
		const revised = appendContractSource(
			root,
			ledgerPath,
			{
				event_id: "lev_revise",
				occurred_at: "2026-08-13T00:00:01.000Z",
				kind: "work_contract_revised",
				payload: {
					schema_version: "anamnesis.work-contract-event.v1",
					work_id: "wu_one",
					contract_revision: 2,
					previous_contract_revision: 1,
					previous_contract_hash: created.payload.contract_hash,
					contract_hash: revisedHash,
					contract: revisedContract,
				},
			},
			first.head,
		);
		const progressEvent: TypedWorkEvent = {
			event_id: "lev_progress",
			occurred_at: "2026-08-13T00:00:02.000Z",
			kind: "work_requirement_transitioned",
			payload: {
				schema_version: "anamnesis.work-progress-event.v1",
				work_id: "wu_one",
				requirement_id: "req_one",
				basis_contract_hash: revisedHash,
				status: "verified",
				evidence_refs: ["test:typed"],
			},
		};
		expect(() =>
			appendTypedWorkEvent({
				ledgerPath,
				expectedHead: revised.head,
				event: progressEvent,
			}),
		).toThrow(/official source publication API/);
		publishAndAppendTypedWorkSourceEvent({
			source: {
				stateRoot: root,
				eventId: "src_progress",
				capturedAt: "2026-08-13T00:00:02.000Z",
				client: "test",
				contentType: "text/plain",
				fidelity: "native_exact",
				allocationStatus: "allocated",
				body: "progress evidence",
			},
			ledgerPath,
			expectedHead: revised.head,
			ledgerEvent: progressEvent,
		});
		expect(readWorkLedger(ledgerPath).records).toHaveLength(3);
	});

	it("rejects no-op, skipped, stale-basis, and evidence-less verified mutations", () => {
		const { root, ledgerPath } = temporaryLedger();
		const created = creation();
		const first = appendContractSource(root, ledgerPath, created, null);
		for (const mutation of [
			{
				revision: 2,
				previous: 1,
				previousHash: created.payload.contract_hash,
				definition: contract(2),
			},
			{
				revision: 3,
				previous: 1,
				previousHash: created.payload.contract_hash,
				definition: contract(3, "changed"),
			},
		]) {
			expect(() =>
				appendContractSource(
					root,
					ledgerPath,
					{
						event_id: `bad_${mutation.revision}`,
						occurred_at: "2026-08-13T00:00:01.000Z",
						kind: "work_contract_revised",
						payload: {
							schema_version: "anamnesis.work-contract-event.v1",
							work_id: "wu_one",
							contract_revision: mutation.revision,
							previous_contract_revision: mutation.previous,
							previous_contract_hash: mutation.previousHash,
							contract_hash: calculateWorkContractHash(mutation.definition),
							contract: mutation.definition,
						},
					},
					first.head,
				),
			).toThrow(/no-op|exactly 2/);
		}
		for (const [basis, evidence] of [
			[created.payload.contract_hash, []],
			["sha256:" + "0".repeat(64), ["x"]],
		] as const) {
			expect(() =>
				appendTypedWorkEvent({
					ledgerPath,
					expectedHead: first.head,
					event: {
						event_id: `bad_progress_${evidence.length}`,
						occurred_at: "2026-08-13T00:00:01.000Z",
						kind: "work_requirement_transitioned",
						payload: {
							schema_version: "anamnesis.work-progress-event.v1",
							work_id: "wu_one",
							requirement_id: "req_one",
							basis_contract_hash: basis,
							status: "verified",
							evidence_refs: [...evidence],
						},
					},
				}),
			).toThrow(/requires evidence|stale/);
		}
	});

	it("makes contract hash independent of revision and time", () => {
		expect(calculateWorkContractHash(contract(1))).toBe(
			calculateWorkContractHash(contract(2)),
		);
	});

	it("forbids mixing typed and legacy semantic Work histories", () => {
		const typed = temporaryLedger();
		const created = appendContractSource(
			typed.root,
			typed.ledgerPath,
			creation(),
			null,
		);
		expect(() =>
			appendTypedWorkEvent({
				ledgerPath: typed.ledgerPath,
				expectedHead: created.head,
				event: {
					event_id: "legacy",
					occurred_at: "x",
					kind: "requirement_added",
					payload: {},
				} as unknown as TypedWorkEvent,
			}),
		).toThrow(/legacy semantic mutation|exact schema discriminator/);
		for (const kind of [
			"work_contract_revised",
			"work_requirement_transitioned",
			"work_lifecycle_changed",
			"contract_revised",
			"requirement_status_changed",
			"lifecycle_changed",
		]) {
			expect(() =>
				appendTypedWorkEvent({
					ledgerPath: typed.ledgerPath,
					expectedHead: created.head,
					event: {
						event_id: `legacy_${kind}`,
						occurred_at: "x",
						kind,
						payload: {},
					} as unknown as TypedWorkEvent,
				}),
			).toThrow(/legacy semantic mutation|exact schema discriminator/);
		}
		for (const [kind, schema_version] of [
			["work_contract_revised", "anamnesis.work-progress-event.v1"],
			["work_requirement_transitioned", "anamnesis.work-lifecycle-event.v1"],
			["work_lifecycle_changed", "anamnesis.work-contract-event.v1"],
		] as const) {
			expect(() =>
				appendTypedWorkEvent({
					ledgerPath: typed.ledgerPath,
					expectedHead: created.head,
					event: {
						event_id: `wrong_${kind}`,
						occurred_at: "x",
						kind,
						payload: { schema_version },
					} as unknown as TypedWorkEvent,
				}),
			).toThrow();
		}
	});

	it("cannot bypass typed semantic validation through the generic ledger API", () => {
		const typed = temporaryLedger();
		const createdEvent = creation();
		expect(() =>
			appendWorkLedger({
				ledgerPath: typed.ledgerPath,
				expectedHead: null,
				event: createdEvent,
				sourcePrecondition: publishedSourcePrecondition(typed.root),
			}),
		).toThrow(/official source publication API|typed Work append API/);
	});

	it("cannot publish a valid typed event through the generic source API", () => {
		const typed = temporaryLedger();
		expect(() =>
			publishAndAppendWorkSourceEvent({
				source: {
					stateRoot: typed.root,
					eventId: "src_one",
					capturedAt: "2026-08-13T00:00:00.000Z",
					client: "test",
					contentType: "text/plain",
					fidelity: "native_exact",
					allocationStatus: "allocated",
					body: "exact user request",
				},
				ledgerPath: typed.ledgerPath,
				ledgerEvent: creation(),
				expectedHead: null,
			}),
		).toThrow(/canonical typed source publication API/);
		expect(readWorkLedger(typed.ledgerPath).records).toHaveLength(0);
	});

	it("rejects untyped canonical-kind events through the typed source API", () => {
		const { root, ledgerPath } = temporaryLedger();
		expect(() =>
			publishAndAppendTypedWorkSourceEvent({
				source: {
					stateRoot: root,
					eventId: "src_one",
					capturedAt: "x",
					client: "test",
					contentType: "text/plain",
					fidelity: "native_exact",
					allocationStatus: "allocated",
					body: "exact",
				},
				ledgerPath,
				expectedHead: null,
				ledgerEvent: {
					event_id: "untyped",
					occurred_at: "x",
					kind: "work_created",
					payload: { work_id: "wu_one" },
				},
			}),
		).toThrow(/schema|typed Work event/);
		expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
	});

	it("cannot bypass typed semantic validation through generic source publication", () => {
		const { root, ledgerPath } = temporaryLedger();
		expect(() =>
			publishAndAppendWorkSourceEvent({
				source: {
					stateRoot: root,
					eventId: "src_one",
					capturedAt: "2026-08-13T00:00:00.000Z",
					client: "test",
					contentType: "text/plain",
					fidelity: "native_exact",
					allocationStatus: "allocated",
					body: "exact",
				},
				ledgerPath,
				expectedHead: null,
				ledgerEvent: creation(2),
			}),
		).toThrow(/canonical typed source publication API|exactly 1/);
		expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
	});

	it("publishes exact source before typed semantic validation and permits an orphan on failure", () => {
		const { root, ledgerPath } = temporaryLedger();
		const bad = creation(2);
		expect(() =>
			publishAndAppendTypedWorkSourceEvent({
				source: {
					stateRoot: root,
					eventId: "src_one",
					capturedAt: "2026-08-13T00:00:00.000Z",
					client: "codex",
					contentType: "text/plain",
					fidelity: "native_exact",
					allocationStatus: "allocated",
					body: "exact user request",
				},
				ledgerPath,
				ledgerEvent: bad,
				expectedHead: null,
			}),
		).toThrow(/exactly 1|canonical typed source publication API/);
		expect(
			fs.existsSync(path.join(root, "work-inputs", "events", "src_one.yaml")),
		).toBe(true);
		expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
	});

	it("rejects initial supersession graphs and dangling source references", () => {
		const self = contract(1);
		self.requirements[0]!.superseded_by = "req_one";
		expect(() => calculateWorkContractHash(self)).toThrow(
			/superseded_by|itself/,
		);

		const { root, ledgerPath } = temporaryLedger();
		const dangling = contract(1);
		dangling.requirements[0]!.source_event_ids = ["src_other"];
		const event = creation();
		event.payload.contract = dangling;
		event.payload.contract_hash = calculateWorkContractHash(dangling);
		expect(() => appendContractSource(root, ledgerPath, event, null)).toThrow(
			/not published|must be referenced/,
		);
	});

	it("preserves requirement lineage and rejects semantic mutation", () => {
		const { root, ledgerPath } = temporaryLedger();
		const created = creation();
		const first = appendContractSource(root, ledgerPath, created, null);
		const revised = contract(2);
		revised.requirements.push({
			id: "req_two",
			summary: "replacement",
			source_event_ids: ["src_one"],
			supersedes: ["req_one"],
		});
		const event: TypedWorkEvent = {
			event_id: "rev_lineage",
			occurred_at: "2026-08-13T00:01:00.000Z",
			kind: "work_contract_revised",
			payload: {
				schema_version: "anamnesis.work-contract-event.v1",
				work_id: "wu_one",
				contract_revision: 2,
				previous_contract_revision: 1,
				previous_contract_hash: created.payload.contract_hash,
				contract_hash: calculateWorkContractHash(revised),
				contract: revised,
			},
		};
		expect(
			appendContractSource(root, ledgerPath, event, first.head).idempotent,
		).toBe(false);

		const mutated = structuredClone(revised);
		mutated.policy_snapshot = createWorkPolicySnapshot(
			3,
			resolveWorkPolicy([]),
		);
		mutated.requirements[0]!.summary = "rewritten meaning";
		const bad = structuredClone(event);
		bad.event_id = "rev_mutated";
		bad.payload.contract_revision = 3;
		bad.payload.previous_contract_revision = 2;
		bad.payload.previous_contract_hash = event.payload.contract_hash;
		bad.payload.contract = mutated;
		bad.payload.contract_hash = calculateWorkContractHash(mutated);
		expect(() =>
			appendContractSource(
				root,
				ledgerPath,
				bad,
				readWorkLedger(ledgerPath).head,
			),
		).toThrow(/immutable/);
	});

	it("rejects two replacement requirements claiming the same predecessor", () => {
		const { root, ledgerPath } = temporaryLedger();
		const created = creation();
		const first = appendContractSource(root, ledgerPath, created, null);
		const revised = contract(2);
		revised.requirements.push(
			{
				id: "req_two",
				summary: "first replacement",
				source_event_ids: ["src_one"],
				supersedes: ["req_one"],
			},
			{
				id: "req_three",
				summary: "second replacement",
				source_event_ids: ["src_one"],
				supersedes: ["req_one"],
			},
		);
		const event: TypedWorkEvent = {
			event_id: "rev_duplicate_replacement",
			occurred_at: "2026-08-13T00:01:00.000Z",
			kind: "work_contract_revised",
			payload: {
				schema_version: "anamnesis.work-contract-event.v1",
				work_id: "wu_one",
				contract_revision: 2,
				previous_contract_revision: 1,
				previous_contract_hash: created.payload.contract_hash,
				contract_hash: calculateWorkContractHash(revised),
				contract: revised,
			},
		};
		expect(() =>
			appendContractSource(root, ledgerPath, event, first.head),
		).toThrow(/multiple superseding requirements/);
	});

	it("locks and validates prior plus newly published sources for additive revisions", () => {
		const { root, ledgerPath } = temporaryLedger();
		const initial = contract(1);
		initial.requirements[0]!.source_event_ids = ["src_old"];
		const created = creation();
		created.payload.contract = initial;
		created.payload.contract_hash = calculateWorkContractHash(initial);
		const first = publishAndAppendTypedWorkSourceEvent({
			source: {
				stateRoot: root,
				eventId: "src_old",
				capturedAt: "2026-08-13T00:00:00.000Z",
				client: "test",
				contentType: "text/plain",
				fidelity: "native_exact",
				allocationStatus: "allocated",
				body: "old",
			},
			ledgerPath,
			ledgerEvent: created,
			expectedHead: null,
		}).ledger;
		const revised = contract(2);
		revised.requirements[0]!.source_event_ids = ["src_old"];
		revised.requirements.push({
			id: "req_new",
			summary: "new",
			source_event_ids: ["src_new"],
		});
		const revisedHash = calculateWorkContractHash(revised);
		const result = publishAndAppendTypedWorkSourceEvent({
			source: {
				stateRoot: root,
				eventId: "src_new",
				capturedAt: "2026-08-13T00:01:00.000Z",
				client: "test",
				contentType: "text/plain",
				fidelity: "native_exact",
				allocationStatus: "allocated",
				body: "new",
			},
			ledgerPath,
			expectedHead: first.head,
			ledgerEvent: {
				event_id: "rev_sources",
				occurred_at: "2026-08-13T00:01:00.000Z",
				kind: "work_contract_revised",
				payload: {
					schema_version: "anamnesis.work-contract-event.v1",
					work_id: "wu_one",
					contract_revision: 2,
					previous_contract_revision: 1,
					previous_contract_hash: created.payload.contract_hash,
					contract_hash: revisedHash,
					contract: revised,
				},
			},
		});
		expect(result.ledger.idempotent).toBe(false);
	});

	it("revalidates retained envelope bindings before an idempotent retry", () => {
		const { root, ledgerPath } = temporaryLedger();
		const created = creation();
		const committed = appendContractSource(root, ledgerPath, created, null);
		const envelopePath = path.join(
			root,
			"work-inputs",
			"events",
			"src_one.yaml",
		);
		const envelope = JSON.parse(fs.readFileSync(envelopePath, "utf8"));
		envelope.client = "tampered";
		fs.writeFileSync(envelopePath, `${JSON.stringify(envelope)}\n`);

		expect(() => appendContractSource(root, ledgerPath, created, null)).toThrow(
			/metadata changed|envelope/,
		);
		expect(readWorkLedger(ledgerPath).head).toBe(committed.head);
	});

	it("rejects a canonical rewrite of previously committed source metadata", () => {
		const { root, ledgerPath } = temporaryLedger();
		const initial = contract(1);
		initial.requirements[0]!.source_event_ids = ["src_old"];
		const created = creation();
		created.payload.contract = initial;
		created.payload.contract_hash = calculateWorkContractHash(initial);
		const first = publishAndAppendTypedWorkSourceEvent({
			source: {
				stateRoot: root,
				eventId: "src_old",
				capturedAt: "2026-08-13T00:00:00.000Z",
				client: "original",
				contentType: "text/plain",
				fidelity: "native_exact",
				allocationStatus: "allocated",
				body: "old",
			},
			ledgerPath,
			ledgerEvent: created,
			expectedHead: null,
		}).ledger;
		const envelopePath = path.join(
			root,
			"work-inputs",
			"events",
			"src_old.yaml",
		);
		const envelope = JSON.parse(fs.readFileSync(envelopePath, "utf8"));
		envelope.client = "rewritten";
		const canonical = (value: unknown): string => {
			if (
				value === null ||
				typeof value === "boolean" ||
				typeof value === "string" ||
				typeof value === "number"
			)
				return JSON.stringify(value);
			if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
			return `{${Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
				.join(",")}}`;
		};
		fs.writeFileSync(envelopePath, `${canonical(envelope)}\n`);
		const revised = contract(2);
		revised.requirements[0]!.source_event_ids = ["src_old"];
		revised.requirements.push({
			id: "req_new",
			summary: "new",
			source_event_ids: ["src_new"],
		});
		expect(() =>
			publishAndAppendTypedWorkSourceEvent({
				source: {
					stateRoot: root,
					eventId: "src_new",
					capturedAt: "2026-08-13T00:01:00.000Z",
					client: "test",
					contentType: "text/plain",
					fidelity: "native_exact",
					allocationStatus: "allocated",
					body: "new",
				},
				ledgerPath,
				expectedHead: first.head,
				ledgerEvent: {
					event_id: "rev_metadata",
					occurred_at: "x",
					kind: "work_contract_revised",
					payload: {
						schema_version: "anamnesis.work-contract-event.v1",
						work_id: "wu_one",
						contract_revision: 2,
						previous_contract_revision: 1,
						previous_contract_hash: created.payload.contract_hash,
						contract_hash: calculateWorkContractHash(revised),
						contract: revised,
					},
				},
			}),
		).toThrow(/metadata changed/);
		expect(readWorkLedger(ledgerPath).records).toHaveLength(1);
	});

	it("rejects waived transitions without authority and all lifecycle writes", () => {
		const { root, ledgerPath } = temporaryLedger();
		const created = creation();
		const first = appendContractSource(root, ledgerPath, created, null);
		for (const event of [
			{
				event_id: "waive_bad",
				occurred_at: "x",
				kind: "work_requirement_transitioned",
				payload: {
					schema_version: "anamnesis.work-progress-event.v1",
					work_id: "wu_one",
					requirement_id: "req_one",
					basis_contract_hash: created.payload.contract_hash,
					status: "waived",
					evidence_refs: [],
				},
			},
			{
				event_id: "close_bad",
				occurred_at: "x",
				kind: "work_lifecycle_changed",
				payload: {
					schema_version: "anamnesis.work-lifecycle-event.v1",
					work_id: "wu_one",
					basis_contract_hash: created.payload.contract_hash,
					lifecycle: "completed",
				},
			},
		] as TypedWorkEvent[]) {
			expect(() =>
				appendTypedWorkEvent({ ledgerPath, expectedHead: first.head, event }),
			).toThrow(/waived|lifecycle/);
		}
	});

	it("canonicalizes set-like contract arrays and rejects semantic reorder revisions", () => {
		const left = contract(1);
		left.boundary.reason_codes = ["z", "a"];
		left.requirements.push({
			id: "req_two",
			summary: "two",
			source_event_ids: ["src_z", "src_a"],
		});
		const right = structuredClone(left);
		right.boundary.reason_codes.reverse();
		right.requirements.reverse();
		right.requirements
			.find((item) => item.id === "req_two")!
			.source_event_ids.reverse();
		expect(calculateWorkContractHash(right)).toBe(
			calculateWorkContractHash(left),
		);
	});

	it("rejects mixed inverse supersession linkage", () => {
		const mixed = contract(1);
		mixed.requirements.push({
			id: "req_two",
			summary: "two",
			source_event_ids: ["src_one"],
			supersedes: ["req_one"],
		});
		mixed.requirements[0]!.superseded_by = "req_two";
		expect(() => calculateWorkContractHash(mixed)).toThrow(
			/canonical supersedes linkage/,
		);
	});
});

describe("Work execution evidence schemas", () => {
	const digest = `sha256:${"1".repeat(64)}`;
	const basis = {
		work_id: "wu_one",
		basis_contract_revision: 1,
		basis_contract_hash: digest,
		policy_hash: digest,
	};
	const artifact = { ref: "plan.md", hash: digest };
	const lane = {
		lane_id: "lane_one",
		requirement_ids: ["req_one"],
		repository_scopes: [
			{ kind: "tree" as const, path: "cli/src", access: "write" as const },
		],
		external_effects: [],
		depends_on: [],
		verification_owner: "leader" as const,
	};

	it("exports strict UTF-8 byte bounds and preserves inline whitespace", () => {
		const exact = "é".repeat(WORK_EXECUTION_LIMITS.maxRefUtf8Bytes / 2);
		expect(
			providerFailureInputSchema.parse({ capability_ref: exact })
				.capability_ref,
		).toBe(exact);
		expect(() =>
			providerFailureInputSchema.parse({ capability_ref: `${exact}é` }),
		).toThrow();
		expect(
			runtimeAttestedInlineArtifactSchema.parse({
				kind: "runtime_attested_inline",
				ref: "plan",
				content: "  line one\nline two  ",
				assurance: "runtime_attested",
			}).content,
		).toBe("  line one\nline two  ");
		for (const invalid of ["\ud800", "\udc00"]) {
			expect(() =>
				providerFailureInputSchema.parse({ capability_ref: invalid }),
			).toThrow(/Unicode/);
			expect(() =>
				runtimeAttestedInlineArtifactSchema.parse({
					kind: "runtime_attested_inline",
					ref: "x",
					content: invalid,
					assurance: "runtime_attested",
				}),
			).toThrow(/Unicode/);
		}
	});

	it("validates runtime capability and repository scope grammar strictly", () => {
		expect(
			runtimeAttestedCapabilitySchema.parse({
				assurance: "runtime_attested",
				capability_ref: "cap_one",
				providers: [
					{
						provider: "native_agents",
						availability: "available",
						max_agents: WORK_EXECUTION_LIMITS.maxChildContracts,
					},
				],
			}).providers,
		).toHaveLength(1);
		expect(() =>
			runtimeAttestedCapabilitySchema.parse({
				assurance: "runtime_attested",
				capability_ref: "cap_one",
				providers: [
					{
						provider: "native_agents",
						availability: "available",
						max_agents: 1,
					},
					{
						provider: "native_agents",
						availability: "unavailable",
						max_agents: 0,
					},
				],
			}),
		).toThrow(/duplicate/);
		for (const pathValue of ["/abs", "a/../b", "a//b", "a\\b", "a/*", "a/"]) {
			expect(() =>
				repositoryScopeSchema.parse({
					kind: "tree",
					path: pathValue,
					access: "read",
				}),
			).toThrow();
		}
		expect(() =>
			repositoryScopeSchema.parse({ kind: "repo", path: "x", access: "read" }),
		).toThrow();
		expect(
			repositoryScopesOverlap(
				{ kind: "tree", path: "a/b", access: "read" },
				{ kind: "file", path: "a/b/c", access: "write" },
			),
		).toBe(true);
		expect(
			repositoryScopesOverlap(
				{ kind: "tree", path: "a/b", access: "read" },
				{ kind: "tree", path: "a/bc", access: "write" },
			),
		).toBe(false);
		expect(
			repositoryScopesOverlap(
				{ kind: "repo", access: "read" },
				{ kind: "file", path: "anything", access: "read" },
			),
		).toBe(true);
	});

	it("keeps review verdicts, provider failures, and independence fields disjoint", () => {
		const common = {
			schema_version: "anamnesis.work-review-attempt-event.v1" as const,
			...basis,
			gate: "planning" as const,
			activity_id: "review_one",
			attempt_id: "attempt_one",
			review_input_hash: digest,
			provider: "codex_native" as const,
			role: "critic",
		};
		expect(() =>
			workReviewAttemptPayloadSchema.parse({
				...common,
				outcome: "passed",
				reviewer_instance_ref: { provider: "codex_native", ref: "same" },
				author_instance_refs: [{ provider: "codex_native", ref: "same" }],
				independence_assurance: "runtime_attested",
				independence_evidence_refs: ["runtime:refs"],
				artifact_refs: [artifact],
				finding_refs: [],
			}),
		).toThrow(/differ/);
		expect(
			workReviewAttemptPayloadSchema.parse({
				...common,
				outcome: "passed",
				reviewer_instance_ref: { provider: "codex_native", ref: "Ref" },
				author_instance_refs: [{ provider: "codex_native", ref: "ref" }],
				independence_assurance: "runtime_attested",
				independence_evidence_refs: ["runtime:refs"],
				artifact_refs: [artifact],
				finding_refs: [],
			}).outcome,
		).toBe("passed");
		expect(() =>
			workReviewAttemptPayloadSchema.parse({
				...common,
				outcome: "unavailable",
				failure_input: { capability_ref: "cap" },
				failure_refs: ["diag"],
				finding_refs: ["must-not-mix"],
			}),
		).toThrow();
	});

	it("accepts all five strict payload families and rejects cross-variant fields", () => {
		expect(
			workReviewRequestedPayloadSchema.parse({
				schema_version: "anamnesis.work-review-request-event.v1",
				...basis,
				gate: "planning",
				activity_id: "review_one",
				review_input_hash: digest,
				artifact_refs: [artifact],
				provider_order: ["omx", "codex_native", "separate_process"],
				role_hint: "critic",
				minimum_reviewers: 1,
			}).gate,
		).toBe("planning");
		expect(
			workParallelismAssessmentPayloadSchema.parse({
				schema_version: "anamnesis.work-parallelism-assessment-event.v1",
				...basis,
				assessment_id: "assess_one",
				assessment_input_hash: digest,
				decision: "not_parallelizable",
				lanes: [lane],
				selected_provider: null,
				rationale_codes: ["indivisible"],
				evidence_refs: ["plan:one"],
			}).decision,
		).toBe("not_parallelizable");
		expect(() =>
			workParallelismAssessmentPayloadSchema.parse({
				schema_version: "anamnesis.work-parallelism-assessment-event.v1",
				...basis,
				assessment_id: "assess_fake",
				assessment_input_hash: digest,
				decision: "parallel",
				lanes: [lane],
				selected_provider: "native_agents",
				rationale_codes: ["fake"],
				evidence_refs: ["plan:one"],
			}),
		).toThrow(/at least two lanes/);
		expect(() =>
			workParallelismAssessmentPayloadSchema.parse({
				schema_version: "anamnesis.work-parallelism-assessment-event.v1",
				...basis,
				assessment_id: "assess_solo",
				assessment_input_hash: digest,
				decision: "solo",
				lanes: [lane],
				selected_provider: "native_agents",
				rationale_codes: ["indivisible"],
				evidence_refs: ["plan:one"],
			}),
		).toThrow(/cannot select/);
		const child = {
			lane_id: "lane_one",
			work_id: "wu_one",
			basis_contract_revision: 1,
			requirement_ids: ["req_one"],
			invariant_refs: ["inv:one"],
			invariant_hash: digest,
			repository_scopes: lane.repository_scopes,
			external_effects: [],
			side_effect_exclusions: ["no-network"],
			expected_artifact_refs: ["artifact:one"],
			expected_evidence_refs: ["evidence:one"],
			source_pointers: ["docs/plan.md"],
		};
		expect(childContractSchema.parse(child).lane_id).toBe("lane_one");
		expect(
			workDelegationOutcomePayloadSchema.parse({
				schema_version: "anamnesis.work-delegation-outcome-event.v1",
				...basis,
				assessment_id: "assess_one",
				assessment_input_hash: digest,
				provider: "native_agents",
				outcome: "delegated",
				child_contracts: [child],
				delegation_contract_hash: digest,
			}).outcome,
		).toBe("delegated");
		expect(() =>
			workDelegationOutcomePayloadSchema.parse({
				schema_version: "anamnesis.work-delegation-outcome-event.v1",
				...basis,
				assessment_id: "assess_one",
				assessment_input_hash: digest,
				provider: "native_agents",
				outcome: "results_recorded",
				delegation_contract_hash: digest,
				result_refs: ["result:one"],
				child_contracts: [child],
			}),
		).toThrow();
		expect(
			workDelegationWaiverPayloadSchema.parse({
				schema_version: "anamnesis.work-delegation-waiver-event.v1",
				...basis,
				assessment_id: "assess_one",
				assessment_input_hash: digest,
				reason: "explicit user authority",
				authority_ref: "user:one",
				source_event_id: "src_one",
				evidence_refs: ["decision:one"],
			}).assessment_id,
		).toBe("assess_one");
	});

	it("fails closed on every known kind/schema mismatch", () => {
		const validRequest = {
			event_id: "evt_review",
			occurred_at: "x",
			kind: "work_review_requested",
			payload: {
				schema_version: "anamnesis.work-review-request-event.v1",
				...basis,
				gate: "planning",
				activity_id: "review_one",
				review_input_hash: digest,
				artifact_refs: [artifact],
				provider_order: ["omx"],
				role_hint: "critic",
				minimum_reviewers: 1,
			},
		} satisfies TypedWorkEvent;
		expect(parseTypedWorkEvent(validRequest).kind).toBe(
			"work_review_requested",
		);
		for (const [kind, schema_version] of [
			["work_review_requested", "anamnesis.work-review-attempt-event.v1"],
			[
				"work_review_attempt_recorded",
				"anamnesis.work-review-request-event.v1",
			],
			[
				"work_parallelism_assessed",
				"anamnesis.work-delegation-outcome-event.v1",
			],
			[
				"work_delegation_outcome_recorded",
				"anamnesis.work-delegation-waiver-event.v1",
			],
			[
				"work_delegation_waived",
				"anamnesis.work-parallelism-assessment-event.v1",
			],
		] as const) {
			expect(() =>
				parseTypedWorkEvent({
					...validRequest,
					kind,
					payload: { schema_version },
				}),
			).toThrow();
		}
	});

	it("validates current Work revision/hash/policy and frozen review request fields", () => {
		const { root, ledgerPath } = temporaryLedger();
		const created = creation();
		appendContractSource(root, ledgerPath, created, null);
		const current = readWorkLedger(ledgerPath);
		const gate =
			created.payload.contract.policy_snapshot.policy.review.gates[0]!;
		const request: TypedWorkEvent = {
			event_id: "evt_review",
			occurred_at: "x",
			kind: "work_review_requested",
			payload: {
				schema_version: "anamnesis.work-review-request-event.v1",
				work_id: "wu_one",
				basis_contract_revision: 1,
				basis_contract_hash: created.payload.contract_hash,
				policy_hash: created.payload.contract.policy_snapshot.policy_hash,
				gate: "planning",
				activity_id: "review_one",
				review_input_hash: digest,
				artifact_refs: [artifact],
				provider_order: gate.provider_order,
				role_hint: gate.role_hint,
				minimum_reviewers: gate.minimum_reviewers,
			},
		};
		expect(() =>
			validateWorkEventAppend(current.records, request),
		).not.toThrow();
		const stale = structuredClone(request);
		if (stale.kind !== "work_review_requested") throw new Error("fixture");
		stale.payload.basis_contract_revision = 2;
		expect(() => validateWorkEventAppend(current.records, stale)).toThrow(
			/revision is stale/,
		);
		const weakened = structuredClone(request);
		if (weakened.kind !== "work_review_requested") throw new Error("fixture");
		weakened.payload.minimum_reviewers += 1;
		expect(() => validateWorkEventAppend(current.records, weakened)).toThrow(
			/frozen gate policy/,
		);
	});

	it("requires the current review provider and advances only after a permitted failure", () => {
		const { root, ledgerPath } = temporaryLedger();
		const created = creation();
		appendContractSource(root, ledgerPath, created, null);
		const records = readWorkLedger(ledgerPath).records;
		const policy = created.payload.contract.policy_snapshot;
		const gate = policy.policy.review.gates[0]!;
		const request: TypedWorkEvent = {
			event_id: "review_request",
			occurred_at: "x",
			kind: "work_review_requested",
			payload: {
				schema_version: "anamnesis.work-review-request-event.v1",
				work_id: "wu_one",
				basis_contract_revision: 1,
				basis_contract_hash: created.payload.contract_hash,
				policy_hash: policy.policy_hash,
				gate: "planning",
				activity_id: "activity_one",
				review_input_hash: digest,
				artifact_refs: [artifact],
				provider_order: gate.provider_order,
				role_hint: gate.role_hint,
				minimum_reviewers: gate.minimum_reviewers,
			},
		};
		const withRequest = [
			...records,
			ledgerRecord(request, records.at(-1)!.record_hash),
		];
		const failure = (
			provider: "omx" | "codex_native" | "separate_process",
		): TypedWorkEvent => ({
			event_id: `failure_${provider}`,
			occurred_at: "x",
			kind: "work_review_attempt_recorded",
			payload: {
				schema_version: "anamnesis.work-review-attempt-event.v1",
				work_id: "wu_one",
				basis_contract_revision: 1,
				basis_contract_hash: created.payload.contract_hash,
				policy_hash: policy.policy_hash,
				gate: "planning",
				activity_id: "activity_one",
				attempt_id: `attempt_${provider}`,
				review_input_hash: digest,
				provider,
				role: gate.role_hint,
				outcome: "authorization_error",
				failure_input: { capability_ref: "cap" },
				failure_refs: ["failure:one"],
			},
		});
		expect(() =>
			validateWorkEventAppend(withRequest, failure("codex_native")),
		).toThrow(/provider\/role/);
		expect(() =>
			validateWorkEventAppend(withRequest, failure("omx")),
		).not.toThrow();
		const withFailure = [
			...withRequest,
			ledgerRecord(failure("omx"), withRequest.at(-1)!.record_hash),
		];
		expect(() =>
			validateWorkEventAppend(withFailure, failure("codex_native")),
		).not.toThrow();
		const withSecondFailure = [
			...withFailure,
			ledgerRecord(failure("codex_native"), withFailure.at(-1)!.record_hash),
		];
		expect(() =>
			validateWorkEventAppend(withSecondFailure, failure("separate_process")),
		).not.toThrow();
		const withExhaustion = [
			...withSecondFailure,
			ledgerRecord(
				failure("separate_process"),
				withSecondFailure.at(-1)!.record_hash,
			),
		];
		const latePass: TypedWorkEvent = {
			event_id: "late_review_pass",
			occurred_at: "x",
			kind: "work_review_attempt_recorded",
			payload: {
				schema_version: "anamnesis.work-review-attempt-event.v1",
				work_id: "wu_one",
				basis_contract_revision: 1,
				basis_contract_hash: created.payload.contract_hash,
				policy_hash: policy.policy_hash,
				gate: "planning",
				activity_id: "activity_one",
				attempt_id: "attempt_late",
				review_input_hash: digest,
				provider: "separate_process",
				role: gate.role_hint,
				outcome: "passed",
				reviewer_instance_ref: { provider: "codex_native", ref: "reviewer" },
				author_instance_refs: [{ provider: "codex_native", ref: "author" }],
				independence_assurance: "runtime_attested",
				independence_evidence_refs: ["runtime:attested"],
				artifact_refs: [artifact],
				finding_refs: [],
			},
		};
		expect(() => validateWorkEventAppend(withExhaustion, latePass)).toThrow(
			/terminal.*new review activity/,
		);
		expect(() =>
			validateWorkLedgerSemantics([
				...withExhaustion,
				ledgerRecord(latePass, withExhaustion.at(-1)!.record_hash),
			]),
		).toThrow(/terminal.*new review activity/);
		const recoveryRequest = { ...request, event_id: "review_request_recovery" };
		const recovered = [
			...withExhaustion,
			ledgerRecord(recoveryRequest, withExhaustion.at(-1)!.record_hash),
		];
		const recoveryPass = structuredClone(latePass);
		if (recoveryPass.kind !== "work_review_attempt_recorded")
			throw new Error("fixture");
		recoveryPass.event_id = "review_recovery_pass";
		recoveryPass.payload.provider = "omx";
		expect(() =>
			validateWorkEventAppend(recovered, recoveryPass),
		).not.toThrow();
	});

	it("derives delegation fallback and rejects forged contract/failure hashes", () => {
		const { root, ledgerPath } = temporaryLedger();
		const created = creation();
		appendContractSource(root, ledgerPath, created, null);
		const records = readWorkLedger(ledgerPath).records;
		const policy = created.payload.contract.policy_snapshot;
		const laneTwo = {
			...lane,
			lane_id: "lane_two",
			repository_scopes: [
				{ kind: "tree" as const, path: "docs", access: "write" as const },
			],
		};
		const assessment: TypedWorkEvent = {
			event_id: "assess",
			occurred_at: "x",
			kind: "work_parallelism_assessed",
			payload: {
				schema_version: "anamnesis.work-parallelism-assessment-event.v1",
				work_id: "wu_one",
				basis_contract_revision: 1,
				basis_contract_hash: created.payload.contract_hash,
				policy_hash: policy.policy_hash,
				assessment_id: "assess_one",
				assessment_input_hash: digest,
				decision: "parallel",
				lanes: [lane, laneTwo],
				selected_provider: "native_agents",
				rationale_codes: ["two_disjoint_write_scopes"],
				evidence_refs: ["plan:one"],
			},
		};
		expect(() => validateWorkEventAppend(records, assessment)).not.toThrow();
		const withAssessment = [
			...records,
			ledgerRecord(assessment, records.at(-1)!.record_hash),
		];
		const duplicateInput = structuredClone(assessment);
		if (duplicateInput.kind !== "work_parallelism_assessed")
			throw new Error("fixture");
		duplicateInput.event_id = "assess_duplicate_input";
		duplicateInput.payload.assessment_id = "assess_duplicate_input";
		expect(() =>
			validateWorkEventAppend(withAssessment, duplicateInput),
		).toThrow(/changed canonical input hash/);
		const failurePayload = {
			schema_version: "anamnesis.work-delegation-outcome-event.v1" as const,
			work_id: "wu_one",
			basis_contract_revision: 1,
			basis_contract_hash: created.payload.contract_hash,
			policy_hash: policy.policy_hash,
			assessment_id: "assess_one",
			assessment_input_hash: digest,
			provider: "native_agents" as const,
			outcome: "authorization_error" as const,
			failure_input: { capability_ref: "cap", authority_ref: "authority" },
			failure_refs: ["failure:one"],
			failure_fingerprint: digest,
		};
		const failureHash = calculateWorkDelegationFailureFingerprint(
			failurePayload,
			[lane, laneTwo],
		);
		const failure: TypedWorkEvent = {
			event_id: "delegate_failure",
			occurred_at: "x",
			kind: "work_delegation_outcome_recorded",
			payload: { ...failurePayload, failure_fingerprint: failureHash },
		};
		expect(() =>
			validateWorkEventAppend(withAssessment, {
				...failure,
				payload: { ...failure.payload, failure_fingerprint: digest },
			} as TypedWorkEvent),
		).toThrow(/fingerprint mismatch/);
		expect(() =>
			validateWorkEventAppend(withAssessment, failure),
		).not.toThrow();
		const withFailure = [
			...withAssessment,
			ledgerRecord(failure, withAssessment.at(-1)!.record_hash),
		];
		const repeatedFailure = { ...failure, event_id: "delegate_failure_repeat" };
		expect(() => validateWorkEventAppend(withFailure, repeatedFailure)).toThrow(
			/duplicate.*fingerprint/,
		);
		const child = (laneValue: typeof lane) => ({
			lane_id: laneValue.lane_id,
			work_id: "wu_one",
			basis_contract_revision: 1,
			requirement_ids: laneValue.requirement_ids,
			invariant_refs: ["inv:one"],
			invariant_hash: digest,
			repository_scopes: laneValue.repository_scopes,
			external_effects: laneValue.external_effects,
			side_effect_exclusions: ["no-external-write"],
			expected_artifact_refs: ["artifact:one"],
			expected_evidence_refs: ["evidence:one"],
			source_pointers: ["docs/plan.md"],
		});
		const delegatedBase = {
			work_id: "wu_one",
			basis_contract_revision: 1,
			basis_contract_hash: created.payload.contract_hash,
			policy_hash: policy.policy_hash,
			assessment_id: "assess_one",
			assessment_input_hash: digest,
			provider: "tmux_team" as const,
			child_contracts: [child(lane), child(laneTwo)],
		};
		const delegated: TypedWorkEvent = {
			event_id: "delegated",
			occurred_at: "x",
			kind: "work_delegation_outcome_recorded",
			payload: {
				schema_version: "anamnesis.work-delegation-outcome-event.v1",
				...delegatedBase,
				outcome: "delegated",
				delegation_contract_hash:
					calculateWorkDelegationContractHash(delegatedBase),
			},
		};
		expect(() => validateWorkEventAppend(withFailure, delegated)).not.toThrow();
		const withDelegated = [
			...withFailure,
			ledgerRecord(delegated, withFailure.at(-1)!.record_hash),
		];
		expect(() =>
			validateWorkEventAppend(withDelegated, repeatedFailure),
		).toThrow(/terminal recorded outcome/);
		const forged = structuredClone(delegated);
		if (
			forged.kind !== "work_delegation_outcome_recorded" ||
			forged.payload.outcome !== "delegated"
		)
			throw new Error("fixture");
		forged.payload.delegation_contract_hash = digest;
		expect(() => validateWorkEventAppend(withFailure, forged)).toThrow(
			/contract hash mismatch/,
		);
		const secondFailurePayload = {
			...failurePayload,
			provider: "tmux_team" as const,
			failure_refs: ["failure:two"],
		};
		const secondFailure: TypedWorkEvent = {
			event_id: "delegate_failure_two",
			occurred_at: "x",
			kind: "work_delegation_outcome_recorded",
			payload: {
				...secondFailurePayload,
				failure_fingerprint: calculateWorkDelegationFailureFingerprint(
					secondFailurePayload,
					[lane, laneTwo],
				),
			},
		};
		expect(() =>
			validateWorkEventAppend(withFailure, secondFailure),
		).not.toThrow();
		const exhausted = [
			...withFailure,
			ledgerRecord(secondFailure, withFailure.at(-1)!.record_hash),
		];
		expect(() => validateWorkEventAppend(exhausted, delegated)).toThrow(
			/terminal.*exhaustion/,
		);
		const waiverAfterDelegated: TypedWorkEvent = {
			event_id: "late_waiver",
			occurred_at: "x",
			kind: "work_delegation_waived",
			payload: {
				schema_version: "anamnesis.work-delegation-waiver-event.v1",
				work_id: "wu_one",
				basis_contract_revision: 1,
				basis_contract_hash: created.payload.contract_hash,
				policy_hash: policy.policy_hash,
				assessment_id: "assess_one",
				assessment_input_hash: digest,
				reason: "late",
				authority_ref: "user:owner",
				source_event_id: "source:late",
				evidence_refs: ["decision:late"],
			},
		};
		expect(() =>
			validateWorkEventAppend(withDelegated, waiverAfterDelegated),
		).toThrow(/cannot overwrite delegated/);

		const changedInputHash = `sha256:${"2".repeat(64)}`;
		const reusedAssessment = structuredClone(assessment);
		if (reusedAssessment.kind !== "work_parallelism_assessed")
			throw new Error("fixture");
		reusedAssessment.event_id = "assessment_reused";
		reusedAssessment.payload.assessment_input_hash = changedInputHash;
		expect(() =>
			validateWorkEventAppend(withAssessment, reusedAssessment),
		).toThrow(/assessment_id.*reused/);
		expect(() =>
			validateWorkLedgerSemantics([
				...withAssessment,
				ledgerRecord(reusedAssessment, withAssessment.at(-1)!.record_hash),
			]),
		).toThrow(/assessment_id.*reused/);

		const results: TypedWorkEvent = {
			event_id: "results",
			occurred_at: "x",
			kind: "work_delegation_outcome_recorded",
			payload: {
				schema_version: "anamnesis.work-delegation-outcome-event.v1",
				work_id: "wu_one",
				basis_contract_revision: 1,
				basis_contract_hash: created.payload.contract_hash,
				policy_hash: policy.policy_hash,
				assessment_id: "assess_one",
				assessment_input_hash: digest,
				provider: "tmux_team",
				outcome: "results_recorded",
				delegation_contract_hash: delegated.payload.delegation_contract_hash,
				result_refs: ["result:one"],
			},
		};
		expect(() => validateWorkEventAppend(withDelegated, results)).not.toThrow();
		const changedResults = structuredClone(results);
		if (changedResults.kind !== "work_delegation_outcome_recorded")
			throw new Error("fixture");
		changedResults.event_id = "results_changed_input";
		changedResults.payload.assessment_input_hash = changedInputHash;
		expect(() =>
			validateWorkEventAppend(withDelegated, changedResults),
		).toThrow(/unknown or stale assessment/);

		const assessmentB = structuredClone(assessment);
		if (assessmentB.kind !== "work_parallelism_assessed")
			throw new Error("fixture");
		assessmentB.event_id = "assessment_b";
		assessmentB.payload.assessment_id = "assess_two";
		assessmentB.payload.assessment_input_hash = changedInputHash;
		expect(() =>
			validateWorkEventAppend(withDelegated, assessmentB),
		).not.toThrow();
		const withAssessmentB = [
			...withDelegated,
			ledgerRecord(assessmentB, withDelegated.at(-1)!.record_hash),
		];
		expect(() => validateWorkEventAppend(withAssessmentB, results)).toThrow(
			/unknown or stale assessment/,
		);
		expect(() =>
			validateWorkLedgerSemantics([
				...withAssessmentB,
				ledgerRecord(results, withAssessmentB.at(-1)!.record_hash),
			]),
		).toThrow(/unknown or stale assessment/);
	});

	it("accepts exact contract-owned limits and rejects limit plus one", () => {
		const values = (prefix: string, count: number) =>
			Array.from({ length: count }, (_, index) => `${prefix}:${index}`);
		const exactPath = "é".repeat(WORK_EXECUTION_LIMITS.maxPathUtf8Bytes / 2);
		expect(
			repositoryScopeSchema.parse({
				kind: "file",
				path: exactPath,
				access: "read",
			}).kind,
		).toBe("file");
		expect(() =>
			repositoryScopeSchema.parse({
				kind: "file",
				path: `${exactPath}é`,
				access: "read",
			}),
		).toThrow();

		const requestBase = {
			schema_version: "anamnesis.work-review-request-event.v1" as const,
			...basis,
			gate: "planning" as const,
			activity_id: "review",
			review_input_hash: digest,
			provider_order: ["omx" as const],
			role_hint: "critic",
			minimum_reviewers: 1,
		};
		const artifacts = values(
			"artifact",
			WORK_EXECUTION_LIMITS.maxArtifacts,
		).map((ref) => ({ ref, hash: digest }));
		expect(
			workReviewRequestedPayloadSchema.parse({
				...requestBase,
				artifact_refs: artifacts,
			}).artifact_refs,
		).toHaveLength(WORK_EXECUTION_LIMITS.maxArtifacts);
		expect(() =>
			workReviewRequestedPayloadSchema.parse({
				...requestBase,
				artifact_refs: [...artifacts, { ref: "artifact:plus", hash: digest }],
			}),
		).toThrow();

		const waiverBase = {
			schema_version: "anamnesis.work-delegation-waiver-event.v1" as const,
			...basis,
			assessment_id: "assess",
			assessment_input_hash: digest,
			reason: "reason",
			authority_ref: "authority",
			source_event_id: "source",
		};
		const evidenceRefs = values(
			"evidence",
			WORK_EXECUTION_LIMITS.maxEvidenceRefs,
		);
		expect(
			workDelegationWaiverPayloadSchema.parse({
				...waiverBase,
				evidence_refs: evidenceRefs,
			}).evidence_refs,
		).toHaveLength(WORK_EXECUTION_LIMITS.maxEvidenceRefs);
		expect(() =>
			workDelegationWaiverPayloadSchema.parse({
				...waiverBase,
				evidence_refs: [...evidenceRefs, "evidence:plus"],
			}),
		).toThrow();

		const attemptBase = {
			schema_version: "anamnesis.work-review-attempt-event.v1" as const,
			...basis,
			gate: "planning" as const,
			activity_id: "review",
			attempt_id: "attempt",
			review_input_hash: digest,
			provider: "omx" as const,
			role: "critic",
		};
		const findingRefs = values("finding", WORK_EXECUTION_LIMITS.maxFindingRefs);
		const passed = {
			...attemptBase,
			outcome: "passed" as const,
			reviewer_instance_ref: { provider: "omx" as const, ref: "reviewer" },
			author_instance_refs: [{ provider: "omx" as const, ref: "author" }],
			independence_assurance: "runtime_attested" as const,
			independence_evidence_refs: ["independence"],
			artifact_refs: [artifact],
		};
		expect(
			workReviewAttemptPayloadSchema.parse({
				...passed,
				finding_refs: findingRefs,
			}).finding_refs,
		).toHaveLength(WORK_EXECUTION_LIMITS.maxFindingRefs);
		expect(() =>
			workReviewAttemptPayloadSchema.parse({
				...passed,
				finding_refs: [...findingRefs, "finding:plus"],
			}),
		).toThrow();
		const failureRefs = values("failure", WORK_EXECUTION_LIMITS.maxFailureRefs);
		const failedAttempt = {
			...attemptBase,
			outcome: "unavailable" as const,
			failure_input: { capability_ref: "cap" },
		};
		expect(
			workReviewAttemptPayloadSchema.parse({
				...failedAttempt,
				failure_refs: failureRefs,
			}).failure_refs,
		).toHaveLength(WORK_EXECUTION_LIMITS.maxFailureRefs);
		expect(() =>
			workReviewAttemptPayloadSchema.parse({
				...failedAttempt,
				failure_refs: [...failureRefs, "failure:plus"],
			}),
		).toThrow();

		const scopes = values(
			"scope",
			WORK_EXECUTION_LIMITS.maxRepositoryScopesPerLane,
		).map((path) => ({ kind: "file" as const, path, access: "read" as const }));
		const effects = values(
			"effect",
			WORK_EXECUTION_LIMITS.maxExternalEffectsPerLane,
		).map((resource_ref) => ({
			resource_kind: "service",
			resource_ref,
			access: "read" as const,
			irreversible: false,
		}));
		const laneBase = {
			lane_id: "lane",
			requirement_ids: ["req"],
			depends_on: [],
			verification_owner: "leader" as const,
		};
		const exactLane = workParallelLaneSchema.parse({
			...laneBase,
			repository_scopes: scopes,
			external_effects: effects,
		});
		expect(exactLane.repository_scopes).toHaveLength(
			WORK_EXECUTION_LIMITS.maxRepositoryScopesPerLane,
		);
		expect(exactLane.external_effects).toHaveLength(
			WORK_EXECUTION_LIMITS.maxExternalEffectsPerLane,
		);
		expect(() =>
			workParallelLaneSchema.parse({
				...laneBase,
				repository_scopes: [
					...scopes,
					{ kind: "file", path: "scope/plus", access: "read" },
				],
				external_effects: effects,
			}),
		).toThrow();
		expect(() =>
			workParallelLaneSchema.parse({
				...laneBase,
				repository_scopes: scopes,
				external_effects: [
					...effects,
					{
						resource_kind: "service",
						resource_ref: "effect:plus",
						access: "read",
						irreversible: false,
					},
				],
			}),
		).toThrow();

		const requirements = values(
			"req",
			WORK_EXECUTION_LIMITS.maxRequirementsPerChild,
		);
		const pointers = values(
			"pointer",
			WORK_EXECUTION_LIMITS.maxSourcePointersPerChild,
		);
		const childBase = {
			work_id: "wu_one",
			basis_contract_revision: 1,
			invariant_refs: ["inv"],
			invariant_hash: digest,
			repository_scopes: [{ kind: "repo" as const, access: "read" as const }],
			external_effects: [],
			side_effect_exclusions: ["none"],
			expected_artifact_refs: ["artifact"],
			expected_evidence_refs: ["evidence"],
		};
		expect(
			childContractSchema.parse({
				...childBase,
				lane_id: "lane",
				requirement_ids: requirements,
				source_pointers: pointers,
			}).requirement_ids,
		).toHaveLength(WORK_EXECUTION_LIMITS.maxRequirementsPerChild);
		expect(() =>
			childContractSchema.parse({
				...childBase,
				lane_id: "lane",
				requirement_ids: [...requirements, "req:plus"],
				source_pointers: pointers,
			}),
		).toThrow();
		expect(() =>
			childContractSchema.parse({
				...childBase,
				lane_id: "lane",
				requirement_ids: requirements,
				source_pointers: [...pointers, "pointer:plus"],
			}),
		).toThrow();

		const children = values(
			"lane",
			WORK_EXECUTION_LIMITS.maxChildContracts,
		).map((lane_id) => ({
			...childBase,
			lane_id,
			requirement_ids: ["req"],
			source_pointers: ["pointer"],
		}));
		const outcomeBase = {
			schema_version: "anamnesis.work-delegation-outcome-event.v1" as const,
			...basis,
			assessment_id: "assess",
			assessment_input_hash: digest,
			provider: "native_agents" as const,
			outcome: "delegated" as const,
			delegation_contract_hash: digest,
		};
		expect(
			workDelegationOutcomePayloadSchema.parse({
				...outcomeBase,
				child_contracts: children,
			}).child_contracts,
		).toHaveLength(WORK_EXECUTION_LIMITS.maxChildContracts);
		expect(() =>
			workDelegationOutcomePayloadSchema.parse({
				...outcomeBase,
				child_contracts: [
					...children,
					{ ...children[0]!, lane_id: "lane:plus" },
				],
			}),
		).toThrow();
	});

	it("fails closed when replay reorders evidence or contains forged derived hashes", () => {
		const { root, ledgerPath } = temporaryLedger();
		const created = creation();
		appendContractSource(root, ledgerPath, created, null);
		const baseRecords = readWorkLedger(ledgerPath).records;
		const policy = created.payload.contract.policy_snapshot;
		const gate = policy.policy.review.gates[0]!;
		const attempt: TypedWorkEvent = {
			event_id: "attempt_before_request",
			occurred_at: "x",
			kind: "work_review_attempt_recorded",
			payload: {
				schema_version: "anamnesis.work-review-attempt-event.v1",
				work_id: "wu_one",
				basis_contract_revision: 1,
				basis_contract_hash: created.payload.contract_hash,
				policy_hash: policy.policy_hash,
				gate: "planning",
				activity_id: "missing_activity",
				attempt_id: "attempt",
				review_input_hash: digest,
				provider: "omx",
				role: gate.role_hint,
				outcome: "unavailable",
				failure_input: { capability_ref: "cap" },
				failure_refs: ["failure"],
			},
		};
		expect(() =>
			validateWorkLedgerSemantics([
				...baseRecords,
				ledgerRecord(attempt, baseRecords.at(-1)!.record_hash),
			]),
		).toThrow(/unknown or superseded activity/);

		const outcomeBeforeAssessment: TypedWorkEvent = {
			event_id: "outcome_before_assessment",
			occurred_at: "x",
			kind: "work_delegation_outcome_recorded",
			payload: {
				schema_version: "anamnesis.work-delegation-outcome-event.v1",
				work_id: "wu_one",
				basis_contract_revision: 1,
				basis_contract_hash: created.payload.contract_hash,
				policy_hash: policy.policy_hash,
				assessment_id: "missing",
				assessment_input_hash: digest,
				provider: "native_agents",
				outcome: "unavailable",
				failure_input: { capability_ref: "cap" },
				failure_refs: ["failure"],
				failure_fingerprint: digest,
			},
		};
		expect(() =>
			validateWorkLedgerSemantics([
				...baseRecords,
				ledgerRecord(outcomeBeforeAssessment, baseRecords.at(-1)!.record_hash),
			]),
		).toThrow(/unknown or stale assessment/);

		const laneTwo = {
			...lane,
			lane_id: "lane_two",
			repository_scopes: [
				{ kind: "tree" as const, path: "docs", access: "write" as const },
			],
		};
		const assessment: TypedWorkEvent = {
			event_id: "assessment",
			occurred_at: "x",
			kind: "work_parallelism_assessed",
			payload: {
				schema_version: "anamnesis.work-parallelism-assessment-event.v1",
				work_id: "wu_one",
				basis_contract_revision: 1,
				basis_contract_hash: created.payload.contract_hash,
				policy_hash: policy.policy_hash,
				assessment_id: "assess",
				assessment_input_hash: digest,
				decision: "parallel",
				lanes: [lane, laneTwo],
				selected_provider: "native_agents",
				rationale_codes: ["disjoint"],
				evidence_refs: ["plan"],
			},
		};
		const withAssessment = [
			...baseRecords,
			ledgerRecord(assessment, baseRecords.at(-1)!.record_hash),
		];
		const forged = structuredClone(outcomeBeforeAssessment);
		if (forged.kind !== "work_delegation_outcome_recorded")
			throw new Error("fixture");
		forged.event_id = "forged_failure";
		forged.payload.assessment_id = "assess";
		expect(() =>
			validateWorkLedgerSemantics([
				...withAssessment,
				ledgerRecord(forged, withAssessment.at(-1)!.record_hash),
			]),
		).toThrow(/fingerprint mismatch/);
	});

	it("fails closed on canonical replay kinds with missing or unknown schemas", () => {
		const { root, ledgerPath } = temporaryLedger();
		const created = creation();
		appendContractSource(root, ledgerPath, created, null);
		const records = readWorkLedger(ledgerPath).records;
		for (const [eventId, payload] of [
			["missing_schema", {}],
			["unknown_schema", { schema_version: "anamnesis.future-unknown.v1" }],
		] as const) {
			const malformed: WorkLedgerRecord = {
				...records.at(-1)!,
				event_id: eventId,
				kind: "work_review_requested",
				payload,
			};
			expect(() =>
				validateWorkLedgerSemantics([...records, malformed]),
			).toThrow(/exact schema discriminator/);
		}
		const futureUnknown: WorkLedgerRecord = {
			...records.at(-1)!,
			event_id: "future_unknown",
			kind: "work_future_observation",
			payload: { schema_version: "anamnesis.work-future-observation.v1" },
		};
		expect(() =>
			validateWorkLedgerSemantics([...records, futureUnknown]),
		).not.toThrow();
	});
});
