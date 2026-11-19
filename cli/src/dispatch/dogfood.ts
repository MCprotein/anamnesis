import type { ParsedArgs } from "../cli/args.js";
import { dogfoodCheck, DogfoodError } from "../commands/dogfood.js";
import { inspectCodexHookTrust } from "../core/codex_hook_trust.js";
import { resolveLibraryRoot } from "../library_root.js";
import { reportDogfood } from "../report/dogfood.js";

export async function runDogfood({ positional, flags }: ParsedArgs): Promise<number> {
  const sub = positional[0];
  if (sub !== "check") {
    console.error(
      `error: unknown 'dogfood' subcommand: ${sub ?? "(none)"}`,
    );
    console.error(
      `usage: anamnesis dogfood check [--append] [--output=<path>]`,
    );
    return 1;
  }
  try {
    const projectRoot =
      (flags["project-root"] as string | undefined) ?? process.cwd();
    const codexHookTrust = await inspectCodexHookTrust(projectRoot);
    const result = await dogfoodCheck({
      projectRoot,
      libraryRoot:
        (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
      append: flags["append"] === true,
      outputPath: flags["output"] as string | undefined,
      codexHookTrust,
    });
    reportDogfood(result);
    return result.ok ? 0 : 1;
  } catch (e) {
    if (e instanceof DogfoodError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
