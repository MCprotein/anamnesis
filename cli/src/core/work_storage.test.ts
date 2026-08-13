import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256 } from "../util/hash.js";
import {
	appendCanonicalTypedWorkProgressEvent,
	migrateLegacyWorkSourceEnvelopeBindings,
	publishAndAppendCanonicalTypedWorkSourceEvent,
  publishAndAppendWorkSourceEvent,
  publishWorkSourceEvent,
  resolveWorkStateRoot,
  type WorkSourceEventInput,
  type WorkStoragePublicationPhase,
  withWorkSourceEventLock,
} from "./work_storage.js";
import { readWorkLedger } from "./work_ledger.js";

function temporaryDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sourceInput(stateRoot: string, body: string | Buffer): WorkSourceEventInput {
  return {
    stateRoot,
    eventId: "evt_01test",
    capturedAt: "2026-08-13T00:00:00.000Z",
    client: "codex",
    contentType: "text/plain; charset=utf-8",
    fidelity: "native_exact",
    allocationStatus: "allocated",
    body,
  };
}

describe("work source storage", () => {
	it("keeps source-free progress on a canonical Work path and rejects source authority", () => {
		const root = temporaryDirectory("anamnesis-work-progress-lane-");
		const baseEvent = {
			event_id: "progress_01",
			occurred_at: "2026-08-13T00:00:00.000Z",
			kind: "work_requirement_transitioned",
			payload: {
				schema_version: "anamnesis.work-progress-event.v1",
				work_id: "wu_01",
				requirement_id: "req_01",
				basis_contract_hash: sha256("contract"),
				status: "in_progress",
				evidence_refs: [],
			},
		};
		expect(() =>
			appendCanonicalTypedWorkProgressEvent({
				stateRoot: root,
				ledgerPath: path.join(root, "outside.jsonl"),
				ledgerEvent: baseEvent,
				expectedHead: null,
			}),
		).toThrow("ledger path is not canonical");
		expect(() =>
			appendCanonicalTypedWorkProgressEvent({
				stateRoot: root,
				ledgerPath: path.join(root, "work-units/wu_01/ledger.jsonl"),
				ledgerEvent: {
					...baseEvent,
					payload: { ...baseEvent.payload, source_event_id: "src_forbidden" },
				},
				expectedHead: null,
			}),
		).toThrow("cannot contain source references");
	});

  it("preserves exact bytes and durably publishes the body before its envelope", () => {
    const root = temporaryDirectory("anamnesis-work-source-");
    const body = Buffer.from("first\r\n둘째 😀\r\n", "utf8");
    const phases: WorkStoragePublicationPhase[] = [];

    const result = publishWorkSourceEvent(sourceInput(root, body), {
      onPublicationPhase: (phase) => phases.push(phase),
    });

    expect(fs.readFileSync(result.object_path)).toEqual(body);
    expect(result.envelope.object_hash).toBe(sha256(body));
    expect(phases).toEqual([
      "body-temp-written",
      "body-temp-synced",
      "body-renamed",
      "body-directory-synced",
      "envelope-temp-written",
      "envelope-temp-synced",
      "envelope-renamed",
      "envelope-directory-synced",
    ]);
    expect(fs.readFileSync(result.envelope_path, "utf8")).toContain(
      '"object_path":"work-inputs/objects/evt_01test.txt"',
    );
  });

  it("is idempotent for identical events and fails closed on an ID collision", () => {
    const root = temporaryDirectory("anamnesis-work-source-id-");
    const first = publishWorkSourceEvent(sourceInput(root, "original\r\n"));
    const duplicate = publishWorkSourceEvent(sourceInput(root, "original\r\n"));

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(() => publishWorkSourceEvent(sourceInput(root, "rewritten\n"))).toThrow(
      /ID collision/,
    );
    expect(fs.readFileSync(first.object_path, "utf8")).toBe("original\r\n");
  });

	it("rejects an unallocated immutable source envelope status", () => {
		const root = temporaryDirectory("anamnesis-work-source-status-");
		expect(() => publishWorkSourceEvent({
			...sourceInput(root, "body"),
			allocationStatus: "unallocated",
		} as WorkSourceEventInput)).toThrow(/allocated or provisional/);
		expect(fs.existsSync(path.join(root, "work-inputs"))).toBe(false);
	});

  it("can resume envelope publication after a crash seam leaves a durable body", () => {
    const root = temporaryDirectory("anamnesis-work-source-resume-");
    const input = sourceInput(root, "body");
    expect(() =>
      publishWorkSourceEvent(input, {
        onPublicationPhase: (phase) => {
          if (phase === "body-directory-synced") throw new Error("injected crash");
        },
      }),
    ).toThrow("injected crash");

    const resumed = publishWorkSourceEvent(input);
    expect(resumed.created).toBe(true);
    expect(fs.existsSync(resumed.envelope_path)).toBe(true);
  });

  it("uses the project state root for non-Git projects and rejects missing roots", () => {
    const root = temporaryDirectory("anamnesis-work-root-");
    const resolved = resolveWorkStateRoot(root);
    const canonicalRoot = fs.realpathSync(root);

    expect(resolved.state_root).toBe(path.join(canonicalRoot, ".anamnesis"));
    expect(resolved.worktree_root).toBe(canonicalRoot);
    expect(resolved.source).toBe("project");
    expect(() => resolveWorkStateRoot(path.join(root, "missing"))).toThrow(
      /unavailable/,
    );
  });

  it("fails closed when a Git marker exists but canonical Git state is broken", () => {
    const root = temporaryDirectory("anamnesis-work-broken-git-");
    fs.writeFileSync(path.join(root, ".git"), "gitdir: /missing/git-state\n");

    expect(() => resolveWorkStateRoot(root)).toThrow(
      /cannot establish canonical Git worktree state root/,
    );
  });

  it("shares the primary state root across linked worktrees but fingerprints each", () => {
    const root = temporaryDirectory("anamnesis-work-git-");
    const primary = path.join(root, "primary");
    const linked = path.join(root, "linked");
    fs.mkdirSync(primary);
    git(primary, ["init"]);
    git(primary, ["config", "user.name", "Test"]);
    git(primary, ["config", "user.email", "test@example.invalid"]);
    fs.writeFileSync(path.join(primary, "README.md"), "test\n");
    git(primary, ["add", "README.md"]);
    git(primary, ["commit", "-m", "initial"]);
    git(primary, ["worktree", "add", linked, "-b", "linked"]);

    const primaryRoot = resolveWorkStateRoot(primary);
    const linkedRoot = resolveWorkStateRoot(linked);
    expect(linkedRoot.state_root).toBe(primaryRoot.state_root);
    expect(linkedRoot.state_root).toBe(
      path.join(fs.realpathSync(primary), ".anamnesis"),
    );
    expect(linkedRoot.worktree_fingerprint).not.toBe(
      primaryRoot.worktree_fingerprint,
    );
    expect(linkedRoot.source).toBe("git-primary-worktree");
  });

  it("bounds source-event lock acquisition", () => {
    const root = temporaryDirectory("anamnesis-work-source-lock-");
    const lock = path.join(root, "work-inputs", ".locks", "evt_01test");
    fs.mkdirSync(lock, { recursive: true });

    expect(() =>
      publishWorkSourceEvent(sourceInput(root, "body"), {
        lockTimeoutMs: 5,
        lockRetryMs: 1,
      }),
    ).toThrow(/timed out/);
  });

  it("commits a source allocation only after the published source revalidates", () => {
    const root = temporaryDirectory("anamnesis-work-allocation-");
    const ledgerPath = path.join(root, "work-units", "wu_01", "ledger.jsonl");
    const result = publishAndAppendWorkSourceEvent({
      source: sourceInput(root, "exact\r\nsource"),
      ledgerPath,
      ledgerEvent: {
        event_id: "allocation_01",
        occurred_at: "2026-08-13T00:00:01.000Z",
        kind: "source_allocated",
      },
      expectedHead: null,
    });

    expect(result.ledger.idempotent).toBe(false);
    expect(readWorkLedger(ledgerPath).records[0]!.payload).toMatchObject({
      source_event_id: "evt_01test",
      source_object_hash: result.source.envelope.object_hash,
    });
  });

  it("leaves the ledger unchanged when source durability publication fails", () => {
    const root = temporaryDirectory("anamnesis-work-allocation-fault-");
    const ledgerPath = path.join(root, "work-units", "wu_01", "ledger.jsonl");

    expect(() =>
      publishAndAppendWorkSourceEvent(
        {
          source: sourceInput(root, "exact source"),
          ledgerPath,
          ledgerEvent: {
            event_id: "allocation_01",
            occurred_at: "2026-08-13T00:00:01.000Z",
            kind: "source_allocated",
          },
          expectedHead: null,
        },
        {
          onPublicationPhase: (phase) => {
            if (phase === "body-temp-synced") throw new Error("source fault");
          },
        },
      ),
    ).toThrow("source fault");
    expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
  });

  it("fails closed if a published body disappears before ledger commit", () => {
    const root = temporaryDirectory("anamnesis-work-allocation-missing-");
    const ledgerPath = path.join(root, "work-units", "wu_01", "ledger.jsonl");
    expect(() =>
      publishAndAppendWorkSourceEvent(
        {
          source: sourceInput(root, "exact source"),
          ledgerPath,
          ledgerEvent: {
            event_id: "allocation_01",
            occurred_at: "2026-08-13T00:00:01.000Z",
            kind: "source_allocated",
          },
          expectedHead: null,
        },
        { onSourcePublished: (source) => fs.unlinkSync(source.object_path) },
      ),
    ).toThrow(/is not published/);
    expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
  });

  it("fails closed if published source bytes are tampered before ledger commit", () => {
    const root = temporaryDirectory("anamnesis-work-allocation-tamper-");
    const ledgerPath = path.join(root, "work-units", "wu_01", "ledger.jsonl");
    expect(() =>
      publishAndAppendWorkSourceEvent(
        {
          source: sourceInput(root, "exact source"),
          ledgerPath,
          ledgerEvent: {
            event_id: "allocation_01",
            occurred_at: "2026-08-13T00:00:01.000Z",
            kind: "source_allocated",
          },
          expectedHead: null,
        },
        {
          onSourcePublished: (source) =>
            fs.writeFileSync(source.object_path, "tampered"),
        },
      ),
    ).toThrow(/object hash mismatch/);
    expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
  });

  it("rejects redirected and non-canonical published envelopes", () => {
    for (const mutation of ["redirect", "extra"] as const) {
      const root = temporaryDirectory(`anamnesis-work-envelope-${mutation}-`);
      const ledgerPath = path.join(root, "work-units", "wu_01", "ledger.jsonl");
      expect(() => publishAndAppendWorkSourceEvent(
        {
          source: sourceInput(root, "exact source"), ledgerPath,
          ledgerEvent: { event_id: `allocation_${mutation}`, occurred_at: "2026-08-13T00:00:01.000Z", kind: "source_allocated" }, expectedHead: null,
        },
        { onSourcePublished: (source) => {
          const envelope = JSON.parse(fs.readFileSync(source.envelope_path, "utf8"));
          if (mutation === "redirect") envelope.object_path = "work-inputs/objects/other.txt";
          else envelope.extra = true;
          fs.writeFileSync(source.envelope_path, `${JSON.stringify(envelope)}\n`);
        } },
      )).toThrow(/envelope|object path/);
      expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
    }
  });

  it("rejects malformed ledger events before publication", () => {
    for (const field of ["event_id", "occurred_at", "kind"] as const) {
      const root = temporaryDirectory(`anamnesis-work-malformed-${field}-`);
      const ledgerPath = path.join(root, "work-units", "wu_01", "ledger.jsonl");
      const ledgerEvent = { event_id: "event", occurred_at: "time", kind: "source_allocated" };
      ledgerEvent[field] = "";
      expect(() => publishAndAppendWorkSourceEvent({ source: sourceInput(root, "exact"), ledgerPath, ledgerEvent, expectedHead: null })).toThrow(/requires event_id/);
      expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
      expect(fs.existsSync(path.join(root, "work-inputs", "events", "evt_01test.yaml"))).toBe(false);
    }
  });

  it("requires explicit migration for legacy source records without envelope bindings", () => {
    const root = temporaryDirectory("anamnesis-work-legacy-binding-");
    const ledgerPath = path.join(root, "work-units", "wu_01", "ledger.jsonl");
    const old = publishWorkSourceEvent({ ...sourceInput(root, "old"), eventId: "old" });
    const unsigned = {
      schema_version: "anamnesis.work-ledger.v1", event_id: "legacy", occurred_at: "x", kind: "source_allocated",
      payload: { source_event_id: "old", source_object_hash: old.envelope.object_hash, source_object_path: old.envelope.object_path }, previous_hash: null,
    } as const;
    const record = { ...unsigned, record_hash: sha256(Buffer.from(canonicalTestJson(unsigned), "utf8")) };
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(ledgerPath, `${canonicalTestJson(record)}\n`);
    const input = {
      source: { ...sourceInput(root, "new"), eventId: "new" }, ledgerPath, expectedHead: record.record_hash,
      ledgerEvent: { event_id: "next", occurred_at: "x", kind: "source_allocated", payload: { source_event_ids: ["old"] } },
    };
		expect(() => publishAndAppendWorkSourceEvent(input)).toThrow(/explicit legacy envelope binding migration/);
		expect(() => publishAndAppendWorkSourceEvent(input, { allowLegacyEnvelopeBindingMigration: true } as never)).toThrow(/explicit legacy envelope binding migration/);
		const migrated = migrateLegacyWorkSourceEnvelopeBindings({ stateRoot: root, ledgerPath, eventId: "binding-migration", occurredAt: "x", expectedHead: record.record_hash });
		expect(migrated.idempotent).toBe(false);
		expect(migrated.record.payload.source_envelope_bindings).toEqual([
			{ source_event_id: "old", source_envelope_hash: sha256(fs.readFileSync(old.envelope_path)) },
		]);
		const next = {
			source: { ...sourceInput(root, "later"), eventId: "later" }, ledgerPath, expectedHead: migrated.head,
			ledgerEvent: { event_id: "later-event", occurred_at: "x", kind: "source_allocated", payload: { source_event_ids: ["old"] } },
		};
		expect(publishAndAppendWorkSourceEvent(next).ledger.idempotent).toBe(false);
		const envelope = JSON.parse(fs.readFileSync(old.envelope_path, "utf8"));
		envelope.client = "tampered-after-migration";
		fs.writeFileSync(old.envelope_path, `${canonicalTestJson(envelope)}\n`);
		const afterTamper = {
			source: { ...sourceInput(root, "last"), eventId: "last" }, ledgerPath, expectedHead: readWorkLedger(ledgerPath).head,
			ledgerEvent: { event_id: "last-event", occurred_at: "x", kind: "source_allocated", payload: { source_event_ids: ["old"] } },
		};
		expect(() => publishAndAppendWorkSourceEvent(afterTamper, { allowLegacyEnvelopeBindingMigration: true } as never)).toThrow(/metadata changed/);
  });

  it("rejects caller-supplied envelope binding payloads", () => {
		for (const publish of [publishAndAppendWorkSourceEvent, publishAndAppendCanonicalTypedWorkSourceEvent]) {
			const root = temporaryDirectory("anamnesis-work-forged-binding-");
			expect(() => publish({
				source: sourceInput(root, "exact"), ledgerPath: path.join(root, "ledger.jsonl"), expectedHead: null,
				ledgerEvent: { event_id: "forged", occurred_at: "x", kind: "source_allocated", payload: { source_envelope_bindings: [{ source_event_id: "x", source_envelope_hash: `sha256:${"0".repeat(64)}` }] } },
			})).toThrow(/reserved/);
		}
	});

	it("rejects forged historical bindings on non-migration records", () => {
		const root = temporaryDirectory("anamnesis-work-forged-history-");
		const ledgerPath = path.join(root, "ledger.jsonl");
		const unsigned = {
			schema_version: "anamnesis.work-ledger.v1", event_id: "forged-note", occurred_at: "x", kind: "note",
			payload: { source_envelope_bindings: [{ source_event_id: "old", source_envelope_hash: `sha256:${"0".repeat(64)}` }] }, previous_hash: null,
		} as const;
		const record = { ...unsigned, record_hash: sha256(Buffer.from(canonicalTestJson(unsigned), "utf8")) };
		fs.writeFileSync(ledgerPath, `${canonicalTestJson(record)}\n`);
		expect(() => publishAndAppendWorkSourceEvent({
			source: sourceInput(root, "new"), ledgerPath, expectedHead: record.record_hash,
			ledgerEvent: { event_id: "next", occurred_at: "x", kind: "source_allocated" },
		})).toThrow(/reserved for migration records/);
	});

	it.each([
		["wrong-schema", { schema_version: "wrong", source_envelope_bindings: [{ source_event_id: "a", source_envelope_hash: `sha256:${"0".repeat(64)}` }] }],
		["extra-key", { schema_version: "anamnesis.source-envelope-bindings.v1", source_envelope_bindings: [{ source_event_id: "a", source_envelope_hash: `sha256:${"0".repeat(64)}` }], extra: true }],
		["empty", { schema_version: "anamnesis.source-envelope-bindings.v1", source_envelope_bindings: [] }],
		["unsorted", { schema_version: "anamnesis.source-envelope-bindings.v1", source_envelope_bindings: [{ source_event_id: "z", source_envelope_hash: `sha256:${"0".repeat(64)}` }, { source_event_id: "a", source_envelope_hash: `sha256:${"1".repeat(64)}` }] }],
	] as const)("rejects malformed historical migration payload: %s", (_name, payload) => {
		const root = temporaryDirectory("anamnesis-work-malformed-migration-");
		const ledgerPath = path.join(root, "ledger.jsonl");
		const unsigned = { schema_version: "anamnesis.work-ledger.v1", event_id: "migration", occurred_at: "x", kind: "source_envelope_bindings_migrated", payload, previous_hash: null } as const;
		const record = { ...unsigned, record_hash: sha256(Buffer.from(canonicalTestJson(unsigned), "utf8")) };
		fs.writeFileSync(ledgerPath, `${canonicalTestJson(record)}\n`);
		expect(() => publishAndAppendWorkSourceEvent({ source: sourceInput(root, "new"), ledgerPath, expectedHead: record.record_hash, ledgerEvent: { event_id: "next", occurred_at: "x", kind: "source_allocated" } })).toThrow(/migration|bindings|schema|sorted/);
	});

  it("rejects a symlinked managed input ancestor", () => {
    const root = temporaryDirectory("anamnesis-work-source-symlink-");
    const victim = temporaryDirectory("anamnesis-work-source-victim-");
    fs.symlinkSync(victim, path.join(root, "work-inputs"));

    expect(() => publishWorkSourceEvent(sourceInput(root, "secret"))).toThrow(
      /symbolic link/,
    );
    expect(fs.readdirSync(victim)).toHaveLength(0);
  });

  it("creates source directories and files with private permissions", () => {
    const root = temporaryDirectory("anamnesis-work-source-mode-");
    const result = publishWorkSourceEvent(sourceInput(root, "private"));

    expect(fs.statSync(path.dirname(result.object_path)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(result.object_path).mode & 0o777).toBe(0o600);
    expect(fs.statSync(result.envelope_path).mode & 0o777).toBe(0o600);
  });

  it("holds the source lock while acquiring and committing the Work ledger", () => {
    const root = temporaryDirectory("anamnesis-work-source-order-");
    const canonicalRoot = fs.realpathSync(root);
    const ledgerPath = path.join(root, "work-units", "wu_01", "ledger.jsonl");
    const lockPath = path.join(canonicalRoot, "work-inputs", ".locks", "evt_01test");
    let purgeBlocked = false;

    publishAndAppendWorkSourceEvent(
      {
        source: sourceInput(root, "protected"),
        ledgerPath,
        ledgerEvent: {
          event_id: "allocation_01",
          occurred_at: "2026-08-13T00:00:01.000Z",
          kind: "source_allocated",
        },
        expectedHead: null,
      },
      {
        onSourcePublished: () => {
          try {
            withWorkSourceEventLock(
              lockPath,
              { lockTimeoutMs: 5, lockRetryMs: 1 },
              () => fs.unlinkSync(path.join(root, "work-inputs", "objects", "evt_01test.txt")),
            );
          } catch (error) {
            purgeBlocked = (error as Error).message.includes("timed out");
          }
        },
      },
    );

    expect(purgeBlocked).toBe(true);
    expect(readWorkLedger(ledgerPath).records).toHaveLength(1);
  });

  it("reclaims a durable source lock after its owner process crashes", async () => {
    const root = temporaryDirectory("anamnesis-work-source-crash-");
    const lockPath = path.join(
      fs.realpathSync(root),
      "work-inputs",
      ".locks",
      "evt_01test",
    );
    const readyPath = path.join(root, "ready");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const modulePath = fileURLToPath(new URL("./work_storage.ts", import.meta.url));
    const child = spawn(process.execPath, ["--import", "tsx", "--eval", `
      import { withWorkSourceEventLock } from ${JSON.stringify(modulePath)};
      import fs from "node:fs";
      withWorkSourceEventLock(${JSON.stringify(lockPath)}, {}, () => {
        fs.writeFileSync(${JSON.stringify(readyPath)}, "locked");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
      });
    `], { stdio: ["ignore", "pipe", "pipe"] });
    await waitForFile(readyPath, child);
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.kill("SIGKILL");
    await closed;

    expect(publishWorkSourceEvent(sourceInput(root, "after crash"), {
      lockTimeoutMs: 2_000,
    }).created).toBe(true);
  }, 15_000);
});

function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

async function waitForFile(
  filePath: string,
  child: ReturnType<typeof spawn>,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(filePath)) {
    if (child.exitCode !== null) throw new Error("lock-holder exited before ready");
    if (Date.now() >= deadline) throw new Error("lock-holder readiness timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function canonicalTestJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalTestJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalTestJson(item)}`).join(",")}}`;
}
