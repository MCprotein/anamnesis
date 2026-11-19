import { isVerbose, type ParsedArgs } from "../cli/args.js";
import { update, UpdateError } from "../commands/update.js";
import { resolveLibraryRoot } from "../library_root.js";
import {
	printUpdateDeprecationWarning,
	reportUpdate,
} from "../report/update.js";

export async function runApply({ flags }: ParsedArgs): Promise<number> {
  try {
    const projectRoot =
      (flags["project-root"] as string | undefined) ?? process.cwd();
    if (flags["dry-run"] === true && flags["apply"] === true) {
      throw new UpdateError(
        "`anamnesis apply` cannot combine --dry-run and --apply",
      );
    }
    const result = update({
      projectRoot,
      libraryRoot:
        (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
      apply: flags["dry-run"] !== true,
      bumpPinned: flags["bump-pinned"] === true,
      allowExecAdapters: flags["allow-exec-adapters"] === true,
    });
    reportUpdate(result, {
			commandName: "apply",
			projectRoot,
			verbose: isVerbose(flags),
		});
    return 0;
  } catch (e) {
    if (e instanceof UpdateError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

export async function runUpdate({ flags }: ParsedArgs): Promise<number> {
  try {
    const projectRoot =
      (flags["project-root"] as string | undefined) ?? process.cwd();
    printUpdateDeprecationWarning();
    const result = update({
      projectRoot,
      libraryRoot:
        (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
      apply: flags["apply"] === true,
      bumpPinned: flags["bump-pinned"] === true,
      allowExecAdapters: flags["allow-exec-adapters"] === true,
    });
    reportUpdate(result, {
			commandName: "update",
			projectRoot,
			verbose: isVerbose(flags),
		});
    return 0;
  } catch (e) {
    if (e instanceof UpdateError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
