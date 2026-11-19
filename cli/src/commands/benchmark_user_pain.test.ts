import { describe, expect, it } from "vitest";
import { createTui } from "../core/tui.js";
import { formatUserPainBenchmark } from "../report/benchmark_user_pain.js";
import {
	UserPainBenchmarkError,
	userPainBenchmark,
} from "./benchmark_user_pain.js";

const FILES: Record<string, string> = {
	"a.txt": "❯ 언제 끝나? 비밀정원\n\n⏺ 새 판 준비\n",
	"b.txt": "❯ 아직도 판정 안 했어?\n\n@ seed-helper❯ 판매 목록 확인\n",
	"keywords.yaml": "strong_complaint:\n  terms: [비밀정원]\n",
	"broken.yaml": "status_question: [unclosed\n",
	"rules.yaml":
		'- id: banned-pan\n  kind: banned_term\n  pattern: "판"\n  allow: ["판매", "판단", "판정"]\n',
};

function readFile(filePath: string): string {
	const content = FILES[filePath];
	if (content === undefined) {
		throw Object.assign(new Error(`missing ${filePath}`), { code: "ENOENT" });
	}
	return content;
}

describe("userPainBenchmark", () => {
	it("sums several export files and applies rules", () => {
		const result = userPainBenchmark({
			exportPaths: ["a.txt", "b.txt"],
			rulesPath: "rules.yaml",
			readFile,
		});
		expect(result.userInputs).toBe(2);
		expect(result.rules?.total).toBe(1);
		expect(result.rules?.bySpeaker.lead).toBe(1);
		expect(result.rules?.bySpeaker.teammate).toBe(0);
	});

	it("adds keywords from --keywords and reports YAML errors by position", () => {
		const result = userPainBenchmark({
			exportPaths: ["a.txt"],
			keywordsPath: "keywords.yaml",
			readFile,
		});
		expect(result.signals.strong_complaint.count).toBe(1);
		expect(() =>
			userPainBenchmark({ exportPaths: ["a.txt"], keywordsPath: "broken.yaml", readFile }),
		).toThrow(/^keywords file: invalid YAML at line \d+, column \d+$/);
	});

	it("omits rule metrics when no rules file is given", () => {
		const result = userPainBenchmark({ exportPaths: ["a.txt"], readFile });
		expect(result.rules).toBeUndefined();
	});

	it("never puts transcript text or file paths in JSON or human output", () => {
		const result = userPainBenchmark({
			exportPaths: ["a.txt", "b.txt"],
			rulesPath: "rules.yaml",
			readFile,
		});
		const human = formatUserPainBenchmark(
			result,
			createTui({ color: false, width: 100 }),
		).join("\n");
		for (const output of [JSON.stringify(result), human]) {
			expect(output).not.toContain("비밀정원");
			expect(output).not.toContain("a.txt");
			expect(output).not.toContain("판매");
		}
		expect(human).toContain("status_question");
		expect(human).toContain("banned-pan");
	});

	it("reports a missing rules section in human output", () => {
		const human = formatUserPainBenchmark(
			userPainBenchmark({ exportPaths: ["a.txt"], readFile }),
			createTui({ color: false, width: 100 }),
		).join("\n");
		expect(human).toContain("skipped: no --rules file");
	});

	it("fails without export files or with unreadable files", () => {
		expect(() => userPainBenchmark({ exportPaths: [], readFile })).toThrow(
			UserPainBenchmarkError,
		);
		expect(() =>
			userPainBenchmark({ exportPaths: ["missing.txt"], readFile }),
		).toThrow(/export file #1 \(ENOENT\)/);
		expect(() =>
			userPainBenchmark({ exportPaths: ["a.txt"], rulesPath: "none.yaml", readFile }),
		).toThrow(/rules file/);
	});
});
