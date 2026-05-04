import { describe, expect, it } from "vitest";
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
});
