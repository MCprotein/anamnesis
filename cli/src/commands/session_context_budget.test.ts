import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sessionContextBudget } from "./session_context_budget.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(relRoot: string, relPath: string, text: string): void {
  const abs = path.join(relRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
}

describe("sessionContextBudget", () => {
  it("measures compact source-pointer payload for startup-active sources only", () => {
    const project = tmpDir("anamnesis-session-budget-");
    write(
      project,
      "system_graph.yaml",
      "invariants:\n  - rule: must preserve startup source pointers\n",
    );
    write(
      project,
      ".anamnesis/ontology/base.yaml",
      "rules:\n  - always read ontology before edits\n",
    );
    write(
      project,
      ".anamnesis/handoff/active.md",
      [
        "# Active handoff index",
        "",
        "## Current focus",
        "- continue budget fixture — archive: `.anamnesis/handoff/current.md`",
        "",
      ].join("\n"),
    );
    write(
      project,
      ".anamnesis/handoff/current.md",
      "# Handoff\n\n## Goal\nContinue.\n\n## Next steps\n1. Test.\n",
    );
    write(
      project,
      ".anamnesis/handoff/unreferenced.md",
      "# Handoff\n\n## Goal\nOld.\n\n## Next steps\n1. Ignore.\n",
    );

    const result = sessionContextBudget({
      projectRoot: project,
      now: () => new Date("2026-07-07T00:00:00.000Z"),
    });

    expect(result.capExceeded).toBe(false);
    expect(result.sourcePointers).toBe(4);
    expect(result.requiredRulesPresent).toBe(result.requiredRulesTotal);
    expect(result.sources.map((source) => source.path)).toEqual([
      "system_graph.yaml",
      ".anamnesis/ontology/base.yaml",
      ".anamnesis/handoff/active.md",
      ".anamnesis/handoff/current.md",
    ]);
    expect(result.activeTaskLines).toBe(1);
    expect(result.invariantDigestLines).toBeGreaterThanOrEqual(1);
  });

  it("flags compact payloads that exceed the configured token cap", () => {
    const project = tmpDir("anamnesis-session-budget-");
    write(
      project,
      "system_graph.yaml",
      [
        "invariants:",
        ...Array.from(
          { length: 30 },
          (_, index) => `  - rule: must keep generated context bounded ${index}`,
        ),
      ].join("\n"),
    );

    const result = sessionContextBudget({
      projectRoot: project,
      maxTokens: 10,
    });

    expect(result.capExceeded).toBe(true);
    expect(result.warnings[0]).toContain("exceeding budget 10");
  });
});
