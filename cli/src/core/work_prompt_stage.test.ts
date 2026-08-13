import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
	calculateWorkContractHash,
	type TypedWorkEvent,
	type WorkContractDefinition,
} from "./work_contract.js";
import { readWorkLedger } from "./work_ledger.js";
import { normalizeWorkPromptCapturePolicy } from "./work_prompt_policy.js";
import {
	allocateStagedWorkPromptToTypedWork,
	assertWorkPromptStagePrivacyBoundary,
	bindRetainedProvisionalPromptToTypedWork,
	deriveWorkPromptCaptureId,
	deriveWorkPromptSourceEventId,
	discardStagedWorkPrompt,
	gcStagedWorkPrompts,
	readStagedWorkPrompt,
	readWorkPromptStageBinding,
	readWorkPromptStageOutcome,
	retainStagedWorkPromptProvisional,
	stageWorkPrompt,
} from "./work_prompt_stage.js";
import { createWorkPolicySnapshot, resolveWorkPolicy } from "./work_policy.js";
import { withWorkSourceEventLock } from "./work_storage.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function fixture(ignore = true) {
	const project = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-prompt-stage-"),
	);
	roots.push(project);
	execFileSync("git", ["-C", project, "init"], { stdio: "ignore" });
	if (ignore)
		fs.writeFileSync(
			path.join(project, ".gitignore"),
			".anamnesis/work-prompt-stage/\n.anamnesis/work-inputs/\n",
		);
	const stateRoot = path.join(project, ".anamnesis");
	const policy = normalizeWorkPromptCapturePolicy({
		preset: "bounded",
		ttl: "PT1H",
		max_entry_bytes: 1024,
		max_total_bytes: 2048,
		max_entries: 2,
	});
	return { project, stateRoot, policy };
}

function staged(
	overrides: Partial<Parameters<typeof stageWorkPrompt>[0]> = {},
) {
	const base = fixture();
	const input = {
		projectRoot: base.project,
		stateRoot: base.stateRoot,
		policy: base.policy,
		client: "codex",
		sessionId: "session-one",
		boundaryId: "turn-one",
		capturedAt: "2026-08-14T00:00:00.000Z",
		contentType: "text/plain; charset=utf-8",
		fidelity: "native_exact" as const,
		body: Buffer.from("첫째\r\nsecond 😀\n", "utf8"),
		...overrides,
	};
	return { ...base, input, captureId: deriveWorkPromptCaptureId(input) };
}

function creation(sourceId: string): TypedWorkEvent {
	const contract: WorkContractDefinition = {
		work: {
			id: "wu_stage",
			title: "Stage Work",
			completion_contract: "Requirement verified",
		},
		boundary: {
			state: "accepted",
			classification: "same_unit",
			reason_codes: ["explicit"],
			confidence: "high",
		},
		policy_snapshot: createWorkPolicySnapshot(1, resolveWorkPolicy([])),
		requirements: [
			{
				id: "req_stage",
				summary: "preserve raw prompt",
				source_event_ids: [sourceId],
			},
		],
		open_conflicts: [],
	};
	return {
		event_id: "ledger_stage_create",
		occurred_at: "2026-08-14T00:01:00.000Z",
		kind: "work_created",
		payload: {
			schema_version: "anamnesis.work-contract-event.v1",
			work_id: "wu_stage",
			contract_revision: 1,
			previous_contract_revision: null,
			previous_contract_hash: null,
			contract_hash: calculateWorkContractHash(contract),
			contract,
		},
	};
}

