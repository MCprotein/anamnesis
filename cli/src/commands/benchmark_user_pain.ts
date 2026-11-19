import * as fs from "node:fs";
import {
	summarizeUserPain,
	type UserPainSummary,
} from "../core/user_pain_aggregate.js";
import { applyKeywordFile } from "../core/user_pain_keywords.js";
import { parseCorrectionRules } from "../core/user_pain_rules.js";
import { parseExportTranscript } from "../core/user_pain_transcript.js";
import {
	DEFAULT_USER_PAIN_KEYWORDS,
	type UserPainKeywords,
} from "../core/user_pain_vocabulary.js";
import { UserPainInputError } from "../core/user_pain_yaml.js";

export interface UserPainBenchmarkOptions {
	exportPaths: readonly string[];
	rulesPath?: string;
	keywordsPath?: string;
	keywords?: UserPainKeywords;
	readFile?: (filePath: string) => string;
}

export class UserPainBenchmarkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UserPainBenchmarkError";
	}
}

function readOrThrow(
	readFile: (filePath: string) => string,
	filePath: string,
	label: string,
): string {
	try {
		return readFile(filePath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code ?? "read failed";
		throw new UserPainBenchmarkError(`cannot read ${label} (${code})`);
	}
}

function parseInput<T>(parse: () => T): T {
	try {
		return parse();
	} catch (error) {
		if (error instanceof UserPainInputError) {
			throw new UserPainBenchmarkError(error.message);
		}
		throw error;
	}
}

export function userPainBenchmark(
	options: UserPainBenchmarkOptions,
): UserPainSummary {
	if (options.exportPaths.length === 0) {
		throw new UserPainBenchmarkError(
			"benchmark user-pain requires at least one export file",
		);
	}
	const readFile =
		options.readFile ?? ((filePath: string) => fs.readFileSync(filePath, "utf8"));
	const { rulesPath, keywordsPath } = options;
	const rules =
		rulesPath === undefined
			? undefined
			: parseInput(() =>
					parseCorrectionRules(readOrThrow(readFile, rulesPath, "rules file")),
				);
	const baseKeywords = options.keywords ?? DEFAULT_USER_PAIN_KEYWORDS;
	const keywords =
		keywordsPath === undefined
			? baseKeywords
			: parseInput(() =>
					applyKeywordFile(
						readOrThrow(readFile, keywordsPath, "keywords file"),
						baseKeywords,
					),
				);
	const transcripts = options.exportPaths.map((filePath, index) => ({
		file: index + 1,
		utterances: parseExportTranscript(
			readOrThrow(readFile, filePath, `export file #${index + 1}`),
		),
	}));
	return summarizeUserPain(transcripts, keywords, rules);
}
