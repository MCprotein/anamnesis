import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadFragment,
  loadAllFragments,
  topologicalSort,
  detectConflicts,
  FragmentParseError,
  type FragmentDefinition,
} from "./fragments.js";

function tmpLib(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-frag-"));
  fs.mkdirSync(path.join(dir, "fragments"));
  return dir;
}

function writeFragment(libRoot: string, id: string, yaml: string): string {
  const dir = path.join(libRoot, "fragments", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "fragment.yaml"), yaml);
  return dir;
}

const MIN_YAML = `
id: prisma
version: 1
capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: prisma
`;

describe("loadFragment", () => {
  it("parses a minimal fragment", () => {
    const lib = tmpLib();
    const dir = writeFragment(lib, "prisma", MIN_YAML);
    const frag = loadFragment(dir);
    expect(frag.id).toBe("prisma");
    expect(frag.version).toBe(1);
    expect(frag.capabilities).toHaveLength(1);
    expect(frag.requires).toEqual([]);
    expect(frag.conflicts).toEqual([]);
  });

  it("parses all five capability types", () => {
    const yaml = `
id: everything
version: 1
capabilities:
  - type: project_memory
    source: a.md
    region: x
  - type: ontology
    source: o.yaml
  - type: executable_hook
    event: PreToolUse:Bash
    source: h.sh
    adapters_supported: [claude-code]
  - type: skill
    name: my-skill
    source: skills/my-skill
  - type: slash_command
    name: hello
    source: commands/hello.md
`;
    const lib = tmpLib();
    const dir = writeFragment(lib, "everything", yaml);
    const frag = loadFragment(dir);
    expect(frag.capabilities).toHaveLength(5);
    const types = frag.capabilities.map((c) => c.type);
    expect(types).toEqual([
      "project_memory",
      "ontology",
      "executable_hook",
      "skill",
      "slash_command",
    ]);
  });

  it("rejects when fragment.yaml is missing", () => {
    const lib = tmpLib();
    const dir = path.join(lib, "fragments", "ghost");
    fs.mkdirSync(dir);
    expect(() => loadFragment(dir)).toThrow(/not found/);
  });

  it("rejects mismatched id vs directory name", () => {
    const lib = tmpLib();
    const dir = writeFragment(lib, "prisma", MIN_YAML.replace("id: prisma", "id: other"));
    expect(() => loadFragment(dir)).toThrow(/must match directory name/);
  });

  it("rejects unknown capability type", () => {
    const yaml = `
id: bad
version: 1
capabilities:
  - type: not_real
    source: x
`;
    const lib = tmpLib();
    const dir = writeFragment(lib, "bad", yaml);
    expect(() => loadFragment(dir)).toThrow(FragmentParseError);
  });

  it("rejects invalid YAML", () => {
    const lib = tmpLib();
    // Unclosed flow mapping is unambiguous YAML syntax error.
    const dir = writeFragment(lib, "broken", "id: prisma\nversion: { a: 1");
    expect(() => loadFragment(dir)).toThrow(/YAML parse error/);
  });
});

describe("loadAllFragments", () => {
  it("loads every fragment in the library", () => {
    const lib = tmpLib();
    writeFragment(lib, "prisma", MIN_YAML);
    writeFragment(
      lib,
      "k8s",
      MIN_YAML.replace("id: prisma", "id: k8s").replace("region: prisma", "region: k8s"),
    );
    const map = loadAllFragments(lib);
    expect(map.size).toBe(2);
    expect(map.has("prisma")).toBe(true);
    expect(map.has("k8s")).toBe(true);
  });

  it("returns empty map when fragments/ is absent", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-empty-"));
    expect(loadAllFragments(empty).size).toBe(0);
  });

  it("ignores directories without fragment.yaml", () => {
    const lib = tmpLib();
    fs.mkdirSync(path.join(lib, "fragments", "orphan"));
    writeFragment(lib, "prisma", MIN_YAML);
    const map = loadAllFragments(lib);
    expect(map.size).toBe(1);
  });
});

// Helper for sort/conflict tests — skip disk round-trip.
function frag(
  id: string,
  requires: string[] = [],
  conflicts: string[] = [],
): FragmentDefinition {
  return {
    id,
    version: 1,
    requires,
    conflicts,
    owns: [],
    capabilities: [{ type: "ontology", source: "o.yaml" }],
  };
}

describe("topologicalSort", () => {
  it("orders dependencies before dependents", () => {
    const a = frag("a");
    const b = frag("b", ["a"]);
    const c = frag("c", ["b"]);
    const sorted = topologicalSort([c, b, a]);
    const ids = sorted.map((f) => f.id);
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
  });

  it("detects a cycle", () => {
    const a = frag("a", ["b"]);
    const b = frag("b", ["a"]);
    expect(() => topologicalSort([a, b])).toThrow(/cycle/);
  });

  it("throws on missing dependency", () => {
    const a = frag("a", ["missing"]);
    expect(() => topologicalSort([a])).toThrow(/unknown fragment 'missing'/);
  });

  it("is idempotent on already-sorted input", () => {
    const a = frag("a");
    const b = frag("b", ["a"]);
    const sorted1 = topologicalSort([a, b]);
    const sorted2 = topologicalSort(sorted1);
    expect(sorted1.map((f) => f.id)).toEqual(sorted2.map((f) => f.id));
  });
});

describe("detectConflicts", () => {
  it("returns empty when no conflicts declared", () => {
    expect(detectConflicts([frag("a"), frag("b")])).toEqual([]);
  });

  it("detects explicit conflicts", () => {
    const a = frag("a", [], ["b"]);
    const b = frag("b");
    expect(detectConflicts([a, b])).toEqual([["a", "b"]]);
  });

  it("reports each pair once even if both sides declare", () => {
    const a = frag("a", [], ["b"]);
    const b = frag("b", [], ["a"]);
    expect(detectConflicts([a, b])).toEqual([["a", "b"]]);
  });

  it("ignores conflicts with fragments not in the input set", () => {
    const a = frag("a", [], ["ghost"]);
    expect(detectConflicts([a])).toEqual([]);
  });
});
