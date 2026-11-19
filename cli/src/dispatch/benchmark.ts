import {
	optionalRequiredCommaListFlag,
	parseBenchmarkAttemptsFlag,
	parseBenchmarkRunsFlag,
	parseCommaListFlag,
	type ParsedArgs,
	parseOptionalPositiveIntegerFlag,
	parseWorkContinuityBenchmarkFlag,
} from "../cli/args.js";
import {
	benchmarkCompare,
	BenchmarkError,
	benchmarkReport,
} from "../commands/benchmark.js";
import {
	benchmarkGallery,
	BenchmarkGalleryError,
} from "../commands/benchmark_gallery.js";
import {
	promptDeltaGate,
	PromptDeltaGateError,
} from "../commands/benchmark_prompt_gate.js";
import {
	retrievalBenchmark,
	RetrievalBenchmarkError,
} from "../commands/benchmark_retrieval.js";
import {
	sessionContextBenchmark,
	SessionContextBenchmarkError,
} from "../commands/benchmark_session_context.js";
import {
	subagentInjectionBenchmark,
	SubagentInjectionBenchmarkError,
} from "../commands/benchmark_subagent_injection.js";
import {
	agentTaskBenchmark,
	agentTaskBenchmarkCompare,
	agentTaskBenchmarkCompareTemplate,
	AgentTaskBenchmarkError,
	agentTaskBenchmarkTemplate,
} from "../commands/benchmark_task.js";
import {
	agentTaskBenchmarkSeries,
	AgentTaskBenchmarkSeriesError,
} from "../commands/benchmark_task_series.js";
import {
	BenchmarkTraceError,
	benchmarkTraceRollup,
} from "../commands/benchmark_trace.js";
import {
	upgradeBenchmark,
	UpgradeBenchmarkError,
} from "../commands/benchmark_upgrade.js";
import {
	workContinuityBenchmark,
	WorkContinuityBenchmarkError,
} from "../commands/benchmark_work.js";
import {
	workAgentBenchmark,
	WorkAgentBenchmarkError,
	type WorkAgentScenarioId,
} from "../commands/benchmark_work_agent.js";
import {
	type ParallelProtocol,
	workParallelAgentBenchmark,
} from "../commands/benchmark_work_parallel_agent.js";
import { formatNamespaceHelp } from "../core/cli_guide.js";
import { resolveLibraryRoot } from "../library_root.js";
import {
	reportAgentTaskBenchmark,
	reportAgentTaskBenchmarkCompare,
	reportAgentTaskBenchmarkSeries,
	reportBenchmark,
	reportBenchmarkCompare,
	reportBenchmarkGallery,
	reportBenchmarkTrace,
	reportPromptDeltaGate,
	reportRetrievalBenchmark,
	reportSessionContextBenchmark,
	reportSubagentInjectionBenchmark,
	reportUpgradeBenchmark,
	reportWorkAgentBenchmark,
	reportWorkContinuityBenchmark,
	reportWorkParallelAgentBenchmark,
} from "../report/benchmark.js";

