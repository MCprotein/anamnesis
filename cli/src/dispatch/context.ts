import { parseContextLimitFlag, type ParsedArgs } from "../cli/args.js";
import { writeStdoutFully } from "../cli/stdout.js";
import { contextDiagnostics } from "../commands/context_diagnostics.js";
import { contextDocs } from "../commands/context_docs.js";
import {
	contextIndex,
	ContextIndexError,
	type ContextIndexKind,
	contextQuery,
} from "../commands/context_index.js";
import {
	contextInstructionAudit,
	formatInstructionAudit,
} from "../commands/context_instruction_audit.js";
import {
	contextResume,
	contextSubagentPreamble,
} from "../commands/context_resume.js";
import { formatNamespaceHelp } from "../core/cli_guide.js";
import {
	reportContextDiagnostics,
	reportContextDocs,
	reportContextIndex,
	reportContextQuery,
	reportContextResume,
	reportContextSubagentPreamble,
} from "../report/context.js";

export async function runContext({ positional, flags }: ParsedArgs): Promise<number> {
  const sub = positional[0];
  if (sub === undefined) {
    console.log(formatNamespaceHelp("context"));
    return 0;
  }
  if (
    sub !== "index" &&
    sub !== "docs" &&
    sub !== "query" &&
    sub !== "diagnose" &&
    sub !== "audit-instructions" &&
    sub !== "resume" &&
    sub !== "subagent-preamble"
  ) {
    console.error(
      `error: unknown 'context' subcommand: ${sub ?? "(none)"}`,
    );
    console.error(
      `usage: anamnesis context index [--json] [--write] [--output=<path>]`,
    );
    console.error(
      `       anamnesis context docs [--json] [--catalog=<path>]`,
    );
    console.error(
      `       anamnesis context query [--kind=<kind>] [--limit=<n>] [--index=<path>] <query>`,
    );
		console.error(`       anamnesis context diagnose [--json]`);
    console.error(
      `       anamnesis context resume [--json] [--write] [--output=<path>]`,
    );
    console.error(
      `       anamnesis context subagent-preamble [--json] [--write] [--output=<path>]`,
    );
    return 1;
  }
  try {
    if (sub === "index") {
      const result = contextIndex({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        write: flags["write"] === true,
        outputPath: flags["output"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportContextIndex(result);
      }
      return 0;
    }

    if (sub === "docs") {
      const result = contextDocs({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        catalogPath: flags["catalog"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportContextDocs(result);
      }
      return 0;
    }

    if (sub === "audit-instructions") {
      if (flags["write"] || flags["apply"] || flags["output"]) throw new Error("audit-instructions is read-only; use stdout redirection to save a report");
      const result = contextInstructionAudit({ projectRoot: (flags["project-root"] as string | undefined) ?? process.cwd() });
      await writeStdoutFully(`${flags["json"] === true ? JSON.stringify(result, null, 2) : formatInstructionAudit(result)}\n`);
      return 0;
    }

    if (sub === "diagnose") {
      const result = contextDiagnostics({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportContextDiagnostics(result);
      }
      return 0;
    }

    if (sub === "resume") {
      const result = contextResume({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        write: flags["write"] === true,
        outputPath: flags["output"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportContextResume(result);
      }
      return 0;
    }

    if (sub === "subagent-preamble") {
      const result = contextSubagentPreamble({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        write: flags["write"] === true,
        outputPath: flags["output"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportContextSubagentPreamble(result);
      }
      return 0;
    }

    const query = positional.slice(1).join(" ").trim();
    if (!query) {
      console.error(
        `usage: anamnesis context query [--kind=<kind>] [--limit=<n>] [--index=<path>] <query>`,
      );
      return 1;
    }
    const result = contextQuery({
      projectRoot:
        (flags["project-root"] as string | undefined) ?? process.cwd(),
      query,
      kind: flags["kind"] as ContextIndexKind | undefined,
      limit: parseContextLimitFlag(flags["limit"]),
      indexPath: flags["index"] as string | undefined,
    });
    if (flags["json"] === true) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      reportContextQuery(result);
    }
    return 0;
  } catch (e) {
    if (e instanceof ContextIndexError) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
