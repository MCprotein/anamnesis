import { describe, expect, it } from "vitest";
import { parseExportTranscript, utteranceText } from "./user_pain_transcript.js";
import { UserPainSpeaker } from "./user_pain_vocabulary.js";

const FIXTURE = [
	" ▐▛███▜▌   Example CLI banner",
	"",
	"❯ 정원에 물 주는 일정 정리해줘",
	"  토마토는 이틀마다",
	"",
	"⏺ 일정을 정리합니다.",
	"  토마토: 이틀마다",
	"",
	"⏺ Bash(echo garden)",
	"  ⎿  garden",
	"     second output line",
	"",
	"@ greenhouse-helper❯",
	"  온실 담당입니다. 물 주기 검토만 합니다.",
	"",
	"@ soil-checker❯ 흙 상태 보고",
	"",
	"※ recap: 정원 일정",
	"",
	"❯ 끝났어?",
].join("\n");

describe("parseExportTranscript", () => {
	it("separates user, lead, tool, and teammate utterances", () => {
		const utterances = parseExportTranscript(FIXTURE);
		expect(utterances.map((u) => u.speaker)).toEqual([
			UserPainSpeaker.user,
			UserPainSpeaker.lead,
			UserPainSpeaker.lead,
			UserPainSpeaker.tool,
			UserPainSpeaker.teammate,
			UserPainSpeaker.teammate,
			UserPainSpeaker.user,
		]);
	});

	it("does not count teammate messages as lead or user", () => {
		const utterances = parseExportTranscript(FIXTURE);
		const teammates = utterances.filter(
			(u) => u.speaker === UserPainSpeaker.teammate,
		);
		expect(teammates.map((u) => u.startLine)).toEqual([13, 16]);
		expect(utteranceText(teammates[0]!)).toContain("온실 담당입니다");
		expect(utteranceText(teammates[1]!)).toBe("흙 상태 보고");
	});

	it("joins indented continuation lines and keeps line numbers", () => {
		const [first] = parseExportTranscript(FIXTURE);
		expect(first!.lines.map((row) => row.line)).toEqual([3, 4]);
		expect(utteranceText(first!)).toBe("정원에 물 주는 일정 정리해줘\n토마토는 이틀마다");
	});

	it("keeps tool output lines in the tool utterance", () => {
		const tool = parseExportTranscript(FIXTURE).find(
			(u) => u.speaker === UserPainSpeaker.tool,
		);
		expect(tool!.lines.map((row) => row.line)).toEqual([10, 11]);
	});

	it("does not start a user input at a column-0 marker inside a code fence", () => {
		const utterances = parseExportTranscript(
			[
				"⏺ 예시 입력입니다.",
				"  ```text",
				"❯ 코드 안의 예시 입력",
				"  ```",
				"",
				"❯ 실제 입력",
			].join("\n"),
		);
		expect(utterances.map((u) => [u.speaker, u.startLine])).toEqual([
			[UserPainSpeaker.lead, 1],
			[UserPainSpeaker.user, 6],
		]);
	});

	it("removes a leading byte order mark before parsing", () => {
		const [first] = parseExportTranscript("\uFEFF❯ 첫 입력\n");
		expect(first?.speaker).toBe(UserPainSpeaker.user);
		expect(first?.lines[0]?.text).toBe("첫 입력");
	});

	it("returns no utterances for empty input", () => {
		expect(parseExportTranscript("")).toEqual([]);
	});
});