export async function runBenchmark({ positional, flags }: ParsedArgs): Promise<number> {
  const sub = positional[0];
  if (sub === undefined) {
    console.log(formatNamespaceHelp("benchmark"));
    return 0;
  }
  if (
    sub !== "report" &&
    sub !== "compare" &&
    sub !== "gallery" &&
    sub !== "trace" &&
    sub !== "upgrade" &&
    sub !== "work-continuity" &&
sub !== "work-agent-ab" &&
sub !== "work-parallel-agent-ab" &&
    sub !== "task" &&
    sub !== "task-compare" &&
    sub !== "task-series" &&
    sub !== "prompt-gate" &&
    sub !== "retrieval" &&
    sub !== "session-context" &&
    sub !== "subagent-injection"
  ) {
    console.error(
      `error: unknown 'benchmark' subcommand: ${sub ?? "(none)"}`,
    );
    console.error(
      `usage: anamnesis benchmark report [--json] [--append] [--output=<path>]`,
    );
    console.error(
      `       anamnesis benchmark compare --baseline <path> --after <path> [--json] [--append] [--output=<path>]`,
    );
    console.error(
      `       anamnesis benchmark gallery [--json] [--write] [--validate] [--output=<path>]`,
    );
    console.error(
      `       anamnesis benchmark trace [--json] [--append] [--output=<path>] [--source=<path>]`,
    );
    console.error(
      `       anamnesis benchmark upgrade [--json] [--write] [--append] [--runs=<n>] [--output=<dir>]`,
    );
    console.error(
      `       anamnesis benchmark work-continuity [--json] [--write] [--append] [--runs=<n>] [--requirements=<n>] [--compact-window=<n>] [--output=<dir>]`,
    );
console.error(
	`       anamnesis benchmark work-agent-ab [--json] [--write] [--runs=<n>] [--model=<id>] [--output=<dir>]`,
);
console.error(
	`       anamnesis benchmark work-parallel-agent-ab [--protocol=validate|shadow|final] [--json] [--write] [--model=<id>] [--output=<dir>]`,
);
    console.error(
      `       anamnesis benchmark task --input <path> [--json] [--append] [--output=<path>]`,
    );
    console.error(
      `       anamnesis benchmark task-compare --full <path> --compact <path> [--json] [--append] [--output=<path>]`,
    );
		console.error(`       anamnesis benchmark task-compare --template`);
    console.error(
      `       anamnesis benchmark task-series [--json] [--write] [--source=<path>] [--output=<dir>]`,
    );
    console.error(
      `       anamnesis benchmark prompt-gate [--json] [--append] [--output=<path>]`,
    );
    console.error(
      `       anamnesis benchmark retrieval [--json] [--write] [--append] [--output=<dir>]`,
    );
    console.error(
      `       anamnesis benchmark session-context [--json] [--write] [--output=<dir>]`,
    );
    console.error(
      `       anamnesis benchmark subagent-injection [--json] [--write] [--append] [--attempts=<n>] [--output=<dir>]`,
    );
    return 1;
  }
  try {
    if (sub === "subagent-injection") {
      const result = subagentInjectionBenchmark({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        attempts: parseBenchmarkAttemptsFlag(flags["attempts"]),
        write: flags["write"] === true,
        append: flags["append"] === true,
        outputPath: flags["output"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportSubagentInjectionBenchmark(result);
      }
      return result.ok ? 0 : 1;
    }

    if (sub === "session-context") {
      const result = sessionContextBenchmark({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        write: flags["write"] === true,
        outputPath: flags["output"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportSessionContextBenchmark(result);
      }
      return 0;
    }

    if (sub === "retrieval") {
      const result = retrievalBenchmark({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        write: flags["write"] === true,
        append: flags["append"] === true,
        outputPath: flags["output"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportRetrievalBenchmark(result);
      }
      return result.summary.ok ? 0 : 1;
    }

    if (sub === "prompt-gate") {
      const maxTokens = parseOptionalPositiveIntegerFlag(
        flags["max-tokens"],
        "--max-tokens",
      );
      const result = promptDeltaGate({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        libraryRoot:
          (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
        append: flags["append"] === true,
        outputPath: flags["output"] as string | undefined,
        sources: parseCommaListFlag(flags["source"]),
				...(maxTokens !== undefined
					? { maxPromptDeltaTokens: maxTokens }
					: {}),
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportPromptDeltaGate(result);
      }
      return 0;
    }

    if (sub === "task") {
      if (flags["template"] === true) {
        console.log(JSON.stringify(agentTaskBenchmarkTemplate(), null, 2));
        return 0;
      }
      const inputPath = flags["input"];
      if (typeof inputPath !== "string") {
        console.error(
          `usage: anamnesis benchmark task --input <path> [--json] [--append] [--output=<path>]`,
        );
				console.error(`       anamnesis benchmark task --template`);
        return 1;
      }
      const result = agentTaskBenchmark({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        inputPath,
        append: flags["append"] === true,
        outputPath: flags["output"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportAgentTaskBenchmark(result);
      }
      return 0;
    }

    if (sub === "task-compare") {
      if (flags["template"] === true) {
				console.log(
					JSON.stringify(agentTaskBenchmarkCompareTemplate(), null, 2),
				);
        return 0;
      }
      const fullInputPath = flags["full"];
      const compactInputPath = flags["compact"];
      if (
        typeof fullInputPath !== "string" ||
        typeof compactInputPath !== "string"
      ) {
        console.error(
          `usage: anamnesis benchmark task-compare --full <path> --compact <path> [--json] [--append] [--output=<path>]`,
        );
				console.error(`       anamnesis benchmark task-compare --template`);
        return 1;
      }
      const result = agentTaskBenchmarkCompare({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        fullInputPath,
        compactInputPath,
        append: flags["append"] === true,
        outputPath: flags["output"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportAgentTaskBenchmarkCompare(result);
      }
      return 0;
    }

    if (sub === "task-series") {
      const result = agentTaskBenchmarkSeries({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        sources: parseCommaListFlag(flags["source"]),
        write: flags["write"] === true,
        outputPath: flags["output"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportAgentTaskBenchmarkSeries(result);
      }
      return 0;
    }

    if (sub === "trace") {
      const result = benchmarkTraceRollup({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        sourcePath: flags["source"] as string | undefined,
        append: flags["append"] === true,
        outputPath: flags["output"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportBenchmarkTrace(result);
      }
      return result.ok ? 0 : 1;
    }

    if (sub === "upgrade") {
      const result = upgradeBenchmark({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        runs: parseBenchmarkRunsFlag(flags["runs"]),
        write: flags["write"] === true,
        append: flags["append"] === true,
        outputPath: flags["output"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportUpgradeBenchmark(result);
      }
      return result.ok ? 0 : 1;
    }

if (sub === "work-continuity") {
	const result = workContinuityBenchmark({
		projectRoot:
			(flags["project-root"] as string | undefined) ?? process.cwd(),
		runs: parseWorkContinuityBenchmarkFlag(flags["runs"], "--runs"),
		requirements: parseWorkContinuityBenchmarkFlag(
			flags["requirements"],
			"--requirements",
		),
		compactFactWindow: parseWorkContinuityBenchmarkFlag(
			flags["compact-window"],
			"--compact-window",
		),
		write: flags["write"] === true,
		append: flags["append"] === true,
		outputPath: flags["output"] as string | undefined,
	});
	if (flags["json"] === true) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		reportWorkContinuityBenchmark(result);
	}
	return result.ok ? 0 : 1;
}

if (sub === "work-agent-ab") {
	const result = workAgentBenchmark({
		projectRoot:
			(flags["project-root"] as string | undefined) ?? process.cwd(),
		runs: parseWorkContinuityBenchmarkFlag(flags["runs"], "--runs"),
		model: flags["model"] as string | undefined,
		strict: flags["strict"] === true,
		scenarios: optionalRequiredCommaListFlag(flags, "scenarios") as
			| WorkAgentScenarioId[]
			| undefined,
		write: flags["write"] === true,
		outputPath: flags["output"] as string | undefined,
		onPlan: ({ runs, scenarios, invocations }) => {
			if (flags["json"] !== true) {
				console.error(
					`planning ${invocations} Codex invocations (${scenarios} scenarios x ${runs} runs x 2 conditions)`,
				);
			}
		},
	});
	if (flags["json"] === true) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		reportWorkAgentBenchmark(result);
	}
	return result.ok ? 0 : 1;
}

if (sub === "work-parallel-agent-ab") {
	const explicitProtocol = flags["protocol"];
	if (explicitProtocol !== undefined && flags["runs"] !== undefined) {
		throw new Error("--runs cannot be combined with --protocol");
	}
			const protocolValue =
				explicitProtocol ??
		(flags["runs"] !== undefined ? "legacy" : "validate");
	if (
		typeof protocolValue !== "string" ||
		!["validate", "shadow", "final", "legacy"].includes(protocolValue)
	) {
		throw new Error("--protocol must be validate, shadow, or final");
	}
	const result = await workParallelAgentBenchmark({
		projectRoot:
			(flags["project-root"] as string | undefined) ?? process.cwd(),
		protocol: protocolValue as ParallelProtocol,
		runs:
			protocolValue === "legacy"
				? parseWorkContinuityBenchmarkFlag(flags["runs"], "--runs")
				: undefined,
		model: flags["model"] as string | undefined,
		write: flags["write"] === true,
		outputPath: flags["output"] as string | undefined,
		onPlan: ({ runs, invocations }) => {
			if (flags["json"] !== true) {
				console.error(
					`planning ${invocations} ${protocolValue === "validate" ? "local fake-runner" : "Codex"} invocations (${runs} ${protocolValue === "legacy" ? "pairs" : "pairs/family x 3 families"} x 2 conditions x 4 model stages; 2 deterministic stages excluded)`,
				);
			}
		},
	});
	if (flags["json"] === true) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		reportWorkParallelAgentBenchmark(result);
	}
	return result.ok ? 0 : 1;
}

    if (sub === "gallery") {
      const result = benchmarkGallery({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        outputPath: flags["output"] as string | undefined,
        write: flags["write"] === true,
        validate: flags["validate"] === true,
        sources: parseCommaListFlag(flags["source"]),
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportBenchmarkGallery(result);
      }
      return result.ok ? 0 : 1;
    }

    if (sub === "compare") {
      const baselinePath = flags["baseline"];
      const afterPath = flags["after"];
			if (
				typeof baselinePath !== "string" ||
				typeof afterPath !== "string"
			) {
        console.error(
          `usage: anamnesis benchmark compare --baseline <path> --after <path> [--json] [--append] [--output=<path>]`,
        );
        return 1;
      }
      const result = benchmarkCompare({
        projectRoot:
          (flags["project-root"] as string | undefined) ?? process.cwd(),
        baselinePath,
        afterPath,
        append: flags["append"] === true,
        outputPath: flags["output"] as string | undefined,
      });
      if (flags["json"] === true) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        reportBenchmarkCompare(result);
      }
      return 0;
    }

    const result = benchmarkReport({
      projectRoot:
        (flags["project-root"] as string | undefined) ?? process.cwd(),
      libraryRoot:
        (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
      append: flags["append"] === true,
      outputPath: flags["output"] as string | undefined,
    });
    if (flags["json"] === true) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      reportBenchmark(result);
    }
    return 0;
  } catch (e) {
    if (
      e instanceof BenchmarkError ||
      e instanceof BenchmarkGalleryError ||
      e instanceof BenchmarkTraceError ||
      e instanceof UpgradeBenchmarkError ||
	e instanceof WorkContinuityBenchmarkError ||
	e instanceof WorkAgentBenchmarkError ||
      e instanceof AgentTaskBenchmarkError ||
      e instanceof AgentTaskBenchmarkSeriesError ||
      e instanceof PromptDeltaGateError ||
      e instanceof SessionContextBenchmarkError ||
      e instanceof RetrievalBenchmarkError ||
      e instanceof SubagentInjectionBenchmarkError
    ) {
      console.error(`error: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
