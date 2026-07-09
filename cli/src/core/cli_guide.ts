import { createTui, type TuiOptions } from "./tui.js";

export function formatGettingStartedGuide(
  version: string,
  opts: TuiOptions = {},
): string {
  const ui = createTui(opts);
  return [
    ...ui.title(
      `anamnesis ${version}`,
      "AI coding agent config lifecycle manager",
    ),
    ...ui.section("Start"),
    ...ui.commandRows([
      {
        command: "anamnesis init --dry-run",
        description: "Preview first-time project adoption.",
      },
      {
        command: "anamnesis init --tools all --allow-exec-adapters",
        description: "Install Claude Code, Codex, and Cursor surfaces.",
      },
    ]),
    ...ui.section("Maintain"),
    ...ui.commandRows([
      {
        command: "anamnesis apply --dry-run --allow-exec-adapters",
        description: "Preview project-managed changes.",
      },
      {
        command: "anamnesis apply --allow-exec-adapters",
        description: "Apply reviewed project-managed changes.",
      },
      {
        command: "anamnesis doctor",
        description: "Check install integrity and repair guidance.",
      },
      {
        command: "anamnesis status",
        description: "Show fragments, drift, context, and evidence state.",
      },
    ]),
    ...ui.section("Upgrade"),
    ...ui.commandRows([
      {
        command: "anamnesis upgrade plan",
        description: "Plan CLI package and project apply work.",
      },
    ]),
    ...ui.section("Agent Follow-Ups"),
    ...ui.commandRows([
      {
        command: "/ontology-enrich",
        description: "Add semantic relationships, flows, intent, and rules.",
      },
      {
        command: "/handoff-prepare",
        description: "Capture in-flight work before switching agents.",
      },
    ]),
    ...ui.section("More"),
    ...ui.commandRows([
      {
        command: "anamnesis --help",
        description: "Core command help.",
      },
      {
        command: "anamnesis --help --all",
        description: "Full maintainer command and flag catalog.",
      },
      {
        command: "anamnesis --version",
        description: "Installed CLI version.",
      },
    ]),
    "",
    "Docs: https://github.com/MCprotein/anamnesis",
  ].join("\n");
}

export function formatCompactHelp(
  version: string,
  opts: TuiOptions = {},
): string {
  const ui = createTui(opts);
  return [
    ...ui.title(
      `anamnesis ${version}`,
      "AI coding agent config lifecycle manager",
    ),
    "",
    "Usage:",
    `  ${ui.command("anamnesis <command> [options]")}`,
    ...ui.section("Core Commands"),
    ...ui.commandRows([
      {
        command: "init",
        description: "First-time setup for the current project.",
      },
      {
        command: "apply",
        description: "Apply project-managed changes; use --dry-run to preview.",
      },
      {
        command: "status",
        description: "Show installed fragments, drift, context, and evidence.",
      },
      {
        command: "doctor",
        description: "Diagnose install integrity and adapter wiring.",
      },
      {
        command: "upgrade",
        description: "Check or update the installed anamnesis CLI.",
      },
    ]),
    ...ui.section("Workflow Namespaces"),
    ...ui.commandRows([
      {
        command: "upgrade plan",
        description: "Read-only package and project apply plan with choices.",
      },
      {
        command: "context ...",
        description: "Index, query, diagnose, and resume project context.",
      },
      {
        command: "handoff ...",
        description: "Draft, close, or deprecate handoff archives.",
      },
      {
        command: "benchmark ...",
        description: "Run context and upgrade evidence workflows.",
      },
    ]),
    ...ui.section("Compatibility"),
    ...ui.commandRows([
      {
        command: "update",
        description: "Deprecated compatibility command for apply.",
      },
    ]),
    ...ui.section("Common Flags"),
    ...ui.commandRows([
      {
        command: "--project-root <path>",
        description: "Target directory; defaults to the current working directory.",
      },
      {
        command: "--library <path>",
        description: "Library path; defaults to the bundled package.",
      },
      {
        command: "--allow-exec-adapters",
        description: "Permit hooks, commands, skills, Cursor rules, and Codex wrappers.",
      },
      {
        command: "--json",
        description: "Print structured output where supported.",
      },
    ]),
    "",
    ui.note("Use `anamnesis --help --all` for the full maintainer command and flag catalog."),
    "Docs: https://github.com/MCprotein/anamnesis",
  ].join("\n");
}

export type HelpNamespace = "context" | "handoff" | "benchmark";

export function formatNamespaceHelp(
  namespace: HelpNamespace,
  opts: TuiOptions = {},
): string {
  const ui = createTui(opts);
  const rows = namespaceRows(namespace);
  return [
    ...ui.title(`anamnesis ${namespace}`, namespaceSubtitle(namespace)),
    ...ui.section("Subcommands"),
    ...ui.commandRows(rows),
    "",
    ui.note("Use `anamnesis --help --all` for every advanced flag."),
  ].join("\n");
}

function namespaceSubtitle(namespace: HelpNamespace): string {
  switch (namespace) {
    case "context":
      return "Index, retrieve, diagnose, and resume project context.";
    case "handoff":
      return "Draft and lifecycle-manage session handoff archives.";
    case "benchmark":
      return "Record deterministic and model-dependent context evidence.";
  }
}

function namespaceRows(namespace: HelpNamespace) {
  switch (namespace) {
    case "context":
      return [
        { command: "context index", description: "Build a local source-pointer index." },
        { command: "context query <query>", description: "Search indexed context and print exact source pointers." },
        { command: "context diagnose", description: "Report stale handoff, ontology, docs, and evidence issues." },
        { command: "context resume", description: "Print or write a compact resume bundle." },
        { command: "context subagent-preamble", description: "Print launcher-wrapper context for external subagents." },
      ];
    case "handoff":
      return [
        { command: "handoff draft", description: "Draft a handoff from git status, evidence, and active pointers." },
        { command: "handoff close", description: "Close a finalized archive and clean matching active entries." },
        { command: "handoff deprecate", description: "Mark an archive deprecated or superseded." },
      ];
    case "benchmark":
      return [
        { command: "benchmark report", description: "Generate the deterministic context-quality scorecard." },
        { command: "benchmark upgrade", description: "Run sanitized upgrade fixtures and graph evidence." },
        { command: "benchmark task", description: "Record a model-dependent task benchmark run." },
        { command: "benchmark task-series", description: "Roll up repeated full/compact task comparisons." },
        { command: "benchmark subagent-injection", description: "Measure repeated subagent context injection evidence." },
        { command: "benchmark prompt-gate", description: "Decide whether prompt-time context injection is justified." },
      ];
  }
}
