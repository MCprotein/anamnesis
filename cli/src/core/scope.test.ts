import { describe, it, expect } from "vitest";
import {
  effectiveScopes,
  isMultiScope,
  ScopeResolutionError,
} from "./scope.js";
import { parseAgentfile } from "./agentfile.js";

// ---------------------------------------------------------------------------

describe("effectiveScopes — back-compat", () => {
  it("returns single root scope when no scopes declared", () => {
    const af = parseAgentfile(`
version: 1
project:
  name: x
tools: [claude-code]
fragments:
  - { id: base, version: 1 }
`);
    const scopes = effectiveScopes(af);
    expect(scopes).toHaveLength(1);
    expect(scopes[0]!.path).toBe(".");
    expect(scopes[0]!.tools).toEqual(["claude-code"]);
    expect(scopes[0]!.fragments).toEqual([{ id: "base", version: 1 }]);
  });

  it("returns single root when scopes is just [- path: .]", () => {
    const af = parseAgentfile(`
version: 1
project:
  name: x
  scopes:
    - path: .
tools: [claude-code]
fragments:
  - { id: base, version: 1 }
`);
    const scopes = effectiveScopes(af);
    expect(scopes).toHaveLength(1);
    expect(scopes[0]!.path).toBe(".");
    expect(scopes[0]!.fragments).toEqual([{ id: "base", version: 1 }]);
  });
});

// ---------------------------------------------------------------------------

describe("effectiveScopes — multi-scope inheritance", () => {
  it("child scope inherits tools and fragments from root via extends", () => {
    const af = parseAgentfile(`
version: 1
project:
  name: monorepo
  scopes:
    - path: .
    - path: apps/api
      extends: .
tools: [claude-code]
fragments:
  - { id: base, version: 1 }
`);
    const scopes = effectiveScopes(af);
    expect(scopes).toHaveLength(2);
    const child = scopes.find((s) => s.path === "apps/api")!;
    expect(child.tools).toEqual(["claude-code"]);
    expect(child.fragments).toEqual([{ id: "base", version: 1 }]);
  });

  it("overrides.fragments_add appends to inherited list", () => {
    const af = parseAgentfile(`
version: 1
project:
  name: monorepo
  scopes:
    - path: .
    - path: apps/api
      extends: .
      overrides:
        fragments_add:
          - { id: fastapi, version: 1 }
tools: [claude-code]
fragments:
  - { id: base, version: 1 }
`);
    const child = effectiveScopes(af).find((s) => s.path === "apps/api")!;
    expect(child.fragments.map((f) => f.id)).toEqual(["base", "fastapi"]);
  });

  it("overrides.fragments_remove drops by id", () => {
    const af = parseAgentfile(`
version: 1
project:
  name: monorepo
  scopes:
    - path: .
    - path: apps/lite
      extends: .
      overrides:
        fragments_remove: [k8s]
tools: [claude-code]
fragments:
  - { id: base, version: 1 }
  - { id: k8s, version: 1 }
`);
    const child = effectiveScopes(af).find((s) => s.path === "apps/lite")!;
    expect(child.fragments.map((f) => f.id)).toEqual(["base"]);
  });

  it("overrides.tools replaces inherited tools fully", () => {
    const af = parseAgentfile(`
version: 1
project:
  name: monorepo
  scopes:
    - path: .
    - path: apps/api
      extends: .
      overrides:
        tools: [codex]
tools: [claude-code, codex]
fragments: []
`);
    const child = effectiveScopes(af).find((s) => s.path === "apps/api")!;
    expect(child.tools).toEqual(["codex"]);
  });

  it("fragments_add with same id replaces inherited entry", () => {
    const af = parseAgentfile(`
version: 1
project:
  name: monorepo
  scopes:
    - path: .
    - path: apps/api
      extends: .
      overrides:
        fragments_add:
          - { id: base, version: 2, pinned: true }
tools: [claude-code]
fragments:
  - { id: base, version: 1 }
`);
    const child = effectiveScopes(af).find((s) => s.path === "apps/api")!;
    expect(child.fragments).toEqual([
      { id: "base", version: 2, pinned: true },
    ]);
  });

  it("non-extending non-root scope starts from empty config", () => {
    const af = parseAgentfile(`
version: 1
project:
  name: monorepo
  scopes:
    - path: .
    - path: apps/standalone
      overrides:
        tools: [codex]
        fragments_add:
          - { id: fastapi, version: 1 }
tools: [claude-code]
fragments:
  - { id: base, version: 1 }
`);
    const child = effectiveScopes(af).find(
      (s) => s.path === "apps/standalone",
    )!;
    expect(child.tools).toEqual(["codex"]);
    expect(child.fragments).toEqual([{ id: "fastapi", version: 1 }]);
  });

  it("preserves declared order, not topological order", () => {
    const af = parseAgentfile(`
version: 1
project:
  name: monorepo
  scopes:
    - path: apps/web
      extends: .
    - path: .
    - path: apps/api
      extends: .
tools: [claude-code]
fragments: []
`);
    const scopes = effectiveScopes(af);
    expect(scopes.map((s) => s.path)).toEqual([
      "apps/web",
      ".",
      "apps/api",
    ]);
  });
});

