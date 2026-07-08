import { describe, expect, it } from "vitest";
import { formatInitNextStepLines } from "./init_next_steps.js";

describe("formatInitNextStepLines", () => {
  it("points dry-runs at the reviewed apply command", () => {
    expect(
      formatInitNextStepLines({
        writtenToDisk: false,
        blockedWrites: 0,
        tools: ["claude-code", "codex", "cursor"],
      }),
    ).toEqual(
      expect.arrayContaining([
        "    apply reviewed plan: anamnesis init --tools all --allow-exec-adapters",
        expect.stringContaining("/ontology-enrich"),
        expect.stringContaining("/handoff-prepare"),
      ]),
    );
  });

  it("points applied installs at verification and status commands", () => {
    expect(
      formatInitNextStepLines({
        writtenToDisk: true,
        blockedWrites: 0,
        tools: ["claude-code", "codex", "cursor"],
      }),
    ).toEqual(
      expect.arrayContaining([
        "    verify install: anamnesis doctor",
        "    inspect status: anamnesis status",
      ]),
    );
  });

  it("explains blocked executable adapter writes", () => {
    expect(
      formatInitNextStepLines({
        writtenToDisk: true,
        blockedWrites: 3,
        tools: ["claude-code"],
      }).join("\n"),
    ).toContain("blocked executable surfaces");
  });
});
