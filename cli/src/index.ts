#!/usr/bin/env node

// anamnesis CLI entrypoint.
//
// v0.1 implements `init`. `update` and `promote` land in subsequent rounds.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  init,
  InitError,
  summarizeChanges,
  type InitResult,
} from "./commands/init.js";

const VERSION = "0.1.0-dev";

// ---------------------------------------------------------------------------
// Arg parsing — tiny, deliberate, no dependency.
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      flags[arg.slice(1)] = true;
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

// ---------------------------------------------------------------------------
// Library root discovery
// ---------------------------------------------------------------------------

/**
 * Find the library root relative to the CLI entrypoint.
 *
 * Layout:
 *   <library>/cli/dist/index.js   (built, npm-installed)
 *   <library>/cli/src/index.ts    (dev via tsx)
 *
 * In both cases the library root is two levels up from __dirname.
 */
function resolveLibraryRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}

// ---------------------------------------------------------------------------
// Help / version
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(
    `anamnesis ${VERSION} — AI coding agent config lifecycle manager

Usage:
  anamnesis <command> [options]

Commands:
  init                          First-time setup for the current project

Flags (init):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --dry-run                     Show plan without writing
  --allow-exec-adapters         Permit .claude/{hooks,commands,skills} writes
  --project-name <name>         Override project name (default: dir basename)

Global:
  --help, -h                    Show this help
  --version, -v                 Show version

Docs: https://github.com/MCprotein/anamnesis`,
  );
}

// ---------------------------------------------------------------------------
// Reporters
// ---------------------------------------------------------------------------

function reportInit(result: InitResult): void {
  const s = summarizeChanges(result.changes);
  const fragIds = result.selectedFragments.map((f) => f.id).join(", ") || "(none)";
  console.log(`anamnesis init — ${result.agentfile.project.name}`);
  console.log(`  fragments: ${fragIds}`);
  console.log(
    `  changes: create=${s.create} update=${s.update} noop=${s.noop} blocked=${s.blocked} user-modified=${s.userModified}`,
  );
  if (!result.writtenToDisk) {
    console.log("  (dry-run — no files written)");
  }
  if (s.blocked > 0) {
    console.log(
      "  (some writes blocked — re-run with --allow-exec-adapters to include hooks/commands/skills)",
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);

  if (flags.help || flags.h) {
    printHelp();
    return 0;
  }
  if (flags.version || flags.v) {
    console.log(VERSION);
    return 0;
  }

  if (!command) {
    printHelp();
    return 0;
  }

  switch (command) {
    case "init":
      try {
        const result = init({
          projectRoot: (flags["project-root"] as string | undefined) ?? process.cwd(),
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          dryRun: flags["dry-run"] === true,
          allowExecAdapters: flags["allow-exec-adapters"] === true,
          projectName: flags["project-name"] as string | undefined,
        });
        reportInit(result);
        return 0;
      } catch (e) {
        if (e instanceof InitError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }

    default:
      console.error(`unknown command: ${command}`);
      console.error(`run 'anamnesis --help' for usage.`);
      return 1;
  }
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
