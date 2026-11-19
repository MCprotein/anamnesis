import type { UserPainSummary } from "../core/user_pain_aggregate.js";
import { createTui, type Tui } from "../core/tui.js";
import {
	USER_PAIN_SIGNALS,
	USER_PAIN_SPEAKERS,
	type UserPainSpeaker,
} from "../core/user_pain_vocabulary.js";

function percent(ratio: number): string {
	return `${(ratio * 100).toFixed(1)}%`;
}

function speakerBreakdown(counts: Record<UserPainSpeaker, number>): string {
	return USER_PAIN_SPEAKERS.map((speaker) => `${speaker}=${counts[speaker]}`).join(
		", ",
	);
}

export function formatUserPainBenchmark(
	result: UserPainSummary,
	ui: Tui = createTui(),
): string[] {
	const lines = [
		...ui.title(
			"anamnesis benchmark user-pain",
			"Counts, ratios, rule ids, and line numbers only. No transcript text.",
		),
		...ui.section("Inputs"),
		...ui.keyValues([
			{ key: "files", value: String(result.files.length) },
			{ key: "user inputs", value: String(result.userInputs) },
			{ key: "utterances", value: speakerBreakdown(result.utterances) },
		]),
		...ui.section("User input signals"),
		...ui.statusRows(
			USER_PAIN_SIGNALS.map((signal) => ({
				label: signal,
				value: `${result.signals[signal].count}/${result.userInputs}`,
				summary: percent(result.signals[signal].ratio),
			})),
		),
	];
	if (!result.rules) {
		lines.push(...ui.section("Rule violations"), ui.note("skipped: no --rules file"));
		return lines;
	}
	lines.push(
		...ui.section("Rule violations", result.rules.total),
		...ui.keyValues([
			{ key: "by speaker", value: speakerBreakdown(result.rules.bySpeaker) },
		]),
		...ui.statusRows(
			result.rules.rules.map((rule) => ({
				label: rule.ruleId,
				value: String(rule.total),
				tone: rule.total > 0 ? "warning" : "success",
				summary: speakerBreakdown(rule.bySpeaker),
			})),
		),
	);
	if (result.rules.skippedRuleIds.length > 0) {
		lines.push(
			ui.note(`not checked (not banned_term): ${result.rules.skippedRuleIds.join(", ")}`),
		);
	}
	return lines;
}

export function reportUserPainBenchmark(result: UserPainSummary): void {
	console.log(formatUserPainBenchmark(result).join("\n"));
}
