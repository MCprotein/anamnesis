import { describe, expect, it } from "vitest";
import {
	ambiguousWidthCharacters,
	CHIP,
	CHIP_WIDTH,
	createTui,
	LEVEL,
	resolveWidth,
	shouldUseColor,
	shouldUseUnicode,
	stripAnsi,
	truncateText,
	visibleLength,
	worstLevel,
	wrapText,
} from "./tui.js";

function displayColumn(line: string, characterIndex: number): number {
	return visibleLength([...stripAnsi(line)].slice(0, characterIndex).join(""));
}

function textColumnAfterChip(line: string): number {
	const plain = stripAnsi(line);
	const characters = [...plain];
	const close = characters.indexOf("]");
	let index = close + 1;
	while (characters[index] === " ") index += 1;
	return displayColumn(plain, index);
}

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
      "✓ Ready  Project configuration is healthy.

      Overview  3
        Fragments    1 in sync
        Codex hooks  5/5 trusted, 0 modified"
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
          1 modified, explicit approval
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
		expect(truncateText("한글-identifier", 8)).toBe("한글-...");
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
			"1 modified, explicit approval required",
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

	it("renders every chip with a fixed width and centered label", () => {
		const ui = createTui({ color: false });
		const chips = Object.values(CHIP).map((chip) => ui.chip(chip));

		expect(chips).toEqual([
			"[ OK ]",
			"[WARN]",
			"[FAIL]",
			"[INFO]",
			"[TODO]",
			"[WORK]",
		]);
		for (const chip of chips) expect(visibleLength(chip)).toBe(CHIP_WIDTH);
		const colored = createTui({ color: true }).chip(CHIP.ok);
		expect(colored).toContain("\x1b[");
		expect(stripAnsi(colored)).toBe("[ OK ]");
	});

	it.each([48, 80, 120])(
		"starts the text after every chip at the same display column at %i columns",
		(width) => {
			for (const color of [false, true]) {
				const ui = createTui({ color, unicode: true, width });
				const lines = ui.table([
					[ui.chip(CHIP.ok), "managed", "12/12 clean"],
					[ui.chip(CHIP.warn), "drift", "missing .git/hooks/pre-commit"],
					[ui.chip(CHIP.fail), "로그인", "로그인 화면 추가 요청이 실패했다"],
					[ui.chip(CHIP.work), "add-login-form", "로그인 화면 추가"],
					[ui.chip(CHIP.todo), "fix-docs", "문서 링크 고치기 (new)"],
					[ui.chip(CHIP.info), "evidence", "latest record is 30 days old"],
				]);
				const chipLines = lines.filter((line) => stripAnsi(line).includes("["));
				expect(chipLines).toHaveLength(6);
				const columns = new Set(chipLines.map(textColumnAfterChip));
				expect([...columns]).toEqual([2 + CHIP_WIDTH + 2]);
				const detailColumns = new Set(
					chipLines.map((line) => {
						const plain = stripAnsi(line);
						const detail = plain.slice(2 + CHIP_WIDTH + 2).match(/^\S+\s+/);
						return visibleLength(
							plain.slice(0, 2 + CHIP_WIDTH + 2 + (detail?.[0].length ?? 0)),
						);
					}),
				);
				expect(detailColumns.size).toBe(1);
				for (const line of lines)
					expect(visibleLength(line)).toBeLessThanOrEqual(width);
			}
		},
	);

	it("computes table columns across the whole block", () => {
		const ui = createTui({ color: true, width: 80 });
		const lines = ui.table(
			[
				["managed", ui.style("12/12", "success"), "clean", "1 fragment"],
				["continuity", ui.style("6/6", "success"), "checks", ""],
				["hooks", ui.style("5/5", "warning"), "runnable", "0 conflicts"],
			],
			[{}, { right: true }],
		);

		expect(lines.map(stripAnsi)).toEqual([
			"  managed     12/12  clean     1 fragment",
			"  continuity    6/6  checks",
			"  hooks         5/5  runnable  0 conflicts",
		]);
		expect(lines[0]).toContain("\x1b[32m12/12\x1b[0m");
		expect(lines[0]).not.toContain("\x1b[32mclean");
	});

	it("orders four verdict levels and renders them without ambiguous symbols", () => {
		expect(worstLevel([])).toBe(LEVEL.ready);
		expect(worstLevel([LEVEL.notice, LEVEL.ready])).toBe(LEVEL.notice);
		expect(worstLevel([LEVEL.notice, LEVEL.attention])).toBe(LEVEL.attention);
		expect(worstLevel([LEVEL.failed, LEVEL.attention])).toBe(LEVEL.failed);
		const unicode = createTui({ color: false, unicode: true, width: 80 });
		const ascii = createTui({ color: false, unicode: false, width: 80 });
		expect(Object.values(LEVEL).map((level) => unicode.level(level)[0])).toEqual([
			"\u2713 Ready",
			"i Notice",
			"! Attention",
			"\u2717 Failed",
		]);
		expect(Object.values(LEVEL).map((level) => ascii.level(level)[0])).toEqual([
			"OK Ready",
			"i Notice",
			"! Attention",
			"x Failed",
		]);
		expect(unicode.level(LEVEL.notice, "everything is in sync")).toEqual([
			"i Notice  everything is in sync",
		]);
	});

	it.each([true, false])(
		"keeps renderer output free of East Asian ambiguous-width symbols (unicode=%s)",
		(unicode) => {
			const ui = createTui({ color: true, unicode, width: 48 });
			const output = [
				...ui.heading("anamnesis status", "example-app"),
				...ui.title("anamnesis status", "example-app"),
				...Object.values(LEVEL).flatMap((level) =>
					ui.level(level, "a summary long enough to wrap onto another line here"),
				),
				...(["ready", "info", "warning", "error"] as const).flatMap((tone) =>
					ui.verdict({ tone, label: "Label", summary: "summary" }),
				),
				...Object.values(CHIP).map((chip) => ui.chip(chip)),
				...ui.table([["a", "b", "c"]]),
				...ui.statusRows([{ label: "a", value: "b", summary: "c" }]),
				...ui.panel("Next", ["one", "two"]),
				...ui.detail("Runtime", ["x"]),
				...ui.commandRows([{ command: "anamnesis doctor", description: "check" }]),
				ui.truncate("a-very-long-identifier-value", 10),
			].join("\n");

			expect(ambiguousWidthCharacters(output)).toEqual([]);
			expect(ambiguousWidthCharacters("\u25cf \u2014 \u2026 \u2502 \u2500 \u00b7")).toHaveLength(6);
		},
	);

	it("falls back to COLUMNS or 80 when the terminal reports zero width", () => {
		expect(resolveWidth(undefined, 0, "132")).toBe(132);
		expect(resolveWidth(undefined, 0, undefined)).toBe(80);
		expect(resolveWidth(undefined, 0, "0")).toBe(80);
		expect(resolveWidth(undefined, 100, "132")).toBe(100);
		expect(resolveWidth(60, 0, "132")).toBe(60);
	});

	it("lets NO_COLOR win over FORCE_COLOR", () => {
		expect(shouldUseColor({ NO_COLOR: "", FORCE_COLOR: "1" }, true)).toBe(false);
		expect(createTui({ env: { NO_COLOR: "1", FORCE_COLOR: "1" } }).color).toBe(
			false,
		);
	});
});
