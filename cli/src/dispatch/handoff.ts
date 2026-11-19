import type { ParsedArgs } from "../cli/args.js";
import {
	handoffAction,
	HandoffActionError,
} from "../commands/handoff_action.js";
import { handoffDraft } from "../commands/handoff_draft.js";
import { formatNamespaceHelp } from "../core/cli_guide.js";
import { reportHandoffAction, reportHandoffDraft } from "../report/handoff.js";

export async function runHandoff({ positional, flags }: ParsedArgs): Promise<number> {
  const sub = positional[0];
  if (sub === undefined) {
    console.log(formatNamespaceHelp("handoff"));
    return 0;
  }
  if (sub !== "draft" && sub !== "close" && sub !== "deprecate") {
    console.error(
      `error: unknown 'handoff' subcommand: ${sub ?? "(none)"}`,
    );
    console.error(
      `usage: anamnesis handoff draft [--json] [--write] [--output=<path>]`,
    );
    console.error(
      `       anamnesis handoff close --archive=<path> [--apply] [--summary=<text>] [--reason=<text>]`,
    );
    console.error(
      `       anamnesis handoff deprecate --archive=<path> [--apply] [--superseded-by=<path>] [--summary=<text>] [--reason=<text>]`,
    );
    return 1;
  }
  try {
    if (sub === "draft") {
      const result = handoffDraft({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        write: flags["write"] === true,
        outputPath: flags["output"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportHandoffDraft(result);
      }
      return 0;
    }

    const result = handoffAction({
      projectRoot:
        (flags["project-root"] as string | undefined) ?? process.cwd(),
      mode: sub,
      archive: flags["archive"] as string | undefined,
      apply: flags["apply"] === true,
      summary: flags["summary"] as string | undefined,
      reason: flags["reason"] as string | undefined,
      supersededBy: flags["superseded-by"] as string | undefined,
    });
    if (flags["json"] === true) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      reportHandoffAction(result);
    }
    return 0;
  } catch (e) {
    if (e instanceof HandoffActionError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
