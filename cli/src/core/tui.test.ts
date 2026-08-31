import { describe, expect, it } from "vitest";
import {
	createTui,
	shouldUseColor,
	shouldUseUnicode,
	stripAnsi,
	truncateText,
	visibleLength,
	wrapText,
} from "./tui.js";

describe("tui", () => {
	it("keeps plain output free of ANSI when color is disabled", () => {
		const ui = createTui({ color: false });

		const output = [
			...ui.title("Title", "subtitle"),
			...ui.section("Section"),
			...ui.commandRows([
				{ command: "anamnesis status", description: "Check state." },
			]),
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
		expect(shouldUseColor({ NO_COLOR: "1", FORCE_COLOR: "1" }, true)).toBe(
			false,
		);
		expect(shouldUseColor({ TERM: "dumb" }, true)).toBe(false);
	});

	it("wraps long descriptions without changing the command column", () => {
		const ui = createTui({ color: false, width: 40 });

		const lines = ui.commandRows([
			{
				command: "anamnesis apply --dry-run --allow-exec-adapters",
				description:
					"Preview project-managed changes, including executable adapter surfaces, before writing anything.",
			},
		]);

		expect(lines.length).toBeGreaterThan(1);
		expect(lines.join("").replaceAll(/\s/g, "")).toContain(
			"anamnesis apply --dry-run --allow-exec-adapters".replaceAll(" ", ""),
		);
		expect(lines.join("\n")).not.toContain("…");
		const wrappedBody = lines.slice(1).join(" ");
		expect(wrappedBody).toContain("adapter");
		expect(wrappedBody).toContain("surfaces");
		expect(lines.join("\n")).not.toContain("\x1b[");
	});

	it("renders a compact semantic summary at a wide terminal width", () => {
		const ui = createTui({ color: false, unicode: true, width: 100 });

		const output = [
			...ui.verdict({
				tone: "ready",
				label: "Ready",
				summary: "Project configuration is healthy.",
			}),
			...ui.section("Overview", 3),
			...ui.statusRows([
				{
					label: "Fragments",
					value: "1 in sync",
					tone: "success",
					detail: "base@23",
				},
				{
					label: "Codex hooks",
					value: "5/5 trusted",
					tone: "success",
					summary: "0 modified",
				},
			]),
		].join("\n");

		expect(output).toMatchInlineSnapshot(`
      "● Ready — Project configuration is healthy.

      Overview  3
        Fragments    1 in sync
        Codex hooks  5/5 trusted · 0 modified"
    `);
	});

	it("falls back to stacked rows and ASCII markers at a narrow width", () => {
		const ui = createTui({ color: false, unicode: false, width: 40 });

		const output = [
			...ui.verdict({
				tone: "warning",
				label: "Needs attention",
				summary:
					"Some installed hooks may not execute until they are reviewed.",
			}),
			...ui.statusRows([
				{
					label: "Codex hook trust status",
					value: "1 modified",
					tone: "warning",
					summary: "explicit approval required",
				},
			]),
			...ui.panel(
				"Next",
				"Run anamnesis hooks codex trust --dry-run before applying.",
				{
					tone: "warning",
				},
			),
		].join("\n");

		expect(output).toMatchInlineSnapshot(`
      "! Needs attention
        Some installed hooks may not execute
        until they are reviewed.
        Codex hook trust status
          1 modified · explicit approval
          required
      Next
        | Run anamnesis hooks codex trust
        | --dry-run before applying."
    `);
		for (const line of output.split("\n"))
			expect(visibleLength(line)).toBeLessThanOrEqual(40);
	});

	it("keeps details collapsed unless detailed output is requested", () => {
		const ui = createTui({ color: false, width: 80 });
		const row = {
			label: "Codex hooks",
			value: "5 trusted",
			detail: ["key: project:hook:0", "hash: sha256:123"],
		};

		expect(ui.statusRows([row]).join("\n")).not.toContain("sha256");
		expect(ui.statusRows([row], { detail: true }).join("\n")).toContain(
			"sha256:123",
		);
		expect(ui.detail("Runtime evidence", row.detail)).toEqual([
			"  Runtime evidence: 2 details",
		]);
		expect(
			ui.detail("Runtime evidence", row.detail, { expanded: true }),
		).toContain("    hash: sha256:123");
	});

	it("detects Unicode support and provides deterministic ASCII fallback", () => {
		expect(shouldUseUnicode({ LANG: "en_US.UTF-8" })).toBe(true);
		expect(shouldUseUnicode({ LANG: "C" })).toBe(false);
		expect(
			shouldUseUnicode({ ANAMNESIS_UNICODE: "0", LANG: "en_US.UTF-8" }),
		).toBe(false);
		expect(shouldUseUnicode({ ANAMNESIS_UNICODE: "1", TERM: "dumb" })).toBe(
			true,
		);
	});

	it("wraps and truncates long unbroken values with display-width awareness", () => {
		expect(wrapText("sha256:abcdefghijklmnopqrstuvwxyz", 10)).toEqual([
			"sha256:abc",
			"defghijklm",
			"nopqrstuvw",
			"xyz",
		]);
		expect(truncateText("한글-identifier", 8)).toBe("한글-id…");
		expect(visibleLength("한글")).toBe(4);
	});

	it("never breaks ANSI control sequences while wrapping styled text", () => {
		const styled = "\x1b[32mthis-is-a-very-long-styled-status-value\x1b[0m";
		const lines = wrapText(styled, 12);

		expect(lines.length).toBeGreaterThan(1);
		expect(lines.map(stripAnsi).join("")).toBe(
			"this-is-a-very-long-styled-status-value",
		);
		for (const line of lines) {
			expect(line).toMatch(/^\x1b\[32m.*\x1b\[0m$/);
		}
	});

	it("retains semantic tone when a colored status row wraps", () => {
		const ui = createTui({ color: true, unicode: true, width: 40 });
		const lines = ui.statusRows([
			{
				label: "Codex hook trust status",
				value: "1 modified",
				summary: "explicit approval required",
				tone: "warning",
			},
		]);

		expect(stripAnsi(lines.join(" ")).replaceAll(/\s+/g, " ")).toContain(
			"1 modified · explicit approval required",
		);
		for (const line of lines.slice(1)) {
			expect(line).toContain("\x1b[33m");
		}
	});

	it.each([48, 80, 120])(
		"keeps representative output within a %i-column terminal",
		(width) => {
			const ui = createTui({ color: false, unicode: true, width });
			const output = [
				...ui.verdict({
					tone: "warning",
					label: "Attention needed",
					summary:
						"One modified Codex hook requires explicit review before it can execute.",
				}),
				...ui.statusRows([
					{
						label: "Codex hooks",
						value: "4/5 runnable",
						summary: "1 modified",
						tone: "warning",
					},
				]),
				...ui.commandRows([
					{
						command: "anamnesis hooks codex trust --dry-run",
						description: "Review the exact runtime key and current hash.",
					},
				]),
			].join("\n");

			for (const line of output.split("\n")) {
				expect(visibleLength(line)).toBeLessThanOrEqual(width);
			}
			expect(output).toContain("--dry-run");
		},
	);
});
