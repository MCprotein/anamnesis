import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseAgentfile,
  parseAgentfileV1,
  parseAgentfileV2,
  stringifyAgentfile,
  AgentfileParseError,
  findAgentfile,
  readAgentfile,
  writeAgentfile,
} from "./agentfile.js";

const MIN_YAML = `
version: 1
project:
  name: test-project
tools:
  - claude-code
fragments: []
`;

describe("parseAgentfile", () => {
  it("accepts minimal valid input", () => {
    const result = parseAgentfile(MIN_YAML);
    expect(result.version).toBe(1);
    expect(result.project.name).toBe("test-project");
    expect(result.tools).toEqual(["claude-code"]);
    expect(result.fragments).toEqual([]);
  });

  it("accepts a complete example with all fields", () => {
    const yaml = `
version: 1
project:
  name: example
  description: A complete example
tools:
  - claude-code
  - codex
fragments:
  - id: prisma
    version: 1
    params:
      schema_path: prisma/schema.prisma
  - id: k8s
    version: 2
    pinned: true
declined:
  - id: nextjs
    reason: backend-only
    declined_at: "2026-04-23"
settings:
  commit_on_apply: true
  backup_retention: 5
  max_warm_handoff_archives: 3
  max_cold_handoff_age_days: 45
  max_handoff_bytes: 131072
overrides:
  regions:
    - file: AGENTS.md
      region_id: prisma
      locked: true
      reason: manual curation
`;
    const result = parseAgentfile(yaml);
    expect(result.fragments).toHaveLength(2);
    expect(result.fragments[0]!.id).toBe("prisma");
    expect(result.fragments[0]!.params).toEqual({
      schema_path: "prisma/schema.prisma",
    });
    expect(result.fragments[1]!.pinned).toBe(true);
    expect(result.declined).toHaveLength(1);
    expect(result.settings).toMatchObject({
      backup_retention: 5,
      max_warm_handoff_archives: 3,
      max_cold_handoff_age_days: 45,
      max_handoff_bytes: 131072,
    });
    expect(result.overrides?.regions?.[0]?.locked).toBe(true);
  });

  it("rejects unsupported versions", () => {
    const yaml = `
version: 3
project: { name: x }
tools: [claude-code]
fragments: []
`;
    expect(() => parseAgentfile(yaml)).toThrow(AgentfileParseError);
  });

  it("keeps v1 strict and rejects v2-only work policy settings", () => {
    const yaml = `
version: 1
project: { name: x }
tools: [claude-code]
fragments: []
settings:
  work_policy: {}
`;
    expect(() => parseAgentfileV1(yaml)).toThrow(/Unrecognized key/);
    expect(() => parseAgentfile(yaml)).toThrow(/Unrecognized key/);
  });

  it("accepts an absent work policy in v2 without materializing it", () => {
    const yaml = `
version: 2
project: { name: x }
tools: [claude-code]
fragments: []
settings:
  backup_retention: 3
`;
    const result = parseAgentfileV2(yaml);

    expect(result.version).toBe(2);
    expect(result.settings?.backup_retention).toBe(3);
    expect(result.settings).not.toHaveProperty("work_policy");
  });

  it("accepts the strict work policy schema in v2", () => {
    const yaml = `
version: 2
project: { name: x }
tools: [claude-code]
fragments: []
settings:
  work_policy:
    reconciliation:
      preset: frequent
      due_after:
        max_silence: PT5M
        meaningful_actions: 5
      triggers: [work_resume, contract_revision, before_work_close]
      detail: compact
      compact_target_tokens: 220
      after_briefing: continue
    delegation:
      parallelism: auto
      max_agents: 4
      native_agents: prefer
      tmux_team: auto
      fallback_order: [native_agents, tmux_team]
      unavailable: fallback
      reassess_on: [contract_revision, material_scope_change]
`;
    const result = parseAgentfileV2(yaml);

    expect(result.settings?.work_policy?.reconciliation?.preset).toBe(
      "frequent",
    );
    expect(result.settings?.work_policy?.delegation?.max_agents).toBe(4);
  });

  it("rejects unknown work policy keys at every nested level", () => {
    const fixtures = [
      `  work_policy:\n    enabled: true`,
      `  work_policy:\n    reconciliation:\n      preset: off\n      timer_daemon: true`,
      `  work_policy:\n    reconciliation:\n      preset: custom\n      due_after:\n        seconds: 300`,
      `  work_policy:\n    delegation:\n      parallelism: auto\n      worker_pool: shared`,
      `  work_policy:\n    delegation:\n      parallelism: auto\n      composition:\n        native_agents_lanes: []\n        tmux_team_lanes: []\n        solo_lanes: []`,
    ];

    for (const settings of fixtures) {
      expect(() =>
        parseAgentfileV2(`
version: 2
project: { name: x }
tools: [claude-code]
fragments: []
settings:
${settings}
`),
      ).toThrow(/Unrecognized key/);
    }
  });

  it("rejects unknown tool name", () => {
    const yaml = `
version: 1
project: { name: x }
tools: [windsurf]
fragments: []
`;
    expect(() => parseAgentfile(yaml)).toThrow(AgentfileParseError);
  });

  it("rejects duplicate fragment ids", () => {
    const yaml = `
version: 1
project: { name: x }
tools: [claude-code]
fragments:
  - { id: prisma, version: 1 }
  - { id: prisma, version: 2 }
`;
    expect(() => parseAgentfile(yaml)).toThrow(/duplicate fragments\[\]\.id/);
  });

  it("rejects empty tools array", () => {
    const yaml = `
version: 1
project: { name: x }
tools: []
fragments: []
`;
    expect(() => parseAgentfile(yaml)).toThrow(AgentfileParseError);
  });

  it("rejects unknown top-level fields", () => {
    const yaml = `
version: 1
project: { name: x }
tools: [claude-code]
fragments: []
sync: true
`;
    expect(() => parseAgentfile(yaml)).toThrow(/Unrecognized key/);
  });

  it("rejects unknown fragment fields instead of silently dropping them", () => {
    const yaml = `
version: 1
project: { name: x }
tools: [claude-code]
fragments:
  - id: prisma
    version: 2
    source:
      registry: official
`;
    expect(() => parseAgentfile(yaml)).toThrow(/Unrecognized key/);
  });

  it("rejects unknown nested settings, override, and scope fields", () => {
    const yaml = `
version: 1
project:
  name: x
  scopes:
    - path: .
      source: remote
tools: [claude-code]
fragments: []
settings:
  backup_retention: 10
  sync: true
overrides:
  files:
    - path: AGENTS.md
      mode: hard-lock
`;
    expect(() => parseAgentfile(yaml)).toThrow(/Unrecognized key/);
  });

  it("rejects invalid YAML", () => {
    const yaml = `version: 1\nproject: {name: x\ntools: [claude-code]\n`;
    expect(() => parseAgentfile(yaml)).toThrow(/YAML parse error/);
  });

  it("accepts multi-scope monorepo (v0.2+)", () => {
    const yaml = `
version: 1
project:
  name: x
  scopes:
    - path: .
    - path: packages/api
      extends: .
tools: [claude-code]
fragments: []
`;
    expect(() => parseAgentfile(yaml)).not.toThrow();
  });

  it("accepts single '.' scope", () => {
    const yaml = `
version: 1
project:
  name: x
  scopes:
    - path: .
tools: [claude-code]
fragments: []
`;
    expect(() => parseAgentfile(yaml)).not.toThrow();
  });
});

