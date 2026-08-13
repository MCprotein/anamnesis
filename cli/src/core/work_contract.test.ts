import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendTypedWorkEvent,
	calculateWorkContractHash,
	type TypedWorkEvent,
	type WorkContractDefinition,
} from "./work_contract.js";
import { appendWorkLedger, readWorkLedger } from "./work_ledger.js";
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

describe("typed Work contract", () => {
	it("accepts exact +1 revisions and separates progress from contract revision", () => {
		const { root, ledgerPath } = temporaryLedger();
		const created = creation();
		const first = appendContractSource(root, ledgerPath, created, null);
		const revisedContract = contract(2);
		revisedContract.boundary.reason_codes.push("reviewed");
		const revisedHash = calculateWorkContractHash(revisedContract);
		const revised = appendContractSource(root, ledgerPath, {
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
			}, first.head);
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
		expect(() => appendTypedWorkEvent({ ledgerPath, expectedHead: revised.head, event: progressEvent })).toThrow(/official source publication API/);
		publishAndAppendTypedWorkSourceEvent({
			source: { stateRoot: root, eventId: "src_progress", capturedAt: "2026-08-13T00:00:02.000Z", client: "test", contentType: "text/plain", fidelity: "native_exact", allocationStatus: "allocated", body: "progress evidence" },
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
				appendContractSource(root, ledgerPath, {
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
					}, first.head),
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
		const created = appendContractSource(typed.root, typed.ledgerPath, creation(), null);
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
		expect(() => publishAndAppendTypedWorkSourceEvent({
			source: { stateRoot: root, eventId: "src_one", capturedAt: "x", client: "test", contentType: "text/plain", fidelity: "native_exact", allocationStatus: "allocated", body: "exact" },
			ledgerPath,
			expectedHead: null,
			ledgerEvent: { event_id: "untyped", occurred_at: "x", kind: "work_created", payload: { work_id: "wu_one" } },
		})).toThrow(/schema|typed Work event/);
		expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
	});

	it("cannot bypass typed semantic validation through generic source publication", () => {
		const { root, ledgerPath } = temporaryLedger();
		expect(() => publishAndAppendWorkSourceEvent({
			source: { stateRoot: root, eventId: "src_one", capturedAt: "2026-08-13T00:00:00.000Z", client: "test", contentType: "text/plain", fidelity: "native_exact", allocationStatus: "allocated", body: "exact" },
			ledgerPath,
			expectedHead: null,
			ledgerEvent: creation(2),
		})).toThrow(/canonical typed source publication API|exactly 1/);
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
		expect(() => calculateWorkContractHash(self)).toThrow(/superseded_by|itself/);

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
		expect(appendContractSource(root, ledgerPath, event, first.head).idempotent).toBe(false);

		const mutated = structuredClone(revised);
		mutated.policy_snapshot = createWorkPolicySnapshot(3, resolveWorkPolicy([]));
		mutated.requirements[0]!.summary = "rewritten meaning";
		const bad = structuredClone(event);
		bad.event_id = "rev_mutated";
		bad.payload.contract_revision = 3;
		bad.payload.previous_contract_revision = 2;
		bad.payload.previous_contract_hash = event.payload.contract_hash;
		bad.payload.contract = mutated;
		bad.payload.contract_hash = calculateWorkContractHash(mutated);
		expect(() => appendContractSource(root, ledgerPath, bad, readWorkLedger(ledgerPath).head)).toThrow(/immutable/);
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
		expect(() => appendContractSource(root, ledgerPath, event, first.head)).toThrow(
			/multiple superseding requirements/,
		);
	});

	it("locks and validates prior plus newly published sources for additive revisions", () => {
		const { root, ledgerPath } = temporaryLedger();
		const initial = contract(1);
		initial.requirements[0]!.source_event_ids = ["src_old"];
		const created = creation();
		created.payload.contract = initial;
		created.payload.contract_hash = calculateWorkContractHash(initial);
		const first = publishAndAppendTypedWorkSourceEvent({
			source: { stateRoot: root, eventId: "src_old", capturedAt: "2026-08-13T00:00:00.000Z", client: "test", contentType: "text/plain", fidelity: "native_exact", allocationStatus: "allocated", body: "old" },
			ledgerPath, ledgerEvent: created, expectedHead: null,
		}).ledger;
		const revised = contract(2);
		revised.requirements[0]!.source_event_ids = ["src_old"];
		revised.requirements.push({ id: "req_new", summary: "new", source_event_ids: ["src_new"] });
		const revisedHash = calculateWorkContractHash(revised);
		const result = publishAndAppendTypedWorkSourceEvent({
			source: { stateRoot: root, eventId: "src_new", capturedAt: "2026-08-13T00:01:00.000Z", client: "test", contentType: "text/plain", fidelity: "native_exact", allocationStatus: "allocated", body: "new" },
			ledgerPath,
			expectedHead: first.head,
			ledgerEvent: {
				event_id: "rev_sources", occurred_at: "2026-08-13T00:01:00.000Z", kind: "work_contract_revised",
				payload: { schema_version: "anamnesis.work-contract-event.v1", work_id: "wu_one", contract_revision: 2, previous_contract_revision: 1, previous_contract_hash: created.payload.contract_hash, contract_hash: revisedHash, contract: revised },
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

		expect(() =>
			appendContractSource(root, ledgerPath, created, null),
		).toThrow(/metadata changed|envelope/);
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
			source: { stateRoot: root, eventId: "src_old", capturedAt: "2026-08-13T00:00:00.000Z", client: "original", contentType: "text/plain", fidelity: "native_exact", allocationStatus: "allocated", body: "old" },
			ledgerPath, ledgerEvent: created, expectedHead: null,
		}).ledger;
		const envelopePath = path.join(root, "work-inputs", "events", "src_old.yaml");
		const envelope = JSON.parse(fs.readFileSync(envelopePath, "utf8"));
		envelope.client = "rewritten";
		const canonical = (value: unknown): string => {
			if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
			if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
			return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
		};
		fs.writeFileSync(envelopePath, `${canonical(envelope)}\n`);
		const revised = contract(2);
		revised.requirements[0]!.source_event_ids = ["src_old"];
		revised.requirements.push({ id: "req_new", summary: "new", source_event_ids: ["src_new"] });
		expect(() => publishAndAppendTypedWorkSourceEvent({
			source: { stateRoot: root, eventId: "src_new", capturedAt: "2026-08-13T00:01:00.000Z", client: "test", contentType: "text/plain", fidelity: "native_exact", allocationStatus: "allocated", body: "new" },
			ledgerPath, expectedHead: first.head,
			ledgerEvent: { event_id: "rev_metadata", occurred_at: "x", kind: "work_contract_revised", payload: { schema_version: "anamnesis.work-contract-event.v1", work_id: "wu_one", contract_revision: 2, previous_contract_revision: 1, previous_contract_hash: created.payload.contract_hash, contract_hash: calculateWorkContractHash(revised), contract: revised } },
		})).toThrow(/metadata changed/);
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
				payload: { schema_version: "anamnesis.work-progress-event.v1", work_id: "wu_one", requirement_id: "req_one", basis_contract_hash: created.payload.contract_hash, status: "waived", evidence_refs: [] },
			},
			{
				event_id: "close_bad",
				occurred_at: "x",
				kind: "work_lifecycle_changed",
				payload: { schema_version: "anamnesis.work-lifecycle-event.v1", work_id: "wu_one", basis_contract_hash: created.payload.contract_hash, lifecycle: "completed" },
			},
		] as TypedWorkEvent[]) {
			expect(() => appendTypedWorkEvent({ ledgerPath, expectedHead: first.head, event })).toThrow(/waived|lifecycle/);
		}
	});

	it("canonicalizes set-like contract arrays and rejects semantic reorder revisions", () => {
		const left = contract(1);
		left.boundary.reason_codes = ["z", "a"];
		left.requirements.push({ id: "req_two", summary: "two", source_event_ids: ["src_z", "src_a"] });
		const right = structuredClone(left);
		right.boundary.reason_codes.reverse();
		right.requirements.reverse();
		right.requirements.find((item) => item.id === "req_two")!.source_event_ids.reverse();
		expect(calculateWorkContractHash(right)).toBe(calculateWorkContractHash(left));
	});

	it("rejects mixed inverse supersession linkage", () => {
		const mixed = contract(1);
		mixed.requirements.push({ id: "req_two", summary: "two", source_event_ids: ["src_one"], supersedes: ["req_one"] });
		mixed.requirements[0]!.superseded_by = "req_two";
		expect(() => calculateWorkContractHash(mixed)).toThrow(/canonical supersedes linkage/);
	});
});
