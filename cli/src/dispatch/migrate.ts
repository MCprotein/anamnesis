import { type ParsedArgs, parsePositiveIntFlag } from "../cli/args.js";
import { migrateAgentfile, MigrateError } from "../commands/migrate.js";
import {
	migratePolicy,
	PolicyMigrationOutcome,
} from "../commands/migrate_policy.js";
import { defaultProjectRegistryPath } from "../core/project_registry.js";
import { UserWorkPolicyError } from "../core/user_work_policy.js";
import { migrateJson, reportMigrate } from "../report/migrate.js";
import { reportMigratePolicy } from "../report/policy.js";

export async function runMigrate({ positional, flags }: ParsedArgs): Promise<number> {
  const sub = positional[0];
  if (sub === "policy") return runMigratePolicy(flags);
  if (sub !== "agentfile") {
    console.error(
      `error: unknown 'migrate' subcommand: ${sub ?? "(none)"}`,
    );
    console.error(
      `usage: anamnesis migrate agentfile [--apply] [--json] [--to=<version>]`,
    );
    console.error(
      `       anamnesis migrate policy [--all] [--dry-run] [--json]`,
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

function runMigratePolicy(flags: ParsedArgs["flags"]): number {
	try {
		const result = migratePolicy({
			projectRoot:
				(flags["project-root"] as string | undefined) ?? process.cwd(),
			all: flags["all"] === true,
			dryRun: flags["dry-run"] === true,
			registryPath: defaultProjectRegistryPath(),
		});
		if (flags["json"] === true) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			reportMigratePolicy(result);
		}
		return result.projects.some((project) => project.outcome === PolicyMigrationOutcome.Failed)
			? 1
			: 0;
	} catch (e) {
		if (e instanceof UserWorkPolicyError) {
			console.error(`error: ${e.message}`);
			return 1;
		}
		throw e;
	}
}
