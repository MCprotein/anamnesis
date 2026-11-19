import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { WorkAgentTokenUsage } from "./benchmark_work_agent.js";
import {
	parseInlinePayload,
	parseNamedInlinePayload,
	requirementsFromContext,
	requirementsFromText,
} from "./benchmark_work_parallel_agent_scenario.js";
import { equalStringArrays } from "./benchmark_work_parallel_agent_scoring.js";
import {
	type ParallelRunner,
	type ParallelRunnerRequest,
	type ParallelRunnerResponse,
	type ParallelStage,
	type ParallelStageRecord,
	REASONING_EFFORT,
} from "./benchmark_work_parallel_agent_types.js";
import {
	isObjectRecord,
	isOneOf,
} from "./benchmark_work_parallel_agent_util.js";

export function parseStageJsonl(
	stdout: string,
	stage: ParallelStage,
): {
	data?: Record<string, unknown>;
	usage?: WorkAgentTokenUsage;
	protocolValid: boolean;
	outputSchemaValid: boolean;
	runnerFailed: boolean;
	summary: NonNullable<ParallelStageRecord["runner_protocol_summary"]>;
} {
	const messages: string[] = [];
	let protocolValid = true;
	let usage: WorkAgentTokenUsage | undefined;
	let completedTurns = 0;
	let terminalSeen = false;
	let runnerFailed = false;
	const summary = {
		events: 0,
		item_updates: 0,
		agent_messages: 0,
		completed_turns: 0,
		malformed_lines: 0,
		invalid_envelopes: 0,
		unknown_events: 0,
		failure_events: 0,
		forbidden_command_events: 0,
	};
	for (const raw of stdout.split(/\r?\n/u)) {
		if (!raw.trim()) continue;
		let event: unknown;
		try {
			event = JSON.parse(raw);
		} catch {
			protocolValid = false;
			summary.malformed_lines += 1;
			continue;
		}
		if (!event || typeof event !== "object" || Array.isArray(event)) {
			protocolValid = false;
			summary.invalid_envelopes += 1;
			continue;
		}
		const record = event as Record<string, unknown>;
		summary.events += 1;
		if (!runnerEventTypeKnown(record.type)) summary.unknown_events += 1;
		if (record.type === "turn.failed" || record.type === "error") {
			runnerFailed = true;
			summary.failure_events += 1;
		}
		if (terminalSeen) {
			protocolValid = false;
			summary.invalid_envelopes += 1;
			continue;
		}
		if (!runnerEventEnvelopeValid(record)) {
			protocolValid = false;
			summary.invalid_envelopes += 1;
			continue;
		}
		const itemRecord = isObjectRecord(record.item) ? record.item : undefined;
		if (
			itemRecord?.type === "command_execution" &&
			(stage === "child-a" || stage === "child-b" || stage === "reviewer")
		) {
			protocolValid = false;
			summary.forbidden_command_events += 1;
		}
		if (record.type === "item.updated") summary.item_updates += 1;
		const item = record.item;
		if (
			record.type === "item.completed" &&
			item &&
			typeof item === "object" &&
			(item as Record<string, unknown>).type === "agent_message" &&
			typeof (item as Record<string, unknown>).text === "string"
		) {
			messages.push((item as Record<string, unknown>).text as string);
			summary.agent_messages += 1;
		}
		if (record.type === "turn.completed") {
			terminalSeen = true;
			completedTurns += 1;
			summary.completed_turns += 1;
			usage = parseUsage(record.usage);
			if (usage === undefined) protocolValid = false;
		}
	}
	protocolValid =
		protocolValid &&
		!runnerFailed &&
		messages.length >= 1 &&
		completedTurns === 1;
	let data: Record<string, unknown> | undefined;
	if (protocolValid) {
		try {
			const parsed = JSON.parse(messages.at(-1)!) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				data = parsed as Record<string, unknown>;
			}
		} catch {
			// A malformed answer remains a product failure; any usage is retained.
		}
	}
	return {
		data,
		usage,
		protocolValid,
		runnerFailed,
		summary,
		outputSchemaValid:
			protocolValid && data !== undefined && stagePayloadValid(stage, data),
	};
}

