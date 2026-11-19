import * as fs from "node:fs";
import * as path from "node:path";
import {
	optionalWorkFlag,
	type ParsedArgs,
	requiredWorkFlag,
	requiredWorkPositiveIntegerFlag,
} from "./args.js";
import type {
	WorkCloseInput,
	WorkEvidenceMutationInput,
	WorkMutationInput,
	WorkRawSource,
} from "../commands/work.js";
import type { WorkHookClient } from "../commands/work_hook.js";

export function workHookClient(flags: ParsedArgs["flags"]): WorkHookClient {
  const value = requiredWorkFlag(flags, "client");
  if (value === "codex") return "codex";
  if (value === "claude-code") return "claude";
  throw new Error("--client must be codex or claude-code");
}

export function workTimestamp(flags: ParsedArgs["flags"], required: boolean): string {
  const value = optionalWorkFlag(flags, "occurred-at");
  if (!value) {
    if (required) throw new Error("--occurred-at is required");
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    throw new Error("--occurred-at must be a canonical UTC ISO timestamp");
  }
  return value;
}

export function workMutationInput(
  flags: ParsedArgs["flags"],
  subcommand: "create" | "amend" | "transition",
): WorkMutationInput {
	const projectRoot = optionalWorkFlag(flags, "project-root") ?? process.cwd();
  const occurredAt = workTimestamp(flags, true);
  const sourceFile = optionalWorkFlag(flags, "source-file");
  const sourceStdin = flags["source-stdin"] === true;
  const sourceCount = (sourceFile ? 1 : 0) + (sourceStdin ? 1 : 0);
  if (subcommand !== "transition" && sourceCount !== 1) {
		throw new Error(
			"exactly one of --source-file or --source-stdin is required",
		);
  }
  if (subcommand === "transition" && sourceCount > 1) {
		throw new Error(
			"at most one of --source-file or --source-stdin is allowed",
		);
  }
  const fidelityValue = optionalWorkFlag(flags, "fidelity") ?? "client_exact";
  if (
    fidelityValue !== "native_exact" &&
    fidelityValue !== "client_exact" &&
    fidelityValue !== "agent_observed"
  ) {
    throw new Error(
      "--fidelity must be native_exact, client_exact, or agent_observed",
    );
  }
  const sourceEventId =
    sourceCount > 0 ? requiredWorkFlag(flags, "source-event-id") : undefined;
  const source: WorkRawSource | undefined = sourceEventId
    ? {
    event_id: sourceEventId,
    captured_at: optionalWorkFlag(flags, "captured-at") ?? occurredAt,
    client: optionalWorkFlag(flags, "client") ?? "anamnesis-cli",
    content_type:
					optionalWorkFlag(flags, "content-type") ??
					"text/plain; charset=utf-8",
    fidelity: fidelityValue,
    allocation_status: "allocated",
    body: sourceFile
      ? fs.readFileSync(path.resolve(projectRoot, sourceFile))
      : fs.readFileSync(0),
      }
    : undefined;
  const draftPath = requiredWorkFlag(flags, "draft");
  return {
    project_root: projectRoot,
    state_root: optionalWorkFlag(flags, "state-root"),
    work_id: requiredWorkFlag(flags, "work"),
    event_id: requiredWorkFlag(flags, "event-id"),
    occurred_at: occurredAt,
    draft: fs.readFileSync(path.resolve(projectRoot, draftPath)),
		expected_head:
			subcommand === "create" ? null : requiredWorkFlag(flags, "expected-head"),
    ...(sourceFile && source
      ? { source_file: source }
      : sourceStdin && source
        ? { source_stdin: source }
        : {}),
  };
}

export function workEvidenceMutationInput(
	flags: ParsedArgs["flags"],
): WorkEvidenceMutationInput {
	const projectRoot = optionalWorkFlag(flags, "project-root") ?? process.cwd();
	return {
		project_root: projectRoot,
		state_root: optionalWorkFlag(flags, "state-root"),
		work_id: requiredWorkFlag(flags, "work"),
		event_id: requiredWorkFlag(flags, "event-id"),
		occurred_at: workTimestamp(flags, true),
		expected_head: requiredWorkFlag(flags, "expected-head"),
		draft: fs.readFileSync(
			path.resolve(projectRoot, requiredWorkFlag(flags, "draft")),
		),
	};
}

export function workCloseInput(flags: ParsedArgs["flags"]): WorkCloseInput {
	return {
		...workEvidenceMutationInput(flags),
		expected_contract_revision: requiredWorkPositiveIntegerFlag(
			flags,
			"expected-contract-revision",
		),
		expected_contract_hash: requiredWorkFlag(flags, "expected-contract-hash"),
	};
}

export function workEvidenceSource(
	flags: ParsedArgs["flags"],
	projectRoot: string,
	occurredAt: string,
): { source_file?: WorkRawSource; source_stdin?: WorkRawSource } {
	const sourceFile = optionalWorkFlag(flags, "source-file");
	const sourceStdin = flags["source-stdin"] === true;
	if ((sourceFile ? 1 : 0) + (sourceStdin ? 1 : 0) !== 1) {
		throw new Error(
			"exactly one of --source-file or --source-stdin is required",
		);
	}
	const source: WorkRawSource = {
		event_id: requiredWorkFlag(flags, "source-event-id"),
		captured_at: optionalWorkFlag(flags, "captured-at") ?? occurredAt,
		client: optionalWorkFlag(flags, "client") ?? "anamnesis-cli",
		content_type:
			optionalWorkFlag(flags, "content-type") ?? "text/plain; charset=utf-8",
		fidelity: "client_exact",
		allocation_status: "allocated",
		body: sourceFile
			? fs.readFileSync(path.resolve(projectRoot, sourceFile))
			: fs.readFileSync(0),
	};
	return sourceFile ? { source_file: source } : { source_stdin: source };
}
