import * as fs from "node:fs";
import * as path from "node:path";
import {
	isVerbose,
	optionalWorkFlag,
	type ParsedArgs,
	requiredWorkFlag,
	requiredWorkPositiveIntegerFlag,
} from "../cli/args.js";
import { writeStdoutFully } from "../cli/stdout.js";
import {
	workCloseInput,
	workEvidenceMutationInput,
	workEvidenceSource,
	workHookClient,
	workMutationInput,
	workTimestamp,
} from "../cli/work_input.js";
import {
	allocateStagedPromptToNewWork,
	allocateStagedPromptToSameWork,
	amendWork,
	assessWorkDelegation,
	briefWork,
	closeWork,
	confirmWorkBrief,
	createWork,
	discardStagedPrompt,
	gcStagedWorkPromptEntries,
	publicWorkExecutionMutation,
	publicWorkPromptResolution,
	readinessWork,
	recordWorkDelegation,
	recordWorkReview,
	requestWorkReview,
	retainStagedPromptProvisional,
	statusWork,
	switchWork,
	transitionWork,
	waiveWorkDelegation,
	type WorkPromptResolutionResult,
} from "../commands/work.js";
import { handleWorkCompactionResume } from "../commands/work_compaction.js";
import {
	handleWorkPostToolBoundary,
	handleWorkUserPromptSubmit,
} from "../commands/work_hook.js";
import { readAgentfile } from "../core/agentfile.js";
import { formatNamespaceHelp } from "../core/cli_guide.js";
import { parseSingleWorkDraft } from "../core/work_command_draft.js";
import {
	newWorkCursor,
	readWorkCursor,
	switchWorkCursorAtomic,
	writeWorkCursorAtomic,
} from "../core/work_cursor.js";
import { deliverWorkBriefing } from "../core/work_delivery.js";
import { workExecutionInputsSchema } from "../core/work_execution_inputs.js";
import {
	normalizeWorkPromptCapturePolicy,
} from "../core/work_prompt_policy.js";
import {
	formatWorkBrief,
	reportWorkExecutionMutation,
	reportWorkMutation,
	reportWorkPromptResolution,
	reportWorkStatus,
} from "../report/work.js";

