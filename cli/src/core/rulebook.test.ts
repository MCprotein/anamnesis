import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseRulebook,
  loadRulebook,
  evaluateRules,
  matchingRules,
  RulebookParseError,
} from "./rulebook.js";
import { ProjectContext } from "./triggers.js";

const SAMPLE = `
# rulebook

Some intro text that should be ignored.

## Format (v0.1 draft)

This section has no trigger/suggest bullets — parser must skip it.

## prisma
- trigger: \`any: [package_json_has: "@prisma/client", file_exists: prisma/schema.prisma]\`
- suggest: fragments/prisma
- reason: Prisma schema drift is a frequent source of deploy failures.

## k8s
- trigger: \`dir_exists: k8s\`
- suggest: fragments/k8s
- reason: Kubernetes manifests benefit from YAML linting.
`;

function tmpDir(prefix = "anamnesis-rb-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("parseRulebook", () => {
  it("returns empty array for empty input", () => {
    expect(parseRulebook("")).toEqual([]);
  });

  it("parses multiple rules, skipping incomplete sections", () => {
    const rules = parseRulebook(SAMPLE);
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.id)).toEqual(["prisma", "k8s"]);
  });

  it("strips backticks from trigger value", () => {
    const rules = parseRulebook(SAMPLE);
    expect(rules[0]!.trigger).toEqual({
      any: [
        { package_json_has: "@prisma/client" },
        { file_exists: "prisma/schema.prisma" },
      ],
    });
  });

  it("strips `fragments/` prefix from suggest", () => {
    const rules = parseRulebook(SAMPLE);
    expect(rules[0]!.suggest).toBe("prisma");
    expect(rules[1]!.suggest).toBe("k8s");
  });

  it("captures reason text", () => {
    const rules = parseRulebook(SAMPLE);
    expect(rules[0]!.reason).toContain("Prisma schema drift");
  });

  it("throws on duplicate rule id", () => {
    const md = `
## dup
- trigger: \`file_exists: a\`
- suggest: fragments/a

## dup
- trigger: \`file_exists: b\`
- suggest: fragments/b
`;
    expect(() => parseRulebook(md)).toThrow(/duplicate rule id/);
  });

  it("throws on invalid trigger expression", () => {
    const md = `
## broken
- trigger: \`unknown_atom: x\`
- suggest: fragments/x
`;
    expect(() => parseRulebook(md)).toThrow(RulebookParseError);
  });

  it("throws on broken trigger YAML", () => {
    const md = `
## broken
- trigger: \`any: { unclosed\`
- suggest: fragments/x
`;
    expect(() => parseRulebook(md)).toThrow(/YAML parse error/);
  });

  it("rejects empty suggest", () => {
    const md = `
## empty
- trigger: \`file_exists: a\`
- suggest: fragments/
`;
    expect(() => parseRulebook(md)).toThrow(/'suggest' must name a fragment/);
  });

  it("accepts suggest without fragments/ prefix", () => {
    const md = `
## bare
- trigger: \`file_exists: a\`
- suggest: k8s
`;
    const rules = parseRulebook(md);
    expect(rules[0]!.suggest).toBe("k8s");
  });

  it("ignores bullets that are not trigger/suggest/reason", () => {
    const md = `
## x
- trigger: \`file_exists: a\`
- suggest: fragments/x
- priority: high
- note: something
`;
    const rules = parseRulebook(md);
    expect(rules).toHaveLength(1);
  });
});

describe("loadRulebook", () => {
  it("returns empty array when rulebook.md is absent", () => {
    expect(loadRulebook(tmpDir())).toEqual([]);
  });

  it("reads and parses rulebook.md from library root", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "rulebook.md"), SAMPLE);
    const rules = loadRulebook(dir);
    expect(rules).toHaveLength(2);
  });

  it("parses the repo's actual rulebook.md without errors", () => {
    // This grounds the test suite in the real rulebook we ship.
    const repoRoot = path.resolve(__dirname, "..", "..", "..");
    const rulebookPath = path.join(repoRoot, "rulebook.md");
    expect(fs.existsSync(rulebookPath)).toBe(true);
    const rules = loadRulebook(repoRoot);
    // Must have at least the starter rules (prisma, k8s, nestjs, nextjs,
    // fastapi, python-uv, docker-compose) — 7 as of v0.1.
    expect(rules.length).toBeGreaterThanOrEqual(5);
    expect(rules.some((r) => r.suggest === "prisma")).toBe(true);
  });
});

describe("evaluateRules / matchingRules", () => {
  const rules = parseRulebook(SAMPLE);

  it("returns match status for every rule", () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "k8s"));
    const ctx = new ProjectContext(root);
    const results = evaluateRules(rules, ctx);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.rule.id === "k8s")?.matched).toBe(true);
    expect(results.find((r) => r.rule.id === "prisma")?.matched).toBe(false);
  });

  it("matchingRules filters to matches only", () => {
    const root = tmpDir();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { "@prisma/client": "^5" } }),
    );
    const ctx = new ProjectContext(root);
    const matched = matchingRules(rules, ctx);
    expect(matched.map((r) => r.id)).toEqual(["prisma"]);
  });

  it("matchingRules is empty when no rules match", () => {
    const ctx = new ProjectContext(tmpDir());
    expect(matchingRules(rules, ctx)).toEqual([]);
  });
});
