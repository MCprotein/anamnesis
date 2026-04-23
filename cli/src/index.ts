#!/usr/bin/env node

// anamnesis v0.1 — placeholder entrypoint.
// Real CLI (init / update / promote) is not implemented yet.
// See docs/DESIGN.md for architecture.

const version = "0.1.0-dev";

function main(argv: string[]): number {
  const cmd = argv[2];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(`anamnesis ${version} — AI coding agent config lifecycle manager

Usage:
  anamnesis <command> [options]

Commands:
  init      First-time setup for current project
  update    Sync library updates / detect drift (dry-run by default)
  promote   Promote a project-local fragment into the library
  status    Show installed fragments and drift state
  --help    Show this help

Status: v0.1 pre-alpha. Commands are not yet implemented.
See https://github.com/MCprotein/anamnesis for design docs.`);
    return 0;
  }

  if (cmd === "--version" || cmd === "-v") {
    console.log(version);
    return 0;
  }

  console.error(`anamnesis: command '${cmd}' not implemented yet (v0.1 in development)`);
  return 1;
}

process.exit(main(process.argv));
