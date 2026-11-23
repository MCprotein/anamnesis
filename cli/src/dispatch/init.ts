import { isVerbose, type ParsedArgs, parseToolsFlag } from "../cli/args.js";
import { init, InitError } from "../commands/init.js";
import { defaultProjectRegistryPath } from "../core/project_registry.js";
import { resolveLibraryRoot } from "../library_root.js";
import { reportInit } from "../report/init.js";

export async function runInit({ flags }: ParsedArgs): Promise<number> {
  try {
    const projectRoot =
      (flags["project-root"] as string | undefined) ?? process.cwd();
    const result = init({
      projectRoot,
      libraryRoot:
        (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
      dryRun: flags["dry-run"] === true,
      allowExecAdapters: flags["allow-exec-adapters"] === true,
      tools: parseToolsFlag(flags["tools"]),
      projectName: flags["project-name"] as string | undefined,
      monorepo: flags["monorepo"] === true,
      noBootstrap: flags["no-bootstrap"] === true,
      noContextBootstrap: flags["no-context-bootstrap"] === true,
      scaffoldDocs: flags["scaffold-docs"] === true,
      enhanceDocs: flags["enhance-docs"] === true,
			projectRegistryPath: defaultProjectRegistryPath(),
      projectPolicy: flags["project-policy"] === true,
    });
		reportInit(result, projectRoot, flags["allow-exec-adapters"] === true, {
			verbose: isVerbose(flags),
		});
    return 0;
  } catch (e) {
    if (e instanceof InitError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
