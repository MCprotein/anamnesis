import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";

function parse(...args: string[]) {
	return parseArgs(["node", "anamnesis", ...args]);
}

describe("parseArgs", () => {
	it("treats --json as a boolean even when a positional follows", () => {
		expect(parse("benchmark", "user-pain", "--json", "a.txt", "b.txt")).toEqual({
			command: "benchmark",
			positional: ["user-pain", "a.txt", "b.txt"],
			flags: { json: true },
		});
	});

	it("keeps value flags consuming the next argument", () => {
		expect(
			parse("context", "query", "--project-root", "/repo", "--json", "terms"),
		).toEqual({
			command: "context",
			positional: ["query", "terms"],
			flags: { "project-root": "/repo", json: true },
		});
	});

	it("keeps --json before another flag and explicit --flag=value forms", () => {
		expect(parse("status", "--json", "--output", "out.md")).toEqual({
			command: "status",
			positional: [],
			flags: { json: true, output: "out.md" },
		});
		expect(parse("status", "--output=out.md", "-v").flags).toEqual({
			output: "out.md",
			v: true,
		});
	});
});
