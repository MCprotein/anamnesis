import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newWorkCursor, readWorkCursor, writeWorkCursorAtomic } from "../core/work_cursor.js";
import { resolveWorkStateRoot } from "../core/work_storage.js";
import {
  amendWork,
  closeWork,
  createWork,
  statusWork,
  transitionWork,
} from "./work.js";
import * as workModule from "./work.js";
import { deriveWorkHookCursorId } from "./work_hook.js";
import { handleWorkCompactionResume } from "./work_compaction.js";

const roots: string[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const tsxCli = path.join(repositoryRoot, "node_modules/tsx/dist/cli.mjs");
const anamnesisCli = path.join(repositoryRoot, "cli/src/index.ts");
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(preset = "frequent", bindCursor = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-compact-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, "Agentfile"), JSON.stringify({
    version: 2, project: { name: "compact" }, tools: ["codex"], fragments: [],
    settings: { work_policy: { reconciliation: { preset }, review: { preset: "off" } } },
  }));
  const created = createWork({
    project_root: root, work_id: "wu_compact", event_id: "evt_create",
    occurred_at: "2026-09-06T00:00:00.000Z",
    draft: Buffer.from(JSON.stringify({
      work: { title: "Resume safely", completion_contract: "Tests pass and changes reviewed" },
      boundary: { state: "accepted", classification: "new_unit", reason_codes: ["explicit_user_requirement"], confidence: "high" },
      requirements: [{ id: "req_one", summary: "Preserve latest requirement", source_event_ids: ["src_create"] }], open_conflicts: [],
    })),
    source_stdin: { event_id: "src_create", captured_at: "2026-09-06T00:00:00.000Z", client: "codex", content_type: "text/plain; charset=utf-8", fidelity: "native_exact", allocation_status: "allocated", body: Buffer.from("private original prompt") },
  });
  const state = resolveWorkStateRoot(root);
  const cursor = newWorkCursor({
    cursor_id: deriveWorkHookCursorId("codex", "session"), client_session_ref: "session",
    worktree_fingerprint: state.worktree_fingerprint, updated_at: "2026-09-06T00:00:00.000Z",
    truth: { work_id: "wu_compact", revision: created.projection.contract_revision, last_event_id: created.projection.last_event_id, projection_hash: created.projection.projection_hash },
  });
  if (bindCursor) writeWorkCursorAtomic(state.state_root, cursor, { expectedCursorRevision: null });
  return { root, cursor, state };
}

function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      result[path.relative(root, file)] = fs.readFileSync(file).toString("base64");
    }
  }
  return result;
}

function resume(root: string, payload: unknown = { source: "compact", session_id: "session" }) {
  return handleWorkCompactionResume({ project_root: root, client: "codex", payload });
}

