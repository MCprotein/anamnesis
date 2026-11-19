import { PromptDeltaGateError } from "../commands/benchmark_prompt_gate.js";
import {
	SubagentInjectionBenchmarkError,
} from "../commands/benchmark_subagent_injection.js";
import { UpgradeBenchmarkError } from "../commands/benchmark_upgrade.js";
import { WorkContinuityBenchmarkError } from "../commands/benchmark_work.js";
import { ContextIndexError } from "../commands/context_index.js";
import { GcError } from "../commands/gc.js";
import { InitError } from "../commands/init.js";
import { MigrateError } from "../commands/migrate.js";
import type { ToolName } from "../core/agentfile.js";

const SUPPORTED_TOOLS = [
	"claude-code",
	"codex",
	"cursor",
] as const satisfies readonly ToolName[];

export interface ParsedArgs {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

const BOOLEAN_ONLY_FLAGS: ReadonlySet<string> = new Set(["json"]);

export function parseArgs(argv: string[]): ParsedArgs {
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
        if (
          next !== undefined &&
          !next.startsWith("-") &&
          !BOOLEAN_ONLY_FLAGS.has(key)
        ) {
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

export function parseToolsFlag(
	value: string | boolean | undefined,
): ToolName[] | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) {
    throw new InitError("--tools requires a comma-separated list or 'all'");
  }
  const raw = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (raw.length === 0) {
    throw new InitError("--tools requires at least one adapter");
  }
  if (raw.length === 1 && raw[0] === "all") {
    return [...SUPPORTED_TOOLS];
  }
  const tools: ToolName[] = [];
  for (const tool of raw) {
    if (!SUPPORTED_TOOLS.includes(tool as ToolName)) {
      throw new InitError(
        `unknown adapter '${tool}' in --tools. Expected one of: ${SUPPORTED_TOOLS.join(", ")}, all`,
      );
    }
    if (!tools.includes(tool as ToolName)) tools.push(tool as ToolName);
  }
  return tools;
}

export function parseCommaListFlag(
	value: string | boolean | undefined,
): string[] | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) return undefined;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

export function optionalRequiredCommaListFlag(
	flags: ParsedArgs["flags"],
	name: string,
): string[] | undefined {
	const value = optionalWorkFlag(flags, name);
	if (value === undefined) return undefined;
	const parts = value
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	if (parts.length === 0) throw new Error(`--${name} requires a value`);
	return parts;
}

export function parsePositiveIntFlag(
  value: string | boolean | undefined,
  flagName: string,
): number | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) {
    throw new MigrateError(`${flagName} requires a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new MigrateError(`${flagName} requires a positive integer`);
  }
  return parsed;
}

export function parseOptionalPositiveIntegerFlag(
  value: string | boolean | undefined,
  flagName: string,
): number | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) {
    throw new PromptDeltaGateError(`${flagName} requires a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new PromptDeltaGateError(`${flagName} requires a positive integer`);
  }
  return parsed;
}

export function parseBenchmarkRunsFlag(
  value: string | boolean | undefined,
): number | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) {
    throw new UpgradeBenchmarkError("--runs requires a positive integer");
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new UpgradeBenchmarkError("--runs requires a positive integer");
  }
  return parsed;
}

export function parseWorkContinuityBenchmarkFlag(
	value: string | boolean | undefined,
	flagName: string,
): number | undefined {
	if (value === undefined || value === false) return undefined;
	if (value === true) {
		throw new WorkContinuityBenchmarkError(
			`${flagName} requires a positive integer`,
		);
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new WorkContinuityBenchmarkError(
			`${flagName} requires a positive integer`,
		);
	}
	return parsed;
}

export function parseBenchmarkAttemptsFlag(
  value: string | boolean | undefined,
): number | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) {
    throw new SubagentInjectionBenchmarkError(
      "--attempts requires a positive integer",
    );
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new SubagentInjectionBenchmarkError(
      "--attempts requires a positive integer",
    );
  }
  return parsed;
}

export function parseContextLimitFlag(
  value: string | boolean | undefined,
): number | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) {
    throw new ContextIndexError("--limit requires a positive integer");
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ContextIndexError("--limit requires a positive integer");
  }
  return parsed;
}

export function parseGcPositiveIntegerFlag(
  value: string | boolean | undefined,
  flagName: string,
): number | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) {
    throw new GcError(`${flagName} requires a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new GcError(`${flagName} requires a positive integer`);
  }
  return parsed;
}

export function parseGcNonnegativeIntegerFlag(
  value: string | boolean | undefined,
  flagName: string,
): number | undefined {
  if (value === undefined || value === false) return undefined;
  if (value === true) {
    throw new GcError(`${flagName} requires a nonnegative integer`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new GcError(`${flagName} requires a nonnegative integer`);
  }
  return parsed;
}

export function isVerbose(flags: ParsedArgs["flags"]): boolean {
	return flags.verbose === true;
}

export function requiredWorkFlag(flags: ParsedArgs["flags"], name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`--${name} requires a value`);
  }
  return value;
}

export function optionalWorkFlag(
  flags: ParsedArgs["flags"],
  name: string,
): string | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`--${name} requires a value`);
  }
  return value;
}

export function requiredWorkPositiveIntegerFlag(
  flags: ParsedArgs["flags"],
  name: string,
): number {
  const value = requiredWorkFlag(flags, name);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive safe integer`);
  }
  return parsed;
}
