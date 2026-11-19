import type { BannedTermRule } from "./user_pain_rules.js";
import type { TranscriptUtterance } from "./user_pain_transcript.js";
import {
	USER_PAIN_SIGNALS,
	type UserPainKeywords,
	type UserPainSignal,
	type UserPainSpeaker,
} from "./user_pain_vocabulary.js";

export interface RuleViolation {
	ruleId: string;
	speaker: UserPainSpeaker;
	line: number;
}

function compact(value: string): string {
	return value.replace(/\s+/gu, "").toLowerCase();
}

export function classifyUserInput(
	text: string,
	keywords: UserPainKeywords,
): UserPainSignal[] {
	const haystack = compact(text);
	return USER_PAIN_SIGNALS.filter((signal) =>
		keywords[signal].some((keyword) => {
			const needle = compact(keyword);
			return needle.length > 0 && haystack.includes(needle);
		}),
	);
}

function occurrences(text: string, term: string): number[] {
	const found: number[] = [];
	if (term.length === 0) return found;
	let index = text.indexOf(term);
	while (index >= 0) {
		found.push(index);
		index = text.indexOf(term, index + 1);
	}
	return found;
}

export function countBannedTerm(text: string, rule: BannedTermRule): number {
	const haystack = text.toLowerCase();
	const pattern = rule.pattern.toLowerCase();
	const covered = rule.allow.flatMap((term) => {
		const allowed = term.toLowerCase();
		return occurrences(haystack, allowed).map(
			(start) => [start, start + allowed.length] as const,
		);
	});
	return occurrences(haystack, pattern).filter((start) => {
		const end = start + pattern.length;
		return !covered.some(([from, to]) => from <= start && end <= to);
	}).length;
}

export function findRuleViolations(
	utterance: TranscriptUtterance,
	rules: readonly BannedTermRule[],
): RuleViolation[] {
	const violations: RuleViolation[] = [];
	for (const rule of rules) {
		for (const row of utterance.lines) {
			const count = countBannedTerm(row.text, rule);
			for (let i = 0; i < count; i++) {
				violations.push({
					ruleId: rule.id,
					speaker: utterance.speaker,
					line: row.line,
				});
			}
		}
	}
	return violations;
}
