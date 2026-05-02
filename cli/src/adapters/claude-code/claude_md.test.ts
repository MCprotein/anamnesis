import { describe, expect, it } from "vitest";
import {
  CLAUDE_MD_REGION_ID,
  planClaudeMdEntrypoint,
} from "./claude_md.js";

const settings = {
  ontology_file: "system_graph.yaml",
  agents_md_path: "AGENTS.md",
  claude_md_path: "CLAUDE.md",
};

describe("Claude Code CLAUDE.md entrypoint", () => {
  it("plans a root CLAUDE.md managed region pointing at AGENTS.md", () => {
    const action = planClaudeMdEntrypoint({
      scopePath: ".",
      settings,
    });

    expect(action.kind).toBe("region");
    expect(action.file).toBe("CLAUDE.md");
    expect(action.regionId).toBe(CLAUDE_MD_REGION_ID);
    expect(action.content).toContain("Claude Code entrypoint");
    expect(action.content).toContain("`AGENTS.md` is the canonical");
    expect(action.content).toContain("/ontology-enrich");
    expect(action.content).toContain("/handoff-prepare");
  });

  it("plans scope-local CLAUDE.md for monorepo scopes", () => {
    const action = planClaudeMdEntrypoint({
      scopePath: "apps/api",
      settings,
    });

    expect(action.file).toBe("apps/api/CLAUDE.md");
  });
});
