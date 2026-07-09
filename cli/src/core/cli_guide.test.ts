import { describe, expect, it } from "vitest";
import { formatGettingStartedGuide } from "./cli_guide.js";

describe("formatGettingStartedGuide", () => {
  it("prints a concise first-run guide", () => {
    const output = formatGettingStartedGuide("1.2.3");

    expect(output).toContain("anamnesis 1.2.3");
    expect(output).toContain("Get started:");
    expect(output).toContain("anamnesis init --dry-run");
    expect(output).toContain("anamnesis init --tools all --allow-exec-adapters");
    expect(output).toContain("anamnesis doctor");
    expect(output).toContain("anamnesis status");
    expect(output).toContain("anamnesis apply --dry-run --allow-exec-adapters");
    expect(output).toContain("anamnesis apply --allow-exec-adapters");
    expect(output).toContain("anamnesis upgrade plan");
    expect(output).toContain("/ontology-enrich");
    expect(output).toContain("/handoff-prepare");
    expect(output).toContain("anamnesis --help");
  });
});
