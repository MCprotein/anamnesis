import { describe, expect, it } from "vitest";
import { parseAgentfile, stringifyAgentfile } from "./agentfile.js";
import { effectiveScopes } from "./scope.js";

const FIXTURES = {
  legacyClaudeOnly: `
version: 1
project:
  name: legacy-backend
tools:
  - claude-code
fragments:
  - id: base
    version: 2
  - id: prisma
    version: 1
declined:
  - id: nextjs
    reason: backend-only
    declined_at: "2026-04-30"
`,
  allAdapterSingleScope: `
version: 1
project:
  name: all-adapter-service
  description: Service managed by every supported adapter.
tools:
  - claude-code
  - codex
  - cursor
fragments:
  - id: base
    version: 8
  - id: prisma
    version: 2
    params:
      schema_path: prisma/schema.prisma
    adapters:
      claude-code: true
      codex: true
      cursor: true
  - id: nestjs
    version: 1
settings:
  backup_retention: 0
overrides:
  files:
    - path: CLAUDE.md
      locked: true
`,
  multiScopePinned: `
version: 1
project:
  name: monorepo
  scopes:
    - path: .
    - path: apps/api
      extends: .
      overrides:
        tools:
          - codex
        fragments_add:
          - id: nestjs
            version: 1
    - path: apps/web
      extends: .
      overrides:
        fragments_remove:
          - prisma
        fragments_add:
          - id: nextjs
            version: 1
            adapters:
              cursor: false
tools:
  - claude-code
  - codex
  - cursor
fragments:
  - id: base
    version: 8
    pinned: true
  - id: prisma
    version: 2
`,
} as const;

describe("Agentfile v1 compatibility fixtures", () => {
  it("accepts historical Claude Code-only managed projects", () => {
    const af = parseAgentfile(FIXTURES.legacyClaudeOnly);

    expect(af.tools).toEqual(["claude-code"]);
    expect(af.fragments.map((fragment) => fragment.id)).toEqual([
      "base",
      "prisma",
    ]);
    expect(af.declined).toEqual([
      {
        id: "nextjs",
        reason: "backend-only",
        declined_at: "2026-04-30",
      },
    ]);
  });

  it("accepts the current all-adapter single-scope shape", () => {
    const af = parseAgentfile(FIXTURES.allAdapterSingleScope);

    expect(af.tools).toEqual(["claude-code", "codex", "cursor"]);
    expect(af.settings).toMatchObject({
      ontology_file: "system_graph.yaml",
      agents_md_path: "AGENTS.md",
      claude_md_path: "CLAUDE.md",
      commit_on_apply: false,
      backup_retention: 0,
    });
    expect(af.fragments[1]?.adapters).toEqual({
      "claude-code": true,
      codex: true,
      cursor: true,
    });
    expect(af.overrides?.files).toEqual([
      { path: "CLAUDE.md", locked: true },
    ]);
  });

  it("accepts multi-scope pinned projects and resolves effective scopes", () => {
    const af = parseAgentfile(FIXTURES.multiScopePinned);
    const scopes = effectiveScopes(af);

    const root = scopes.find((scope) => scope.path === ".")!;
    const api = scopes.find((scope) => scope.path === "apps/api")!;
    const web = scopes.find((scope) => scope.path === "apps/web")!;

    expect(root.fragments).toEqual([
      { id: "base", version: 8, pinned: true },
      { id: "prisma", version: 2 },
    ]);
    expect(api.tools).toEqual(["codex"]);
    expect(api.fragments.map((fragment) => fragment.id)).toEqual([
      "base",
      "prisma",
      "nestjs",
    ]);
    expect(web.fragments.map((fragment) => fragment.id)).toEqual([
      "base",
      "nextjs",
    ]);
    expect(web.fragments[1]?.adapters).toEqual({ cursor: false });
  });

  it("roundtrips compatibility fixtures through stringify", () => {
    for (const fixture of Object.values(FIXTURES)) {
      const parsed = parseAgentfile(fixture);
      expect(parseAgentfile(stringifyAgentfile(parsed))).toEqual(parsed);
    }
  });

  it("continues rejecting duplicate declined entries", () => {
    expect(() =>
      parseAgentfile(`
version: 1
project: { name: duplicate-declined }
tools: [claude-code]
fragments: []
declined:
  - { id: prisma, reason: no }
  - { id: prisma, reason: still-no }
`),
    ).toThrow(/duplicate declined\[\]\.id/);
  });
});
