#!/usr/bin/env node
// anamnesis CLI entrypoint.
//
// v0.1 implements `init`. `update` and `promote` land in subsequent rounds.

import { parseArgs } from "./cli/args.js";
import {
	printGettingStartedGuide,
	printHelp,
	printWorkHelp,
	VERSION,
} from "./cli/help.js";
import { runApply, runUpdate } from "./dispatch/apply.js";
import { runBenchmark } from "./dispatch/benchmark.js";
import { runContext } from "./dispatch/context.js";
import { runDoctor } from "./dispatch/doctor.js";
import { runDogfood } from "./dispatch/dogfood.js";
import { runGc } from "./dispatch/gc.js";
import { runHandoff } from "./dispatch/handoff.js";
import { runHooks } from "./dispatch/hooks.js";
import { runInit } from "./dispatch/init.js";
import { runMigrate } from "./dispatch/migrate.js";
import { runOntology } from "./dispatch/ontology.js";
import { runProjects } from "./dispatch/projects.js";
import { runPromote } from "./dispatch/promote.js";
import { runRelease } from "./dispatch/release.js";
import { runStatus } from "./dispatch/status.js";
import { runUpgrade } from "./dispatch/upgrade.js";
import { runWork } from "./dispatch/work.js";

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const { command, flags } = args;

  if (flags.help || flags.h) {
    if (command === "work") printWorkHelp();
    else printHelp(flags.all === true);
    return 0;
  }
  if (flags.version || flags.v) {
    console.log(VERSION);
    return 0;
  }

  if (!command) {
    printGettingStartedGuide();
    return 0;
  }

  switch (command) {
    case "init":
      return runInit(args);
    case "apply":
      return runApply(args);
    case "update":
      return runUpdate(args);
    case "upgrade":
      return runUpgrade(args);
    case "projects":
      return runProjects(args);
    case "status":
      return runStatus(args);
    case "doctor":
      return runDoctor(args);
    case "release":
      return runRelease(args);
    case "hooks":
      return runHooks(args);
    case "dogfood":
      return runDogfood(args);
    case "work":
      return runWork(args);
    case "context":
      return runContext(args);
    case "handoff":
      return runHandoff(args);
    case "gc":
      return runGc(args);
    case "benchmark":
      return runBenchmark(args);
    case "migrate":
      return runMigrate(args);
    case "promote":
      return runPromote(args);
    case "ontology":
      return runOntology(args);
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
