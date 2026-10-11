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
    expect(action.content).toContain("\n@AGENTS.md\n");
    expect(action.content).toContain("canonical cross-agent project memory");
    expect(action.content).toContain("anamnesis context query");
    expect(action.content).toContain("source_path");
    expect(action.content).toContain("/ontology-enrich");
    expect(action.content).toContain("/handoff-prepare");
  });

  it("limits startup handoff reads to active warm archives", () => {
    const { content } = planClaudeMdEntrypoint({ scopePath: ".", settings });
    expect(content).toContain("Current focus");
    expect(content).toContain("Active tasks");
    expect(content).toContain("warm\n  archives");
    expect(content).toContain("Recently completed");
    expect(content).not.toContain("referenced archive before continuing work");
  });

  it("plans scope-local CLAUDE.md for monorepo scopes", () => {
    const action = planClaudeMdEntrypoint({
      scopePath: "apps/api",
      settings,
    });

    expect(action.file).toBe("apps/api/CLAUDE.md");
    expect(action.content).toContain("\n@AGENTS.md\n");
  });

  it("marks Codex fallback sections as Codex-only for Claude", () => {
    const { content } = planClaudeMdEntrypoint({ scopePath: ".", settings });
    expect(content).toContain("fallbacks\n  for Codex only");
  });

  it("does not import the file into itself", () => {
    const { content } = planClaudeMdEntrypoint({
      scopePath: ".",
      settings: { ...settings, claude_md_path: "AGENTS.md" },
    });
    expect(content).not.toContain("@AGENTS.md");
  });

  it("imports AGENTS.md relative to a nested CLAUDE.md path", () => {
    const { content } = planClaudeMdEntrypoint({
      scopePath: ".",
      settings: { ...settings, claude_md_path: ".claude/CLAUDE.md" },
    });

    expect(content).toContain("\n@../AGENTS.md\n");
  });
});
