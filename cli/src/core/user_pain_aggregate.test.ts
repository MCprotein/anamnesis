import { describe, expect, it } from "vitest";
import { summarizeUserPain } from "./user_pain_aggregate.js";
import { parseExportTranscript } from "./user_pain_transcript.js";
import {
	DEFAULT_USER_PAIN_KEYWORDS,
	UserPainSignal,
} from "./user_pain_vocabulary.js";

const RULES = {
	bannedTerms: [{ id: "banned-pan", pattern: "판", allow: ["판매", "판단", "판정"] }],
	skippedRuleIds: ["center-chip"],
};

const FIRST = ["❯ 화분 진행중이야?", "", "⏺ 새 판으로 정리했습니다.", ""].join("\n");
const SECOND = [
	"❯ 몇 번 말했잖아, 판매 기록만 봐",
	"",
	"⏺ 판단 기준을 고칩니다.",
	"",
	"@ market-helper❯",
	"  전체 판 다시 적재",
	"",
	"⏺ Read(notes.md)",
	"  ⎿  새 판 목록",
	"",
	"❯ 남은 일 언제 끝나? 젠장",
].join("\n");

describe("summarizeUserPain", () => {
	it("returns zero counts and ratios for empty input", () => {
		const summary = summarizeUserPain(
			[{ file: 1, utterances: parseExportTranscript("") }],
			DEFAULT_USER_PAIN_KEYWORDS,
		);
		expect(summary.userInputs).toBe(0);
		expect(summary.signals[UserPainSignal.statusQuestion]).toEqual({
			count: 0,
			ratio: 0,
			locations: [],
		});
		expect(summary.rules).toBeUndefined();
	});

	it("adds counts across files and keeps file-local line numbers", () => {
		const summary = summarizeUserPain(
			[
				{ file: 1, utterances: parseExportTranscript(FIRST) },
				{ file: 2, utterances: parseExportTranscript(SECOND) },
			],
			DEFAULT_USER_PAIN_KEYWORDS,
			RULES,
		);
		expect(summary.userInputs).toBe(3);
		expect(summary.files.map((f) => f.userInputs)).toEqual([1, 2]);
		expect(summary.utterances).toEqual({ user: 3, lead: 3, teammate: 1, tool: 1 });
		expect(summary.signals[UserPainSignal.statusQuestion]).toMatchObject({
			count: 2,
			ratio: 0.6667,
			locations: [
				{ file: 1, line: 1 },
				{ file: 2, line: 11 },
			],
		});
		expect(summary.signals[UserPainSignal.repeatedCorrection].count).toBe(1);
		expect(summary.signals[UserPainSignal.strongComplaint].count).toBe(1);
		expect(summary.rules).toMatchObject({
			ruleCount: 1,
			skippedRuleIds: ["center-chip"],
			total: 3,
			bySpeaker: { user: 0, lead: 1, teammate: 1, tool: 1 },
		});
		expect(summary.rules!.rules[0]!.locations).toEqual([
			{ file: 1, line: 3, speaker: "lead" },
			{ file: 2, line: 6, speaker: "teammate" },
			{ file: 2, line: 9, speaker: "tool" },
		]);
	});
});
