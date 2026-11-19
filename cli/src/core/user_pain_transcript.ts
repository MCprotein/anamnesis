import { UserPainSpeaker } from "./user_pain_vocabulary.js";

export interface TranscriptLine {
	line: number;
	text: string;
}

export interface TranscriptUtterance {
	speaker: UserPainSpeaker;
	startLine: number;
	lines: TranscriptLine[];
}

interface UtteranceStart {
	speaker: UserPainSpeaker;
	text: string;
}

const MARKERS: ReadonlyArray<readonly [RegExp, UserPainSpeaker]> = [
	[/^@ [^❯\s][^❯]*❯ ?(.*)$/u, UserPainSpeaker.teammate],
	[/^❯ ?(.*)$/u, UserPainSpeaker.user],
	[/^⏺ ?(.*)$/u, UserPainSpeaker.lead],
	[/^\s+⎿ ?(.*)$/u, UserPainSpeaker.tool],
];
const CONTINUATION = /^\s+(.*)$/u;
const CODE_FENCE = /^\s*```/u;
const BYTE_ORDER_MARK = /^\uFEFF/u;

function startOf(raw: string): UtteranceStart | undefined {
	for (const [pattern, speaker] of MARKERS) {
		const match = pattern.exec(raw);
		if (match) return { speaker, text: match[1] ?? "" };
	}
	return undefined;
}

export function parseExportTranscript(content: string): TranscriptUtterance[] {
	const utterances: TranscriptUtterance[] = [];
	let current: TranscriptUtterance | undefined;
	let inFence = false;
	const rows = content.replace(BYTE_ORDER_MARK, "").split(/\r?\n/u);
	for (const [index, raw] of rows.entries()) {
		const line = index + 1;
		if (inFence && /^❯/u.test(raw)) {
			current?.lines.push({ line, text: raw.trimEnd() });
			continue;
		}
		const start = startOf(raw);
		if (start) {
			inFence =
				start.speaker === UserPainSpeaker.lead && CODE_FENCE.test(start.text);
			current = {
				speaker: start.speaker,
				startLine: line,
				lines: [{ line, text: start.text.trimEnd() }],
			};
			utterances.push(current);
			continue;
		}
		if (raw.trim().length === 0) continue;
		const continuation = CONTINUATION.exec(raw);
		if (current && continuation) {
			current.lines.push({ line, text: (continuation[1] ?? "").trimEnd() });
			if (current.speaker === UserPainSpeaker.lead && CODE_FENCE.test(raw)) {
				inFence = !inFence;
			}
			continue;
		}
		current = undefined;
		inFence = false;
	}
	return utterances;
}

export function utteranceText(utterance: TranscriptUtterance): string {
	return utterance.lines.map((row) => row.text).join("\n");
}