describe("read-only Work compaction recovery", () => {
  it.each([false, true])("follows advertised native onboarding through CLI selection and compact recovery (existing unbound: %s)", (existingUnbound) => {
    const { root, state } = fixture("frequent", false);
    const sessionId = " native ' $(touch INJECTED) `touch INJECTED` session ";
    const cursorId = deriveWorkHookCursorId("codex", sessionId);
    const cli = (args: string[], payload?: unknown) => spawnSync(process.execPath,
      [tsxCli, anamnesisCli, "work", ...args, "--project-root", root],
      { cwd: root, encoding: "utf8", input: payload === undefined ? undefined : JSON.stringify(payload) });
    if (existingUnbound) {
      const selected = cli(["switch", "--work", "wu_compact", "--session", cursorId]);
      expect(selected.status, selected.stderr).toBe(0);
      expect(readWorkCursor(state.state_root, cursorId).cursor?.client_session_ref).toBeNull();
    }
    const compactPayload = { source: "compact", session_id: sessionId };
    expect(resume(root, compactPayload).context).toBeNull();
    const ledgerBefore = statusWork({ project_root: root, work_id: "wu_compact" }).projection.ledger_head;
    const onboarding = cli(["hook-user-prompt", "--client", "codex"], {
      session_id: sessionId, turn_id: "turn-1", prompt: "continue",
    });
    expect(onboarding.status, onboarding.stderr).toBe(0);
    expect(onboarding.stdout).toContain("locator, not Work authority");
    if (existingUnbound) {
      expect(onboarding.stdout).toContain("until explicit rebind");
      expect(onboarding.stdout).toContain("Preserve latest requirement");
      const repeated = cli(["hook-user-prompt", "--client", "codex"], {
        session_id: sessionId, turn_id: "turn-1", prompt: "continue",
      });
      expect(repeated.status, repeated.stderr).toBe(0);
      expect(repeated.stdout).toContain("until explicit rebind");
      expect(repeated.stdout).not.toContain("Preserve latest requirement");
    }
    // The hook must not establish a binding or choose a Work itself.
    expect(readWorkCursor(state.state_root, cursorId).cursor?.client_session_ref ?? null).toBeNull();
    const advertised = onboarding.stdout.split("\n").find((line) => line.startsWith("anamnesis work switch "));
    expect(advertised).toBeDefined();
    // Execute the actual advertised shell quoting, replacing only the explicit Work placeholder.
    const selected = spawnSync("/bin/sh", ["-c", `anamnesis() { "$ANAMNESIS_TEST_NODE" "$ANAMNESIS_TEST_TSX" "$ANAMNESIS_TEST_CLI" "$@"; }\n${advertised!.replace("<id>", "wu_compact")}`], {
      cwd: root, encoding: "utf8", env: { ...process.env,
        ANAMNESIS_TEST_NODE: process.execPath, ANAMNESIS_TEST_TSX: tsxCli, ANAMNESIS_TEST_CLI: anamnesisCli },
    });
    expect(selected.status, selected.stderr).toBe(0);
    const bound = readWorkCursor(state.state_root, cursorId).cursor!;
    expect(bound.client_session_ref).toBe(sessionId);
    expect(bound.work_id).toBe("wu_compact");
    expect(bound.worktree_fingerprint).toBe(state.worktree_fingerprint);
    expect(fs.existsSync(path.join(root, "INJECTED"))).toBe(false);
    if (existingUnbound) {
      for (const refFlags of [["--client-session-ref", sessionId], []]) {
        const repeated = cli(["switch", "--work", "wu_compact", "--session", cursorId, ...refFlags]);
        expect(repeated.status, repeated.stderr).toBe(0);
        expect(readWorkCursor(state.state_root, cursorId).cursor?.client_session_ref).toBe(sessionId);
      }
    }
    const beforeCompact = snapshot(root);
    const recovered = cli(["hook-session-start", "--client", "codex"], compactPayload);
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(recovered.stdout).toContain("Preserve latest requirement");
    expect(recovered.stdout).toContain("Cancellation/pause/redirection overrides this snapshot");
    expect(snapshot(root)).toEqual(beforeCompact);
    expect(statusWork({ project_root: root, work_id: "wu_compact" }).projection.ledger_head).toBe(ledgerBefore);
  });

  it.each(["another-session", " session"])("rejects exact native binding mismatch %j without overwriting it", (wrongRef) => {
    const { root, cursor, state } = fixture();
    writeWorkCursorAtomic(state.state_root, { ...cursor, client_session_ref: wrongRef });
    const before = snapshot(root);
    expect(resume(root).context).toBeNull();
    const selected = spawnSync(process.execPath, [tsxCli, anamnesisCli, "work", "switch",
      "--project-root", root, "--work", "wu_compact", "--session", cursor.cursor_id,
      "--client-session-ref", "session"], { cwd: root, encoding: "utf8" });
    expect(selected.status).toBe(1);
    expect(selected.stderr).toContain("bound to another client session");
    expect(snapshot(root)).toEqual(before);
  });

  it("rejects explicit binding of another worktree's unbound cursor without mutation", () => {
    const { root, cursor, state } = fixture();
    writeWorkCursorAtomic(state.state_root, { ...cursor, client_session_ref: null, worktree_fingerprint: `sha256:${"0".repeat(64)}` });
    const before = snapshot(root);
    const selected = spawnSync(process.execPath, [tsxCli, anamnesisCli, "work", "switch",
      "--project-root", root, "--work", "wu_compact", "--session", cursor.cursor_id,
      "--client-session-ref", "session"], { cwd: root, encoding: "utf8" });
    expect(selected.status).toBe(1);
    expect(selected.stderr).toContain("belongs to another worktree");
    expect(snapshot(root)).toEqual(before);
    expect(resume(root).context).toBeNull();
  });

  it("restores the unchanged contract on every compact without mutating state or capturing prompts", () => {
    const { root } = fixture();
    const before = snapshot(root);
    const first = resume(root, { source: "compact", session_id: "session", prompt: "must not be staged", transcript_path: "/untrusted" });
    expect(first.context).toContain("Tests pass and changes reviewed");
    expect(first.context).toContain("Preserve latest requirement");
    expect(first.context).toContain("continue the same task subject to the latest user request");
    expect(first.context).toContain("Cancellation/pause/redirection overrides this snapshot");
    expect(first.context).not.toContain("private original prompt");
    expect(resume(root)).toEqual(first);
    expect(snapshot(root)).toEqual(before);
  });
  it("does not guess another session's Work or act on ordinary startup", () => {
    const { root } = fixture();
    for (const payload of [{ source: "compact", session_id: "other" }, { source: "startup", session_id: "session" }, { source: "compact" }]) {
      expect(resume(root, payload).context).toBeNull();
    }
  });
  it("respects reconciliation off and rejects a mismatched worktree cursor", () => {
    expect(resume(fixture("off").root).context).toBeNull();
    const { root, cursor, state } = fixture();
    writeWorkCursorAtomic(state.state_root, { ...cursor, worktree_fingerprint: `sha256:${"0".repeat(64)}` });
    expect(resume(root).context).toBeNull();
  });

  it("restores the latest amended projection even when the cursor truth is unchanged", () => {
    const { root } = fixture();
    const current = statusWork({ project_root: root, work_id: "wu_compact" });
    amendWork({
      project_root: root,
      work_id: "wu_compact",
      event_id: "evt_amend",
      occurred_at: "2026-09-06T00:01:00.000Z",
      expected_head: current.projection.ledger_head,
      draft: Buffer.from(JSON.stringify({
        work: { title: "Resume safely", completion_contract: "Tests pass and changes reviewed" },
        boundary: { state: "accepted", classification: "same_unit", reason_codes: ["explicit_user_requirement"], confidence: "high" },
        requirements: [
          { id: "req_one", summary: "Preserve latest requirement", source_event_ids: ["src_create"] },
          { id: "req_two", summary: "Restore amended requirement", source_event_ids: ["src_amend"] },
        ],
        open_conflicts: [],
      })),
      source_stdin: {
        event_id: "src_amend",
        captured_at: "2026-09-06T00:01:00.000Z",
        client: "codex",
        content_type: "text/plain; charset=utf-8",
        fidelity: "native_exact",
        allocation_status: "allocated",
        body: Buffer.from("private amended prompt"),
      },
    });

    const result = resume(root);
    expect(result.context).toContain("Restore amended requirement");
    expect(result.context).not.toContain("private amended prompt");
  });

  it("retries when an amendment lands after the first projection fold", () => {
    const { root } = fixture();
    const original = workModule.statusWork;
    let amended = false;
    const status = vi.spyOn(workModule, "statusWork").mockImplementation((input) => {
      const result = original(input);
      if (!amended) {
        amended = true;
        amendWork({
          project_root: root,
          work_id: "wu_compact",
          event_id: "evt_racing_amend",
          occurred_at: "2026-09-06T00:01:00.000Z",
          expected_head: result.projection.ledger_head,
          draft: Buffer.from(JSON.stringify({
            work: { title: "Resume safely", completion_contract: "Tests pass and changes reviewed" },
            boundary: { state: "accepted", classification: "same_unit", reason_codes: ["explicit_user_requirement"], confidence: "high" },
            requirements: [
              { id: "req_one", summary: "Preserve latest requirement", source_event_ids: ["src_create"] },
              { id: "req_race", summary: "Include racing amendment", source_event_ids: ["src_racing_amend"] },
            ],
            open_conflicts: [],
          })),
          source_stdin: {
            event_id: "src_racing_amend",
            captured_at: "2026-09-06T00:01:00.000Z",
            client: "codex",
            content_type: "text/plain; charset=utf-8",
            fidelity: "native_exact",
            allocation_status: "allocated",
            body: Buffer.from("private racing amendment"),
          },
        });
      }
      return result;
    });

    const result = resume(root);
    expect(status).toHaveBeenCalledTimes(2);
    expect(result.context).toContain("Include racing amendment");
    expect(result.context).not.toContain("private racing amendment");
  });

  it("does not auto-continue terminal Work", () => {
    const { root } = fixture();
    const current = statusWork({ project_root: root, work_id: "wu_compact" });
    const verified = transitionWork({
      project_root: root,
      work_id: "wu_compact",
      event_id: "evt_verify",
      occurred_at: "2026-09-06T00:01:00.000Z",
      expected_head: current.projection.ledger_head,
      draft: Buffer.from(JSON.stringify({
        requirement_id: "req_one",
        status: "verified",
        evidence_refs: ["test:pass"],
      })),
    });
    closeWork({
      project_root: root,
      work_id: "wu_compact",
      event_id: "evt_close",
      occurred_at: "2026-09-06T00:02:00.000Z",
      expected_head: verified.projection.ledger_head!,
      expected_contract_revision: verified.projection.contract_revision,
      expected_contract_hash: verified.projection.contract_hash!,
      draft: Buffer.from(JSON.stringify({
        lifecycle: "completed",
        authority: {
          kind: "delegated_objective_completion",
          source_event_id: "src_create",
          authority_ref: "user-request:complete-objective",
        },
        evidence_refs: ["test:pass"],
      })),
    });

    const result = resume(root);
    expect(result.context).toContain("This Work is terminal");
    expect(result.context).not.toContain("continue the same task");
  });

  it("retries when Work closes after the first projection fold", () => {
    const { root } = fixture();
    const current = statusWork({ project_root: root, work_id: "wu_compact" });
    const verified = transitionWork({
      project_root: root,
      work_id: "wu_compact",
      event_id: "evt_racing_verify",
      occurred_at: "2026-09-06T00:01:00.000Z",
      expected_head: current.projection.ledger_head,
      draft: Buffer.from(JSON.stringify({
        requirement_id: "req_one",
        status: "verified",
        evidence_refs: ["test:pass"],
      })),
    });
    const original = workModule.statusWork;
    let closed = false;
    const status = vi.spyOn(workModule, "statusWork").mockImplementation((input) => {
      const result = original(input);
      if (!closed) {
        closed = true;
        closeWork({
          project_root: root,
          work_id: "wu_compact",
          event_id: "evt_racing_close",
          occurred_at: "2026-09-06T00:02:00.000Z",
          expected_head: verified.projection.ledger_head!,
          expected_contract_revision: verified.projection.contract_revision,
          expected_contract_hash: verified.projection.contract_hash!,
          draft: Buffer.from(JSON.stringify({
            lifecycle: "completed",
            authority: {
              kind: "delegated_objective_completion",
              source_event_id: "src_create",
              authority_ref: "user-request:complete-objective",
            },
            evidence_refs: ["test:pass"],
          })),
        });
      }
      return result;
    });

    const result = resume(root);
    expect(status).toHaveBeenCalledTimes(2);
    expect(result.context).toContain("This Work is terminal");
    expect(result.context).not.toContain("continue the same task");
  });

  it("rejects recovery when the session cursor changes during the status read", () => {
    const { root, cursor, state } = fixture();
    const original = workModule.statusWork;
    const status = vi.spyOn(workModule, "statusWork").mockImplementation((input) => {
      const result = original(input);
      writeWorkCursorAtomic(state.state_root, {
        ...cursor,
        updated_at: "2026-09-06T00:03:00.000Z",
      });
      return result;
    });

    expect(resume(root).context).toBeNull();
    expect(status).toHaveBeenCalledOnce();
    status.mockRestore();
  });

  it("exposes compact recovery through the hidden stdin CLI", () => {
    const { root } = fixture();
    const cli = spawnSync(
      process.execPath,
      [
        tsxCli,
        anamnesisCli,
        "work",
        "hook-session-start",
        "--client",
        "codex",
        "--project-root",
        root,
      ],
      {
        cwd: repositoryRoot,
        input: JSON.stringify({ source: "compact", session_id: "session" }),
        encoding: "utf8",
      },
    );

    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout).toContain("Tests pass and changes reviewed");
    expect(cli.stdout).toContain("continue the same task");
  });
});
