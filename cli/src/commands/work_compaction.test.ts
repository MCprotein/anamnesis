import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newWorkCursor, writeWorkCursorAtomic } from "../core/work_cursor.js";
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

function fixture(preset = "frequent") {
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
  writeWorkCursorAtomic(state.state_root, cursor, { expectedCursorRevision: null });
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
  it("restores the unchanged contract on every compact without mutating state or capturing prompts", () => {
    const { root } = fixture();
    const before = snapshot(root);
    const first = resume(root, { source: "compact", session_id: "session", prompt: "must not be staged", transcript_path: "/untrusted" });
    expect(first.context).toContain("Tests pass and changes reviewed");
    expect(first.context).toContain("Preserve latest requirement");
    expect(first.context).toContain("continue the same task");
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
