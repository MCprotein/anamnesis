import { describe, expect, it } from "vitest";
import { parseCorrectionRules } from "./user_pain_rules.js";
import { UserPainInputError } from "./user_pain_yaml.js";

describe("parseCorrectionRules", () => {
	it("reads banned_term rules and skips other kinds", () => {
		const rules = parseCorrectionRules(
			[
				"- id: banned-pan",
				"  kind: banned_term",
				'  pattern: "판"',
				'  allow: ["판매", "판단", "판정"]',
				"  scope: [assistant, teammate]",
				"  enforcement: warn",
				"- id: center-chip",
				"  kind: ui_rule",
				"  reminder: keep chips centered",
			].join("\n"),
		);
		expect(rules.bannedTerms).toEqual([
			{ id: "banned-pan", pattern: "판", allow: ["판매", "판단", "판정"] },
		]);
		expect(rules.skippedRuleIds).toEqual(["center-chip"]);
	});

	it("treats an empty file as no rules", () => {
		expect(parseCorrectionRules("")).toEqual({ bannedTerms: [], skippedRuleIds: [] });
	});

	it.each([
		["a kind typo", "- {id: a, kind: banned_terms, pattern: b}\n"],
		["a missing pattern", "- {id: a, kind: banned_term}\n"],
		["an empty allow entry", '- {id: a, kind: banned_term, pattern: b, allow: [""]}\n'],
		["an unknown field", "- {id: a, kind: banned_term, pattern: b, patern: c}\n"],
		["a pattern on ui_rule", "- {id: a, kind: ui_rule, pattern: b}\n"],
		["an unknown scope", "- {id: a, kind: ui_rule, scope: [everyone]}\n"],
		["a non-list document", "id: a\n"],
	])("rejects %s", (_label, source) => {
		expect(() => parseCorrectionRules(source)).toThrow(UserPainInputError);
	});

	it("rejects duplicate ids without printing them", () => {
		expect(() =>
			parseCorrectionRules(
				"- {id: secret-id, kind: banned_term, pattern: b}\n- {id: secret-id, kind: ui_rule}\n",
			),
		).toThrow(/^rules file: duplicate rule id at entry 1$/);
	});

	it("reports YAML errors by line and column without source text", () => {
		let message = "";
		try {
			parseCorrectionRules("- id: ok\n- id: [private words\n");
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toMatch(/^rules file: invalid YAML at line \d+, column \d+$/);
		expect(message).not.toContain("private");
	});

	it("reports schema errors by path and code without values", () => {
		expect(() =>
			parseCorrectionRules("- {id: a, kind: private-kind, pattern: b}\n"),
		).toThrow(/^rules file: invalid entries: 0\.kind \(invalid_union\)$/);
	});
});
