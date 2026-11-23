import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	ParallelRequirement,
	ParallelRunner,
} from "./benchmark_work_parallel_agent.js";

export const REQUIREMENTS: ParallelRequirement[] = [
	"REQ-A",
	"REQ-B",
	"REQ-C",
	"REQ-D",
].map((id, index) => ({
	id,
	status: index === 3 ? "pending" : "verified",
	summary: `sanitized parallel condition ${index + 1}`,
}));

export function tempRoot(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "parallel-agent-test-"));
}
function output(
	data: Record<string, unknown>,
	tokens = 10,
	usage?: Record<string, unknown>,
): string {
	return `${JSON.stringify({ type: "item.completed", item: { id: "agent-message-1", type: "agent_message", text: JSON.stringify(data) } })}\n${JSON.stringify({ type: "turn.completed", usage: usage ?? { input_tokens: tokens - 2, cached_input_tokens: 0, output_tokens: 2, total_tokens: tokens } })}`;
}
export function runner(
	opts: {
		childAContainer?: "missing" | "null" | "scalar";
		malformedOutputRows?: boolean;
		malformedUsage?: boolean;
		overlap?: boolean;
		reviewerDuplicateFirst?: boolean;
		reviewerOmitLast?: boolean;
		reviewerReverse?: boolean;
		wrong?: boolean;
		wrongPlan?: boolean;
		wrongDisabledIterations?: number[];
		wrongEnabledIterations?: number[];
		reviewerWrongDisabledIterations?: number[];
		reviewerWrongEnabledIterations?: number[];
		enabledTokens?: number;
		invalidReviewerEnvelopeCondition?: "disabled" | "enabled";
	} = {},
): ParallelRunner {
	return async (request) => {
		const stage = request.prompt.match(/\[parallel-stage:([^\]]+)/u)?.[1];
		const fixture = path
			.basename(request.cwd)
			.match(/^(\d+)-(disabled|enabled)$/u);
		const iteration = Number(fixture?.[1]);
		const condition = fixture?.[2];
		const wrong =
			opts.wrong === true ||
			(condition === "disabled" &&
				opts.wrongDisabledIterations?.includes(iteration) === true) ||
			(condition === "enabled" &&
				opts.wrongEnabledIterations?.includes(iteration) === true);
		const reviewerWrong =
			opts.reviewerOmitLast === true ||
			(condition === "disabled" &&
				opts.reviewerWrongDisabledIterations?.includes(iteration) === true) ||
			(condition === "enabled" &&
				opts.reviewerWrongEnabledIterations?.includes(iteration) === true);
		await new Promise((resolve) =>
			setTimeout(
				resolve,
				opts.overlap === false
					? 0
					: stage === "child-a"
						? 12
						: stage === "child-b"
							? 6
							: 1,
			),
		);
		const ids = ["REQ-A", "REQ-B", "REQ-C", "REQ-D"];
		let data: Record<string, unknown>;
		const req = (id: string) => ({
			id,
			status: id === "REQ-D" ? "pending" : "verified",
			summary: `sanitized parallel condition ${ids.indexOf(id) + 1}`,
		});
		if (stage === "leader-plan")
			data = opts.wrongPlan
				? { child_a: ids.slice(2), child_b: ids.slice(0, 2) }
				: { child_a: ids.slice(0, 2), child_b: ids.slice(2) };
		else if (stage === "child-a") {
			if (opts.childAContainer === "missing") data = {};
			else if (opts.childAContainer === "null") data = { requirements: null };
			else if (opts.childAContainer === "scalar")
				data = { requirements: "not-an-array" };
			else
				data = {
					requirements: [
						...(wrong ? [ids[0]] : ids.slice(0, 2)).map(req),
						...(opts.malformedOutputRows ? [null, 7, []] : []),
					],
				};
		} else if (stage === "child-b")
			data = { requirements: ids.slice(2).map(req) };
		else if (stage === "reviewer") {
			const reviewerIds = reviewerWrong ? ids.slice(0, -1) : ids;
			const reviewerRequirements = reviewerIds.map(req);
			if (opts.reviewerDuplicateFirst) reviewerRequirements.push(req(ids[0]!));
			if (opts.reviewerReverse) reviewerRequirements.reverse();
			data = {
				requirements: [
					...reviewerRequirements,
					...(opts.malformedOutputRows ? [null, 7, []] : []),
				],
			};
		} else throw new Error(`Unexpected synthetic model stage: ${stage}`);
		const invalidReviewerEnvelope =
			stage === "reviewer" &&
			condition === opts.invalidReviewerEnvelopeCondition;
		const tokens = condition === "enabled" ? (opts.enabledTokens ?? 10) : 10;
		return {
			status: 0,
			stdout: invalidReviewerEnvelope
				? `${JSON.stringify({ type: "item.completed", item: { id: "agent-message-1", type: "agent_message", text: "not-json" } })}\n${JSON.stringify({ type: "turn.completed", usage: { input_tokens: tokens - 2, cached_input_tokens: 0, output_tokens: 2, total_tokens: tokens } })}`
				: opts.malformedUsage
					? `${JSON.stringify({ type: "item.completed", item: { id: "agent-message-1", type: "agent_message", text: JSON.stringify(data) } })}\n${JSON.stringify({ type: "turn.completed", usage: {} })}`
					: output(data, tokens),
			stderr: "",
			elapsedMs: 1,
		};
	};
}
