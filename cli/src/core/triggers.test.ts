import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseTriggerYaml,
  evaluateTrigger,
  ProjectContext,
  TriggerEvalError,
  type TriggerExpr,
} from "./triggers.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-trig-"));
}

describe("parseTriggerYaml", () => {
  it("parses an atom", () => {
    const e = parseTriggerYaml(`package_json_has: "@prisma/client"`);
    expect(e).toEqual({ package_json_has: "@prisma/client" });
  });

  it("parses all atoms", () => {
    expect(parseTriggerYaml("file_exists: prisma/schema.prisma")).toEqual({
      file_exists: "prisma/schema.prisma",
    });
    expect(parseTriggerYaml("dir_exists: k8s")).toEqual({ dir_exists: "k8s" });
    expect(parseTriggerYaml("pyproject_has: fastapi")).toEqual({
      pyproject_has: "fastapi",
    });
    expect(parseTriggerYaml("any_yaml_contains: apiVersion")).toEqual({
      any_yaml_contains: "apiVersion",
    });
  });

  it("parses `any` combinator with flow-style inline YAML", () => {
    const yaml = `any: [package_json_has: "@prisma/client", file_exists: prisma/schema.prisma]`;
    const e = parseTriggerYaml(yaml) as Extract<TriggerExpr, { any: unknown }>;
    expect(e.any).toHaveLength(2);
    expect(e.any[0]).toEqual({ package_json_has: "@prisma/client" });
    expect(e.any[1]).toEqual({ file_exists: "prisma/schema.prisma" });
  });

  it("parses `all` combinator with block-style YAML", () => {
    const yaml = `
all:
  - file_exists: Dockerfile
  - file_exists: docker-compose.yml
`;
    const e = parseTriggerYaml(yaml) as Extract<TriggerExpr, { all: unknown }>;
    expect(e.all).toHaveLength(2);
  });

  it("parses nested combinators", () => {
    const yaml = `
any:
  - all:
      - file_exists: a
      - file_exists: b
  - file_exists: c
`;
    const e = parseTriggerYaml(yaml) as Extract<TriggerExpr, { any: unknown }>;
    expect(e.any).toHaveLength(2);
    expect("all" in e.any[0]!).toBe(true);
  });

  it("rejects unknown atom", () => {
    expect(() => parseTriggerYaml("unknown_key: x")).toThrow(TriggerEvalError);
  });

  it("rejects mixed keys in single atom", () => {
    expect(() =>
      parseTriggerYaml("{package_json_has: a, file_exists: b}"),
    ).toThrow(TriggerEvalError);
  });

  it("rejects broken YAML", () => {
    expect(() => parseTriggerYaml("any: { unclosed")).toThrow(
      /YAML parse error/,
    );
  });
});

