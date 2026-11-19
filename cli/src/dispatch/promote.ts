import type { ParsedArgs } from "../cli/args.js";
import {
	type PromotableType,
	promote,
	PromoteError,
} from "../commands/promote.js";
import { resolveLibraryRoot } from "../library_root.js";
import { reportPromote } from "../report/promote.js";

export async function runPromote({ positional, flags }: ParsedArgs): Promise<number> {
  const source = (positional[0] as string | undefined) ?? "";
  const fragmentId = flags["as"] as string | undefined;
  if (!source) {
		console.error(
			"error: promote requires a source path positional argument.",
		);
    console.error(
      "usage: anamnesis promote <source> --as=<fragment-id> [--type=<capability>]",
    );
    return 1;
  }
  if (!fragmentId) {
    console.error("error: promote requires --as=<fragment-id>");
    return 1;
  }
  try {
    const result = promote({
      projectRoot:
        (flags["project-root"] as string | undefined) ?? process.cwd(),
      libraryRoot:
        (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
      source,
      fragmentId,
      capabilityType: flags["type"] as PromotableType | undefined,
      name: flags["name"] as string | undefined,
      region: flags["region"] as string | undefined,
      description: flags["description"] as string | undefined,
    });
    reportPromote(result);
    return 0;
  } catch (e) {
    if (e instanceof PromoteError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
