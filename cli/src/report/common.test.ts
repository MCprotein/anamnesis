import { describe, expect, it } from "vitest";
import { CHIP, createTui, LEVEL, visibleLength } from "../core/tui.js";
import { type Finding, findingLevel, findingLines, metric } from "./common.js";

const findings: Finding[] = [
	{
		chip: CHIP.warn,
		topic: "drift",
		detail: "missing .git/hooks/pre-commit and a long tail that has to wrap",
		more: ["first extra line that is also long enough to wrap around"],
	},
	{ chip: CHIP.info, topic: "evidence", detail: "latest record is stale" },
];

function leadingSpaces(line: string): number {
	return line.length - line.trimStart().length;
}

describe("findingLines", () => {
	it("hangs wrapped detail and extra lines at one column", () => {
		const ui = createTui({ color: false, width: 60 });
		const lines = findingLines(ui, findings);
		const continuation = lines.filter((line) => !line.trimStart().startsWith("["));

		expect(continuation.length).toBeGreaterThanOrEqual(2);
		expect(new Set(continuation.map(leadingSpaces))).toEqual(
			new Set([lines[0]?.indexOf("missing")]),
		);
	});

	it("wraps a long topic inside the width in stacked mode", () => {
		const ui = createTui({ color: false, width: 40 });
		const lines = findingLines(ui, [
			{
				chip: CHIP.fail,
				topic: "continuity-adapter-surface-missing-and-more-text",
				detail: "detail",
			},
		]);

		for (const line of lines) expect(visibleLength(line)).toBeLessThanOrEqual(40);
		expect(new Set(lines.slice(1).map(leadingSpaces))).toEqual(new Set([10]));
	});

	it("maps chips to levels and colors problem counts", () => {
		expect(findingLevel([{ chip: CHIP.fail, topic: "a", detail: "b" }])).toBe(
			LEVEL.failed,
		);
		expect(findingLevel([{ chip: CHIP.todo, topic: "a", detail: "b" }])).toBe(
			LEVEL.ready,
		);
		const ui = createTui({ color: true });
		expect(metric(ui, 2, false, "danger")).toBe("\x1b[31m2\x1b[0m");
		expect(metric(ui, 0, true)).toBe("\x1b[32m0\x1b[0m");
	});
});
