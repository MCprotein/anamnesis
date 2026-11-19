import { classifyUserInput, findRuleViolations } from "./user_pain_classify.js";
import type { CorrectionRuleSet } from "./user_pain_rules.js";
import {
	type TranscriptUtterance,
	utteranceText,
} from "./user_pain_transcript.js";
import {
	USER_PAIN_SIGNALS,
	USER_PAIN_SPEAKERS,
	type UserPainKeywords,
	type UserPainSignal,
	UserPainSpeaker,
} from "./user_pain_vocabulary.js";

export const USER_PAIN_SCHEMA_VERSION = "anamnesis.benchmark_user_pain.v1";

export interface UserPainTranscript {
	file: number;
	utterances: TranscriptUtterance[];
}

export interface UserPainLocation {
	file: number;
	line: number;
}

export interface UserPainSignalSummary {
	count: number;
	ratio: number;
	locations: UserPainLocation[];
}

export interface UserPainRuleSummary {
	ruleId: string;
	total: number;
	bySpeaker: Record<UserPainSpeaker, number>;
	locations: Array<UserPainLocation & { speaker: UserPainSpeaker }>;
}

export interface UserPainRulesSummary {
	ruleCount: number;
	skippedRuleIds: string[];
	total: number;
	bySpeaker: Record<UserPainSpeaker, number>;
	rules: UserPainRuleSummary[];
}

export interface UserPainFileSummary {
	file: number;
	userInputs: number;
	utterances: Record<UserPainSpeaker, number>;
}

export interface UserPainSummary {
	schema_version: typeof USER_PAIN_SCHEMA_VERSION;
	files: UserPainFileSummary[];
	userInputs: number;
	utterances: Record<UserPainSpeaker, number>;
	signals: Record<UserPainSignal, UserPainSignalSummary>;
	rules?: UserPainRulesSummary;
}

function speakerCounts(): Record<UserPainSpeaker, number> {
	return Object.fromEntries(
		USER_PAIN_SPEAKERS.map((speaker) => [speaker, 0]),
	) as Record<UserPainSpeaker, number>;
}

function ratio(count: number, total: number): number {
	return total === 0 ? 0 : Math.round((count / total) * 10_000) / 10_000;
}

function summarizeRules(
	transcripts: readonly UserPainTranscript[],
	rules: CorrectionRuleSet,
): UserPainRulesSummary {
	const byRule = new Map<string, UserPainRuleSummary>(
		rules.bannedTerms.map((rule) => [
			rule.id,
			{ ruleId: rule.id, total: 0, bySpeaker: speakerCounts(), locations: [] },
		]),
	);
	const bySpeaker = speakerCounts();
	let total = 0;
	for (const transcript of transcripts) {
		for (const utterance of transcript.utterances) {
			for (const violation of findRuleViolations(utterance, rules.bannedTerms)) {
				const summary = byRule.get(violation.ruleId);
				if (!summary) continue;
				summary.total += 1;
				summary.bySpeaker[violation.speaker] += 1;
				summary.locations.push({
					file: transcript.file,
					line: violation.line,
					speaker: violation.speaker,
				});
				bySpeaker[violation.speaker] += 1;
				total += 1;
			}
		}
	}
	return {
		ruleCount: rules.bannedTerms.length,
		skippedRuleIds: [...rules.skippedRuleIds],
		total,
		bySpeaker,
		rules: [...byRule.values()],
	};
}

export function summarizeUserPain(
	transcripts: readonly UserPainTranscript[],
	keywords: UserPainKeywords,
	rules?: CorrectionRuleSet,
): UserPainSummary {
	const utterances = speakerCounts();
	const locations = Object.fromEntries(
		USER_PAIN_SIGNALS.map((signal) => [signal, [] as UserPainLocation[]]),
	) as Record<UserPainSignal, UserPainLocation[]>;
	const files: UserPainFileSummary[] = [];
	for (const transcript of transcripts) {
		const fileUtterances = speakerCounts();
		for (const utterance of transcript.utterances) {
			fileUtterances[utterance.speaker] += 1;
			utterances[utterance.speaker] += 1;
			if (utterance.speaker !== UserPainSpeaker.user) continue;
			for (const signal of classifyUserInput(utteranceText(utterance), keywords)) {
				locations[signal].push({ file: transcript.file, line: utterance.startLine });
			}
		}
		files.push({
			file: transcript.file,
			userInputs: fileUtterances[UserPainSpeaker.user],
			utterances: fileUtterances,
		});
	}
	const userInputs = utterances[UserPainSpeaker.user];
	const signals = Object.fromEntries(
		USER_PAIN_SIGNALS.map((signal) => [
			signal,
			{
				count: locations[signal].length,
				ratio: ratio(locations[signal].length, userInputs),
				locations: locations[signal],
			},
		]),
	) as Record<UserPainSignal, UserPainSignalSummary>;
	return {
		schema_version: USER_PAIN_SCHEMA_VERSION,
		files,
		userInputs,
		utterances,
		signals,
		...(rules ? { rules: summarizeRules(transcripts, rules) } : {}),
	};
}
