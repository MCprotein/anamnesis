import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectMonorepo } from "./monorepo.js";
import type { Rule } from "./rulebook.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-mono-"));
}

function makePackageJson(
  dir: string,
  body: Record<string, unknown>,
): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(body, null, 2),
  );
}

const PRISMA_RULE: Rule = {
  id: "prisma",
  trigger: { package_json_has: "@prisma/client" },
  suggest: "prisma",
  reason: "test",
};

const NEXT_RULE: Rule = {
  id: "nextjs",
  trigger: { package_json_has: "next" },
  suggest: "nextjs",
  reason: "test",
};

const NEST_RULE: Rule = {
  id: "nestjs",
  trigger: { package_json_has: "@nestjs/core" },
  suggest: "nestjs",
  reason: "test",
};

const RULES: Rule[] = [PRISMA_RULE, NEXT_RULE, NEST_RULE];

// ---------------------------------------------------------------------------

describe("detectMonorepo — non-monorepo cases", () => {
  it("returns isMonorepo=false when no package.json", () => {
    const root = tmp();
    expect(detectMonorepo(root, RULES)).toEqual({
      isMonorepo: false,
      declaredVia: null,
      scopes: [],
      emptyScopes: [],
    });
  });

  it("returns isMonorepo=false when package.json has no workspaces field", () => {
    const root = tmp();
    makePackageJson(root, { name: "single-app", dependencies: {} });
    const result = detectMonorepo(root, RULES);
    expect(result.isMonorepo).toBe(false);
  });

  it("ignores invalid package.json (malformed JSON)", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "package.json"), "{not json");
    const result = detectMonorepo(root, RULES);
    expect(result.isMonorepo).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("detectMonorepo — package.json workspaces", () => {
  let root: string;

  beforeEach(() => {
    root = tmp();
  });

  it("detects workspaces array form", () => {
    makePackageJson(root, {
      name: "monorepo",
      workspaces: ["apps/*", "libs/*"],
    });
    fs.mkdirSync(path.join(root, "apps"));
    fs.mkdirSync(path.join(root, "libs"));
    const result = detectMonorepo(root, RULES);
    expect(result.isMonorepo).toBe(true);
    expect(result.declaredVia).toBe("package_json_workspaces");
  });

  it("detects workspaces object form (yarn classic)", () => {
    makePackageJson(root, {
      name: "monorepo",
      workspaces: { packages: ["apps/*"] },
    });
    fs.mkdirSync(path.join(root, "apps"));
    expect(detectMonorepo(root, RULES).isMonorepo).toBe(true);
  });

  it("expands glob patterns to actual sub-directories", () => {
    makePackageJson(root, {
      name: "monorepo",
      workspaces: ["apps/*"],
    });
    makePackageJson(path.join(root, "apps/api"), {
      name: "api",
      dependencies: { "@nestjs/core": "^10" },
    });
    makePackageJson(path.join(root, "apps/web"), {
      name: "web",
      dependencies: { next: "^14" },
    });
    const result = detectMonorepo(root, RULES);
    expect(result.scopes.map((s) => s.path).sort()).toEqual([
      "apps/api",
      "apps/web",
    ]);
  });

  it("matches rules per-scope (each app gets its own fragment match)", () => {
    makePackageJson(root, {
      name: "monorepo",
      workspaces: ["apps/*"],
    });
    makePackageJson(path.join(root, "apps/api"), {
      dependencies: { "@nestjs/core": "^10", "@prisma/client": "^5" },
    });
    makePackageJson(path.join(root, "apps/web"), {
      dependencies: { next: "^14" },
    });
    const result = detectMonorepo(root, RULES);
    const api = result.scopes.find((s) => s.path === "apps/api")!;
    const web = result.scopes.find((s) => s.path === "apps/web")!;
    expect(api.matchedRules.map((r) => r.suggest).sort()).toEqual([
      "nestjs",
      "prisma",
    ]);
    expect(web.matchedRules.map((r) => r.suggest)).toEqual(["nextjs"]);
  });

  it("reports empty scopes (dirs with no rulebook hits) separately", () => {
    makePackageJson(root, {
      name: "monorepo",
      workspaces: ["libs/*"],
    });
    makePackageJson(path.join(root, "libs/shared"), {
      dependencies: { lodash: "^4" }, // no rule matches
    });
    const result = detectMonorepo(root, RULES);
    expect(result.scopes).toHaveLength(0);
    expect(result.emptyScopes).toEqual(["libs/shared"]);
  });

  it("ignores patterns whose base dir does not exist", () => {
    makePackageJson(root, {
      name: "monorepo",
      workspaces: ["apps/*", "ghost/*"],
    });
    fs.mkdirSync(path.join(root, "apps"));
    makePackageJson(path.join(root, "apps/x"), {
      dependencies: { next: "^14" },
    });
    const result = detectMonorepo(root, RULES);
    expect(result.scopes.map((s) => s.path)).toEqual(["apps/x"]);
  });

  it("supports exact (non-glob) workspace paths", () => {
    makePackageJson(root, {
      name: "monorepo",
      workspaces: ["one-app"],
    });
    makePackageJson(path.join(root, "one-app"), {
      dependencies: { next: "^14" },
    });
    const result = detectMonorepo(root, RULES);
    expect(result.scopes.map((s) => s.path)).toEqual(["one-app"]);
  });

  it("returns sorted, de-duplicated scope paths", () => {
    makePackageJson(root, {
      name: "monorepo",
      workspaces: ["apps/*", "apps/*"], // duplicate pattern
    });
    makePackageJson(path.join(root, "apps/b"), {
      dependencies: { next: "^14" },
    });
    makePackageJson(path.join(root, "apps/a"), {
      dependencies: { "@nestjs/core": "^10" },
    });
    const result = detectMonorepo(root, RULES);
    expect(result.scopes.map((s) => s.path)).toEqual(["apps/a", "apps/b"]);
  });
});
