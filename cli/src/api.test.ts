import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  fragmentAdapterEnabled,
  parseAgentfile,
  stringifyAgentfile,
  type Fragment,
} from "./api.js";

describe("public API boundary", () => {
  it("exports Agentfile parse/stringify utilities", () => {
    const agentfile = parseAgentfile(`
version: 1
project:
  name: api-fixture
tools:
  - claude-code
fragments:
  - id: base
    version: 1
`);

    expect(agentfile.project.name).toBe("api-fixture");
    expect(parseAgentfile(stringifyAgentfile(agentfile))).toEqual(agentfile);
  });

  it("exports fragment adapter helper", () => {
    const fragment: Fragment = {
      id: "base",
      version: 1,
      adapters: { cursor: false },
    };

    expect(fragmentAdapterEnabled(fragment, "claude-code")).toBe(true);
    expect(fragmentAdapterEnabled(fragment, "cursor")).toBe(false);
  });

  it("keeps package exports limited to the public API and package metadata", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { exports: unknown };

    expect(pkg.exports).toEqual({
      ".": {
        types: "./cli/dist/api.d.ts",
        import: "./cli/dist/api.js",
      },
      "./package.json": "./package.json",
    });
  });
});