// ---------------------------------------------------------------------------

describe("effectiveScopes — error cases", () => {
  it("throws on extends cycle", () => {
    // Circular extends — caught by Agentfile schema check actually...
    // but if it slipped past, scope.ts should still detect.
    // We construct a synthetic Agentfile object directly to bypass schema validation.
    const af = {
      version: 1 as const,
      project: {
        name: "cycle",
        scopes: [
          { path: "a", extends: "b" },
          { path: "b", extends: "a" },
        ],
      },
      tools: ["claude-code" as const],
      fragments: [],
    };
    expect(() => effectiveScopes(af as never)).toThrow(/cycle/);
  });
});

// ---------------------------------------------------------------------------

describe("isMultiScope", () => {
  it("false when no scopes declared", () => {
    const af = parseAgentfile(`
version: 1
project: { name: x }
tools: [claude-code]
fragments: []
`);
    expect(isMultiScope(af)).toBe(false);
  });

  it("false when single root scope", () => {
    const af = parseAgentfile(`
version: 1
project:
  name: x
  scopes:
    - path: .
tools: [claude-code]
fragments: []
`);
    expect(isMultiScope(af)).toBe(false);
  });

  it("true when multiple scopes", () => {
    const af = parseAgentfile(`
version: 1
project:
  name: x
  scopes:
    - path: .
    - path: apps/api
      extends: .
tools: [claude-code]
fragments: []
`);
    expect(isMultiScope(af)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("Agentfile schema — multi-scope acceptance", () => {
  it("accepts multi-scope Agentfile (no longer rejected)", () => {
    expect(() =>
      parseAgentfile(`
version: 1
project:
  name: monorepo
  scopes:
    - path: .
    - path: apps/api
      extends: .
tools: [claude-code]
fragments: []
`),
    ).not.toThrow();
  });

  it("rejects scope with unknown extends target", () => {
    expect(() =>
      parseAgentfile(`
version: 1
project:
  name: x
  scopes:
    - path: apps/api
      extends: .
tools: [claude-code]
fragments: []
`),
    ).toThrow(/extends unknown scope/);
  });

  it("rejects duplicate scope path", () => {
    expect(() =>
      parseAgentfile(`
version: 1
project:
  name: x
  scopes:
    - path: .
    - path: .
tools: [claude-code]
fragments: []
`),
    ).toThrow(/duplicate path/);
  });

  it("rejects self-extends", () => {
    expect(() =>
      parseAgentfile(`
version: 1
project:
  name: x
  scopes:
    - path: .
      extends: .
tools: [claude-code]
fragments: []
`),
    ).toThrow(/cannot extend itself/);
  });
});
