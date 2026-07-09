import { describe, expect, it } from "vitest";
import { createTui, shouldUseColor, stripAnsi } from "./tui.js";

describe("tui", () => {
  it("keeps plain output free of ANSI when color is disabled", () => {
    const ui = createTui({ color: false });

    const output = [
      ...ui.title("Title", "subtitle"),
      ...ui.section("Section"),
      ...ui.commandRows([{ command: "anamnesis status", description: "Check state." }]),
      ...ui.keyValues([{ key: "status", value: "ok", tone: "success" }]),
    ].join("\n");

    expect(output).not.toContain("\x1b[");
    expect(output).toContain("Title");
    expect(output).toContain("anamnesis status");
    expect(stripAnsi(output)).toBe(output);
  });

  it("adds ANSI color only when enabled", () => {
    const ui = createTui({ color: true });

    const output = ui.section("Section").join("\n");

    expect(output).toContain("\x1b[");
    expect(stripAnsi(output)).toBe("\nSection");
  });

  it("honors color environment switches", () => {
    expect(shouldUseColor({ FORCE_COLOR: "1" }, false)).toBe(true);
    expect(shouldUseColor({ ANAMNESIS_FORCE_COLOR: "1" }, false)).toBe(true);
    expect(shouldUseColor({ NO_COLOR: "1", FORCE_COLOR: "1" }, true)).toBe(false);
    expect(shouldUseColor({ TERM: "dumb" }, true)).toBe(false);
  });

  it("wraps long descriptions without changing the command column", () => {
    const ui = createTui({ color: false, width: 64 });

    const lines = ui.commandRows([
      {
        command: "anamnesis apply --dry-run --allow-exec-adapters",
        description:
          "Preview project-managed changes, including executable adapter surfaces, before writing anything.",
      },
    ]);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain("anamnesis apply --dry-run --allow-exec-adapters");
    const wrappedBody = lines.slice(1).join(" ");
    expect(wrappedBody).toContain("adapter");
    expect(wrappedBody).toContain("surfaces");
    expect(lines.join("\n")).not.toContain("\x1b[");
  });
});
