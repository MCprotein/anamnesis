import { type ParsedArgs, parsePositiveIntFlag } from "../cli/args.js";
import { migrateAgentfile, MigrateError } from "../commands/migrate.js";
import { migrateJson, reportMigrate } from "../report/migrate.js";

export async function runMigrate({ positional, flags }: ParsedArgs): Promise<number> {
  const sub = positional[0];
  if (sub !== "agentfile") {
    console.error(
      `error: unknown 'migrate' subcommand: ${sub ?? "(none)"}`,
    );
    console.error(
      `usage: anamnesis migrate agentfile [--apply] [--json] [--to=<version>]`,
    );
    return 1;
  }
  try {
    const result = migrateAgentfile({
      projectRoot:
        (flags["project-root"] as string | undefined) ?? process.cwd(),
      apply: flags["apply"] === true,
      targetVersion: parsePositiveIntFlag(flags["to"], "--to"),
    });
    if (flags["json"] === true) {
      console.log(JSON.stringify(migrateJson(result), null, 2));
    } else {
      reportMigrate(result);
    }
    return 0;
  } catch (e) {
    if (e instanceof MigrateError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