export async function runWork({ positional, flags }: ParsedArgs): Promise<number> {
  const sub = positional[0];
  if (sub === undefined) {
    console.log(formatNamespaceHelp("work"));
    return 0;
  }
  if (
    sub !== "create" &&
    sub !== "amend" &&
    sub !== "transition" &&
    sub !== "close" &&
		sub !== "review" &&
		sub !== "delegation" &&
		sub !== "readiness" &&
    sub !== "status" &&
    sub !== "brief" &&
    sub !== "confirm" &&
    sub !== "switch" &&
    sub !== "prompt" &&
    sub !== "hook-policy-probe" &&
    sub !== "hook-session-start" &&
    sub !== "hook-user-prompt" &&
    sub !== "hook-post-tool-use"
  ) {
    console.error(`error: unknown 'work' subcommand: ${sub}`);
		console.error(
			"usage: anamnesis work <create|amend|transition|close|review|delegation|readiness|status|brief|confirm|switch> [options]",
		);
    return 1;
  }
  try {
    if (sub === "hook-policy-probe") {
      const projectRoot =
        optionalWorkFlag(flags, "project-root") ?? process.cwd();
      let enabled = false;
      try {
        const agentfile = readAgentfile(projectRoot);
        enabled =
          agentfile.version === 2 &&
          normalizeWorkPromptCapturePolicy(
            agentfile.settings?.work_prompt_capture,
          ).enabled;
      } catch {
        enabled = false;
      }
      await writeStdoutFully(
        `${JSON.stringify({
          schema_version: "anamnesis.work-prompt-policy-probe.v1",
          capture_enabled: enabled,
        })}\n`,
      );
      return 0;
    }

    if (sub === "prompt") {
      const action = positional[1];
      if (
        action !== "allocate-same" &&
        action !== "allocate-new" &&
        action !== "retain" &&
        action !== "discard" &&
	action !== "gc"
      ) {
        throw new Error(
          "work prompt requires allocate-same, allocate-new, retain, discard, or gc",
        );
      }
      const projectRoot =
        optionalWorkFlag(flags, "project-root") ?? process.cwd();
      const stateRoot = optionalWorkFlag(flags, "state-root");
  if (action === "gc") {
	const gcResult = gcStagedWorkPromptEntries({
		project_root: projectRoot,
		state_root: stateRoot,
		now: optionalWorkFlag(flags, "now"),
	});
	if (flags.json === true) {
		await writeStdoutFully(`${JSON.stringify(gcResult, null, 2)}\n`);
	} else {
					console.log(
						`Work prompt GC removed ${gcResult.removed.length} stage(s)`,
					);
		if (gcResult.skipped_locked.length > 0)
			console.log(`  locked: ${gcResult.skipped_locked.length}`);
		if (gcResult.skipped_indeterminate.length > 0)
						console.log(
							`  indeterminate: ${gcResult.skipped_indeterminate.length}`,
						);
	}
	return 0;
  }
      const captureId = requiredWorkFlag(flags, "stage");
      const occurredAt = workTimestamp(flags, false);
      let resolution: WorkPromptResolutionResult;
      if (action === "retain") {
        resolution = retainStagedPromptProvisional({
          project_root: projectRoot,
          state_root: stateRoot,
          capture_id: captureId,
          resolved_at: occurredAt,
          draft: fs.readFileSync(
            path.resolve(projectRoot, requiredWorkFlag(flags, "draft")),
          ),
        });
      } else if (action === "discard") {
        const reason = requiredWorkFlag(flags, "reason");
        if (reason !== "interruption" && reason !== "non_requirement") {
          throw new Error(
            "--reason must be interruption or non_requirement",
          );
        }
        resolution = discardStagedPrompt({
          project_root: projectRoot,
          state_root: stateRoot,
          capture_id: captureId,
          resolved_at: occurredAt,
          reason,
        });
      } else {
        const allocationInput = {
          project_root: projectRoot,
          state_root: stateRoot,
          capture_id: captureId,
          work_id: requiredWorkFlag(flags, "work"),
          occurred_at: occurredAt,
          draft: fs.readFileSync(
            path.resolve(projectRoot, requiredWorkFlag(flags, "draft")),
          ),
          expected_head:
            action === "allocate-same"
              ? requiredWorkFlag(flags, "expected-head")
              : null,
          expected_contract_revision:
            action === "allocate-same"
              ? requiredWorkPositiveIntegerFlag(
                  flags,
                  "expected-contract-revision",
                )
              : null,
          expected_contract_hash:
            action === "allocate-same"
              ? requiredWorkFlag(flags, "expected-contract-hash")
              : null,
        };
        resolution =
          action === "allocate-same"
            ? allocateStagedPromptToSameWork(allocationInput)
            : allocateStagedPromptToNewWork(allocationInput);
      }
      if (flags.json === true) {
        await writeStdoutFully(
		`${JSON.stringify(publicWorkPromptResolution(resolution), null, 2)}\n`,
	);
      } else {
        reportWorkPromptResolution(resolution);
      }
      return 0;
    }

    if (
      sub === "hook-session-start" ||
      sub === "hook-user-prompt" ||
      sub === "hook-post-tool-use"
    ) {
      let payload: unknown;
      try {
        const source = new TextDecoder("utf-8", { fatal: true }).decode(
          fs.readFileSync(0),
        );
        payload = JSON.parse(source);
      } catch {
        return 0;
      }
      const hookInput = {
        project_root:
          optionalWorkFlag(flags, "project-root") ?? process.cwd(),
        state_root: optionalWorkFlag(flags, "state-root"),
        client: workHookClient(flags),
        payload,
        now: workTimestamp(flags, false),
      };
      const result =
        sub === "hook-session-start"
          ? handleWorkCompactionResume(hookInput)
          : sub === "hook-user-prompt"
          ? handleWorkUserPromptSubmit(hookInput)
          : handleWorkPostToolBoundary(hookInput);
      if (flags.json === true) {
        await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
      } else if (result.context) {
        await writeStdoutFully(`${result.context}\n`);
      }
      return 0;
    }

		if (sub === "review" || sub === "delegation") {
			const action = positional[1];
			if (sub === "review" && action !== "request" && action !== "record") {
				throw new Error("work review requires request or record");
			}
			if (
				sub === "delegation" &&
				action !== "assess" &&
				action !== "record" &&
				action !== "waive"
			) {
				throw new Error(
					"work delegation requires assess, record, or waive",
				);
			}
			const evidenceInput = workEvidenceMutationInput(flags);
			const result =
				sub === "review" && action === "request"
					? (() => {
							const gate = requiredWorkFlag(flags, "gate");
							if (gate !== "planning" && gate !== "completion") {
								throw new Error("--gate must be planning or completion");
							}
							return requestWorkReview({
								...evidenceInput,
								gate,
								activity_id: requiredWorkFlag(flags, "activity-id"),
							});
						})()
					: sub === "review"
						? recordWorkReview(evidenceInput)
						: action === "assess"
							? assessWorkDelegation(evidenceInput)
							: action === "record"
								? recordWorkDelegation(evidenceInput)
								: waiveWorkDelegation({
										...evidenceInput,
										...workEvidenceSource(
											flags,
											evidenceInput.project_root,
											evidenceInput.occurred_at,
										),
									});
			if (flags.json === true) {
				await writeStdoutFully(
					`${JSON.stringify(publicWorkExecutionMutation(result), null, 2)}\n`,
				);
			} else {
				reportWorkExecutionMutation(result);
			}
			return 0;
		}

		if (sub === "readiness") {
			const projectRoot =
				optionalWorkFlag(flags, "project-root") ?? process.cwd();
			const action = requiredWorkFlag(flags, "action");
			if (action !== "implementation-entry" && action !== "completion") {
				throw new Error(
					"--action must be implementation-entry or completion",
				);
			}
			const inputsPath = optionalWorkFlag(flags, "inputs");
			const parsed = inputsPath
				? parseSingleWorkDraft(
						fs.readFileSync(path.resolve(projectRoot, inputsPath)),
						workExecutionInputsSchema,
					)
				: undefined;
			const result = readinessWork({
				project_root: projectRoot,
				state_root: optionalWorkFlag(flags, "state-root"),
				work_id: requiredWorkFlag(flags, "work"),
				action:
					action === "implementation-entry"
						? "implementation_entry"
						: "completion",
				execution_inputs: parsed,
			});
			if (flags.json === true) {
				await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
			} else {
				console.log(
					`Work readiness: ${result.allowed ? "allowed" : "blocked"}`,
				);
				console.log(`  review: ${result.contextual_state.review}`);
				console.log(
					`  parallelism: ${result.contextual_state.parallelism}`,
				);
				for (const reason of result.reason_codes)
					console.log(`  reason: ${reason}`);
			}
			return result.allowed ? 0 : 1;
		}

    if (sub === "create" || sub === "amend" || sub === "transition") {
      const input = workMutationInput(flags, sub);
      const result =
        sub === "create"
          ? createWork(input)
          : sub === "amend"
            ? amendWork(input)
            : transitionWork(input);
      if (flags.json === true) {
        await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        reportWorkMutation(result);
      }
      return 0;
    }

    if (sub === "close") {
      const result = closeWork(workCloseInput(flags));
      if (flags.json === true) {
        await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        reportWorkMutation(result);
      }
      return 0;
    }

    const projectRoot =
      optionalWorkFlag(flags, "project-root") ?? process.cwd();
    const stateRoot = optionalWorkFlag(flags, "state-root");
    const workId = requiredWorkFlag(flags, "work");
    if (sub === "status") {
      const result = statusWork({
        project_root: projectRoot,
        state_root: stateRoot,
        work_id: workId,
      });
      if (flags.json === true) {
        await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        reportWorkStatus(result, { verbose: isVerbose(flags) });
      }
      return 0;
    }

    const cursorId = requiredWorkFlag(flags, "session");
    if (sub === "brief") {
      const occurredAt = workTimestamp(flags, false);
      const result = briefWork({
        project_root: projectRoot,
        state_root: stateRoot,
        work_id: workId,
        cursor_id: cursorId,
        client_session_ref:
          optionalWorkFlag(flags, "client-session-ref") ?? null,
        occurred_at: occurredAt,
      });
      const json = flags.json === true;
      await deliverWorkBriefing({
        rendered: `${json ? JSON.stringify(result, null, 2) : formatWorkBrief(result)}\n`,
        direct_tty: process.stdout.isTTY === true,
        structured: json,
        write: writeStdoutFully,
        confirm: () => {
          confirmWorkBrief({
            project_root: projectRoot,
            state_root: stateRoot,
            work_id: workId,
            cursor_id: cursorId,
            delivery_token: result.delivery_token,
            confirmed_at: new Date().toISOString(),
          });
        },
      });
      return 0;
    }

    if (sub === "confirm") {
      const result = confirmWorkBrief({
        project_root: projectRoot,
        state_root: stateRoot,
        work_id: workId,
        cursor_id: cursorId,
        delivery_token: requiredWorkFlag(flags, "delivery-token"),
        confirmed_at: workTimestamp(flags, false),
      });
      if (flags.json === true) {
        await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        console.log(`Work briefing confirmed: ${result.delivery_token}`);
      }
      return 0;
    }

    const occurredAt = workTimestamp(flags, false);
    const result = switchWork(
      {
        project_root: projectRoot,
        state_root: stateRoot,
        work_id: workId,
        cursor_id: cursorId,
        client_session_ref:
          optionalWorkFlag(flags, "client-session-ref") ?? null,
        occurred_at: occurredAt,
      },
      {
        switchWork: (input) => {
          const truth = {
            work_id: input.work_id,
            revision: input.projection.contract_revision,
            last_event_id: input.projection.last_event_id,
            projection_hash: input.projection.projection_hash,
          };
          const read = readWorkCursor(
            input.state_root,
            input.cursor_id,
            undefined,
            input.worktree_fingerprint,
          );
          if (read.status === "corrupt") throw new Error(read.error);
          if (read.status === "switched") {
            throw new Error("Work cursor belongs to another worktree");
          }
          if (read.cursor) {
            if (
              input.client_session_ref !== null &&
              read.cursor.client_session_ref !== null &&
              read.cursor.client_session_ref !== input.client_session_ref
            ) {
              throw new Error("Work cursor is bound to another client session");
            }
            switchWorkCursorAtomic(
              input.state_root,
              {
                ...read.cursor,
                client_session_ref:
                  input.client_session_ref ?? read.cursor.client_session_ref,
                updated_at: input.occurred_at,
              },
              truth,
            );
          } else {
            writeWorkCursorAtomic(
              input.state_root,
              newWorkCursor({
                cursor_id: input.cursor_id,
                client_session_ref: input.client_session_ref,
                worktree_fingerprint: input.worktree_fingerprint,
                updated_at: input.occurred_at,
                truth,
              }),
              { expectedCursorRevision: null },
            );
          }
          const current = readWorkCursor(
            input.state_root,
            input.cursor_id,
            truth,
            input.worktree_fingerprint,
          );
          if (!current.cursor) throw new Error("Work cursor write failed");
          return {
            schema_version: "anamnesis.work-switch.v1" as const,
            work_id: input.work_id,
            cursor: current.cursor,
          };
        },
      },
    );
    if (flags.json === true) {
      await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      console.log(`Session ${cursorId} switched to Work ${workId}`);
    }
    return 0;
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    return 1;
  }
}