describe("stringifyAgentfile", () => {
  it("roundtrips through parse", () => {
    const original = parseAgentfile(MIN_YAML);
    const serialized = stringifyAgentfile(original);
    const reparsed = parseAgentfile(serialized);
    expect(reparsed).toEqual(original);
  });
});

describe("findAgentfile", () => {
  function tmpProject(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-test-"));
  }

  it("returns null when no Agentfile present", () => {
    const dir = tmpProject();
    expect(findAgentfile(dir)).toBeNull();
  });

  it("finds Agentfile (preferred name)", () => {
    const dir = tmpProject();
    const p = path.join(dir, "Agentfile");
    fs.writeFileSync(p, MIN_YAML);
    expect(findAgentfile(dir)).toBe(p);
  });

  it("finds agentfile.yaml", () => {
    const dir = tmpProject();
    const p = path.join(dir, "agentfile.yaml");
    fs.writeFileSync(p, MIN_YAML);
    expect(findAgentfile(dir)).toBe(p);
  });

  it("throws on multiple Agentfile variants", () => {
    const dir = tmpProject();
    fs.writeFileSync(path.join(dir, "Agentfile"), MIN_YAML);
    fs.writeFileSync(path.join(dir, "agentfile.yaml"), MIN_YAML);
    expect(() => findAgentfile(dir)).toThrow(/Multiple Agentfile variants/);
  });
});

describe("readAgentfile / writeAgentfile", () => {
  it("writes then reads equivalently", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-test-"));
    const src = parseAgentfile(MIN_YAML);
    writeAgentfile(dir, src);
    const round = readAgentfile(dir);
    expect(round).toEqual(src);
  });
});
