import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readSettings,
  writeSettings,
  ensureHookRegistration,
  hookRegistrationPresent,
  syncHookRegistrations,
  settingsPath,
  type HookRegistration,
} from "./settings.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-settings-"));
}

const REG_INJECT: HookRegistration = {
  event: "SessionStart",
  command: ".claude/hooks/inject-ontology.sh",
};

const REG_VALIDATE: HookRegistration = {
  event: "PostToolUse",
  matcher: "Edit",
  command: ".claude/hooks/prisma-validate.sh",
};

// ---------------------------------------------------------------------------

describe("readSettings / writeSettings", () => {
  it("returns empty object when settings.json missing", () => {
    expect(readSettings(tmpProject())).toEqual({});
  });

  it("roundtrips through write + read", () => {
    const root = tmpProject();
    const data = { hooks: {}, permissions: { allow: ["Bash"] } };
    writeSettings(root, data);
    expect(readSettings(root)).toEqual(data);
  });

  it("creates .claude/ directory if missing", () => {
    const root = tmpProject();
    writeSettings(root, {});
    expect(fs.existsSync(settingsPath(root))).toBe(true);
  });

  it("throws on malformed JSON (does not silently swallow)", () => {
    const root = tmpProject();
    fs.mkdirSync(path.join(root, ".claude"));
    fs.writeFileSync(settingsPath(root), "{not json");
    expect(() => readSettings(root)).toThrow();
  });
});

// ---------------------------------------------------------------------------

describe("ensureHookRegistration — create", () => {
  it("inserts SessionStart hook (no matcher) into empty settings", () => {
    const { settings, status } = ensureHookRegistration({}, REG_INJECT);
    expect(status).toBe("create");
    expect(hookRegistrationPresent(settings, REG_INJECT)).toBe(true);
    expect(settings).toEqual({
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: ".claude/hooks/inject-ontology.sh" },
            ],
          },
        ],
      },
    });
  });

  it("inserts PostToolUse hook with matcher", () => {
    const { settings, status } = ensureHookRegistration({}, REG_VALIDATE);
    expect(status).toBe("create");
    expect(hookRegistrationPresent(settings, REG_VALIDATE)).toBe(true);
  });

  it("preserves unrelated keys (permissions, env, ...)", () => {
    const initial = {
      permissions: { allow: ["Bash(npm test)"], deny: [] },
      env: { DEBUG: "true" },
    };
    const { settings } = ensureHookRegistration(initial, REG_INJECT);
    expect(settings.permissions).toEqual(initial.permissions);
    expect(settings.env).toEqual(initial.env);
  });

  it("appends to existing matcher group instead of duplicating it", () => {
    const initial = {
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit",
            hooks: [
              { type: "command", command: ".claude/hooks/existing.sh" },
            ],
          },
        ],
      },
    };
    const { settings } = ensureHookRegistration(initial, REG_VALIDATE);
    const entries = (settings.hooks as Record<string, unknown>)
      .PostToolUse as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect((entries[0]!.hooks as unknown[])).toHaveLength(2);
  });

  it("creates a separate matcher group for a different matcher", () => {
    const initial = {
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: ".claude/hooks/edit.sh" }],
          },
        ],
      },
    };
    const reg: HookRegistration = {
      event: "PostToolUse",
      matcher: "Bash",
      command: ".claude/hooks/bash.sh",
    };
    const { settings } = ensureHookRegistration(initial, reg);
    const entries = (settings.hooks as Record<string, unknown>)
      .PostToolUse as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

describe("ensureHookRegistration — noop", () => {
  it("returns noop when registration already present", () => {
    const initial = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: ".claude/hooks/inject-ontology.sh" },
            ],
          },
        ],
      },
    };
    const { status } = ensureHookRegistration(initial, REG_INJECT);
    expect(status).toBe("noop");
  });

  it("noop when same command already in matcher group", () => {
    const initial = {
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit",
            hooks: [
              {
                type: "command",
                command: ".claude/hooks/prisma-validate.sh",
              },
            ],
          },
        ],
      },
    };
    const { status } = ensureHookRegistration(initial, REG_VALIDATE);
    expect(status).toBe("noop");
  });

  it("matcher comparison treats undefined and missing identically", () => {
    const initial = {
      hooks: {
        SessionStart: [
          {
            // no `matcher` field at all
            hooks: [
              {
                type: "command",
                command: ".claude/hooks/inject-ontology.sh",
              },
            ],
          },
        ],
      },
    };
    const reg: HookRegistration = {
      event: "SessionStart",
      command: ".claude/hooks/inject-ontology.sh",
      // no matcher field
    };
    const { status } = ensureHookRegistration(initial, reg);
    expect(status).toBe("noop");
  });
});

// ---------------------------------------------------------------------------

describe("hookRegistrationPresent", () => {
  it("returns false on empty settings", () => {
    expect(hookRegistrationPresent({}, REG_INJECT)).toBe(false);
  });

  it("returns false when matcher matches but command differs", () => {
    const initial = {
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit",
            hooks: [{ type: "command", command: ".claude/hooks/other.sh" }],
          },
        ],
      },
    };
    expect(hookRegistrationPresent(initial, REG_VALIDATE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("syncHookRegistrations", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject();
  });

  it("creates settings.json with multiple registrations", () => {
    const { results, changed } = syncHookRegistrations(root, [
      REG_INJECT,
      REG_VALIDATE,
    ]);
    expect(changed).toBe(true);
    expect(results.map((r) => r.status)).toEqual(["create", "create"]);
    const written = readSettings(root);
    expect(hookRegistrationPresent(written, REG_INJECT)).toBe(true);
    expect(hookRegistrationPresent(written, REG_VALIDATE)).toBe(true);
  });

  it("noop when re-running with same registrations", () => {
    syncHookRegistrations(root, [REG_INJECT]);
    const second = syncHookRegistrations(root, [REG_INJECT]);
    expect(second.changed).toBe(false);
    expect(second.results[0]!.status).toBe("noop");
  });

  it("does not touch unrelated settings.json keys", () => {
    writeSettings(root, {
      permissions: { allow: ["Bash(npm test)"] },
      hooks: {
        // pre-existing user hook
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: ".claude/hooks/user.sh" }],
          },
        ],
      },
    });
    syncHookRegistrations(root, [REG_INJECT]);
    const after = readSettings(root) as Record<string, Record<string, unknown>>;
    expect(after.permissions).toEqual({ allow: ["Bash(npm test)"] });
    // User's PreToolUse hook still present
    const pre = (after.hooks!.PreToolUse as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect((pre.hooks as unknown[])[0]).toEqual({
      type: "command",
      command: ".claude/hooks/user.sh",
    });
    // Our SessionStart hook added
    expect(after.hooks!.SessionStart).toBeDefined();
  });

  it("returns unchanged=false when no registrations supplied", () => {
    const { changed, results } = syncHookRegistrations(root, []);
    expect(changed).toBe(false);
    expect(results).toEqual([]);
    expect(fs.existsSync(settingsPath(root))).toBe(false);
  });
});