function runnerEventTypeKnown(type: unknown): boolean {
	return (
		type === "thread.started" ||
		type === "turn.started" ||
		type === "item.started" ||
		type === "item.updated" ||
		type === "item.completed" ||
		type === "turn.completed" ||
		type === "turn.failed" ||
		type === "error"
	);
}

function runnerEventEnvelopeValid(record: Record<string, unknown>): boolean {
	const type = record.type;
	if (!runnerEventTypeKnown(type)) return false;
	if (type === "thread.started") {
		return typeof record.thread_id === "string";
	}
	if (
		type === "item.started" ||
		type === "item.updated" ||
		type === "item.completed"
	) {
		return runnerItemEnvelopeValid(record.item);
	}
	if (type === "turn.completed") {
		return (
			record.usage !== null &&
			typeof record.usage === "object" &&
			!Array.isArray(record.usage)
		);
	}
	if (type === "turn.failed") {
		return runnerErrorEnvelopeValid(record.error);
	}
	if (type === "error") {
		return typeof record.message === "string";
	}
	return true;
}

function runnerItemEnvelopeValid(item: unknown): boolean {
	if (!isObjectRecord(item) || typeof item.id !== "string") return false;
	switch (item.type) {
		case "agent_message":
		case "reasoning":
			return typeof item.text === "string";
		case "command_execution":
			return (
				typeof item.command === "string" &&
				typeof item.aggregated_output === "string" &&
				(item.exit_code === null || Number.isInteger(item.exit_code)) &&
				isOneOf(item.status, ["in_progress", "completed", "failed", "declined"])
			);
		default:
			return false;
	}
}

function runnerErrorEnvelopeValid(error: unknown): boolean {
	return (
		error !== null &&
		typeof error === "object" &&
		!Array.isArray(error) &&
		typeof (error as Record<string, unknown>).message === "string"
	);
}

function stagePayloadValid(
	stage: ParallelStage,
	data: Record<string, unknown>,
): boolean {
	if (stage === "leader-plan") {
		return (
			exactObjectKeys(data, ["child_a", "child_b"]) &&
			Array.isArray(data.child_a) &&
			data.child_a.every((item) => typeof item === "string") &&
			Array.isArray(data.child_b) &&
			data.child_b.every((item) => typeof item === "string")
		);
	}
	if (stage === "child-a" || stage === "child-b" || stage === "reviewer") {
		return (
			exactObjectKeys(data, ["requirements"]) &&
			Array.isArray(data.requirements) &&
			data.requirements.every(requirementRowValid)
		);
	}
	return false;
}

function exactObjectKeys(
	value: Record<string, unknown>,
	expected: string[],
): boolean {
	const keys = Object.keys(value).sort();
	return equalStringArrays(keys, [...expected].sort());
}

function requirementRowValid(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>;
	return (
		exactObjectKeys(row, ["id", "status", "summary"]) &&
		typeof row.id === "string" &&
		(row.status === "verified" || row.status === "pending") &&
		typeof row.summary === "string"
	);
}

/** Local, deterministic runner used by `validate`; it never starts Codex. */
export const validationRunner: ParallelRunner = (request) => {
	const stage = request.prompt.match(/\[parallel-stage:([^\]]+)/u)?.[1];
	const inlinePayload =
		stage === "child-a" || stage === "child-b"
			? parseInlinePayload(request.prompt)
			: undefined;
	const reviewerTruth =
		stage === "reviewer"
			? parseNamedInlinePayload(request.prompt, "authoritative-truth")
			: undefined;
	const requirements =
		stage === "child-a" || stage === "child-b"
			? inlinePayload === undefined
				? []
				: requirementsFromText(inlinePayload)
			: stage === "reviewer"
				? reviewerTruth === undefined
					? []
					: requirementsFromText(reviewerTruth)
				: requirementsFromContext(request.cwd);
	const ids = requirements.map((requirement) => requirement.id);
	const assignedIds = request.prompt
		.match(/assigned requirements, in this order: ([^.]+)\./u)?.[1]
		?.split(/,\s*/u)
		.filter(Boolean);
	const rows = assignedIds
		? assignedIds.flatMap((id) => requirements.filter((row) => row.id === id))
		: requirements;
	let data: Record<string, unknown>;
	if (stage === "leader-plan") {
		const half = Math.ceil(ids.length / 2);
		data = { child_a: ids.slice(0, half), child_b: ids.slice(half) };
	} else if (stage === "reviewer") {
		let reviewPacketValid = false;
		try {
			const packet = JSON.parse(
				parseNamedInlinePayload(request.prompt, "child-reports") ?? "{}",
			) as Record<string, unknown>;
			reviewPacketValid =
				Array.isArray(packet.child_a) && Array.isArray(packet.child_b);
		} catch {
			reviewPacketValid = false;
		}
		data = { requirements: reviewPacketValid ? requirements : [] };
	} else {
		data = { requirements: rows };
	}
	return new Promise((resolve) =>
		setTimeout(
			() =>
				resolve({
					status: 0,
					stdout: outputJsonl(data),
					stderr: "",
					elapsedMs: 1,
				}),
			1,
		),
	);
};