describe("Work prompt staging", () => {
	it("fails closed unless both raw staging and retained inputs are ignored", () => {
		const missing = fixture(false);
		expect(() =>
			assertWorkPromptStagePrivacyBoundary(missing.project, missing.stateRoot),
		).toThrow(/privacy boundary/);
		fs.writeFileSync(
			path.join(missing.project, ".gitignore"),
			".anamnesis/work-prompt-stage/\n",
		);
		expect(() =>
			assertWorkPromptStagePrivacyBoundary(missing.project, missing.stateRoot),
		).toThrow(/privacy boundary/);
		fs.appendFileSync(
			path.join(missing.project, ".gitignore"),
			".anamnesis/work-inputs/\n",
		);
		expect(() =>
			assertWorkPromptStagePrivacyBoundary(missing.project, missing.stateRoot),
		).not.toThrow();
	});

	it("derives opaque identity IDs independent of body and preserves exact Buffer bytes privately", () => {
		const item = staged();
		const first = stageWorkPrompt(item.input);
		const duplicate = stageWorkPrompt({
			...item.input,
			capturedAt: "2026-08-14T00:00:01.000Z",
		});
		expect(first.created).toBe(true);
		expect(duplicate.created).toBe(false);
		expect(first.body).toEqual(item.input.body);
		expect(first.record.capture_id).toBe(item.captureId);
		expect(duplicate.record.captured_at).toBe(first.record.captured_at);
		expect(item.captureId).not.toContain("first");
		expect(
			fs.statSync(path.join(item.stateRoot, "work-prompt-stage")).mode & 0o777,
		).toBe(0o700);
		expect(
			fs.statSync(
				path.join(
					item.stateRoot,
					"work-prompt-stage/bodies",
					`${item.captureId}.bin`,
				),
			).mode & 0o777,
		).toBe(0o600);
		expect(() =>
			stageWorkPrompt({ ...item.input, body: Buffer.from("different") }),
		).toThrow(/collision/);
	});

	it("enforces default-off, entry, total-byte, and entry-count budgets", () => {
		const item = staged();
		expect(() =>
			stageWorkPrompt({
				...item.input,
				policy: normalizeWorkPromptCapturePolicy(),
			}),
		).toThrow(/policy is off/);
		expect(() =>
			stageWorkPrompt({ ...item.input, body: Buffer.alloc(1025) }),
		).toThrow(/max_entry_bytes/);
		stageWorkPrompt({ ...item.input, body: Buffer.alloc(1024) });
		stageWorkPrompt({
			...item.input,
			boundaryId: "turn-two",
			body: Buffer.alloc(1024),
		});
		expect(() =>
			stageWorkPrompt({
				...item.input,
				boundaryId: "turn-three",
				body: Buffer.alloc(1),
			}),
		).toThrow(/budget exceeded/);
	});

	it("does not acquire durable stage locks for live GC metadata entries", () => {
		const item = staged();
		const policy = normalizeWorkPromptCapturePolicy({
			preset: "bounded",
			ttl: "PT1H",
			max_entry_bytes: 1024,
			max_total_bytes: 8192,
			max_entries: 8,
		});
		for (let index = 0; index < 4; index += 1) {
			stageWorkPrompt({
				...item.input,
				policy,
				boundaryId: `live-${index}`,
				body: index === 0 ? Buffer.alloc(0) : item.input.body,
			});
		}
		let acquiredSourceLocks = 0;
		stageWorkPrompt(
			{
				...item.input,
				policy,
				boundaryId: "fresh",
			},
			{
				onSourceLockAcquired: () => {
					acquiredSourceLocks += 1;
				},
			},
		);

		expect(acquiredSourceLocks).toBe(1);
	});

	it("writes a terminal discard receipt before deletion and recovers cleanup after a crash seam", () => {
		const item = staged();
		stageWorkPrompt(item.input);
		expect(() =>
			discardStagedWorkPrompt(
				{
					stateRoot: item.stateRoot,
					captureId: item.captureId,
					resolvedAt: "2026-08-14T00:02:00.000Z",
					reason: "interruption",
				},
				{
					onResolutionPhase: (phase) => {
						if (phase === "outcome-persisted") throw new Error("crash");
					},
				},
			),
		).toThrow("crash");
		expect(readStagedWorkPrompt(item.stateRoot, item.captureId)).toBeDefined();
		const recovered = discardStagedWorkPrompt({
			stateRoot: item.stateRoot,
			captureId: item.captureId,
			resolvedAt: "2026-08-14T00:03:00.000Z",
			reason: "interruption",
		});
		expect(recovered.outcome).toBe("discarded");
		expect(readWorkPromptStageOutcome(item.stateRoot, item.captureId)).toEqual(
			recovered,
		);
		expect("body_hash" in recovered).toBe(false);
		expect(
			readStagedWorkPrompt(item.stateRoot, item.captureId),
		).toBeUndefined();
		expect(() =>
			retainStagedWorkPromptProvisional({
				stateRoot: item.stateRoot,
				captureId: item.captureId,
				resolvedAt: "2026-08-14T00:04:00.000Z",
				boundaryState: "provisional",
				classification: "interruption",
				reasonCodes: ["unclear"],
			}),
		).toThrow(/outcome conflict/);
	});

	it("allows private non-Git roots and requires ignore coverage in an external Git worktree", () => {
		const nonGit = fs.mkdtempSync(
			path.join(os.tmpdir(), "anamnesis-stage-nongit-"),
		);
		roots.push(nonGit);
		expect(() =>
			assertWorkPromptStagePrivacyBoundary(
				nonGit,
				path.join(nonGit, ".anamnesis"),
			),
		).not.toThrow();
		const item = fixture(false);
		const external = fs.mkdtempSync(
			path.join(os.tmpdir(), "anamnesis-stage-external-"),
		);
		roots.push(external);
		execFileSync("git", ["-C", external, "init"], { stdio: "ignore" });
		expect(() =>
			assertWorkPromptStagePrivacyBoundary(item.project, external),
		).toThrow(/privacy boundary/);
		fs.writeFileSync(
			path.join(external, ".gitignore"),
			"work-prompt-stage/\nwork-inputs/\n",
		);
		expect(() =>
			assertWorkPromptStagePrivacyBoundary(item.project, external),
		).not.toThrow();
	});

	it("fails closed when a Git marker exists but Git verification is unavailable", () => {
		const item = fixture(false);
		const priorPath = process.env.PATH;
		process.env.PATH = "";
		try {
			expect(() =>
				assertWorkPromptStagePrivacyBoundary(item.project, item.stateRoot),
			).toThrow(/privacy boundary could not be verified/);
		} finally {
			if (priorPath === undefined) delete process.env.PATH;
			else process.env.PATH = priorPath;
		}
	});

	it("fails closed for a broken Git worktree marker", () => {
		const root = fs.mkdtempSync(
			path.join(os.tmpdir(), "anamnesis-stage-broken-git-"),
		);
		roots.push(root);
		fs.writeFileSync(path.join(root, ".git"), "not a gitdir\n");

		expect(() =>
			assertWorkPromptStagePrivacyBoundary(root, path.join(root, ".anamnesis")),
		).toThrow(/privacy boundary could not be verified/);
	});

	it("garbage-collects only expired unresolved stages in deterministic order", () => {
		const item = staged();
		const older = stageWorkPrompt({
			...item.input,
			boundaryId: "old",
			capturedAt: "2026-08-14T00:00:00.000Z",
		});
		const newer = stageWorkPrompt({
			...item.input,
			boundaryId: "new",
			capturedAt: "2026-08-14T00:10:00.000Z",
		});
		const result = gcStagedWorkPrompts(
			item.stateRoot,
			item.policy,
			Date.parse("2026-08-14T02:00:00.000Z"),
		);
		expect(result.removed).toEqual([
			older.record.capture_id,
			newer.record.capture_id,
		]);
		expect(result.skipped_indeterminate).toEqual([]);
	});

	it("skips a live stage lock and removes the expired stage after release", () => {
		const item = staged();
		const entry = stageWorkPrompt(item.input);
		const lockPath = path.join(
			fs.realpathSync(item.stateRoot),
			"work-prompt-stage/.locks",
			entry.record.capture_id,
		);
		withWorkSourceEventLock(lockPath, {}, () => {
			const during = gcStagedWorkPrompts(
				item.stateRoot,
				item.policy,
				Date.parse("2026-08-14T02:00:00.000Z"),
			);
			expect(during.removed).toEqual([]);
			expect(during.skipped_locked).toEqual([entry.record.capture_id]);
		});
		const after = gcStagedWorkPrompts(
			item.stateRoot,
			item.policy,
			Date.parse("2026-08-14T02:00:00.000Z"),
		);
		expect(after.removed).toEqual([entry.record.capture_id]);
	});

	it("uses terminal outcomes as GC cleanup receipts after a crash", () => {
		const item = staged();
		const entry = stageWorkPrompt(item.input);
		expect(() =>
			discardStagedWorkPrompt(
				{
					stateRoot: item.stateRoot,
					captureId: entry.record.capture_id,
					resolvedAt: "2026-08-14T00:02:00.000Z",
					reason: "interruption",
				},
				{
					onResolutionPhase: (phase) => {
						if (phase === "outcome-persisted") throw new Error("crash");
					},
				},
			),
		).toThrow("crash");

		const result = gcStagedWorkPrompts(
			item.stateRoot,
			item.policy,
			Date.parse("2026-08-14T02:00:00.000Z"),
		);
		expect(result.removed).toEqual([entry.record.capture_id]);
		expect(
			readStagedWorkPrompt(item.stateRoot, entry.record.capture_id),
		).toBeUndefined();
	});

	it("reclaims expired orphan bodies and corrupt partial stages", () => {
		const item = staged();
		const orphan = stageWorkPrompt(item.input);
		const corrupt = stageWorkPrompt({
			...item.input,
			boundaryId: "corrupt-partial",
		});
		const stageRoot = path.join(item.stateRoot, "work-prompt-stage");
		const orphanBody = path.join(
			stageRoot,
			"bodies",
			`${orphan.record.capture_id}.bin`,
		);
		fs.unlinkSync(
			path.join(stageRoot, "records", `${orphan.record.capture_id}.json`),
		);
		fs.utimesSync(orphanBody, new Date(0), new Date(0));

		const corruptRecord = path.join(
			stageRoot,
			"records",
			`${corrupt.record.capture_id}.json`,
		);
		const corruptBody = path.join(
			stageRoot,
			"bodies",
			`${corrupt.record.capture_id}.bin`,
		);
		fs.writeFileSync(corruptRecord, "{broken\n", { mode: 0o600 });
		fs.utimesSync(corruptRecord, new Date(0), new Date(0));
		fs.utimesSync(corruptBody, new Date(0), new Date(0));

		const result = gcStagedWorkPrompts(
			item.stateRoot,
			item.policy,
			Date.parse("2026-08-14T02:00:00.000Z"),
		);
		expect(result.removed).toEqual([
			orphan.record.capture_id,
			corrupt.record.capture_id,
		].sort());
		expect(fs.existsSync(orphanBody)).toBe(false);
		expect(fs.existsSync(corruptBody)).toBe(false);
		expect(fs.existsSync(corruptRecord)).toBe(false);
	});

	it("reclaims stale durable-publication temp files without a daemon", () => {
		const item = staged();
		stageWorkPrompt(item.input);
		const stageRoot = path.join(item.stateRoot, "work-prompt-stage");
		const tempCaptureId = deriveWorkPromptCaptureId({
			client: "codex",
			sessionId: "session-one",
			boundaryId: "temp-crash",
		});
		const tempPath = path.join(
			stageRoot,
			"bodies",
			`.${tempCaptureId}.bin.999999.deadbeef.tmp`,
		);
		fs.writeFileSync(tempPath, "private partial", { mode: 0o600 });
		fs.utimesSync(tempPath, new Date(0), new Date(0));

		const result = gcStagedWorkPrompts(
			item.stateRoot,
			item.policy,
			Date.parse("2026-08-14T02:00:00.000Z"),
		);
		expect(result.removed).toContain(tempCaptureId);
		expect(fs.existsSync(tempPath)).toBe(false);
	});

	it("rejects symlink traversal before writing raw bytes", () => {
		const item = staged();
		fs.mkdirSync(item.stateRoot, { recursive: true });
		const outside = fs.mkdtempSync(
			path.join(os.tmpdir(), "anamnesis-stage-outside-"),
		);
		roots.push(outside);
		fs.symlinkSync(outside, path.join(item.stateRoot, "work-prompt-stage"));
		expect(() => stageWorkPrompt(item.input)).toThrow(
			/symbolic link|privacy boundary/,
		);
		expect(fs.readdirSync(outside)).toEqual([]);
	});

	it("allocates staged bytes through the typed Work path with exact idempotent retry", () => {
		const item = staged();
		stageWorkPrompt(item.input);
		const sourceId = deriveWorkPromptSourceEventId(item.captureId);
		const ledgerPath = path.join(
			item.stateRoot,
			"work-units/wu_stage/ledger.jsonl",
		);
		const input = {
			stateRoot: item.stateRoot,
			captureId: item.captureId,
			resolvedAt: "2026-08-14T00:02:00.000Z",
			decision: "allocate_new" as const,
			workId: "wu_stage",
			ledgerPath,
			ledgerEvent: creation(sourceId),
			expectedHead: null,
		};
		expect(() =>
			allocateStagedWorkPromptToTypedWork(input, {
				onResolutionPhase: (phase) => {
					if (phase === "resolution-effect-committed")
						throw new Error("allocation receipt crash");
				},
			}),
		).toThrow("allocation receipt crash");
		const first = allocateStagedWorkPromptToTypedWork(input);
		const retry = allocateStagedWorkPromptToTypedWork(input);
		expect(retry).toEqual(first);
		expect(readWorkLedger(ledgerPath).records).toHaveLength(1);
		expect(
			fs.readFileSync(
				path.join(item.stateRoot, "work-inputs/objects", `${sourceId}.txt`),
			),
		).toEqual(item.input.body);
		expect(() =>
			allocateStagedWorkPromptToTypedWork({
				...input,
				decision: "allocate_same",
			}),
		).toThrow(/assertion conflict/);
	});

	it("retains provisional source once and later binds it without envelope mutation", () => {
		const item = staged();
		stageWorkPrompt(item.input);
		const outcome = retainStagedWorkPromptProvisional({
			stateRoot: item.stateRoot,
			captureId: item.captureId,
			resolvedAt: "2026-08-14T00:02:00.000Z",
			boundaryState: "needs_user",
			classification: "same_unit",
			reasonCodes: ["ambiguous_completion_contract"],
			question: "Does this belong to the current Work?",
		});
		const envelopePath = path.join(
			item.stateRoot,
			"work-inputs/events",
			`${outcome.source_event_id}.yaml`,
		);
		const before = fs.readFileSync(envelopePath);
		const ledgerPath = path.join(
			item.stateRoot,
			"work-units/wu_stage/ledger.jsonl",
		);
		const bindInput = {
			stateRoot: item.stateRoot,
			captureId: item.captureId,
			boundAt: "2026-08-14T00:03:00.000Z",
			decision: "allocate_same" as const,
			workId: "wu_stage",
			ledgerPath,
			ledgerEvent: creation(outcome.source_event_id!),
			expectedHead: null,
		};
		expect(() =>
			bindRetainedProvisionalPromptToTypedWork({
				...bindInput,
				ledgerPath: path.join(item.stateRoot, "outside-ledger.jsonl"),
			}),
		).toThrow(/ledger path is not canonical/);
		expect(fs.existsSync(path.join(item.stateRoot, "outside-ledger.jsonl"))).toBe(
			false,
		);
		expect(() =>
			bindRetainedProvisionalPromptToTypedWork(bindInput, {
				onResolutionPhase: (phase) => {
					if (phase === "binding-work-committed")
						throw new Error("binding receipt crash");
				},
			}),
		).toThrow("binding receipt crash");
		const binding = bindRetainedProvisionalPromptToTypedWork(bindInput);
		expect(readWorkPromptStageBinding(item.stateRoot, item.captureId)).toEqual(
			binding,
		);
		expect(fs.readFileSync(envelopePath)).toEqual(before);
		expect(JSON.parse(before.toString("utf8")).allocation_status).toBe(
			"provisional",
		);
		expect(readWorkLedger(ledgerPath).records).toHaveLength(1);
		expect(() =>
			bindRetainedProvisionalPromptToTypedWork({
				...bindInput,
				decision: "allocate_new",
			}),
		).toThrow(/binding assertion conflict/);
		expect(() =>
			retainStagedWorkPromptProvisional({
				stateRoot: item.stateRoot,
				captureId: item.captureId,
				resolvedAt: "2026-08-14T00:03:00.000Z",
				boundaryState: "needs_user",
				classification: "new_unit",
				reasonCodes: ["different"],
			}),
		).toThrow(/assertion conflict/);
	});
});
