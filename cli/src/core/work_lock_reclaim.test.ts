import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withWorkLedgerLock } from "./work_ledger.js";
import { withWorkSourceEventLock } from "./work_storage.js";

vi.mock("node:fs", async (importOriginal) => ({ ...await importOriginal<typeof fs>() }));

vi.mock("node:child_process", async (importOriginal) => ({ ...await importOriginal<typeof childProcess>() }));

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

for (const kind of ["ledger", "source"] as const) {
  describe(`${kind} reclaim ownership`, () => {
    function setup() {
      const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "work-reclaim-")));
      roots.push(root);
      const target = path.join(root, "target");
      const lock = kind === "ledger" ? `${target}.lock` : target;
      const owner = {
        schema_version: kind === "ledger" ? "anamnesis.work-lock.v1" : "anamnesis.work-source-lock.v1",
        nonce: "a".repeat(32), pid: 2147483647, process_start: "dead process",
      };
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify(owner));
      const acquire = (operation: () => void, timeout = 0) =>
        (kind === "ledger" ? withWorkLedgerLock : withWorkSourceEventLock)(
          target, { lockTimeoutMs: timeout, lockRetryMs: 0 }, operation,
        );
      return { root, lock, owner, acquire };
    }

    it("preserves B replacing A during the liveness probe", () => {
      const { lock, owner, acquire } = setup();
      const replacement = { ...owner, nonce: "b".repeat(32), pid: process.pid };
      const kill = vi.spyOn(process, "kill").mockImplementation(() => {
        fs.renameSync(lock, `${lock}.released`);
        fs.mkdirSync(lock);
        fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify(replacement));
        throw Object.assign(new Error("dead"), { code: "ESRCH" });
      });
      expect(() => acquire(() => { throw new Error("overlap"); })).toThrow("timed out");
      expect(kill).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8"))).toEqual(replacement);
    });

    it("rejects a replacement directory even with an identical owner record", () => {
      const { lock, owner, acquire } = setup();
      vi.spyOn(process, "kill").mockImplementation(() => {
        fs.renameSync(lock, `${lock}.old`);
        fs.mkdirSync(lock);
        fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify(owner));
        throw Object.assign(new Error("dead"), { code: "ESRCH" });
      });
      expect(() => acquire(() => {})).toThrow("timed out");
      expect(fs.existsSync(lock)).toBe(true);
    });

    it("rejects a changed nonce in the original owner inode", () => {
      const { lock, owner, acquire } = setup();
      vi.spyOn(process, "kill").mockImplementation(() => {
        fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ ...owner, nonce: "b".repeat(32) }));
        throw Object.assign(new Error("dead"), { code: "ESRCH" });
      });
      expect(() => acquire(() => {})).toThrow("timed out");
      expect(fs.existsSync(lock)).toBe(true);
    });

    it.each(["symlink", "directory"])("rejects a %s owner before probing", (type) => {
      const { root, lock, acquire } = setup();
      const ownerPath = path.join(lock, "owner.json");
      fs.renameSync(ownerPath, path.join(root, "original-owner"));
      if (type === "symlink") fs.symlinkSync(path.join(root, "original-owner"), ownerPath);
      else fs.mkdirSync(ownerPath);
      const probe = vi.spyOn(process, "kill");
      expect(() => acquire(() => {})).toThrow("timed out");
      expect(probe).not.toHaveBeenCalled();
      expect(fs.existsSync(lock)).toBe(true);
    });

    it("leaves an existing crashed claim untouched and fails closed", () => {
      const { lock, owner, acquire } = setup();
      const claim = `${lock}.reclaim-${owner.nonce}`;
      fs.mkdirSync(claim);
      const probe = vi.spyOn(process, "kill");
      expect(() => acquire(() => {})).toThrow("timed out");
      expect(probe).not.toHaveBeenCalled();
      expect(fs.existsSync(claim)).toBe(true);
      expect(fs.existsSync(lock)).toBe(true);
    });

    it("does not clean up a replaced claim", () => {
      const { lock, owner, acquire } = setup();
      const claim = `${lock}.reclaim-${owner.nonce}`;
      vi.spyOn(process, "kill").mockImplementation(() => {
        fs.renameSync(claim, `${claim}.old`);
        fs.mkdirSync(claim);
        throw Object.assign(new Error("unknown"), { code: "EPERM" });
      });
      expect(() => acquire(() => {})).toThrow("timed out");
      expect(fs.existsSync(claim)).toBe(true);
      expect(fs.existsSync(lock)).toBe(true);
    });

    it.each(["", "throws", "different start"])("handles process identity %j failclosed or as PID reuse", (identity) => {
      const { lock, owner, acquire } = setup();
      vi.spyOn(process, "kill").mockReturnValue(true);
      const exec = childProcess.execFileSync;
      vi.spyOn(childProcess, "execFileSync").mockImplementation((...args: Parameters<typeof exec>) => {
        if (Array.isArray(args[1]) && args[1].includes(String(owner.pid))) {
          if (identity === "throws") throw new Error("unknown identity");
          return identity;
        }
        return exec(...args);
      });
      expect(() => acquire(() => {})).toThrow("timed out");
      expect(fs.existsSync(lock)).toBe(identity !== "different start");
      expect(fs.existsSync(`${lock}.reclaim-${owner.nonce}`)).toBe(false);
    });

    it("rejects a live owner and permits normal release", () => {
      const { lock, acquire } = setup();
      fs.rmSync(lock, { recursive: true });
      let nestedEntered = false;
      acquire(() => {
        expect(() => acquire(() => { nestedEntered = true; })).toThrow("timed out");
        expect(fs.existsSync(lock)).toBe(true);
      });
      expect(nestedEntered).toBe(false);
      expect(fs.existsSync(lock)).toBe(false);
    });

    it("excludes a second stale reclaimer before the first rename", () => {
      const { lock, acquire } = setup();
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw Object.assign(new Error("dead"), { code: "ESRCH" });
      });
      let clock = 0;
      vi.spyOn(Date, "now").mockImplementation(() => clock++);
      const rename = fs.renameSync;
      let nested = false;
      let entered = false;
      vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
        if (from === lock && !nested) {
          nested = true;
          try {
            acquire(() => {
              entered = true;
              // Resume the stale first reclaimer while B owns the lock.
              rename(from, to);
            }, 15);
          } catch { /* New protocol times out; old protocol loses B's ownership. */ }
          if (entered) return;
        }
        rename(from, to);
      });
      expect(() => acquire(() => {}, 0)).toThrow("timed out");
      expect(nested).toBe(true);
      expect(entered).toBe(false);
    });
  });
}