function outputJsonl(data: Record<string, unknown>): string {
	return `${JSON.stringify({ type: "item.completed", item: { id: "agent-message-1", type: "agent_message", text: JSON.stringify(data) } })}\n${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, total_tokens: 2 } })}`;
}

export function runCodexExec(
	request: ParallelRunnerRequest,
): Promise<ParallelRunnerResponse> {
	return new Promise((resolve) => {
		const started = performance.now();
		let settled = false;
		let timedOut = false;
		let killTimeout: NodeJS.Timeout | undefined;
		const child = spawn(
			"codex",
			[
				"exec",
				"--json",
				"--ephemeral",
				"--ignore-user-config",
				"--sandbox",
				"read-only",
				"--skip-git-repo-check",
				"--model",
				request.model,
				"-c",
				`model_reasoning_effort=${REASONING_EFFORT}`,
				"--output-schema",
				request.outputSchemaPath,
				"-C",
				request.cwd,
				"-",
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		const finish = (status: number | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (killTimeout) clearTimeout(killTimeout);
			resolve({
				status,
				stdout,
				stderr,
				elapsedMs: performance.now() - started,
			});
		};
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			killTimeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
		}, 180_000);
		child.stdout.on("data", (bytes: Buffer) => {
			stdout += bytes.toString("utf8");
		});
		child.stderr.on("data", (bytes: Buffer) => {
			stderr += bytes.toString("utf8");
		});
		child.on("error", () => finish(null));
		child.on("close", (status) => finish(timedOut ? null : status));
		child.stdin.end(request.prompt);
	});
}

export function addUsage(
	total: WorkAgentTokenUsage,
	record: ParallelStageRecord,
): WorkAgentTokenUsage {
	return {
		input_tokens: total.input_tokens + record.tokens.input_tokens,
		cached_input_tokens:
			total.cached_input_tokens + record.tokens.cached_input_tokens,
		output_tokens: total.output_tokens + record.tokens.output_tokens,
		total_tokens: total.total_tokens + record.tokens.total_tokens,
	};
}

function parseUsage(value: unknown): WorkAgentTokenUsage | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	const record = value as Record<string, unknown>;
	const fields = [
		"input_tokens",
		"cached_input_tokens",
		"output_tokens",
	] as const;
	if (
		!fields.every(
			(field) =>
				typeof record[field] === "number" &&
				Number.isSafeInteger(record[field]) &&
				record[field] >= 0,
		)
	) {
		return;
	}
	const derivedTotal =
		(record.input_tokens as number) + (record.output_tokens as number);
	const totalTokens = Object.hasOwn(record, "total_tokens")
		? record.total_tokens
		: derivedTotal;
	if (
		typeof totalTokens !== "number" ||
		!Number.isSafeInteger(totalTokens) ||
		totalTokens < 0 ||
		totalTokens !== derivedTotal
	) {
		return;
	}
	return {
		input_tokens: record.input_tokens as number,
		cached_input_tokens: record.cached_input_tokens as number,
		output_tokens: record.output_tokens as number,
		total_tokens: totalTokens,
	};
}
