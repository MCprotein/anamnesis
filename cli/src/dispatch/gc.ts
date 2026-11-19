import {
	type ParsedArgs,
	parseGcNonnegativeIntegerFlag,
	parseGcPositiveIntegerFlag,
} from "../cli/args.js";
import { gc, GcError } from "../commands/gc.js";
import { reportGc } from "../report/gc.js";

export async function runGc({ flags }: ParsedArgs): Promise<number> {
  try {
    const result = gc({
      projectRoot:
        (flags["project-root"] as string | undefined) ?? process.cwd(),
      dryRun: flags["dry-run"] === true,
      apply: flags["apply"] === true,
      maxCurrentAgeDays: parseGcPositiveIntegerFlag(
        flags["max-current-age-days"],
        "--max-current-age-days",
      ),
      maxCurrentHarnesses: parseGcPositiveIntegerFlag(
        flags["max-current-harnesses"],
        "--max-current-harnesses",
      ),
      maxReusableHarnesses: parseGcPositiveIntegerFlag(
        flags["max-reusable-harnesses"],
        "--max-reusable-harnesses",
      ),
      maxTotalBytes: parseGcPositiveIntegerFlag(
        flags["max-total-bytes"],
        "--max-total-bytes",
      ),
      maxWarmHandoffArchives: parseGcNonnegativeIntegerFlag(
        flags["max-warm-handoff-archives"],
        "--max-warm-handoff-archives",
      ),
      maxColdHandoffAgeDays: parseGcNonnegativeIntegerFlag(
        flags["max-cold-handoff-age-days"],
        "--max-cold-handoff-age-days",
      ),
      maxHandoffBytes: parseGcPositiveIntegerFlag(
        flags["max-handoff-bytes"],
        "--max-handoff-bytes",
      ),
    });
    if (flags["json"] === true) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      reportGc(result);
    }
    return 0;
  } catch (e) {
    if (e instanceof GcError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
