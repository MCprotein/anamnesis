import { isVerbose, type ParsedArgs } from "../cli/args.js";
import { hookSummary, HookSummaryError } from "../commands/hooks.js";
import {
	CodexHookTrustChangedError,
	trustCodexHooks,
} from "../core/codex_hook_trust.js";
import { reportCodexHookTrust, reportHookSummary } from "../report/hooks.js";

export async function runHooks({ positional, flags }: ParsedArgs): Promise<number> {
  const sub = positional[0];
  if (sub === "codex" && positional[1] === "trust") {
    const dryRun = flags["dry-run"] === true;
    const apply = flags["apply"] === true;
    if (dryRun === apply) {
			console.error(
				"error: choose exactly one of --dry-run or --apply for explicit Codex hook trust review",
			);
      console.error(
        "usage: anamnesis hooks codex trust (--dry-run|--apply) [--json] [--project-root=<path>]",
      );
      return 1;
    }
    try {
      const projectRoot =
        (flags["project-root"] as string | undefined) ?? process.cwd();
      const result = await trustCodexHooks(projectRoot, { apply });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportCodexHookTrust(result);
      }
      return apply && !result.inspection.available ? 1 : 0;
    } catch (error) {
      if (error instanceof CodexHookTrustChangedError) {
        console.error(`error: ${error.message}`);
        return 1;
      }
      throw error;
    }
  }
  if (sub !== "summary") {
		console.error(`error: unknown 'hooks' subcommand: ${sub ?? "(none)"}`);
    console.error(
      `usage: anamnesis hooks summary [--json] [--append] [--output=<path>] [--source=<path>] | anamnesis hooks codex trust (--dry-run|--apply)`,
    );
    return 1;
  }
  try {
    const result = hookSummary({
      projectRoot:
        (flags["project-root"] as string | undefined) ?? process.cwd(),
      sourcePath: flags["source"] as string | undefined,
      append: flags["append"] === true,
      outputPath: flags["output"] as string | undefined,
    });
    if (flags["json"] === true) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      reportHookSummary(result, { verbose: isVerbose(flags) });
    }
    return result.ok ? 0 : 1;
  } catch (e) {
    if (e instanceof HookSummaryError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
