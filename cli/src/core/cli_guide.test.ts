import { describe, expect, it } from "vitest";
import {
  formatCompactHelp,
  formatGettingStartedGuide,
  formatNamespaceHelp,
} from "./cli_guide.js";

describe("formatGettingStartedGuide", () => {
  it("prints a concise first-run guide", () => {
    const output = formatGettingStartedGuide("1.2.3");

    expect(output).toContain("anamnesis 1.2.3");
    expect(output).toContain("Start");
    expect(output).toContain("anamnesis init --dry-run");
    expect(output).toContain("anamnesis init --tools all --allow-exec-adapters");
    expect(output).toContain("anamnesis doctor");
    expect(output).toContain("anamnesis status");
    expect(output).toContain("anamnesis apply --dry-run --allow-exec-adapters");
    expect(output).toContain("anamnesis apply --allow-exec-adapters");
    expect(output).toContain("anamnesis upgrade plan");
    expect(output).toContain("/ontology-enrich");
    expect(output).toContain("/handoff-prepare");
    expect(output).toContain("anamnesis --help");
    expect(output).toContain("anamnesis --help --all");
    expect(output).not.toContain("\x1b[");
  });

  it("prints compact help without advanced command flood", () => {
    const output = formatCompactHelp("1.2.3", { color: false, width: 100 });

    expect(output).toContain("Core Commands");
    expect(output).toContain("Workflow Namespaces");
    expect(output).toContain("update");
    expect(output).toContain("Deprecated compatibility command for apply");
    expect(output).toContain("anamnesis --help --all");
    expect(output).not.toContain("benchmark task-series");
    expect(output).not.toContain("\x1b[");
    expect(output).toMatchInlineSnapshot(`
      "anamnesis 1.2.3
      AI coding agent config lifecycle manager

      Usage:
        anamnesis <command> [options]

      Core Commands
        init     First-time setup for the current project.
        apply    Apply project-managed changes; use --dry-run to preview.
        status   Show installed fragments, drift, context, and evidence.
        doctor   Diagnose install integrity and adapter wiring.
        upgrade  Check or update the installed anamnesis CLI.

      Workflow Namespaces
        upgrade plan   Read-only package and project apply plan with choices.
        context ...    Index, query, diagnose, and resume project context.
        handoff ...    Draft, close, or deprecate handoff archives.
        benchmark ...  Run context and upgrade evidence workflows.

      Compatibility
        update  Deprecated compatibility command for apply.

      Common Flags
        --project-root <path>  Target directory; defaults to the current working directory.
        --library <path>       Library path; defaults to the bundled package.
        --allow-exec-adapters  Permit hooks, commands, skills, Cursor rules, and Codex wrappers.
        --json                 Print structured output where supported.

        Use \`anamnesis --help --all\` for the full maintainer command and flag catalog.
      Docs: https://github.com/MCprotein/anamnesis"
    `);
  });

  it("can render colored terminal output", () => {
    const output = formatCompactHelp("1.2.3", { color: true });

    expect(output).toContain("\x1b[");
    expect(output).toContain("Core Commands");
  });

  it("prints namespace help for grouped advanced surfaces", () => {
    const output = formatNamespaceHelp("context", { color: false });

    expect(output).toContain("anamnesis context");
    expect(output).toContain("context index");
    expect(output).toContain("context subagent-preamble");
    expect(output).not.toContain("\x1b[");
  });
});
