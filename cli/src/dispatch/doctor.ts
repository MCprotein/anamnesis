import { isVerbose, type ParsedArgs } from "../cli/args.js";
import { doctor, DoctorError } from "../commands/doctor.js";
import { inspectCodexHookTrust } from "../core/codex_hook_trust.js";
import { resolveLibraryRoot } from "../library_root.js";
import { reportDoctor } from "../report/doctor.js";

export async function runDoctor({ flags }: ParsedArgs): Promise<number> {
  try {
    const projectRoot =
      (flags["project-root"] as string | undefined) ?? process.cwd();
    const codexHookTrust = await inspectCodexHookTrust(projectRoot);
    const result = doctor({
      projectRoot,
      libraryRoot:
        (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
      append: flags["append"] === true,
      outputPath: flags["output"] as string | undefined,
      codexHookTrust,
    });
		reportDoctor(result, { verbose: isVerbose(flags) });
    return result.ok ? 0 : 1;
  } catch (e) {
    if (e instanceof DoctorError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
