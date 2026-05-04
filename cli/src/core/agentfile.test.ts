import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseAgentfile,
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
    expect(result.overrides?.regions?.[0]?.locked).toBe(true);
  });

  it("rejects wrong version", () => {
    const yaml = `
version: 2
project: { name: x }
tools: [claude-code]
fragments: []
`;
    expect(() => parseAgentfile(yaml)).toThrow(AgentfileParseError);
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
