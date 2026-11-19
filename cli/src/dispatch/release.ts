import type { ParsedArgs } from "../cli/args.js";
import { DoctorError } from "../commands/doctor.js";
import { releaseCheck } from "../commands/release_check.js";
import { StatusError } from "../commands/status.js";
import { UpdateError } from "../commands/update.js";
import { inspectCodexHookTrust } from "../core/codex_hook_trust.js";
import { resolveLibraryRoot } from "../library_root.js";
import { reportReleaseCheck } from "../report/release.js";

export async function runRelease({ positional, flags }: ParsedArgs): Promise<number> {
  const sub = positional[0];
  if (sub !== "check") {
    console.error(
      `error: unknown 'release' subcommand: ${sub ?? "(none)"}`,
    );
    console.error(
      `usage: anamnesis release check [--json] [--append] [--project-root=<path>] [--library=<path>]`,
    );
    return 1;
  }
  try {
    const projectRoot =
      (flags["project-root"] as string | undefined) ?? process.cwd();
    const codexHookTrust = await inspectCodexHookTrust(projectRoot);
    const result = releaseCheck({
      projectRoot,
      libraryRoot:
        (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
      append: flags["append"] === true,
      codexHookTrust,
    });
    if (flags["json"] === true) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      reportReleaseCheck(result);
    }
    return result.ok ? 0 : 1;
  } catch (e) {
    if (
      e instanceof StatusError ||
      e instanceof UpdateError ||
      e instanceof DoctorError
    ) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
