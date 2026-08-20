import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256 } from "../util/hash.js";
import {
  appendWorkLedger,
  canonicalWorkLedgerRecord,
  readWorkLedger,
  recoverWorkLedger,
  validateWorkLedger,
	WORK_TYPED_EVENT_KIND_SCHEMA_PAIRS,
  type WorkLedgerEvent,
} from "./work_ledger.js";

function temporaryLedger(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-work-ledger-")),
    "ledger.jsonl",
  );
}

function event(id: string, payload: Record<string, unknown> = {}): WorkLedgerEvent {
  return {
    event_id: id,
    occurred_at: "2026-08-13T00:00:00.000Z",
    kind: "requirement_recorded",
    payload,
  };
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
		.join(",")}}`;
}

describe("work ledger", () => {
	it("fails closed through the generic appender for typed schemas and every execution-evidence kind", () => {
		const executionEvidenceKinds = new Set([
			"work_review_requested",
			"work_review_attempt_recorded",
			"work_parallelism_assessed",
			"work_delegation_outcome_recorded",
			"work_delegation_waived",
		]);
		for (const [kind, schema_version] of Object.entries(WORK_TYPED_EVENT_KIND_SCHEMA_PAIRS)) {
			const payloads = executionEvidenceKinds.has(kind)
				? [{ schema_version }, {}, { schema_version: "unknown.v1" }]
				: [{ schema_version }];
			for (const payload of payloads) {
				const ledgerPath = temporaryLedger();
				expect(() => appendWorkLedger({
					ledgerPath,
					expectedHead: null,
					event: { event_id: `evt_${kind}`, occurred_at: "x", kind, payload },
				})).toThrow(/typed Work append API/);
				expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
			}
			const wrongKindLedger = temporaryLedger();
			expect(() => appendWorkLedger({
				ledgerPath: wrongKindLedger,
				expectedHead: null,
				event: { event_id: `evt_schema_${kind}`, occurred_at: "x", kind: "unknown_kind", payload: { schema_version } },
			})).toThrow(/typed Work append API/);
		}
	});

	it("preserves schema-less legacy Work events on the generic surface", () => {
		const ledgerPath = temporaryLedger();
		const result = appendWorkLedger({
			ledgerPath,
			expectedHead: null,
			event: {
				event_id: "evt_legacy_created",
				occurred_at: "2026-08-13T00:00:00.000Z",
				kind: "work_created",
				payload: { work_id: "wu_legacy" },
			},
		});
		expect(result.idempotent).toBe(false);
		expect(readWorkLedger(ledgerPath).records).toHaveLength(1);
	});

	it("rejects an exact typed retry before generic duplicate success", () => {
		const ledgerPath = temporaryLedger();
		const typedEvent: WorkLedgerEvent = {
			event_id: "evt_typed_retry",
			occurred_at: "x",
			kind: "work_review_requested",
			payload: { schema_version: "anamnesis.work-review-request-event.v1" },
		};
		const unsigned = {
			schema_version: "anamnesis.work-ledger.v1",
			...typedEvent,
			previous_hash: null,
		};
		const record = {
			...unsigned,
			record_hash: sha256(Buffer.from(canonicalJson(unsigned), "utf8")),
		};
		fs.writeFileSync(ledgerPath, `${canonicalJson(record)}\n`);
		expect(readWorkLedger(ledgerPath).records).toHaveLength(1);
		expect(() => appendWorkLedger({ ledgerPath, event: typedEvent, expectedHead: null })).toThrow(/typed Work append API/);
		expect(readWorkLedger(ledgerPath).records).toHaveLength(1);
	});
	it.each([
		["event_id", "   "],
		["occurred_at", 123],
		["kind", "\t"],
	] as const)("rejects malformed runtime %s before commit", (field, value) => {
		const ledgerPath = temporaryLedger();
		const malformed = event("bad") as unknown as Record<string, unknown>;
		malformed[field] = value;
		expect(() => appendWorkLedger({ ledgerPath, event: malformed as unknown as WorkLedgerEvent, expectedHead: null })).toThrow(/requires event_id/);
		expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
	});

	it("rejects committed whitespace identifiers during read validation", () => {
		const ledgerPath = temporaryLedger();
		fs.writeFileSync(ledgerPath, `${JSON.stringify({ schema_version: "anamnesis.work-ledger.v1", event_id: " ", occurred_at: "x", kind: "test", payload: {}, previous_hash: null, record_hash: `sha256:${"0".repeat(64)}` })}\n`);
		expect(() => readWorkLedger(ledgerPath)).toThrow(/invalid work ledger record/);
	});
  it("does not export forgeable unlocked or canonical typed append capabilities", async () => {
    const module = await import("./work_ledger.js") as Record<string, unknown>;
    expect(module.appendWorkLedgerUnlocked).toBeUndefined();
    expect(module.appendCanonicalTypedWorkLedger).toBeUndefined();
  });
  it("appends canonical hash-linked records and reads a validated contract", () => {
    const ledgerPath = temporaryLedger();
    const first = appendWorkLedger({
      ledgerPath,
      event: event("evt_01", { z: 1, nested: { b: true, a: "first" } }),
      expectedHead: null,
    });
    const second = appendWorkLedger({
      ledgerPath,
      event: event("evt_02", { requirement_id: "req_02" }),
      expectedHead: first.head,
    });

    const read = readWorkLedger(ledgerPath);
    expect(read.head).toBe(second.head);
    expect(read.records).toHaveLength(2);
    expect(read.records[1]!.previous_hash).toBe(first.head);
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe(
      `${read.records.map(canonicalWorkLedgerRecord).join("\n")}\n`,
    );
  });

  it("enforces expected-head CAS but permits an identical idempotent retry", () => {
    const ledgerPath = temporaryLedger();
    const firstEvent = event("evt_01", { requirement_id: "req_01" });
    const first = appendWorkLedger({
      ledgerPath,
      event: firstEvent,
      expectedHead: null,
    });

    const retry = appendWorkLedger({
      ledgerPath,
      event: firstEvent,
      expectedHead: null,
    });
    expect(retry.idempotent).toBe(true);
    expect(retry.head).toBe(first.head);
    expect(() =>
      appendWorkLedger({
        ledgerPath,
        event: event("evt_02"),
        expectedHead: null,
      }),
    ).toThrow(/head conflict/);
  });

  it("returns the unchanged current head when retrying an older event", () => {
    const ledgerPath = temporaryLedger();
    const firstEvent = event("evt_01");
    const first = appendWorkLedger({
      ledgerPath,
      event: firstEvent,
      expectedHead: null,
    });
    const second = appendWorkLedger({
      ledgerPath,
      event: event("evt_02"),
      expectedHead: first.head,
    });

    const retry = appendWorkLedger({
      ledgerPath,
      event: firstEvent,
      expectedHead: null,
    });
    expect(retry.idempotent).toBe(true);
    expect(retry.head).toBe(second.head);
    expect(readWorkLedger(ledgerPath).records).toHaveLength(2);
  });

  it("does not expose a record when a pre-publication fault is injected", () => {
    const ledgerPath = temporaryLedger();
    expect(() =>
      appendWorkLedger({
        ledgerPath,
        event: event("evt_01"),
        expectedHead: null,
        onBeforeLedgerSync: () => {
          throw new Error("injected fault");
        },
      }),
    ).toThrow("injected fault");
    expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
  });

  it("fails closed when an event ID is reused with different canonical content", () => {
    const ledgerPath = temporaryLedger();
    appendWorkLedger({
      ledgerPath,
      event: event("evt_01", { value: 1 }),
      expectedHead: null,
    });

    expect(() =>
      appendWorkLedger({
        ledgerPath,
        event: event("evt_01", { value: 2 }),
        expectedHead: null,
      }),
    ).toThrow(/ID collision/);
  });

  it("rejects source references without a publication precondition", () => {
    const ledgerPath = temporaryLedger();
    expect(() =>
      appendWorkLedger({
        ledgerPath,
        event: event("evt_01", { source_event_id: "missing" }),
        expectedHead: null,
      }),
		).toThrow(/official source publication API/);
    expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
  });

  it("recursively rejects alternate source-reference shapes without a precondition", () => {
    const payloads = [
      { source_event_ids: ["missing"] },
      { nested: { source_object_hash: "sha256:missing" } },
      { refs: [{ source_object_path: "work-inputs/objects/missing.txt" }] },
    ];
    for (const [index, payload] of payloads.entries()) {
      const ledgerPath = temporaryLedger();
      expect(() =>
        appendWorkLedger({
          ledgerPath,
          event: event(`evt_${index}`, payload),
          expectedHead: null,
        }),
			).toThrow(/official source publication API/);
      expect(readWorkLedger(ledgerPath).records).toHaveLength(0);
    }
  });

  it("recovers only a non-newline final tail", () => {
    const ledgerPath = temporaryLedger();
    const first = appendWorkLedger({
      ledgerPath,
      event: event("evt_01"),
      expectedHead: null,
    });
    fs.appendFileSync(ledgerPath, '{"event_id":"torn"');

    expect(() => readWorkLedger(ledgerPath)).toThrow(/uncommitted/);
    const recovered = recoverWorkLedger({ ledgerPath });
    expect(recovered.recovered).toBe(true);
    expect(recovered.truncated_bytes).toBeGreaterThan(0);
    expect(recovered.head).toBe(first.head);
    expect(readWorkLedger(ledgerPath).records).toHaveLength(1);
  });

  it("fails closed on newline-terminated invalid JSON and interior corruption", () => {
    const invalidJson = temporaryLedger();
    fs.mkdirSync(path.dirname(invalidJson), { recursive: true });
    fs.writeFileSync(invalidJson, "not-json\n");
    expect(() => recoverWorkLedger({ ledgerPath: invalidJson })).toThrow(
      /invalid work ledger JSON/,
    );

    const interior = temporaryLedger();
    const first = appendWorkLedger({
      ledgerPath: interior,
      event: event("evt_01"),
      expectedHead: null,
    });
    appendWorkLedger({
      ledgerPath: interior,
      event: event("evt_02"),
      expectedHead: first.head,
    });
    const lines = fs.readFileSync(interior, "utf8").split("\n");
    lines[0] = lines[0]!.replace("requirement_recorded", "requirement_tampered");
    fs.writeFileSync(interior, lines.join("\n"));
    expect(() => validateWorkLedger(interior)).toThrow(/hash mismatch/);
    expect(() => recoverWorkLedger({ ledgerPath: interior })).toThrow(
      /hash mismatch/,
    );
  });

  it("treats a complete record without its commit newline as an uncommitted tail", () => {
    const ledgerPath = temporaryLedger();
    const appended = appendWorkLedger({
      ledgerPath,
      event: event("evt_01"),
      expectedHead: null,
    });
    fs.truncateSync(ledgerPath, fs.statSync(ledgerPath).size - 1);

    const recovered = recoverWorkLedger({ ledgerPath });
    expect(recovered.records).toHaveLength(0);
    expect(recovered.head).toBeNull();
    expect(recovered.truncated_bytes).toBeGreaterThan(0);
    expect(appended.head).not.toBeNull();
  });

  it("allows only one concurrent writer to win the same expected head", async () => {
    const ledgerPath = temporaryLedger();
    const modulePath = fileURLToPath(new URL("./work_ledger.ts", import.meta.url));
    const results = await Promise.all([
      concurrentAppend(modulePath, ledgerPath, "evt_a"),
      concurrentAppend(modulePath, ledgerPath, "evt_b"),
    ]);

    expect(results.filter((result) => result === "ok")).toHaveLength(1);
    expect(results.filter((result) => result.includes("head conflict"))).toHaveLength(1);
    expect(readWorkLedger(ledgerPath).records).toHaveLength(1);
  }, 15_000);

  it("bounds local writer lock acquisition", () => {
    const ledgerPath = temporaryLedger();
    fs.mkdirSync(`${ledgerPath}.lock`, { recursive: true });
    expect(() =>
      appendWorkLedger({
        ledgerPath,
        event: event("evt_01"),
        expectedHead: null,
        lockTimeoutMs: 5,
        lockRetryMs: 1,
      }),
    ).toThrow(/timed out/);
  });

	it("cannot forge source integrity with a caller callback", () => {
		const ledgerPath = temporaryLedger();
		const sourceEvent = event("evt_01", { source_event_id: "source_01" });
		expect(() =>
			appendWorkLedger({
				ledgerPath,
				event: sourceEvent,
				expectedHead: null,
				sourcePrecondition: () => {
					// Deliberately forged no-op/unused callback.
				},
			} as Parameters<typeof appendWorkLedger>[0]),
		).toThrow(/official source publication API/);
	});

  it("rejects invalid UTF-8 bytes even when newline terminated", () => {
    const ledgerPath = temporaryLedger();
    fs.writeFileSync(ledgerPath, Buffer.from([0x7b, 0xff, 0x7d, 0x0a]));
    expect(() => validateWorkLedger(ledgerPath)).toThrow(/invalid UTF-8/);
    expect(() => recoverWorkLedger({ ledgerPath })).toThrow(/invalid UTF-8/);
  });

  it("rejects symlinked ledger files without modifying the external victim", () => {
    const ledgerPath = temporaryLedger();
    const victim = path.join(temporaryLedger(), "..", "victim.jsonl");
    fs.writeFileSync(victim, "external\n");
    fs.symlinkSync(victim, ledgerPath);

    expect(() =>
      appendWorkLedger({ ledgerPath, event: event("evt_01"), expectedHead: null }),
    ).toThrow(/symbolic link/);
    expect(fs.readFileSync(victim, "utf8")).toBe("external\n");
  });

  it("creates the ledger and managed directories with private permissions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-work-mode-"));
    const ledgerPath = path.join(root, "work-units", "wu_01", "ledger.jsonl");
    appendWorkLedger({ ledgerPath, event: event("evt_01"), expectedHead: null });

    expect(fs.statSync(path.dirname(ledgerPath)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(ledgerPath).mode & 0o777).toBe(0o600);
  });

  it("reclaims a durable ledger lock only after its owner process dies", async () => {
    const ledgerPath = temporaryLedger();
    const modulePath = fileURLToPath(new URL("./work_ledger.ts", import.meta.url));
    const child = await spawnLockHolder(`
      import { withWorkLedgerLock } from ${JSON.stringify(modulePath)};
      withWorkLedgerLock(${JSON.stringify(ledgerPath)}, {}, () => {
        process.stdout.write("locked\\n");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
      });
    `);
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("close", () => resolve()));

    const appended = appendWorkLedger({
      ledgerPath,
      event: event("evt_after_crash"),
      expectedHead: null,
      lockTimeoutMs: 2_000,
    });
    expect(appended.idempotent).toBe(false);
  }, 15_000);
});

function concurrentAppend(
  modulePath: string,
  ledgerPath: string,
  eventId: string,
): Promise<string> {
  const source = `
    import { appendWorkLedger } from ${JSON.stringify(modulePath)};
    try {
      appendWorkLedger({
        ledgerPath: ${JSON.stringify(ledgerPath)},
        event: { event_id: ${JSON.stringify(eventId)}, occurred_at: "2026-08-13T00:00:00.000Z", kind: "test", payload: {} },
        expectedHead: null,
      });
      process.stdout.write("ok");
    } catch (error) {
      process.stdout.write(error instanceof Error ? error.message : String(error));
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--eval", source], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr));
      else resolve(stdout);
    });
  });
}

function spawnLockHolder(source: string): Promise<ReturnType<typeof spawn>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--eval", source], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.stdout.once("data", (chunk) => {
      if (String(chunk).includes("locked")) resolve(child);
      else reject(new Error(`unexpected lock-holder output: ${String(chunk)}`));
    });
    child.once("close", (code) => {
      if (code !== null && code !== 0 && code !== 137) reject(new Error(stderr));
    });
  });
}
