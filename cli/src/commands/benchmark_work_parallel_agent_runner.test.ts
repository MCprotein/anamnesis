import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type ParallelRunner,
	workParallelAgentBenchmark,
} from "./benchmark_work_parallel_agent.js";
import {
	REQUIREMENTS,
	runner,
	tempRoot,
} from "./benchmark_work_parallel_agent.test-support.js";

describe("real parallel-agent benchmark", () => {
	it("fails token-accounting validity when a usage event is malformed", async () => {
		const root = tempRoot();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: runner({ malformedUsage: true }),
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.checks.full_token_accounting).toBe(false);
		expect(result.harness_validity.checks.runner_protocol_integrity).toBe(
			false,
		);
		expect(result.harness_validity.ok).toBe(false);
		expect(result.runs[0]?.disabled.token_accounting_complete).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("invalidates the harness for an unknown runner event", async () => {
		const root = tempRoot();
		const baseRunner = runner();
		const unknownEventRunner: ParallelRunner = async (request) => {
			const response = await baseRunner(request);
			return {
				...response,
				stdout: `${JSON.stringify({ type: "runner.corrupted" })}\n${response.stdout}`,
			};
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: unknownEventRunner,
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.checks.runner_protocol_integrity).toBe(
			false,
		);
		expect(
			result.runs[0]?.disabled.stages[0]?.runner_protocol_summary
				?.unknown_events,
		).toBe(1);
		expect(result.harness_validity.ok).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("accepts the current Codex item.updated progress event", async () => {
		const root = tempRoot();
		const baseRunner = runner();
		const updatedEventRunner: ParallelRunner = async (request) => {
			const response = await baseRunner(request);
			if (!request.prompt.includes("[parallel-stage:leader-plan]"))
				return response;
			return {
				...response,
				stdout: `${JSON.stringify({ type: "item.updated", item: { id: "item-1", type: "command_execution", command: "sed -n 1,2p CONTEXT.md", aggregated_output: "", exit_code: null, status: "in_progress" } })}\n${response.stdout}`,
			};
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: updatedEventRunner,
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.checks.runner_protocol_integrity).toBe(true);
		expect(result.harness_validity.ok).toBe(true);
		expect(
			result.runs[0]?.disabled.stages[0]?.runner_protocol_summary?.item_updates,
		).toBe(1);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("rejects command execution in the reviewer no-command contract", async () => {
		const root = tempRoot();
		const baseRunner = runner();
		const commandEventRunner: ParallelRunner = async (request) => {
			const response = await baseRunner(request);
			if (!request.prompt.includes("[parallel-stage:reviewer]"))
				return response;
			return {
				...response,
				stdout: `${JSON.stringify({ type: "item.updated", item: { id: "review-command", type: "command_execution", command: "sed -n 1,2p CONTEXT.md", aggregated_output: "", exit_code: null, status: "in_progress" } })}\n${response.stdout}`,
			};
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: commandEventRunner,
			requirements: REQUIREMENTS,
		});
		const reviewer = result.runs[0]?.disabled.stages.find(
			(stage) => stage.stage === "reviewer",
		);
		expect(reviewer?.runner_protocol_valid).toBe(false);
		expect(reviewer?.runner_protocol_summary?.forbidden_command_events).toBe(1);
		expect(result.harness_validity.ok).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("uses the last completed agent message as the authoritative stage output", async () => {
		const root = tempRoot();
		const baseRunner = runner();
		const multiMessageRunner: ParallelRunner = async (request) => {
			const response = await baseRunner(request);
			const progressMessage = JSON.stringify({
				type: "item.completed",
				item: {
					id: "agent-message-progress",
					type: "agent_message",
					text: JSON.stringify({ requirements: [] }),
				},
			});
			return { ...response, stdout: `${progressMessage}\n${response.stdout}` };
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: multiMessageRunner,
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.checks.runner_protocol_integrity).toBe(true);
		expect(result.harness_validity.ok).toBe(true);
		expect(result.quality.enabled_passes).toBe(3);
		expect(
			result.runs[0]?.disabled.stages[0]?.runner_protocol_summary
				?.agent_messages,
		).toBe(2);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("rejects agent messages emitted after turn completion", async () => {
		const root = tempRoot();
		const baseRunner = runner();
		const trailingMessageRunner: ParallelRunner = async (request) => {
			const response = await baseRunner(request);
			return {
				...response,
				stdout: `${response.stdout}\n${JSON.stringify({ type: "item.completed", item: { id: "agent-message-trailing", type: "agent_message", text: JSON.stringify({ requirements: [] }) } })}`,
			};
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: trailingMessageRunner,
			requirements: REQUIREMENTS,
		});
		expect(result.runs[0]?.disabled.stages[0]?.runner_protocol_valid).toBe(
			false,
		);
		expect(
			result.runs[0]?.disabled.stages[0]?.runner_protocol_summary
				?.invalid_envelopes,
		).toBe(1);
		expect(result.harness_validity.ok).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("classifies fatal events after turn completion as runner failures", async () => {
		const root = tempRoot();
		const baseRunner = runner();
		const trailingFailureRunner: ParallelRunner = async (request) => {
			const response = await baseRunner(request);
			return {
				...response,
				stdout: `${response.stdout}\n${JSON.stringify({ type: "error", message: "late failure" })}`,
			};
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: trailingFailureRunner,
			requirements: REQUIREMENTS,
		});
		const plan = result.runs[0]?.disabled.stages[0];
		expect(plan?.execution_ok).toBe(false);
		expect(plan?.runner_protocol_valid).toBe(false);
		expect(plan?.runner_protocol_summary?.failure_events).toBe(1);
		expect(result.harness_validity.ok).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("rejects a malformed item.updated progress event", async () => {
		const root = tempRoot();
		const baseRunner = runner();
		const malformedUpdateRunner: ParallelRunner = async (request) => {
			const response = await baseRunner(request);
			return {
				...response,
				stdout: `${JSON.stringify({ type: "item.updated", item: { id: "item-1", type: "command_execution" } })}\n${response.stdout}`,
			};
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: malformedUpdateRunner,
			requirements: REQUIREMENTS,
		});
		const plan = result.runs[0]?.disabled.stages[0];
		expect(plan?.runner_protocol_valid).toBe(false);
		expect(plan?.runner_protocol_summary?.invalid_envelopes).toBe(1);
		expect(result.harness_validity.ok).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it.each([
		"mcp_tool_call",
		"collab_tool_call",
		"web_search",
		"todo_list",
	])("fails closed for unsupported %s benchmark items", async (itemType) => {
		const root = tempRoot();
		const baseRunner = runner();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: async (request) => {
				const response = await baseRunner(request);
				return {
					...response,
					stdout: `${JSON.stringify({ type: "item.updated", item: { id: "item-1", type: itemType } })}\n${response.stdout}`,
				};
			},
			requirements: REQUIREMENTS,
		});
		expect(
			result.runs[0]?.disabled.stages[0]?.runner_protocol_summary
				?.invalid_envelopes,
		).toBe(1);
		expect(result.harness_validity.ok).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it.each([
		JSON.stringify({ type: "turn.failed", error: { message: "failed" } }),
		JSON.stringify({ type: "error", message: "failed" }),
	])("records a valid Codex failure event explicitly", async (failureEvent) => {
		const root = tempRoot();
		const baseRunner = runner();
		const failureEventRunner: ParallelRunner = async (request) => {
			const response = await baseRunner(request);
			return { ...response, stdout: `${failureEvent}\n${response.stdout}` };
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: failureEventRunner,
			requirements: REQUIREMENTS,
		});
		const plan = result.runs[0]?.disabled.stages[0];
		expect(plan?.execution_ok).toBe(false);
		expect(plan?.runner_protocol_valid).toBe(false);
		expect(plan?.error).toBe("codex-runner-reported-failure");
		expect(plan?.runner_protocol_summary?.failure_events).toBe(1);
		expect(result.harness_validity.ok).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it.each([
		JSON.stringify({ type: "turn.failed", error: {} }),
		JSON.stringify({ type: "error", message: 7 }),
	])("classifies a malformed Codex failure event", async (failureEvent) => {
		const root = tempRoot();
		const baseRunner = runner();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: async (request) => {
				const response = await baseRunner(request);
				return { ...response, stdout: `${failureEvent}\n${response.stdout}` };
			},
			requirements: REQUIREMENTS,
		});
		const plan = result.runs[0]?.disabled.stages[0];
		expect(plan?.execution_ok).toBe(false);
		expect(plan?.runner_protocol_valid).toBe(false);
		expect(plan?.error).toBe("codex-runner-reported-failure");
		expect(plan?.runner_protocol_summary).toMatchObject({
			failure_events: 1,
			invalid_envelopes: 1,
		});
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("counts a parsed non-object JSONL record as an invalid envelope", async () => {
		const root = tempRoot();
		const baseRunner = runner();
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: async (request) => {
				const response = await baseRunner(request);
				return { ...response, stdout: `[]\n${response.stdout}` };
			},
			requirements: REQUIREMENTS,
		});
		expect(
			result.runs[0]?.disabled.stages[0]?.runner_protocol_summary
				?.invalid_envelopes,
		).toBe(1);
		expect(result.harness_validity.ok).toBe(false);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("derives total tokens from current Codex usage events", async () => {
		const root = tempRoot();
		const currentUsageRunner: ParallelRunner = async (request) => {
			const result = await runner()(request);
			return {
				...result,
				stdout: result.stdout.replace(/,"total_tokens":10/gu, ""),
			};
		};
		const result = await workParallelAgentBenchmark({
			projectRoot: root,
			runs: 3,
			runner: currentUsageRunner,
			requirements: REQUIREMENTS,
		});
		expect(result.harness_validity.checks.full_token_accounting).toBe(true);
		expect(result.runs[0]?.disabled.tokens.total_tokens).toBe(40);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it.each([null, 11])(
		"rejects an explicitly malformed or inconsistent total token field: %j",
		async (total) => {
			const root = tempRoot();
			const incompatibleUsageRunner: ParallelRunner = async (request) => {
				const result = await runner()(request);
				return {
					...result,
					stdout: result.stdout.replace(
						/"total_tokens":10/gu,
						`"total_tokens":${JSON.stringify(total)}`,
					),
				};
			};
			const result = await workParallelAgentBenchmark({
				projectRoot: root,
				runs: 3,
				runner: incompatibleUsageRunner,
				requirements: REQUIREMENTS,
			});
			expect(result.harness_validity.checks.full_token_accounting).toBe(false);
			fs.rmSync(root, { recursive: true, force: true });
		},
		10_000,
	);
});
