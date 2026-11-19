import { describe, expect, it } from "vitest";
import { applyKeywordFile } from "./user_pain_keywords.js";
import { UserPainSignal } from "./user_pain_vocabulary.js";
import { UserPainInputError } from "./user_pain_yaml.js";

const BASE = {
	[UserPainSignal.statusQuestion]: ["언제"],
	[UserPainSignal.repeatedCorrection]: ["몇번"],
	[UserPainSignal.strongComplaint]: ["젠장"],
};

describe("applyKeywordFile", () => {
	it("appends by default and replaces when asked", () => {
		const keywords = applyKeywordFile(
			[
				"status_question:",
				"  terms: [어디까지, 언제]",
				"strong_complaint:",
				"  mode: replace",
				"  terms: [가상불만]",
			].join("\n"),
			BASE,
		);
		expect(keywords).toEqual({
			[UserPainSignal.statusQuestion]: ["언제", "어디까지"],
			[UserPainSignal.repeatedCorrection]: ["몇번"],
			[UserPainSignal.strongComplaint]: ["가상불만"],
		});
	});

	it("keeps the base lists for an empty file", () => {
		expect(applyKeywordFile("", BASE)).toEqual(BASE);
	});

	it.each([
		["an unknown signal", "status_questions:\n  terms: [a]\n"],
		["an unknown mode", "status_question:\n  mode: merge\n  terms: [a]\n"],
		["an empty term", 'status_question:\n  terms: [""]\n'],
		["no terms", "status_question:\n  terms: []\n"],
		["an unknown field", "status_question:\n  terms: [a]\n  extra: 1\n"],
		["a list document", "- a\n"],
	])("rejects %s", (_label, source) => {
		expect(() => applyKeywordFile(source, BASE)).toThrow(UserPainInputError);
	});
});
