import { isVerbose, type ParsedArgs } from "../cli/args.js";
import { status, StatusError } from "../commands/status.js";
import { inspectCodexHookTrust } from "../core/codex_hook_trust.js";
import { resolveLibraryRoot } from "../library_root.js";
import { reportStatus } from "../report/status.js";

export async function runStatus({ flags }: ParsedArgs): Promise<number> {
  try {
    const projectRoot =
      (flags["project-root"] as string | undefined) ?? process.cwd();
    const codexHookTrust = await inspectCodexHookTrust(projectRoot);
    const result = status({
      projectRoot,
      libraryRoot:
        (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
      codexHookTrust,
    });
    if (flags["json"] === true) {
      console.log(JSON.stringify(result, null, 2));
    } else {
			reportStatus(result, projectRoot, { verbose: isVerbose(flags) });
    }
    return 0;
  } catch (e) {
    if (e instanceof StatusError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
