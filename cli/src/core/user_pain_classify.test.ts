import { describe, expect, it } from "vitest";
import {
	classifyUserInput,
	countBannedTerm,
	findRuleViolations,
} from "./user_pain_classify.js";
import {
	DEFAULT_USER_PAIN_KEYWORDS,
	UserPainSignal,
	UserPainSpeaker,
} from "./user_pain_vocabulary.js";

const PAN_RULE = {
	id: "banned-pan",
	pattern: "판",
	allow: ["판매", "판단", "판정"],
};

describe("classifyUserInput", () => {
	it.each([
		["지금 진행중이야?", true],
		["뭐 남았어? 어디까지 했어", true],
		["언제 끝나?", true],
		["브리핑 해줘", true],
		["화분 세 개 더 심어줘", false],
	])("classifies %s as a status question: %s", (text, expected) => {
		expect(
			classifyUserInput(text, DEFAULT_USER_PAIN_KEYWORDS).includes(
				UserPainSignal.statusQuestion,
			),
		).toBe(expected);
	});

	it("detects repeated correction phrases with or without spaces", () => {
		for (const text of ["몇 번 말해", "아직도 그대로네", "다시 말하지만 물은 아침에", "아까 그렇게 하라고 했어"]) {
			expect(classifyUserInput(text, DEFAULT_USER_PAIN_KEYWORDS)).toContain(
				UserPainSignal.repeatedCorrection,
			);
		}
	});

	it("detects strong complaints separately", () => {
		expect(classifyUserInput("젠장 또 깨졌네", DEFAULT_USER_PAIN_KEYWORDS)).toEqual([
			UserPainSignal.strongComplaint,
		]);
	});

	it("ignores case in signal keywords", () => {
		const keywords = {
			[UserPainSignal.statusQuestion]: ["ETA"],
			[UserPainSignal.repeatedCorrection]: [],
			[UserPainSignal.strongComplaint]: [],
		};
		expect(classifyUserInput("eta please", keywords)).toEqual([
			UserPainSignal.statusQuestion,
		]);
	});

	it("uses replaced keyword lists", () => {
		const keywords = {
			[UserPainSignal.statusQuestion]: ["status?"],
			[UserPainSignal.repeatedCorrection]: [],
			[UserPainSignal.strongComplaint]: [],
		};
		expect(classifyUserInput("Status?", keywords)).toEqual([
			UserPainSignal.statusQuestion,
		]);
		expect(classifyUserInput("언제", keywords)).toEqual([]);
	});
});

describe("banned term rules", () => {
	it("does not count allowed compounds as violations", () => {
		expect(countBannedTerm("판매 기록을 보고 판단하고 판정한다", PAN_RULE)).toBe(0);
	});

	it("counts the banned term next to allowed compounds", () => {
		expect(countBannedTerm("새 판 목록과 판매 기록, 전체 판", PAN_RULE)).toBe(2);
	});

	it("ignores case in the pattern and the allow list", () => {
		const rule = { id: "banned-draft", pattern: "Draft", allow: ["DRAFTING"] };
		expect(countBannedTerm("draft, DRAFT, Drafting", rule)).toBe(2);
	});

	it("reports speaker and line for each violation", () => {
		const violations = findRuleViolations(
			{
				speaker: UserPainSpeaker.teammate,
				startLine: 7,
				lines: [
					{ line: 7, text: "판단 결과" },
					{ line: 8, text: "새 판" },
				],
			},
			[PAN_RULE],
		);
		expect(violations).toEqual([
			{ ruleId: "banned-pan", speaker: UserPainSpeaker.teammate, line: 8 },
		]);
	});
});