describe("evaluateTrigger — atoms", () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(() => {
    root = tmpProject();
    ctx = new ProjectContext(root);
  });

  it("package_json_has: true when dep present", () => {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { "@prisma/client": "^5.0.0" } }),
    );
    ctx = new ProjectContext(root);
    expect(evaluateTrigger({ package_json_has: "@prisma/client" }, ctx)).toBe(
      true,
    );
  });

  it("package_json_has: false when dep absent", () => {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { express: "^4" } }),
    );
    ctx = new ProjectContext(root);
    expect(evaluateTrigger({ package_json_has: "@prisma/client" }, ctx)).toBe(
      false,
    );
  });

  it("package_json_has: searches all dep sections", () => {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        devDependencies: { typescript: "^5" },
        peerDependencies: { react: "^18" },
      }),
    );
    ctx = new ProjectContext(root);
    expect(evaluateTrigger({ package_json_has: "typescript" }, ctx)).toBe(true);
    expect(evaluateTrigger({ package_json_has: "react" }, ctx)).toBe(true);
  });

  it("package_json_has: false when package.json missing", () => {
    expect(evaluateTrigger({ package_json_has: "x" }, ctx)).toBe(false);
  });

  it("file_exists / dir_exists", () => {
    fs.writeFileSync(path.join(root, "Dockerfile"), "FROM alpine");
    fs.mkdirSync(path.join(root, "k8s"));
    expect(evaluateTrigger({ file_exists: "Dockerfile" }, ctx)).toBe(true);
    expect(evaluateTrigger({ file_exists: "missing.txt" }, ctx)).toBe(false);
    expect(evaluateTrigger({ dir_exists: "k8s" }, ctx)).toBe(true);
    expect(evaluateTrigger({ dir_exists: "missing-dir" }, ctx)).toBe(false);
    // file is not a directory
    expect(evaluateTrigger({ dir_exists: "Dockerfile" }, ctx)).toBe(false);
  });

  it("pyproject_has: substring match", () => {
    fs.writeFileSync(
      path.join(root, "pyproject.toml"),
      `[project]\ndependencies = ["fastapi>=0.100", "pydantic"]`,
    );
    ctx = new ProjectContext(root);
    expect(evaluateTrigger({ pyproject_has: "fastapi" }, ctx)).toBe(true);
    expect(evaluateTrigger({ pyproject_has: "django" }, ctx)).toBe(false);
  });

  it("any_yaml_contains: scans yaml files recursively", () => {
    fs.mkdirSync(path.join(root, "k8s"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "k8s", "deploy.yaml"),
      "apiVersion: apps/v1\nkind: Deployment",
    );
    fs.writeFileSync(path.join(root, "config.yml"), "server:\n  port: 8080");
    expect(evaluateTrigger({ any_yaml_contains: "apiVersion" }, ctx)).toBe(
      true,
    );
    expect(evaluateTrigger({ any_yaml_contains: "NOT_PRESENT" }, ctx)).toBe(
      false,
    );
  });

  it("any_yaml_contains: skips node_modules / .git", () => {
    fs.mkdirSync(path.join(root, "node_modules", "junk"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "node_modules", "junk", "bad.yaml"),
      "apiVersion: must-ignore",
    );
    expect(evaluateTrigger({ any_yaml_contains: "apiVersion" }, ctx)).toBe(
      false,
    );
  });
});

describe("evaluateTrigger — combinators", () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(() => {
    root = tmpProject();
    ctx = new ProjectContext(root);
  });

  it("any: true if at least one matches", () => {
    fs.writeFileSync(path.join(root, "a"), "");
    const expr: TriggerExpr = {
      any: [{ file_exists: "a" }, { file_exists: "b" }],
    };
    expect(evaluateTrigger(expr, ctx)).toBe(true);
  });

  it("any: false if none match", () => {
    const expr: TriggerExpr = {
      any: [{ file_exists: "a" }, { file_exists: "b" }],
    };
    expect(evaluateTrigger(expr, ctx)).toBe(false);
  });

  it("all: true only if all match", () => {
    fs.writeFileSync(path.join(root, "a"), "");
    fs.writeFileSync(path.join(root, "b"), "");
    expect(
      evaluateTrigger(
        { all: [{ file_exists: "a" }, { file_exists: "b" }] },
        ctx,
      ),
    ).toBe(true);
  });

  it("all: false if one missing", () => {
    fs.writeFileSync(path.join(root, "a"), "");
    expect(
      evaluateTrigger(
        { all: [{ file_exists: "a" }, { file_exists: "b" }] },
        ctx,
      ),
    ).toBe(false);
  });

  it("nested: any of { all } / atom", () => {
    fs.writeFileSync(path.join(root, "a"), "");
    fs.writeFileSync(path.join(root, "b"), "");
    // Matches because { all: [a, b] } is true.
    expect(
      evaluateTrigger(
        {
          any: [
            { all: [{ file_exists: "a" }, { file_exists: "b" }] },
            { file_exists: "nonexistent" },
          ],
        },
        ctx,
      ),
    ).toBe(true);
  });
});

describe("ProjectContext caching", () => {
  it("reads package.json once even across multiple evaluations", () => {
    const root = tmpProject();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { x: "1" } }),
    );
    const ctx = new ProjectContext(root);
    const first = ctx.packageJsonDeps();
    // Mutate the file on disk; cached result should NOT update.
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { y: "2" } }),
    );
    const second = ctx.packageJsonDeps();
    expect(second).toBe(first);
    expect(second).toEqual({ x: "1" });
  });
});
