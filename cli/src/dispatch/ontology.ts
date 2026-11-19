import type { ParsedArgs } from "../cli/args.js";
import { bootstrap, OntologyBootstrapError } from "../commands/ontology.js";
import { reportBootstrap } from "../report/ontology.js";

export async function runOntology({ positional, flags }: ParsedArgs): Promise<number> {
  const sub = positional[0];
  if (sub !== "bootstrap") {
    console.error(
      `error: unknown 'ontology' subcommand: ${sub ?? "(none)"}`,
    );
    console.error(
      `usage: anamnesis ontology bootstrap [--scope=<path>] [--fragment=<id>] [--dry-run]`,
    );
    return 1;
  }
  try {
    const result = bootstrap({
      projectRoot:
        (flags["project-root"] as string | undefined) ?? process.cwd(),
      scope: flags["scope"] as string | undefined,
      fragment: flags["fragment"] as string | undefined,
      dryRun: flags["dry-run"] === true,
    });
    reportBootstrap(result);
    return 0;
  } catch (e) {
    if (e instanceof OntologyBootstrapError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
