#!/usr/bin/env node

// anamnesis CLI entrypoint.
//
// v0.1 implements `init`. `update` and `promote` land in subsequent rounds.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BenchmarkCompareResult,
	BenchmarkError,
  type BenchmarkResult,
	benchmarkCompare,
	benchmarkReport,
} from "./commands/benchmark.js";
import {
  BenchmarkGalleryError,
  type BenchmarkGalleryResult,
	benchmarkGallery,
} from "./commands/benchmark_gallery.js";
import {
	PromptDeltaGateError,
	type PromptDeltaGateResult,
	promptDeltaGate,
} from "./commands/benchmark_prompt_gate.js";
import {
	RetrievalBenchmarkError,
	type RetrievalBenchmarkResult,
	retrievalBenchmark,
} from "./commands/benchmark_retrieval.js";
import {
	SessionContextBenchmarkError,
	type SessionContextBenchmarkResult,
	sessionContextBenchmark,
} from "./commands/benchmark_session_context.js";
import {
	SubagentInjectionBenchmarkError,
	type SubagentInjectionBenchmarkResult,
	subagentInjectionBenchmark,
} from "./commands/benchmark_subagent_injection.js";
import {
	type AgentTaskBenchmarkCompareResult,
	AgentTaskBenchmarkError,
	type AgentTaskBenchmarkResult,
  agentTaskBenchmark,
  agentTaskBenchmarkCompare,
  agentTaskBenchmarkCompareTemplate,
  agentTaskBenchmarkTemplate,
} from "./commands/benchmark_task.js";
import {
  AgentTaskBenchmarkSeriesError,
  type AgentTaskBenchmarkSeriesResult,
	agentTaskBenchmarkSeries,
} from "./commands/benchmark_task_series.js";
import {
	BenchmarkTraceError,
	type BenchmarkTraceRollupResult,
	benchmarkTraceRollup,
} from "./commands/benchmark_trace.js";
import {
	UpgradeBenchmarkError,
	type UpgradeBenchmarkResult,
	upgradeBenchmark,
} from "./commands/benchmark_upgrade.js";
import {
	WorkContinuityBenchmarkError,
	type WorkContinuityBenchmarkResult,
	workContinuityBenchmark,
} from "./commands/benchmark_work.js";
import {
	WorkAgentBenchmarkError,
	type WorkAgentBenchmarkResult,
	type WorkAgentScenarioId,
	workAgentBenchmark,
} from "./commands/benchmark_work_agent.js";
import {
	type ParallelBenchmarkResult,
	type ParallelProtocol,
	workParallelAgentBenchmark,
} from "./commands/benchmark_work_parallel_agent.js";
import {
	type ContextDiagnosticsResult,
	contextDiagnostics,
} from "./commands/context_diagnostics.js";
import {
	type ContextDocsResult,
	contextDocs,
} from "./commands/context_docs.js";
import {
  ContextIndexError,
  type ContextIndexKind,
  type ContextIndexResult,
  type ContextQueryResult,
	contextIndex,
	contextQuery,
} from "./commands/context_index.js";
import {
	type ContextResumeResult,
	type ContextSubagentPreambleResult,
  contextResume,
  contextSubagentPreamble,
} from "./commands/context_resume.js";
import { DoctorError, type DoctorResult, doctor } from "./commands/doctor.js";
import {
	DogfoodError,
	type DogfoodResult,
	dogfoodCheck,
} from "./commands/dogfood.js";
import { GcError, type GcResult, gc } from "./commands/gc.js";
import {
  HandoffActionError,
  type HandoffActionResult,
	handoffAction,
} from "./commands/handoff_action.js";
import {
  type HandoffDraftResult,
	handoffDraft,
} from "./commands/handoff_draft.js";
import {
	HookSummaryError,
	type HookSummaryResult,
	hookSummary,
} from "./commands/hooks.js";
import {
	InitError,
	type InitResult,
	init,
	summarizeChanges,
} from "./commands/init.js";
import {
	type MigrateAgentfileResult,
	MigrateError,
	migrateAgentfile,
} from "./commands/migrate.js";
import {
	type BootstrapResult,
	bootstrap,
	OntologyBootstrapError,
} from "./commands/ontology.js";
import {
	type PromotableType,
	PromoteError,
	type PromoteResult,
	promote,
} from "./commands/promote.js";
import {
	ProjectsError,
	type RegisteredProjectsResult,
	listRegisteredProjects,
	pruneRegisteredProjects,
	registerManagedProject,
	syncRegisteredProjects,
	unregisterManagedProject,
} from "./commands/projects.js";
import { syncProjectsAfterUpgrade } from "./commands/upgrade_projects.js";
import {
	type ReleaseCheckResult,
	releaseCheck,
} from "./commands/release_check.js";
import { StatusError, type StatusResult, status } from "./commands/status.js";
import { UpdateError, type UpdateResult, update } from "./commands/update.js";
import {
	UpgradeError,
	type UpgradeResult,
	upgrade,
} from "./commands/upgrade.js";
import {
	UpgradeApplyChoiceError,
	type UpgradeApplyChoiceResult,
	upgradeApplyChoice,
} from "./commands/upgrade_apply_choice.js";
import {
	UpgradeChooseError,
	type UpgradeChooseResult,
	upgradeChoose,
} from "./commands/upgrade_choose.js";
import {
	type UpgradePlanResult,
	upgradePlan,
} from "./commands/upgrade_plan.js";
import {
	detectUpgradeProjectGuidance,
	formatUpgradeProjectGuidance,
} from "./commands/upgrade_project_guidance.js";
import {
  allocateStagedPromptToNewWork,
  allocateStagedPromptToSameWork,
  amendWork,
	assessWorkDelegation,
  briefWork,
  closeWork,
  confirmWorkBrief,
  createWork,
  discardStagedPrompt,
	gcStagedWorkPromptEntries,
	publicWorkExecutionMutation,
	publicWorkPromptResolution,
	readinessWork,
	recordWorkDelegation,
	recordWorkReview,
	requestWorkReview,
  retainStagedPromptProvisional,
  statusWork,
  switchWork,
  transitionWork,
  type WorkBriefResult,
  type WorkCloseInput,
  type WorkEvidenceMutationInput,
  type WorkMutationInput,
  type WorkMutationResult,
  type WorkPromptResolutionResult,
  type WorkRawSource,
  type WorkStatusResult,
	waiveWorkDelegation,
} from "./commands/work.js";
import {
  handleWorkPostToolBoundary,
  handleWorkUserPromptSubmit,
  type WorkHookClient,
} from "./commands/work_hook.js";
import { readAgentfile, type ToolName } from "./core/agentfile.js";
import {
  CodexHookTrustChangedError,
  type CodexHookTrustInspection,
  type TrustCodexHooksResult,
  inspectCodexHookTrust,
  trustCodexHooks,
} from "./core/codex_hook_trust.js";
import {
  formatCompactHelp,
  formatGettingStartedGuide,
  formatNamespaceHelp,
} from "./core/cli_guide.js";
import {
	collectGenerationBoundaryStatus,
	formatBootstrapGenerationBoundaryLines,
	formatGenerationBoundaryLines,
} from "./core/generation-boundary.js";
import { formatInitNextStepLines } from "./core/init_next_steps.js";
import type { OntologyLifecycleRecommendation } from "./core/ontology-gaps.js";
import { createTui, type TuiTone } from "./core/tui.js";
import { PACKAGE_VERSION } from "./core/version.js";
import { parseSingleWorkDraft } from "./core/work_command_draft.js";
import {
	defaultProjectRegistryPath,
	ProjectRegistryError,
} from "./core/project_registry.js";
import {
  newWorkCursor,
  readWorkCursor,
  switchWorkCursorAtomic,
  writeWorkCursorAtomic,
} from "./core/work_cursor.js";
import { deliverWorkBriefing } from "./core/work_delivery.js";
import { workExecutionInputsSchema } from "./core/work_execution_inputs.js";
import { normalizeWorkPromptCapturePolicy } from "./core/work_prompt_policy.js";
import {
	detectWorkspaceProfile,
	formatWorkspaceProfileLines,
} from "./core/workspace_profile.js";

const VERSION = PACKAGE_VERSION;
const SUPPORTED_TOOLS = [
	"claude-code",
	"codex",
	"cursor",
] as const satisfies readonly ToolName[];

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

function parseToolsFlag(
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

function parseCommaListFlag(
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

function optionalRequiredCommaListFlag(
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

function parsePositiveIntFlag(
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

function parseOptionalPositiveIntegerFlag(
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

function parseBenchmarkRunsFlag(
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

function parseWorkContinuityBenchmarkFlag(
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

function parseBenchmarkAttemptsFlag(
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

function parseContextLimitFlag(
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

function parseGcPositiveIntegerFlag(
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

function parseGcNonnegativeIntegerFlag(
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

function printHelp(full = false): void {
  if (!full) {
    console.log(formatCompactHelp(VERSION));
    return;
  }
  console.log(
    `anamnesis ${VERSION} — AI coding agent config lifecycle manager

Usage:
  anamnesis <command> [options]

Commands:
  init                          First-time setup for the current project
  apply                         Apply project-managed changes
                                  (writes by default; --dry-run previews)
  update                        Deprecated compatibility command for apply
  upgrade                       Check or update the installed anamnesis CLI
  upgrade plan                  Read-only package + project plan with choices
  upgrade apply-choice <id>     Execute one supported upgrade-plan choice
  upgrade choose                Interactive chooser over upgrade-plan choices
  projects list                 List globally registered projects
  projects register             Register an existing managed project
  projects plan                 Preview safe updates for every registered project
  projects apply                Apply safe updates across registered projects
  projects unregister [id|path] Remove one project from the global registry
  projects prune                Remove stale registrations (--apply required)
  status                        Show installed fragments + drift + suggestions
  doctor                        Diagnose install integrity and adapter wiring
  release check                 Run the read-only release readiness gate
  hooks summary                 Summarize hook execution logs and optionally
                                  record runtime evidence
  hooks codex trust             Review or explicitly approve Anamnesis-owned
                                  Codex native hooks
  dogfood check                 Run continuity self-check and optionally append
                                  a record to docs/DOGFOOD.md
  context index                 Build a local JSONL context index from
                                  agent rules, ontology, handoffs, and docs
  context docs                  Summarize Markdown document graph, links,
                                  backlinks, and ontology source refs
  context query                 Search the local context index and print
                                  source pointers for exact follow-up reads
  context diagnose              Report stale handoff pointers, ontology
                                  conflicts, and missing evidence artifacts
  context resume                Print a compact resume bundle for current
                                  handoff, touched files, evidence, warnings
  context subagent-preamble     Print launcher-wrapper preamble for external
                                  subagent hydration
  handoff draft                 Draft a handoff from git status, evidence,
                                  and existing handoff pointers
  handoff close                 Close a finalized handoff archive and remove
                                  matching active entries (dry-run by default)
  handoff deprecate             Mark a finalized handoff archive deprecated or
                                  superseded (dry-run by default)
  gc                            Review lifecycle cleanup; --apply deletes
                                  clean managed task-harness candidates only
  benchmark report             Generate a deterministic context-quality
                                  benchmark report for docs/BENCHMARKS.md
  benchmark compare            Compare two benchmark report JSON snapshots
                                  and optionally append a delta report
  benchmark gallery            Generate or validate docs/BENCHMARK-GALLERY.md
                                  from runtime evidence
  benchmark trace              Roll up benchmark trace JSONL and optionally
                                  record runtime evidence
  benchmark upgrade            Run deterministic sanitized upgrade fixtures
                                  and optionally write JSON/SVG evidence
  benchmark work-continuity    Compare one compaction/resume scenario with
                                  Work continuity disabled and enabled
  benchmark work-agent-ab     Run repeated real Codex disabled/enabled Work
                                  continuity scenarios with token accounting
  benchmark work-parallel-agent-ab
                                Run a real two-child parallel Luna Work A/B
                                  diagnostic with reviewer and leader integration
  benchmark task               Record a model-dependent agent task benchmark
                                  separately from deterministic scorecards
  benchmark task-compare       Compare paired full/compact agent task
                                  benchmark inputs
  benchmark task-series        Roll up repeated full/compact task compare
                                  evidence and write numeric graph artifacts
  benchmark prompt-gate        Decide whether prompt-time context delta
                                  injection is justified by evidence
  benchmark retrieval          Measure deterministic context-query source
                                  pointer ranking over public-safe fixtures
  benchmark session-context    Compare full vs compact SessionStart context
                                  and optionally write JSON/SVG artifacts
  benchmark subagent-injection
                                Measure repeated subagent context injection
                                  and prompt-contract evidence
  migrate agentfile            Plan or apply Agentfile schema migrations
  promote <source>              Lift a project file into the library as a fragment
  ontology bootstrap            Generate .anamnesis/ontology/<id>.bootstrap.yaml
                                  from project files (Layer A — deterministic)
  work create                   Create a Work from an exact source + contract draft
  work amend                    Append a contract revision to an existing Work
  work transition               Transition one requirement with evidence
  work close                    Close a requirements-ready Work as completed
  work review request|record    Prepare or record bounded review evidence
  work delegation assess|record|waive
                                Record parallelism/delegation evidence
  work readiness                Evaluate protected-action obligations read-only
  work status                   Refold and report authoritative Work state
  work brief                    Prepare a session-scoped continuity briefing
  work confirm                  Confirm a briefing was actually presented
  work switch                   Move one session cursor to another Work

Flags (init):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --dry-run                     Show plan without writing
  --allow-exec-adapters         Permit executable adapter writes
                                  (.claude/*, .cursor/rules, Codex hooks)
  --tools <list|all>            Adapter surfaces to install on first init
                                  (comma-separated: claude-code,codex,cursor;
                                  default: claude-code)
  --project-name <name>         Override project name (default: dir basename)
  --monorepo                    Detect package.json workspaces and generate
                                  a multi-scope Agentfile with one scope per
                                  workspace sub-project (silent fall-back to
                                  single-scope if no monorepo detected)
  --no-bootstrap                Skip the post-install 'ontology bootstrap'
                                  pass (fragments with introspectors auto-
                                  populate .anamnesis/ontology/<id>.bootstrap.yaml)
  --no-context-bootstrap        Skip the first-run system_graph.yaml draft
                                  generated from safe local project signals or
                                  zero-context open questions
  --scaffold-docs               Create missing README.md and
                                  docs/PROJECT-CONTEXT.md starter docs
  --enhance-docs                Add/refresh managed context-review regions in
                                  existing README/docs files

Flags (apply / deprecated update):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --dry-run                     Preview project-managed changes without writing
                                  (apply only; update is preview by default)
  --apply                       Compatibility flag: write when using update;
                                  accepted by apply for old muscle memory
  --bump-pinned                 Explicitly bump pinned fragments to current
  --allow-exec-adapters         Permit executable adapter writes
                                  (.claude/*, .cursor/rules, Codex hooks)

Flags (upgrade):
  --registry <url>              Package registry (default: https://registry.npmjs.org)
  --apply                       Upgrade the CLI, then safely sync registered projects
  --registry-file <path>        Override the user-level project registry file
  --json                        Print structured JSON

Flags (upgrade plan):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --registry <url>              Package registry (default: https://registry.npmjs.org)
  --json                        Print structured JSON

Flags (projects):
  --project-root <path>         Project to register (default: cwd)
  --library <path>              Library used for plan/apply (default: bundled)
  --allow-exec-adapters         Persist executable-adapter consent on register
  --registry-file <path>        Override the user-level registry file
  --apply                       Confirm stale-entry removal for projects prune
  --json                        Print structured JSON

Flags (upgrade apply-choice):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --registry <url>              Package registry (default: https://registry.npmjs.org)
  --apply                       Execute local-write or package-install choices
                                  after review; without it, those choices only
                                  run their safe preview when available
  --json                        Print structured JSON

Flags (upgrade choose):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --registry <url>              Package registry (default: https://registry.npmjs.org)
  --choice <id|number>          Select without prompting (useful for scripts)
  --apply                       Execute local-write or package-install choices
                                  after review; without it, those choices only
                                  run their safe preview when available
  --json                        Print structured JSON

Flags (status / doctor):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)

Flags (doctor):
  --append                      Append markdown to docs/DOCTOR.md and record
                                  runtime evidence
  --output <path>               Override doctor check log path

Flags (release check):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --json                        Print structured JSON
  --append                      Record runtime evidence

Flags (status):
  --json                        Print structured JSON for CI/tools

Flags (work):
  --work <id>                   Work identifier (required)
  --state-root <path>           Override the shared local Work state root
  --session <id>                Session cursor identifier (brief/confirm/switch)
  --event-id <id>               Stable ledger event identifier (mutations)
  --source-event-id <id>        Stable exact-source ID (create/amend/waiver)
  --occurred-at <ISO>           Stable event time; defaults to now for cursor-only actions
  --draft <path>                Strict single-document YAML draft (mutations)
  --expected-head <hash>        Required CAS head for every existing-Work mutation
  --expected-contract-revision <n>
                                Required current contract revision (work close)
  --expected-contract-hash <hash>
                                Required current contract hash (work close)
  --inputs <path>               Strict execution-input YAML/JSON (readiness)
  --gate <planning|completion>  Review gate (review request)
  --activity-id <id>            Review activity identifier (review request)
  --action <implementation-entry|completion>
                                Protected action (readiness)
  --source-file <path>          Capture exact user source (create/amend/waiver)
  --source-stdin                Capture stdin exactly (create/amend/waiver)
  --delivery-token <hash>       Prepared briefing token (confirm)
  --json                        Print structured JSON; never implies visible delivery

Flags (hooks summary):
  --project-root <path>         Target directory (default: cwd)
  --source <path>               Hook JSONL path (default:
                                  .anamnesis/logs/hooks.jsonl)
  --json                        Print structured JSON
  --append                      Append markdown to docs/HOOKS.md and record
                                  runtime evidence
  --output <path>               Override hook summary log path

Flags (hooks codex trust):
  --project-root <path>         Target directory (default: cwd)
  --dry-run                     List exact runtime keys/hashes without writing
  --apply                       Explicitly approve reviewed untrusted/modified
                                  Anamnesis hooks through Codex app-server
  --json                        Print structured JSON

Flags (dogfood check):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --append                      Append markdown result to docs/DOGFOOD.md
  --output <path>               Override self-check log path

Flags (context index):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON
  --write                       Write .anamnesis/context/index.jsonl
  --output <path>               Override index output path

Flags (context docs):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON
  --catalog <path>              Override optional document catalog path
                                  (default: .anamnesis/docs/catalog.yaml)

Flags (context query):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON
  --kind <kind>                 Restrict to one context kind
  --limit <n>                   Max matches to print (default: 8)
  --index <path>                Override index JSONL path

Flags (context diagnose):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON

Flags (context resume):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON
  --write                       Write .anamnesis/context/resume.md
  --output <path>               Override resume bundle output path

Flags (context subagent-preamble):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON
  --write                       Write .anamnesis/context/subagent-preamble.md
  --output <path>               Override preamble output path

Flags (handoff draft):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON
  --write                       Write .anamnesis/handoff/drafts/latest.md
  --output <path>               Override draft output path

Flags (handoff close/deprecate):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON
  --archive <path>              Finalized .anamnesis/handoff/*.md archive
  --apply                       Write archive frontmatter and active.md changes
  --summary <text>              Override active.md completed-entry summary
  --reason <text>               Store lifecycle_note in archive frontmatter
  --superseded-by <path>        Replacement archive for handoff deprecate

Flags (gc):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON
  --dry-run                     Preview only; no files are deleted (default)
  --apply                       Delete clean managed task-harness candidates;
                                handoffs and user-authored files stay review-only
  --max-current-age-days <n>    Current harness stale threshold (default: 14)
  --max-current-harnesses <n>   Current harness count budget (default: 5)
  --max-reusable-harnesses <n>  Reusable harness count budget (default: 50)
  --max-total-bytes <n>         Task harness disk budget (default: 262144)
  --max-warm-handoff-archives <n>
                                Warm handoff archive count budget
                                (project default: 5; 0 disables fallback)
  --max-cold-handoff-age-days <n>
                                Cold handoff age threshold (project default: 90)
  --max-handoff-bytes <n>       Handoff archive disk budget
                                (project default: 524288)

Flags (benchmark report):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --json                        Print structured JSON
  --append                      Append markdown result to docs/BENCHMARKS.md
  --output <path>               Override benchmark log path

Flags (benchmark compare):
  --project-root <path>         Target directory (default: cwd)
  --baseline <path>             Baseline benchmark report JSON file
  --after <path>                After benchmark report JSON file
  --json                        Print structured JSON
  --append                      Append markdown result to docs/BENCHMARKS.md
  --output <path>               Override benchmark log path

Flags (benchmark gallery):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON
  --write                       Write docs/BENCHMARK-GALLERY.md
  --validate                    Fail when generated gallery differs on disk
  --source <path[,path]>        Extra evidence JSONL source(s)
  --output <path>               Override gallery path

Flags (benchmark trace):
  --project-root <path>         Target directory (default: cwd)
  --source <path>               Trace JSONL path (default:
                                  .anamnesis/logs/benchmark-traces.jsonl)
  --json                        Print structured JSON
  --append                      Append markdown to docs/BENCHMARK-TRACES.md
                                  and record runtime evidence
  --output <path>               Override trace rollup markdown path

Flags (benchmark upgrade):
  --project-root <path>         Target directory (default: cwd)
  --runs <n>                    Runs per sanitized fixture (default: 3)
  --json                        Print structured JSON
  --write                       Write JSON, markdown, and SVG charts under
                                  docs/benchmark-evidence/upgrade
  --append                      Record runtime evidence
  --output <path>               Override artifact output directory

Flags (benchmark work-continuity):
  --project-root <path>         Target directory (default: cwd)
  --runs <n>                    Repetitions (default: 5)
  --requirements <n>            Requirements in the scenario (default: 20)
  --compact-window <n>          Facts retained without Work (default: all;
                                  smaller values are retention stress only)
  --json                        Print structured JSON
  --write                       Write JSON and markdown evidence under
                                  docs/benchmark-evidence/work-continuity
  --append                      Record runtime evidence
  --output <path>               Override artifact output directory

Flags (benchmark work-agent-ab):
  --project-root <path>         Target directory (default: cwd)
  --runs <n>                    Repetitions per scenario (minimum/default: 3)
  --model <id>                  Codex model (default: gpt-5.6-luna)
  --scenarios <ids>             Diagnostic subset (comma-separated; incompatible
                                  with --strict)
  --strict                      Require >=9 pairs, per-scenario correction
                                  noninferiority, and <=0.1% practical median token
                                  noninferiority for multi-session and delegation/review
  --json                        Print structured JSON
  --write                       Write aggregate-only JSON and markdown under
                                  docs/benchmark-evidence/work-agent-ab
  --output <path>               Override artifact output directory

Flags (benchmark work-parallel-agent-ab):
  --project-root <path>         Target directory (default: cwd)
  --protocol <name>             validate (free, default), shadow (3 pairs), or
                                  final (9 held-out pairs; claim eligible)
  --runs <n>                    Deprecated v2 single-scenario diagnostic mode
  --model <id>                  Codex model (default: gpt-5.6-luna)
  --json                        Print structured JSON
  --write                       Write aggregate-only JSON and markdown under
                                  docs/benchmark-evidence/work-parallel-agent-ab
  --output <path>               Override artifact output directory

Flags (benchmark task):
  --project-root <path>         Target directory (default: cwd)
  --input <path>                Agent task benchmark JSON input
  --template                    Print a JSON input template
  --json                        Print structured JSON
  --append                      Append markdown to docs/AGENT-TASK-BENCHMARKS.md
  --output <path>               Override agent task benchmark log path

Flags (benchmark task-compare):
  --project-root <path>         Target directory (default: cwd)
  --full <path>                 Full SessionStart mode task benchmark JSON
  --compact <path>              Compact SessionStart mode task benchmark JSON
  --template                    Print a paired full/compact input template
  --json                        Print structured JSON
  --append                      Append markdown to docs/AGENT-TASK-BENCHMARKS.md
  --output <path>               Override agent task compare log path

Flags (benchmark task-series):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON
  --write                       Write JSON, markdown, and SVG charts under
                                  docs/benchmark-evidence/agent-task
  --source <path[,path]>        Extra runtime evidence JSONL source(s)
  --output <path>               Override artifact output directory

Flags (benchmark prompt-gate):
  --project-root <path>         Target directory (default: cwd)
  --library <path>              Library path (default: bundled)
  --json                        Print structured JSON
  --append                      Append markdown to docs/BENCHMARKS.md
  --output <path>               Override prompt gate log path
  --source <path[,path]>        Extra evidence JSONL source(s)
  --max-tokens <n>              Max estimated prompt delta token budget
                                  (default: 800)

Flags (benchmark retrieval):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON
  --write                       Write JSON, markdown, and dependency-free SVG
                                  charts under docs/benchmark-evidence
  --append                      Record runtime evidence
  --output <path>               Override artifact output directory

Flags (benchmark session-context):
  --project-root <path>         Target directory (default: cwd)
  --json                        Print structured JSON
  --write                       Write JSON, markdown, and dependency-free SVG
                                  charts under docs/benchmark-evidence
  --output <path>               Override artifact output directory

Flags (benchmark subagent-injection):
  --project-root <path>         Target directory (default: cwd)
  --attempts <n>                Attempts per lane (default: 20)
  --json                        Print structured JSON
  --write                       Write JSON, markdown, and dependency-free SVG
                                  charts under docs/benchmark-evidence
  --append                      Record runtime evidence
  --output <path>               Override artifact output directory

Flags (migrate agentfile):
  --project-root <path>         Target directory (default: cwd)
  --apply                       Actually write after backup (default is dry-run)
  --json                        Print structured JSON
  --to <version>                Optional explicit target Agentfile schema

Flags (ontology bootstrap):
  --project-root <path>         Target directory (default: cwd)
  --scope <path>                Run only this Agentfile scope
                                  (default: all effective scopes)
  --fragment <id>               Run only this fragment's introspector
                                  (default: all installed fragments)
  --dry-run                     Print plan without writing

Flags (promote):
  --as <fragment-id>            Target fragment id (required)
  --type <capability>           Capability type (auto-detected from path if omitted)
                                  one of: project_memory | executable_hook |
                                          slash_command | skill | ontology |
                                          task_harness
  --name <name>                 Override skill / slash_command / task_harness name
  --region <id>                 For project_memory: region id to extract from
                                  source AGENTS.md (defaults to fragment id)
  --description <text>          Set/override fragment description
  --project-root <path>         Source directory (default: cwd)
  --library <path>              Library path (default: bundled)

Global:
  --help, -h                    Show this help
  --version, -v                 Show version

Docs: https://github.com/MCprotein/anamnesis`,
  );
}

function printGettingStartedGuide(): void {
  console.log(formatGettingStartedGuide(VERSION));
}

function printLines(lines: string[]): void {
  for (const line of lines) console.log(line);
}

function countTone(count: number): TuiTone {
  return count > 0 ? "warning" : "success";
}

function verdictTone(ok: boolean): TuiTone {
  return ok ? "success" : "warning";
}

function changeSummaryLine(s: {
  create: number;
  update: number;
  noop: number;
  blocked: number;
  userModified: number;
}): string {
  return `create=${s.create} update=${s.update} noop=${s.noop} blocked=${s.blocked} user-modified=${s.userModified}`;
}

function reportWorkspaceProfile(projectRoot: string): void {
  const ui = createTui();
  const profile = detectWorkspaceProfile(projectRoot);
  printLines(ui.section("Workspace Profile"));
  for (const line of formatWorkspaceProfileLines(profile)) {
    console.log(line);
  }
}

// ---------------------------------------------------------------------------
// Reporters
// ---------------------------------------------------------------------------

function reportInit(
  result: InitResult,
  projectRoot: string,
  execAdaptersEnabled: boolean,
): void {
  const ui = createTui();
  const s = summarizeChanges(result.changes);
	const fragIds =
		result.selectedFragments.map((f) => f.id).join(", ") || "(none)";
  printLines([
    ...ui.title("anamnesis init", result.agentfile.project.name),
    ...ui.keyValues([
      {
        key: "mode",
        value: result.writtenToDisk ? "applied" : "preview",
        tone: result.writtenToDisk ? "success" : "accent",
      },
      { key: "tools", value: result.agentfile.tools.join(", ") },
      { key: "fragments (root)", value: fragIds },
			{
				key: "changes",
				value: changeSummaryLine(s),
				tone: countTone(s.blocked),
			},
    ]),
  ]);
  if (result.monorepoDetection?.isMonorepo) {
    const det = result.monorepoDetection;
    printLines([
      ...ui.section("Workspace Profile"),
			ui.note(
				`monorepo detected via ${det.declaredVia}: ${det.scopes.length} scope(s)`,
			),
    ]);
    for (const scope of det.scopes) {
			const ids =
				scope.matchedRules.map((r) => r.suggest).join(", ") || "(none)";
      console.log(`    ${scope.path.padEnd(20)} ${ids}`);
    }
    if (det.emptyScopes.length > 0) {
      console.log(
        `  empty workspace dirs (no rule match): ${det.emptyScopes.join(", ")}`,
      );
    }
  }
  if (!result.writtenToDisk) {
    console.log(ui.note("dry-run: no files written"));
    reportWorkspaceProfile(projectRoot);
  }
  if (s.blocked > 0) {
    console.log(
      ui.note(
        "some writes blocked; re-run with --allow-exec-adapters to include hooks/commands/skills",
        "warning",
      ),
    );
  }
  if (result.bootstrapError) {
    console.log(`  ontology bootstrap: failed — ${result.bootstrapError}`);
  } else if (result.bootstrapResult) {
    const wrote = result.bootstrapResult.entries.filter(
      (e) => e.outcome === "written",
    ).length;
    const skipped = result.bootstrapResult.entries.filter((e) =>
      e.outcome.startsWith("skipped"),
    ).length;
    console.log(
      `  ontology bootstrap: ${wrote} fragment(s) populated, ${skipped} skipped`,
    );
  }
  if (result.contextBootstrap) {
    const ctx = result.contextBootstrap;
    if (ctx.outcome === "written" || ctx.outcome === "planned") {
      console.log(
        `  context bootstrap: ${ctx.outcome} ${ctx.path} (${ctx.signals.length} signal(s))`,
      );
    } else {
      console.log(`  context bootstrap: ${ctx.outcome}`);
    }
  }
  if (result.projectDocs) {
    const planned = result.projectDocs.targets.filter(
      (target) => target.outcome !== "skipped-existing",
    ).length;
    const skipped = result.projectDocs.targets.length - planned;
    console.log(
      `  project docs: ${result.projectDocs.mode} ${planned} planned, ${skipped} skipped`,
    );
    for (const target of result.projectDocs.targets) {
      console.log(`    ${target.outcome.padEnd(16)} ${target.path}`);
    }
  }
  for (const conflict of result.surfaceConflicts) {
    const label =
      conflict.outcome === "planned-preserve"
        ? "planned surface preserve"
        : "preserved surface";
		console.log(`  ${label}: ${conflict.path} -> ${conflict.preservedAs}`);
  }
  if (result.writtenToDisk && result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
	if (result.registration) {
		console.log(
			`  project registry: registered ${result.registration.canonical_root}`,
		);
	} else if (result.registrationError) {
		console.log(
			ui.note(
				`project registry: registration failed — ${result.registrationError}`,
				"warning",
			),
		);
	}
  console.log("  generation boundary:");
  console.log(
    "    cli-generated: AGENTS.md managed context, optional docs regions, static ontology slices, and any .bootstrap.yaml facts above",
  );
  console.log(
    "    agent-required: run /ontology-enrich for semantic ontology; run /handoff-prepare before switching agents with in-progress work",
  );
  for (const line of formatInitNextStepLines({
    writtenToDisk: result.writtenToDisk,
    blockedWrites: s.blocked,
    tools: result.agentfile.tools,
    execAdaptersEnabled,
  })) {
    console.log(line);
  }
}

function reportStatus(result: StatusResult, projectRoot: string): void {
  const ui = createTui();
  const { agentfile, scopes, suggested, declined, summary } = result;
  const clean = result.entries.every((e) => e.drift === "clean");
  const ok =
    clean &&
    result.continuity.ready &&
    !result.sessionContextBudget.capExceeded &&
    result.contextDiagnostics.ok &&
    result.executableSecurity.ok &&
    result.agentConfigDamage.ok &&
    result.dependencies.ready;
  printLines([
    ...ui.title("anamnesis status", agentfile.project.name),
    ...ui.keyValues([
			{
				key: "verdict",
				value: ok ? "ready" : "attention needed",
				tone: verdictTone(ok),
			},
      { key: "tools", value: agentfile.tools.join(", ") },
      {
        key: "managed entries",
        value: `${summary.entriesClean} clean / ${result.entries.length} total`,
        tone: clean ? "success" : "warning",
      },
    ]),
  ]);

  const isMonorepo = scopes.length > 1;

  if (isMonorepo) {
    printLines(ui.section(`Scopes (${scopes.length})`));
    for (const scope of scopes) {
      const driftCount = scope.entries.filter(
        (e) => e.drift !== "clean",
      ).length;
      const cleanCount = scope.entries.length - driftCount;
      const driftSummary =
        driftCount === 0
          ? `${cleanCount} clean`
          : `${driftCount} drift / ${cleanCount} clean`;
      console.log(
        `    [${scope.path}]  ${scope.fragments.length} fragment(s), ${driftSummary}`,
      );
      for (const f of scope.fragments) {
        console.log(`      ${formatFragmentLine(f)}`);
      }
      const drifted = scope.entries.filter((e) => e.drift !== "clean");
      for (const e of drifted) {
        const tgt =
					e.target === "region" ? `${e.file} [region:${e.regionId}]` : e.path;
        console.log(`      ${e.drift.padEnd(15)} ${tgt}`);
      }
    }
  } else {
    // Single-scope: flat list (back-compat with v0.2 format).
    printLines(ui.section(`Fragments (${summary.fragmentTotal})`));
    for (const f of result.fragments) {
      console.log(`    ${formatFragmentLine(f)}`);
    }
    const drifted = result.entries.filter((e) => e.drift !== "clean");
    if (drifted.length === 0) {
      console.log(`  drift: none (${summary.entriesClean} entries clean)`);
    } else {
      console.log(`  drift:`);
      for (const e of drifted) {
        const tgt =
					e.target === "region" ? `${e.file} [region:${e.regionId}]` : e.path;
        console.log(`    ${e.drift.padEnd(15)} ${tgt}`);
      }
    }
  }

  if (suggested.length > 0) {
    printLines(ui.section("Suggested"));
    for (const s of suggested) {
      console.log(`    ${s.suggest.padEnd(20)} ${s.reason}`);
    }
  }

  if (declined.length > 0) {
    printLines(ui.section("Declined"));
    for (const d of declined) {
      const when = d.declinedAt ? ` (${d.declinedAt})` : "";
      const why = d.reason ? `: ${d.reason}` : "";
      const state = d.matched ? "active" : "stale";
      console.log(`    ${d.id}${when} [${state}]${why}`);
    }
  }

  if (result.partialAdoptions.length > 0) {
		printLines(
			ui.section(`Partial Upgrades (${result.partialAdoptions.length})`),
		);
    for (const partial of result.partialAdoptions) {
      const reasons = partial.reasons.join(", ");
      console.log(
        `    ${partial.fragmentId}@${partial.installedVersion} -> ${partial.libraryVersion} held by ${reasons}`,
      );
      for (const target of partial.targets.slice(0, 3)) {
        console.log(`      ${target}`);
      }
      if (partial.targets.length > 3) {
        console.log(`      ... ${partial.targets.length - 3} more target(s)`);
      }
    }
  }

  if (!result.dependencies.ready) {
		console.log(
			`  dependencies: issues (${result.dependencies.summary.total})`,
		);
    for (const problem of result.dependencies.problems.slice(0, 5)) {
      if (problem.kind === "cycle") {
        console.log(
          `    cycle ${problem.scopePath}: ${problem.cycle?.join(" -> ")}`,
        );
      } else {
        const min = problem.requiredMinVersion
          ? `>=${problem.requiredMinVersion}`
          : "";
        console.log(
          `    ${problem.kind} ${problem.scopePath}: ${problem.fragmentId} -> ${problem.dependencyId}${min}`,
        );
      }
    }
  }

  const continuity = result.continuity;
  console.log(
    `  continuity: ${continuity.ready ? "ready" : "issues"} (${continuity.passed}/${continuity.total})`,
  );
  for (const check of continuity.checks.filter((c) => c.status === "fail")) {
    console.log(`    fail ${check.label}: ${check.detail}`);
  }
  const sessionBudget = result.sessionContextBudget;
  console.log(
    `  session context budget: ${sessionBudget.capExceeded ? "over budget" : "ok"} ` +
      `(${sessionBudget.estimatedTokens}/${sessionBudget.maxTokens} tokens, ` +
      `${sessionBudget.sourcePointers} pointer(s), ${sessionBudget.sourceBytes} source bytes)`,
  );
  if (sessionBudget.requiredRulesTotal > 0) {
    console.log(
      `    required rules: ${sessionBudget.requiredRulesPresent}/${sessionBudget.requiredRulesTotal}, ` +
        `digest lines: ${sessionBudget.invariantDigestLines}, active task lines: ${sessionBudget.activeTaskLines}`,
    );
  }
  for (const warning of sessionBudget.warnings) {
    console.log(`    warning ${warning}`);
  }
  const codexHooks = result.codexHooks;
  if (
    agentfile.tools.includes("codex") ||
    codexHooks.summary.total > 0 ||
    codexHooks.parseError
  ) {
    if (codexHooks.readable) {
      const s = codexHooks.summary;
      console.log(
        `  codex hooks: ${s.total} total (anamnesis ${s.anamnesis}, omx ${s.omx}, plugin ${s.plugin}, user ${s.user}, invalid ${s.invalid}; warnings ${s.warnings})`,
      );
      for (const warning of codexHooks.warnings.slice(0, 3)) {
        console.log(`    warning ${warning.kind}: ${warning.detail}`);
      }
      if (codexHooks.warnings.length > 3) {
        console.log(
          `    ... ${codexHooks.warnings.length - 3} more hook warning(s)`,
        );
      }
    } else {
      console.log(`  codex hooks: unavailable (${codexHooks.parseError})`);
    }
  }
  if (result.codexHookTrust) {
    reportCodexHookTrustInspection(result.codexHookTrust);
    if (
      result.codexHookTrust.summary.untrusted > 0 ||
      result.codexHookTrust.summary.modified > 0
    ) {
      console.log(
        "    warning: hooks are installed but untrusted/modified definitions may not execute",
      );
    }
  }
  const ontology = result.ontology;
  console.log(
    `  ontology gaps: ${ontology.summary.warnings} warning(s), ${ontology.summary.info} info`,
  );
  printOntologyRecommendation(ui, result.ontologyRecommendation, {
    label: "ontology next",
    includeOk: true,
  });
  for (const gap of ontology.gaps.filter((g) => g.severity === "warning")) {
    const scope = gap.scopePath === "." ? "" : ` [${gap.scopePath}]`;
    const target = gap.target ? ` ${gap.target}` : "";
    console.log(
      `    ${gap.severity.padEnd(7)} ${gap.fragmentId}:${gap.kind}${scope}${target}`,
    );
    console.log(`      ${gap.detail}`);
    console.log(`      next: ${gap.next}`);
  }
  const evidence = result.evidence;
  if (evidence.latest) {
    const freshness =
      evidence.latest_age_ms !== undefined
        ? ` (${formatAge(evidence.latest_age_ms)} old${evidence.latest_stale ? "; stale" : ""})`
        : "";
    console.log(
      `  evidence: ${evidence.total} record(s), latest ${evidence.latest.kind} at ${evidence.latest.generated_at}${freshness}`,
    );
    for (const kind of evidence.byKind) {
      console.log(
        `    ${kind.kind}: ${kind.total} record(s), latest ${kind.latest.generated_at} (${formatAge(kind.latest_age_ms)} old${kind.stale ? "; stale" : ""})`,
      );
    }
    if (evidence.invalid > 0) {
      console.log(`    invalid evidence line(s): ${evidence.invalid}`);
    }
  } else {
    const suffix =
      evidence.invalid > 0 ? ` (${evidence.invalid} invalid line(s))` : "";
    console.log(`  evidence: none${suffix}`);
  }
  const documents = result.documents;
  console.log(
    `  documents: ${documents.summary.pages} page(s), ${documents.summary.headings} heading(s), ` +
      `${documents.summary.brokenLinks} broken link(s), ` +
      `${documents.summary.missingOntologyRefs} missing ontology ref(s)` +
			(documents.catalogPath
				? ` [${documents.catalogPath}]`
				: " [default roots]"),
  );
  const contextDiagnostics = result.contextDiagnostics;
  const contextInfo =
    contextDiagnostics.summary.info > 0
      ? `, ${contextDiagnostics.summary.info} info`
      : "";
  console.log(
    `  context diagnostics: ${contextDiagnostics.ok ? "ok" : "issues"} (${contextDiagnostics.summary.warnings} warning(s)${contextInfo})`,
  );
  const executableSecurity = result.executableSecurity;
  const executableInfo =
    executableSecurity.summary.info > 0
      ? `, ${executableSecurity.summary.info} info`
      : "";
  console.log(
    `  executable security: ${executableSecurity.ok ? "ok" : "issues"} (${executableSecurity.summary.warnings} warning(s)${executableInfo})`,
  );
  for (const issue of executableSecurity.issues.slice(0, 3)) {
    console.log(`    ${issue.severity} ${issue.code}: ${issue.target}`);
    console.log(`      ${issue.message}`);
  }
  if (executableSecurity.issues.length > 3) {
    console.log(
      `    ... ${executableSecurity.issues.length - 3} more executable security issue(s)`,
    );
  }
  const agentConfigDamage = result.agentConfigDamage;
  const damageInfo =
    agentConfigDamage.summary.info > 0
      ? `, ${agentConfigDamage.summary.info} info`
      : "";
  console.log(
    `  agent config damage: ${agentConfigDamage.ok ? "ok" : "issues"} (${agentConfigDamage.summary.warnings} warning(s)${damageInfo})`,
  );
  for (const issue of agentConfigDamage.issues.slice(0, 3)) {
    console.log(`    ${issue.severity} ${issue.code}: ${issue.target}`);
    console.log(`      ${issue.message}`);
  }
  if (agentConfigDamage.issues.length > 3) {
    console.log(
      `    ... ${agentConfigDamage.issues.length - 3} more agent config damage issue(s)`,
    );
  }
  for (const line of formatGenerationBoundaryLines(
    collectGenerationBoundaryStatus(projectRoot),
  )) {
    console.log(line);
  }
}

function printOntologyRecommendation(
  ui: ReturnType<typeof createTui>,
  recommendation: OntologyLifecycleRecommendation | undefined,
  opts: { label: string; includeOk?: boolean },
): void {
  if (!recommendation) return;
  if (recommendation.action === "none") {
    if (opts.includeOk === true) {
      console.log(`  ${opts.label}: ok - ${recommendation.reason}`);
    }
    return;
  }

  const command = recommendation.command
    ? `${ui.command(recommendation.command)} - `
    : "";
  console.log(`  ${opts.label}: ${command}${recommendation.reason}`);
  for (const target of recommendation.targets.slice(0, 3)) {
    console.log(`    ${target}`);
  }
  if (recommendation.targets.length > 3) {
    console.log(
      `    ... ${recommendation.targets.length - 3} more ontology target(s)`,
    );
  }
}

function reportDoctor(result: DoctorResult): void {
  const ui = createTui();
  const verdict = result.ok ? "ok" : "issues found";
  printLines([
    ...ui.title("anamnesis doctor", path.basename(result.projectRoot)),
    ...ui.keyValues([
      { key: "verdict", value: verdict, tone: verdictTone(result.ok) },
      {
        key: "issues",
        value: `${result.summary.errors} error(s), ${result.summary.warnings} warning(s), ${result.summary.info} info`,
				tone:
					result.summary.errors > 0 || result.summary.warnings > 0
						? "warning"
						: "success",
      },
    ]),
  ]);
  printOntologyRecommendation(ui, result.ontologyRecommendation, {
    label: "ontology next",
  });
  if (result.codexHookTrust) {
    reportCodexHookTrustInspection(result.codexHookTrust);
  }
  if (result.issues.length === 0) {
    console.log(ui.note("installation integrity checks passed", "success"));
    for (const line of formatGenerationBoundaryLines(
      collectGenerationBoundaryStatus(result.projectRoot),
    )) {
      console.log(line);
    }
    reportAppendEvidence(result.appendedPath, result.evidencePath);
    return;
  }
  printLines(ui.section("Issues"));
  for (const issue of result.issues) {
    const scope = issue.scopePath ? ` [${issue.scopePath}]` : "";
    const target = issue.target ? ` ${issue.target}` : "";
		console.log(`  ${issue.severity.padEnd(7)} ${issue.code}${scope}${target}`);
    console.log(`    ${issue.message}`);
    if (issue.repair) {
      console.log(`    repair: ${issue.repair}`);
    }
  }
  for (const line of formatGenerationBoundaryLines(
    collectGenerationBoundaryStatus(result.projectRoot),
  )) {
    console.log(line);
  }
  reportAppendEvidence(result.appendedPath, result.evidencePath);
}

function reportReleaseCheck(result: ReleaseCheckResult): void {
  console.log(
    `anamnesis release check — ${result.projectName} (${result.ok ? "ok" : "blocked"})`,
  );
  console.log(`  generated: ${result.generatedAt}`);
  console.log(
    `  checks: pass=${result.summary.pass} warn=${result.summary.warn} fail=${result.summary.fail} skip=${result.summary.skip}`,
  );
  console.log(
    `  status: fragments updates=${result.statusSummary.fragmentUpdatesAvailable}, partial=${result.statusSummary.partialAdoptions}; drift modified=${result.statusSummary.entriesUserModified}, missing=${result.statusSummary.entriesMissing}`,
  );
  console.log(
    `  apply preview: create=${result.updateSummary.create} update=${result.updateSummary.update} blocked=${result.updateSummary.blocked} user-modified=${result.updateSummary.userModified}`,
  );
  console.log(
    `  doctor: errors=${result.doctorSummary.errors} warnings=${result.doctorSummary.warnings} info=${result.doctorSummary.info}`,
  );
  for (const check of result.checks) {
    console.log(`  ${check.status.padEnd(4)} ${check.label}: ${check.detail}`);
    if (check.next) {
      console.log(`       next: ${check.next}`);
    }
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

function formatAge(ms: number): string {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ms < minute) return `${Math.floor(ms / 1000)}s`;
  if (ms < hour) return `${Math.floor(ms / minute)}m`;
  if (ms < day) return `${Math.floor(ms / hour)}h`;
  return `${Math.floor(ms / day)}d`;
}

function reportAppendEvidence(
  appendedPath: string | undefined,
  evidencePath: string | undefined,
): void {
  if (appendedPath) {
    console.log(`  appended: ${appendedPath}`);
  }
  if (evidencePath) {
    console.log(`  evidence: ${evidencePath}`);
  }
}

function reportHookSummary(result: HookSummaryResult): void {
  console.log(`anamnesis hooks summary — ${result.projectName}`);
  console.log(`  source: ${result.sourcePath}`);
  console.log(`  records: ${result.total} valid, ${result.invalid} invalid`);
  if (result.latest) {
    console.log(
      `  latest: ${result.latest.event} ${result.latest.status} at ${result.latest.generated_at}`,
    );
  } else {
    console.log("  latest: none");
  }
  if (result.byStatus.length > 0) {
    console.log(
      `  status: ${result.byStatus.map((s) => `${s.status}=${s.total}`).join(", ")}`,
    );
  }
  for (const event of result.byEvent) {
    const statuses = Object.entries(event.byStatus)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `${status}=${count}`)
      .join(", ");
    console.log(`    ${event.event}: ${event.total} (${statuses})`);
  }
  reportAppendEvidence(result.appendedPath, result.evidencePath);
}

function reportCodexHookTrustInspection(
  inspection: CodexHookTrustInspection,
): void {
  const s = inspection.summary;
  console.log(
    `  Codex hooks: ${s.registered} registered, ${s.trusted} trusted, ${s.untrusted} untrusted, ${s.modified} modified, ${s.managed} managed, ${s.unknown} unknown`,
  );
  for (const hook of inspection.hooks) {
    const marker = hook.status === "modified" ? "MODIFIED" : hook.status;
    console.log(`    ${marker.padEnd(9)} ${hook.event} ${hook.command}`);
    if (hook.key) console.log(`      key: ${hook.key}`);
    if (hook.currentHash) console.log(`      current hash: ${hook.currentHash}`);
  }
  for (const alternate of inspection.alternateProjectSources) {
    console.log(`    runtime source instead: ${alternate.sourcePath}`);
  }
  for (const warning of inspection.warnings) {
    console.log(`    warning: ${warning}`);
  }
  if (!inspection.available && inspection.error) {
    console.log(`    unavailable: ${inspection.error}`);
  }
}

function reportCodexHookTrust(result: TrustCodexHooksResult): void {
  console.log(`anamnesis hooks codex trust — ${result.mode}`);
  reportCodexHookTrustInspection(result.inspection);
  console.log(`  approval candidates: ${result.targets.length}`);
  if (result.mode === "dry-run" && result.targets.length > 0) {
    console.log(
      "  preview only; review every definition, then re-run with --apply to approve",
    );
  } else if (result.mode === "apply") {
    console.log(`  approved: ${result.written.length}`);
  }
}

function formatFragmentLine(f: {
	id: string;
	installedVersion: number;
	libraryVersion: number | null;
	pinned: boolean;
	status: string;
}): string {
  let tag: string;
  switch (f.status) {
    case "in-sync":
      tag = "in-sync";
      break;
    case "update-available":
      tag = `update available → ${f.libraryVersion}`;
      break;
    case "pinned":
      tag = `pinned (lib has ${f.libraryVersion})`;
      break;
    case "library-missing":
      tag = "library-missing";
      break;
    default:
      tag = f.status;
  }
  return `${f.id}@${f.installedVersion}  [${tag}]`;
}

function reportPromote(result: PromoteResult): void {
  console.log(
    `anamnesis promote — ${result.isNewFragment ? "created" : "extended"} fragment '${result.fragmentId}'`,
  );
  console.log(`  capability: ${result.capability.type}`);
  console.log(`  files written:`);
  for (const f of result.filesWritten) {
    console.log(`    + ${f}`);
  }
  console.log(`  fragment dir: ${result.fragmentDir}`);
  console.log(
    `\nNext: review the fragment, optionally add a rule to rulebook.md, commit.`,
  );
}

function reportBootstrap(result: BootstrapResult): void {
  console.log(`anamnesis ontology bootstrap`);
  for (const e of result.entries) {
    let suffix = "";
    if (e.outcome === "written" || e.outcome === "unchanged") {
      suffix = ` → ${e.path}`;
    }
    const scope =
			e.scopePath === "." || e.scopePath === "" ? "" : ` [${e.scopePath}]`;
    console.log(`  ${e.fragmentId.padEnd(20)} ${e.outcome}${scope}${suffix}`);
  }
  if (!result.writtenToDisk) {
    console.log("  (dry-run or nothing changed — no files written)");
  }
  for (const line of formatBootstrapGenerationBoundaryLines(result)) {
    console.log(line);
  }
  const enrichmentTargets = bootstrapEnrichmentTargets(result);
  if (enrichmentTargets.length > 0) {
    console.log("  semantic follow-up:");
    console.log(
      "    Layer A facts are only the baseline. Ask the active agent to run /ontology-enrich next.",
    );
    for (const target of enrichmentTargets) {
      console.log(`    /ontology-enrich -> ${target}`);
    }
  }
}

function bootstrapEnrichmentTargets(result: BootstrapResult): string[] {
  const targets = new Set<string>();
  for (const entry of result.entries) {
    if (
      entry.path &&
      (entry.outcome === "written" || entry.outcome === "unchanged")
    ) {
      targets.add(entry.path.replace(/\.bootstrap\.yaml$/, ".enriched.yaml"));
    }
  }
  return Array.from(targets).sort();
}

function reportDogfood(result: DogfoodResult): void {
  console.log(
    `anamnesis dogfood check — ${result.status.agentfile.project.name}`,
  );
  const previous =
		result.score.previous === null
			? "no previous score"
			: `${result.score.previous}/5`;
  console.log(
    `  continuity readiness: ${result.score.passed}/${result.score.total} (${result.score.trend}; ${previous})`,
  );
  console.log(`  tools: ${result.status.agentfile.tools.join(", ")}`);
  console.log(
    `  status: ${result.status.summary.entriesClean} clean, ${result.status.summary.entriesUserModified} modified, ${result.status.summary.entriesMissing} missing`,
  );
  console.log(
    `  doctor: ${result.doctor.ok ? "ok" : "issues"} (${result.doctor.summary.errors} errors, ${result.doctor.summary.warnings} warnings)`,
  );
  for (const criterion of result.criteria) {
    console.log(`  ${criterion.status.padEnd(4)} ${criterion.label}`);
  }
  for (const check of result.checks) {
    console.log(
      `  ${check.outcome.padEnd(7)} ${check.command.join(" ")} (${check.durationMs}ms)`,
    );
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

function reportContextIndex(result: ContextIndexResult): void {
  console.log("anamnesis context index");
  console.log(`  sources: ${result.summary.sources}`);
  console.log(`  entries: ${result.summary.entries}`);
  const byKind = Object.entries(result.summary.byKind)
    .filter(([, total]) => total > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (byKind.length > 0) {
    console.log(
      `  kinds: ${byKind.map(([kind, total]) => `${kind}=${total}`).join(", ")}`,
    );
  }
  if (result.warnings.length > 0) {
    console.log(`  warnings: ${result.warnings.length}`);
    for (const warning of result.warnings.slice(0, 5)) {
      console.log(`    - ${warning}`);
    }
  }
  if (result.writtenPath) {
    console.log(`  written: ${result.writtenPath}`);
  } else {
    console.log("  (dry-run - re-run with --write to write the index)");
  }
}

function reportContextDocs(result: ContextDocsResult): void {
  console.log("anamnesis context docs");
	console.log(
		`  pages: ${result.summary.pages} (${result.summary.canonicalPages} canonical)`,
	);
  console.log(`  headings: ${result.summary.headings}`);
  console.log(
    `  links: ${result.summary.links} ` +
      `(internal=${result.summary.internalLinks}, external=${result.summary.externalLinks}, broken=${result.summary.brokenLinks})`,
  );
  console.log(
    `  backlinks: ${result.summary.backlinks}, ontology refs: ${result.summary.ontologyRefs} ` +
      `(missing=${result.summary.missingOntologyRefs})`,
  );
  if (result.catalog.path) {
    console.log(`  catalog: ${result.catalog.path}`);
  } else {
    console.log("  catalog: default roots");
  }
  const canonical = result.pages.filter((page) => page.canonical);
  if (canonical.length > 0) {
    console.log("  canonical docs:");
    for (const page of canonical.slice(0, 8)) {
			console.log(
				`    - ${page.source_path} (${page.heading_count} heading(s))`,
			);
    }
  }
  const broken = result.links.filter(
    (link) => link.status === "missing" || link.status === "missing-anchor",
  );
  if (broken.length > 0) {
    console.log("  broken links:");
    for (const link of broken.slice(0, 8)) {
      console.log(
        `    - ${link.source_path}:${link.line} -> ${link.target} (${link.status})`,
      );
    }
  }
	const missingOntologyRefs = result.ontology_refs.filter(
		(ref) => ref.status === "missing",
	);
  if (missingOntologyRefs.length > 0) {
    console.log("  missing ontology refs:");
    for (const ref of missingOntologyRefs.slice(0, 8)) {
      console.log(`    - ${ref.source_path}:${ref.line} -> ${ref.target}`);
    }
  }
  if (result.warnings.length > 0) {
    console.log(`  warnings: ${result.warnings.length}`);
    for (const warning of result.warnings.slice(0, 5)) {
      console.log(`    - ${warning}`);
    }
  }
}

function reportContextQuery(result: ContextQueryResult): void {
  console.log(`anamnesis context query - ${result.query}`);
  if (result.kind) {
    console.log(`  kind: ${result.kind}`);
  }
  console.log(
    `  searched: ${result.summary.entriesSearched}, matches: ${result.summary.matches}`,
  );
  console.log(`  index: ${result.summary.indexStatus}`);
  if (
    result.summary.changedSources > 0 ||
    result.summary.missingSources > 0 ||
    result.summary.newSources > 0 ||
    result.summary.missingGeneratedKinds > 0
  ) {
    console.log(
      `  freshness: changed=${result.summary.changedSources}, missing=${result.summary.missingSources}, ` +
        `new=${result.summary.newSources}, missing-kinds=${result.summary.missingGeneratedKinds}`,
    );
  }
  if (result.warnings.length > 0) {
    console.log(`  warnings: ${result.warnings.length}`);
    for (const warning of result.warnings.slice(0, 5)) {
      console.log(`    - ${warning}`);
    }
  }
  for (const match of result.matches) {
    const entry = match.entry;
    console.log(
      `  [${match.score}] ${entry.kind} ${entry.source_path} ${entry.stable_ref}`,
    );
    console.log(`      ${entry.title}`);
    if (entry.snippet) {
      console.log(`      ${entry.snippet}`);
    }
  }
}

function reportContextDiagnostics(result: ContextDiagnosticsResult): void {
  console.log(`anamnesis context diagnose - ${result.ok ? "ok" : "issues"}`);
  console.log(
    `  issues: ${result.summary.warnings} warning(s), ${result.summary.info} info`,
  );
  for (const issue of result.issues) {
    console.log(
      `  ${issue.severity.padEnd(7)} ${issue.code} ${issue.source_path} ${issue.stable_ref}`,
    );
    console.log(`      ${issue.message}`);
    if (issue.repair) {
      console.log(`      repair: ${issue.repair}`);
    }
  }
}

function reportContextResume(result: ContextResumeResult): void {
  console.log(result.bundle);
  console.log("");
  console.log(
    `summary: ${result.summary.lines} lines, ${result.summary.chars} chars, ~${result.summary.estimatedTokens} tokens`,
  );
  if (result.writtenPath) {
    console.log(`written: ${result.writtenPath}`);
  }
}

function reportContextSubagentPreamble(
  result: ContextSubagentPreambleResult,
): void {
  console.log(result.preamble);
  console.log("");
  console.log(
    `summary: ${result.summary.lines} lines, ${result.summary.chars} chars, ` +
      `~${result.summary.estimatedTokens} tokens, ` +
      `${result.summary.startupSourcePointers} startup pointer(s), ` +
      `${result.summary.agentControlSources} control source(s)`,
  );
  if (result.writtenPath) {
    console.log(`written: ${result.writtenPath}`);
  }
}

function reportHandoffDraft(result: HandoffDraftResult): void {
  console.log(result.draft);
  console.log("");
  console.log(
    `summary: ${result.summary.lines} lines, ${result.summary.chars} chars, ~${result.summary.estimatedTokens} tokens`,
  );
  if (result.writtenPath) {
    console.log(`written: ${result.writtenPath}`);
  }
}

function reportHandoffAction(result: HandoffActionResult): void {
  console.log(result.preview);
}

function reportGc(result: GcResult): void {
  console.log(`anamnesis gc — ${result.mode}`);
  console.log(
    `  task harnesses: total=${result.summary.total}, current=${result.summary.current}, reusable=${result.summary.reusable}, unknown=${result.summary.unknown}`,
  );
  console.log(
    `  origin: managed=${result.summary.managed}, user-authored=${result.summary.userAuthored}`,
  );
  console.log(
    `  disk: ${result.summary.totalBytes}/${result.thresholds.maxTotalBytes} bytes${result.summary.diskBudgetExceeded ? " (over budget)" : ""}`,
  );
  console.log(
    `  candidates: ${result.summary.candidates} (delete=${result.summary.deleteCandidates}, review=${result.summary.reviewUserAuthored})`,
  );
  console.log(
    `  handoffs: archives=${result.handoff.summary.archives}, active_refs=${result.handoff.summary.activeReferences}, hot=${result.handoff.summary.hot}, warm=${result.handoff.summary.warm}, cold=${result.handoff.summary.cold}, deprecated=${result.handoff.summary.deprecated}`,
  );
  console.log(
    `  handoff disk: ${result.handoff.summary.totalBytes}/${result.handoff.thresholds.maxTotalBytes} bytes${result.handoff.summary.diskBudgetExceeded ? " (over budget)" : ""}`,
  );
  console.log(
    `  handoff candidates: ${result.handoff.summary.candidates} (review=${result.handoff.summary.reviewUserAuthored}, protected=${result.handoff.summary.protectedByActiveReference})`,
  );
  if (result.warnings.length > 0) {
    console.log(`  warnings: ${result.warnings.length}`);
    for (const warning of result.warnings.slice(0, 5)) {
      console.log(`    - ${warning}`);
    }
  }
  for (const candidate of result.candidates) {
    console.log(
      `  ${candidate.recommendation} ${candidate.path} ${candidate.lifecycle} ${candidate.origin}`,
    );
    console.log(`      reasons: ${candidate.reasons.join(", ")}`);
    console.log(`      age=${candidate.ageDays}d bytes=${candidate.bytes}`);
    if (candidate.supersededBy) {
      console.log(`      superseded_by: ${candidate.supersededBy}`);
    }
  }
  for (const candidate of result.handoff.candidates) {
    console.log(
      `  ${candidate.recommendation} ${candidate.path} ${candidate.tier}`,
    );
    console.log(`      reasons: ${candidate.reasons.join(", ")}`);
    console.log(`      age=${candidate.ageDays}d bytes=${candidate.bytes}`);
    if (candidate.supersededBy) {
      console.log(`      superseded_by: ${candidate.supersededBy}`);
    }
  }
  if (result.applied) {
    console.log(
      `  deleted task harnesses: ${result.deleted.taskHarnesses.length}`,
    );
    if (result.backupDir) {
      console.log(`  backup: ${result.backupDir}`);
    }
    for (const deleted of result.deleted.taskHarnesses.slice(0, 10)) {
      console.log(`    - ${deleted}`);
    }
    console.log(
      `  skipped user-authored task harnesses: ${result.skipped.userAuthoredTaskHarnesses.length}`,
    );
    console.log(
      `  skipped user-modified task harnesses: ${result.skipped.userModifiedTaskHarnesses.length}`,
    );
    console.log(
      `  skipped handoff archives: ${result.skipped.handoffs.length} (review-only)`,
    );
    if (result.evidencePath) {
      console.log(`  evidence: ${result.evidencePath}`);
    }
  } else {
    console.log("  (dry-run — no files deleted)");
  }
}

function reportBenchmark(result: BenchmarkResult): void {
  console.log(
    `anamnesis benchmark report — ${result.status.agentfile.project.name}`,
  );
  console.log(`  tools: ${result.status.agentfile.tools.join(", ")}`);
	console.log(
		`  ready layers: ${result.summary.ready}/${result.summary.total}`,
	);
  console.log(
    `  continuity: ${result.scorecard.continuity.passed}/${result.scorecard.continuity.total}`,
  );
  console.log(
    `  doctor: ${result.doctor.ok ? "ok" : "issues"} (${result.scorecard.diagnostics.doctor_errors} errors, ${result.scorecard.diagnostics.doctor_warnings} warnings)`,
  );
  console.log(
    `  codex hook warnings: ${result.scorecard.diagnostics.codex_hook_warnings}`,
  );
  console.log(
    `  evidence: ${result.scorecard.evidence.records} valid, ${result.scorecard.evidence.invalid_records} invalid`,
  );
  for (const layer of result.layers) {
    console.log(
      `  ${layer.status.padEnd(7)} ${layer.label}: ${layer.score}/${layer.total}`,
    );
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

function reportBenchmarkCompare(result: BenchmarkCompareResult): void {
  console.log(`anamnesis benchmark compare — ${result.after.projectName}`);
  console.log(`  baseline: ${result.baselinePath}`);
  console.log(`  after: ${result.afterPath}`);
  console.log(
    `  summary: ${result.summary.improved} improved, ${result.summary.regressed} regressed, ${result.summary.unchanged} unchanged`,
  );
  for (const delta of result.deltas) {
    const unit = delta.unit ?? "";
    const signed = delta.delta > 0 ? `+${delta.delta}` : String(delta.delta);
    console.log(
      `  ${delta.verdict.padEnd(9)} ${delta.label}: ${delta.before}${unit} -> ${delta.after}${unit} (${signed})`,
    );
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

function reportBenchmarkGallery(result: BenchmarkGalleryResult): void {
  console.log("anamnesis benchmark gallery");
  console.log(
    `  evidence: ${result.evidenceRecords} valid, ${result.invalidEvidenceLines} invalid`,
  );
  console.log(`  entries: ${result.entries.length}`);
  console.log(`  claim candidates: ${result.claimCandidates.length}`);
  if (result.warnings.length > 0) {
    console.log(`  warnings: ${result.warnings.length}`);
    for (const warning of result.warnings) {
      console.log(`    - ${warning}`);
    }
  }
  if (result.writtenPath) {
    console.log(`  written: ${result.writtenPath}`);
  }
  if (result.validation) {
    console.log(
      `  validation: ${result.validation.ok ? "ok" : "stale"} (${result.validation.checkedPath})`,
    );
  }
}

function reportBenchmarkTrace(result: BenchmarkTraceRollupResult): void {
  console.log(`anamnesis benchmark trace — ${result.projectName}`);
  console.log(`  source: ${result.sourcePath}`);
  console.log(`  records: ${result.total} valid, ${result.invalid} invalid`);
  if (result.latest) {
    console.log(
      `  latest: ${result.latest.phase} ${result.latest.status} at ${result.latest.generated_at}`,
    );
  } else {
    console.log("  latest: none");
  }
  if (result.byStatus.length > 0) {
    console.log(
      `  status: ${result.byStatus.map((s) => `${s.status}=${s.total}`).join(", ")}`,
    );
  }
  for (const phase of result.byPhase) {
    const statuses = Object.entries(phase.byStatus)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `${status}=${count}`)
      .join(", ");
    const duration =
      phase.duration_ms.count > 0
        ? `, duration=${phase.duration_ms.total}ms`
        : "";
    console.log(`    ${phase.phase}: ${phase.total} (${statuses}${duration})`);
  }
  if (Object.keys(result.metrics).length > 0) {
    console.log(
      `  metrics: ${Object.entries(result.metrics)
        .map(([name, total]) => `${name}=${total}`)
        .join(", ")}`,
    );
  }
  reportAppendEvidence(result.appendedPath, result.evidencePath);
}

function reportUpgradeBenchmark(result: UpgradeBenchmarkResult): void {
  console.log("anamnesis benchmark upgrade");
  console.log(
    `  summary: ${result.summary.passed}/${result.summary.runs} pass (${result.summary.passRatePct}%), failures=${result.summary.failed}`,
  );
  console.log(
    `  health: pending=${result.summary.postPendingTotal}, doctor_errors=${result.summary.doctorErrorsTotal}, drift=${result.summary.driftTotal}`,
  );
  console.log(
    `  duration: avg=${result.summary.averageDurationMs}ms, max=${result.summary.maxDurationMs}ms`,
  );
  for (const fixture of result.fixtures) {
    console.log(
      `  ${fixture.fixtureId}: ${fixture.passed}/${fixture.runs} pass (${fixture.passRatePct}%), avg=${fixture.durationMs.average}ms, pending=${fixture.postPendingTotal}, doctor_errors=${fixture.doctorErrorsTotal}, drift=${fixture.driftTotal}`,
    );
  }
  if (result.artifacts.outputDir) {
    console.log(`  output: ${result.artifacts.outputDir}`);
  }
  for (const artifact of [
    result.artifacts.json,
    result.artifacts.markdown,
    result.artifacts.passRateSvg,
    result.artifacts.durationSvg,
  ]) {
    if (artifact) console.log(`  artifact: ${artifact}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

function reportWorkContinuityBenchmark(
	result: WorkContinuityBenchmarkResult,
): void {
	console.log("anamnesis benchmark work-continuity");
	console.log(
		`  scenario: requirements=${result.summary.requirements}, verified=${result.summary.verified_requirements}, compact_window=${result.summary.compact_fact_window}, runs=${result.summary.runs}`,
	);
	console.log(
		`  requirement recall: disabled=${result.summary.disabled.requirement_recall_pct}%, enabled=${result.summary.enabled.requirement_recall_pct}%, delta=${result.summary.delta.requirement_recall_points}pp`,
	);
	console.log(
		`  status accuracy: disabled=${result.summary.disabled.status_accuracy_pct}%, enabled=${result.summary.enabled.status_accuracy_pct}%, delta=${result.summary.delta.status_accuracy_points}pp`,
	);
	console.log(
		`  progress error: disabled=${result.summary.disabled.progress_error_points}pp, enabled=${result.summary.enabled.progress_error_points}pp`,
	);
	console.log(
		`  resume: disabled=${result.summary.disabled.resume_ms}ms/${result.summary.disabled.resume_payload_bytes}B, enabled=${result.summary.enabled.resume_ms}ms/${result.summary.enabled.resume_payload_bytes}B`,
	);
	console.log(
		`  enabled durable storage: ${result.summary.enabled.storage_bytes}B`,
	);
	if (result.artifacts.outputDir)
		console.log(`  output: ${result.artifacts.outputDir}`);
	if (result.evidencePath) console.log(`  evidence: ${result.evidencePath}`);
}

function reportWorkAgentBenchmark(result: WorkAgentBenchmarkResult): void {
	console.log("anamnesis benchmark work-agent-ab");
	console.log(
		`  model=${result.model}, runs/scenario=${result.runs_per_scenario}, invocations=${result.planned_invocations}`,
	);
	console.log(
		`  tokens: disabled=${result.summary.disabled.total_tokens}, enabled=${result.summary.enabled.total_tokens}, delta=${result.summary.delta.total_tokens_pct}%`,
	);
	console.log(
		`  recall: requirements ${result.summary.disabled.requirement_recall_pct}% -> ${result.summary.enabled.requirement_recall_pct}%, status ${result.summary.disabled.status_recall_pct}% -> ${result.summary.enabled.status_recall_pct}%`,
	);
	console.log(
		`  completion/gates: ${result.summary.enabled.completion_correct_pct}%/${result.summary.enabled.gate_correct_pct}%`,
	);
	console.log(
		`  paired overall: tokens p50=${result.analysis.overall.token_delta_pct.p50}% p95=${result.analysis.overall.token_delta_pct.p95}%, elapsed p50=${result.analysis.overall.elapsed_delta_pct.p50}% p95=${result.analysis.overall.elapsed_delta_pct.p95}%`,
	);
	for (const scenario of result.analysis.scenarios) {
		console.log(
			`  ${scenario.id}: tokens p50=${scenario.paired.token_delta_pct.p50}% p95=${scenario.paired.token_delta_pct.p95}% wins=${scenario.paired.token_pair_wins}/${scenario.paired.pairs}; corrections ${scenario.disabled.reminders_or_reexplanations}->${scenario.enabled.reminders_or_reexplanations}`,
		);
	}
	console.log(`  contract: ${result.ok ? "PASS" : "FAIL"}`);
	if (result.artifacts.output_dir)
		console.log(`  output: ${result.artifacts.output_dir}`);
}

function reportWorkParallelAgentBenchmark(
	result: ParallelBenchmarkResult,
): void {
	console.log("anamnesis benchmark work-parallel-agent-ab");
	console.log(
		`  protocol=${result.protocol}, model=${result.model}, pairs=${result.comparison.total_pairs}, invocations=${result.actual_invocations}`,
	);
	console.log(
		`  tokens/run: disabled=${result.summary.disabled.total_tokens}, enabled=${result.summary.enabled.total_tokens}, delta=${result.summary.delta.total_tokens_pct}%`,
	);
	console.log(
		`  critical path/run: disabled=${result.summary.disabled.critical_path_ms}ms, enabled=${result.summary.enabled.critical_path_ms}ms, delta=${result.summary.delta.critical_path_pct}%`,
	);
	console.log(
		`  final accuracy: disabled=${result.summary.disabled.final_accuracy_pct}%, enabled=${result.summary.enabled.final_accuracy_pct}%, delta=${result.comparison.delta_points}pp`,
	);
	console.log(
		`  paired accuracy: wins=${result.comparison.enabled_pair_wins}, ties=${result.comparison.paired_ties}, losses=${result.comparison.enabled_pair_losses}, verdict=${result.comparison.verdict}`,
	);
	console.log(
		`  harness=${result.harness_validity.ok ? "PASS" : "FAIL"}, enabled-quality=${result.quality.enabled_ready ? "PASS" : "FAIL"}`,
	);
	if (result.artifacts.output_dir) {
		console.log(`  output: ${result.artifacts.output_dir}`);
	}
}

function reportAgentTaskBenchmark(result: AgentTaskBenchmarkResult): void {
  console.log(`anamnesis benchmark task — ${result.input.project.name}`);
  console.log(`  task: ${result.input.task.id}`);
  console.log(`  run: ${result.input.run.id}`);
  console.log(
    `  agent/model: ${result.input.run.agent} / ${result.input.run.model}`,
  );
  if (result.input.run.session_context_mode) {
		console.log(
			`  session context mode: ${result.input.run.session_context_mode}`,
		);
  }
  console.log(`  context state: ${result.input.run.context_state}`);
  console.log(`  score: ${result.score.points}/${result.score.total}`);
  console.log(
    `  metrics: questions=${result.input.metrics.questions_before_action}, tool_turns=${result.input.metrics.tool_turns_to_context}, elapsed_ms=${result.input.metrics.elapsed_ms}`,
  );
  console.log(
    `  first correct action: ${result.input.metrics.first_correct_action ? "yes" : "no"}`,
  );
  console.log(
    `  handoff recovered: ${result.input.metrics.handoff_recovered ? "yes" : "no"}`,
  );
  if (result.score.retrieval) {
    const metrics = result.input.metrics;
    console.log(
      `  retrieval: success=${metrics.task_success === undefined ? "unknown" : metrics.task_success ? "yes" : "no"}, source_reads=${metrics.required_source_reads ?? "-"}/${metrics.expected_source_reads ?? "-"}, missed=${metrics.missed_invariant_count ?? "-"}, hallucinated=${metrics.hallucinated_fact_count ?? "-"}, unnecessary=${metrics.unnecessary_context_reads ?? "-"}, total_tokens=${metrics.total_tokens ?? "-"}`,
    );
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

function reportAgentTaskBenchmarkCompare(
  result: AgentTaskBenchmarkCompareResult,
): void {
  console.log(`anamnesis benchmark task-compare — ${result.full.project.name}`);
  console.log(`  task: ${result.full.task.id}`);
	console.log(
		`  agent/model: ${result.full.run.agent} / ${result.full.run.model}`,
	);
  console.log(`  full run: ${result.full.run.id}`);
  console.log(`  compact run: ${result.compact.run.id}`);
  console.log(
    `  score: full ${result.fullScore.points}/${result.fullScore.total}, compact ${result.compactScore.points}/${result.compactScore.total}`,
  );
  console.log(
    `  compact task success within tolerance: ${result.summary.compact_task_success_within_tolerance === undefined ? "unknown" : result.summary.compact_task_success_within_tolerance ? "yes" : "no"}`,
  );
  console.log(
    `  regressions/failures: ${result.summary.regressions}/${result.summary.failures}`,
  );
  if (result.summary.compact_token_reduction_pct !== undefined) {
    console.log(
      `  compact token reduction: ${result.summary.compact_token_reduction_pct}%`,
    );
  }
  for (const delta of result.deltas) {
    const compact = delta.compact === undefined ? "-" : String(delta.compact);
    const full = delta.full === undefined ? "-" : String(delta.full);
    const diff =
      delta.delta === undefined
        ? "-"
        : delta.delta > 0
          ? `+${delta.delta}`
          : String(delta.delta);
    console.log(
      `  ${delta.verdict.padEnd(14)} ${delta.label}: full=${full}, compact=${compact}, delta=${diff}`,
    );
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

function reportAgentTaskBenchmarkSeries(
  result: AgentTaskBenchmarkSeriesResult,
): void {
  console.log("anamnesis benchmark task-series");
  console.log(
    `  evidence: ${result.evidenceRecords} valid, ${result.invalidEvidenceLines} invalid`,
  );
  console.log(`  compare records: ${result.compareRecords}`);
  console.log(
    `  summary: ${result.summary.groups} group(s), ${result.summary.pairs} pair(s), regressions=${result.summary.regressions}, failures=${result.summary.failures}`,
  );
  for (const group of result.groups) {
    const tokenDelta =
      group.total_tokens_delta.average === undefined
        ? "unknown"
        : String(group.total_tokens_delta.average);
    const sourceDelta =
      group.required_source_read_rate_delta.average === undefined
        ? "unknown"
        : String(group.required_source_read_rate_delta.average);
    const citationDelta =
      group.source_citation_rate_delta.average === undefined
        ? "unknown"
        : String(group.source_citation_rate_delta.average);
    console.log(
      `  ${group.id}: pairs=${group.pairs}, compact_success=${formatCliRate(group.compact_task_success_rate)}, source_read_delta=${sourceDelta}, source_citation_delta=${citationDelta}, token_delta=${tokenDelta}`,
    );
  }
  if (result.artifacts.outputDir) {
    console.log(`  output: ${result.artifacts.outputDir}`);
  }
  for (const artifact of [
    result.artifacts.json,
    result.artifacts.markdown,
    result.artifacts.tokenDeltaSvg,
    result.artifacts.qualitySummarySvg,
    result.artifacts.sourceCitationDeltaSvg,
  ]) {
    if (artifact) console.log(`  artifact: ${artifact}`);
  }
}

function formatCliRate(value: number | undefined): string {
  return value === undefined ? "unknown" : `${Math.round(value * 100)}%`;
}

function reportPromptDeltaGate(result: PromptDeltaGateResult): void {
  console.log(
    `anamnesis benchmark prompt-gate — ${result.status.agentfile.project.name}`,
  );
  console.log(`  decision: ${result.decision.recommendation}`);
  console.log(
    `  implement prompt delta: ${result.decision.shouldImplementPromptDelta ? "yes" : "no"}`,
  );
  console.log(`  reason: ${result.decision.reason}`);
  console.log(
    `  evidence: ${result.evidence.records} valid, ${result.evidence.invalidRecords} invalid`,
  );
  console.log(
    `  session-context benchmarks: ${result.evidence.sessionContextBenchmarks}`,
  );
  console.log(
    `  agent task compares: ${result.evidence.agentTaskBenchmarkCompares}`,
  );
  console.log(
    `  retrieval benchmarks: ${result.evidence.retrievalBenchmarks} (compact ${result.evidence.compactRetrievalBenchmarks}, full ${result.evidence.fullRetrievalBenchmarks}), friction/failures ${result.evidence.retrievalFriction}/${result.evidence.retrievalFailures}`,
  );
  console.log(
    `  source-pointer retrieval: ${result.evidence.retrievalSourcePointerBenchmarks} benchmark(s), failures ${result.evidence.retrievalSourcePointerFailures}`,
  );
  console.log(
    `  retrieval top-1/top-3/MRR: ${formatCliRate(result.evidence.retrievalTop1HitRate)} / ${formatCliRate(result.evidence.retrievalTop3HitRate)} / ${result.evidence.retrievalMrr?.toFixed(3) ?? "unknown"}`,
  );
  console.log(
    `  context budget: ~${result.contextBudget.estimatedTokens}/${result.contextBudget.maxPromptDeltaTokens} tokens, duplicate risk ${result.contextBudget.duplicateContextRisk}`,
  );
  for (const signal of result.signals) {
    const assessment = formatPromptDeltaSignalAssessment(signal.status);
		console.log(`  ${assessment.padEnd(5)} ${signal.label}: ${signal.detail}`);
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidenceRecordPath) {
    console.log(`  evidence: ${result.evidenceRecordPath}`);
  }
}

function formatPromptDeltaSignalAssessment(status: string): string {
  switch (status) {
    case "pass":
      return "pass";
    case "warn":
      return "watch";
    case "fail":
      return "risk";
    default:
      return status;
  }
}

function reportSessionContextBenchmark(
  result: SessionContextBenchmarkResult,
): void {
  console.log("anamnesis benchmark session-context");
  console.log(`  fixtures: ${result.summary.fixtures}`);
  console.log(
    `  compact required rules: ${result.summary.compactRequiredRulePasses}/${result.summary.compactRequiredRuleTotal}`,
  );
  console.log(
    `  compact source pointer fixtures: ${result.summary.compactSourcePointerFixtures}/${result.summary.fixtures}`,
  );
  console.log(
    `  large fixture reduction: ${result.summary.largeFixtureCompactReductionPct}%`,
  );
  console.log(
    `  cap exceeded: compact=${result.summary.compactCapExceeded}, full=${result.summary.fullCapExceeded}`,
  );
  for (const fixture of result.fixtures) {
    const direction =
      fixture.compactReductionPct >= 0
        ? `${fixture.compactReductionPct}% less`
        : `${Math.abs(fixture.compactReductionPct)}% more`;
    console.log(
      `  ${fixture.id}: full=${fixture.metrics.full.estimatedTokens} tokens, compact=${fixture.metrics.compact.estimatedTokens} tokens (${direction})`,
    );
  }
  if (result.artifacts.outputDir) {
    console.log(`  output: ${result.artifacts.outputDir}`);
  }
  for (const artifact of [
    result.artifacts.json,
    result.artifacts.markdown,
    result.artifacts.tokenByModeSvg,
    result.artifacts.payloadCompositionSvg,
    result.artifacts.fixtureGrowthSvg,
    result.artifacts.capSuccessSummarySvg,
  ]) {
    if (artifact) console.log(`  artifact: ${artifact}`);
  }
}

function reportRetrievalBenchmark(result: RetrievalBenchmarkResult): void {
  console.log("anamnesis benchmark retrieval");
  console.log(`  cases: ${result.summary.cases}`);
  console.log(
    `  top-1: ${formatCliRate(result.summary.top1HitRate)} (${result.summary.top1Hits}/${result.summary.cases})`,
  );
  console.log(
    `  top-3: ${formatCliRate(result.summary.top3HitRate)} (${result.summary.top3Hits}/${result.summary.cases})`,
  );
  console.log(`  mrr: ${result.summary.mrr.toFixed(3)}`);
  console.log(
    `  compact session context: ${result.summary.compactSessionStartTokens}/${result.summary.compactSessionStartCap} tokens`,
  );
  console.log(`  gate: ${result.summary.ok ? "pass" : "fail"}`);
  if (result.artifacts.outputDir) {
    console.log(`  artifacts: ${result.artifacts.outputDir}`);
  }
  if (result.evidenceRecordPath) {
    console.log(`  evidence: ${result.evidenceRecordPath}`);
  }
}

function reportSubagentInjectionBenchmark(
  result: SubagentInjectionBenchmarkResult,
): void {
  console.log("anamnesis benchmark subagent-injection");
  console.log(`  attempts per lane: ${result.requestedAttempts}`);
  console.log(
    `  injection: ${result.summary.injected}/${result.summary.injectionEligibleAttempts}` +
      ` injected, ${result.summary.missed} missed` +
      (result.summary.injectionRatePct !== null
        ? ` (${result.summary.injectionRatePct}%)`
        : ""),
  );
  console.log(
    `  prompt contract: ${result.summary.contractAccepted}/${result.summary.contractAttempts}` +
      ` accepted, ${result.summary.contractRejected} rejected` +
      (result.summary.contractPassRatePct !== null
        ? ` (${result.summary.contractPassRatePct}%)`
        : ""),
  );
  for (const lane of result.lanes) {
		const rate =
			lane.injectionRatePct !== null
      ? `${lane.injectionRatePct}% injection`
      : lane.contractPassRatePct !== null
        ? `${lane.contractPassRatePct}% contract`
        : "n/a";
    console.log(
      `  ${lane.laneId}: ${lane.enforcement}, attempts=${lane.attempts}, ` +
        `injected=${lane.injected}, missed=${lane.missed}, ` +
        `accepted=${lane.accepted}, rejected=${lane.rejected}, rate=${rate}`,
    );
  }
  if (result.artifacts.outputDir) {
    console.log(`  output: ${result.artifacts.outputDir}`);
  }
  for (const artifact of [
    result.artifacts.json,
    result.artifacts.markdown,
    result.artifacts.countsSvg,
    result.artifacts.ratesSvg,
  ]) {
    if (artifact) console.log(`  artifact: ${artifact}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}

function reportMigrate(result: MigrateAgentfileResult): void {
  const verdict = result.changed
    ? result.applied
      ? "applied"
      : "changes available"
    : "no changes";
  console.log(`anamnesis migrate agentfile — ${verdict}`);
  console.log(`  path: ${result.agentfilePath}`);
  console.log(`  version: ${result.currentVersion} -> ${result.targetVersion}`);
  if (result.migrations.length === 0) {
    console.log("  migrations: none");
  } else {
    console.log("  migrations:");
    for (const migration of result.migrations) {
      console.log(`    ${migration.id}: ${migration.title}`);
    }
  }
  if (result.backupPath) {
    console.log(`  backup: ${result.backupPath}`);
  }
  if (result.changed && !result.applied) {
    console.log("  (dry-run — re-run with --apply to actually write)");
    for (const line of formatWholeFileDiff(result)) {
      console.log(line);
    }
  }
  console.log(`  next: ${result.nextCommand}`);
}

function formatWholeFileDiff(result: MigrateAgentfileResult): string[] {
  if (result.currentContent === result.newContent) return [];
  const lines = [
    `--- a/${result.agentfilePath}`,
    `+++ b/${result.agentfilePath}`,
  ];
  for (const line of result.currentContent.split(/\r?\n/)) {
    lines.push(`-${line}`);
  }
  for (const line of result.newContent.split(/\r?\n/)) {
    lines.push(`+${line}`);
  }
  return lines;
}

function printUpdateDeprecationWarning(): void {
  console.error(
    "warning: `anamnesis update` is deprecated; use `anamnesis apply --dry-run` to preview project changes or `anamnesis apply` to write reviewed changes. `update --apply` remains available for compatibility.",
  );
}

function reportUpdate(
  result: UpdateResult,
  opts: { commandName?: "apply" | "update"; projectRoot?: string } = {},
): void {
  const ui = createTui();
  const commandName = opts.commandName ?? "update";
  const s = summarizeChanges(result.changes);
	const fragIds =
		result.agentfile.fragments.map((f) => f.id).join(", ") || "(none)";
  const pending = s.create + s.update + s.blocked + s.userModified;
  const mode = result.writtenToDisk
    ? "applied"
    : pending > 0
      ? "preview"
      : "no changes";
  printLines([
    ...ui.title(`anamnesis ${commandName}`, result.agentfile.project.name),
    ...ui.keyValues([
			{
				key: "mode",
				value: mode,
				tone: result.writtenToDisk ? "success" : "accent",
			},
      { key: "fragments", value: fragIds },
			{
				key: "changes",
				value: changeSummaryLine(s),
				tone: countTone(s.blocked),
			},
    ]),
  ]);
  if (result.suggested.length > 0) {
    const ids = result.suggested.map((r) => r.suggest).join(", ");
    printLines([
      ...ui.section("Suggested"),
      ui.note(ids),
			ui.note(
				"add to Agentfile.fragments[] and re-run, or list under 'declined' to silence",
			),
    ]);
  }
  if (s.userModified > 0) {
    console.log(
      ui.note(
        `${s.userModified} user-modified: your edits are preserved; library updates skipped for those`,
        "warning",
      ),
    );
  }
  if (s.blocked > 0) {
    console.log(
      ui.note(
        "some writes blocked; re-run with --allow-exec-adapters to include hooks/commands/skills",
        "warning",
      ),
    );
  }
  for (const conflict of result.surfaceConflicts) {
    const label =
      conflict.outcome === "planned-preserve"
        ? "planned surface preserve"
        : "preserved surface";
		console.log(`  ${label}: ${conflict.path} -> ${conflict.preservedAs}`);
  }
  const showOntologyRecommendation =
    result.ontologyRecommendation.action !== "none" &&
    (result.writtenToDisk || result.ontologyRecommendation.action !== "apply");
  if (showOntologyRecommendation) {
    printOntologyRecommendation(ui, result.ontologyRecommendation, {
      label: result.writtenToDisk ? "ontology next" : "after apply",
    });
  }
  if (result.writtenToDisk) {
    if (result.backedUpFiles && result.backedUpFiles.length > 0) {
      console.log(`  backup: ${result.backupDir}`);
    }
    if (result.prunedBackupDirs && result.prunedBackupDirs.length > 0) {
      console.log(`  pruned backups: ${result.prunedBackupDirs.length}`);
    }
    if (result.evidencePath) {
      console.log(`  evidence: ${result.evidencePath}`);
    }
  } else {
    if (opts.projectRoot) {
      reportWorkspaceProfile(opts.projectRoot);
    }
    if (commandName === "apply") {
			console.log(
				ui.note("dry-run: re-run without --dry-run to actually write"),
			);
    } else {
      console.log(
        ui.note(
          "dry-run: use `anamnesis apply` to write; `update --apply` remains available for compatibility",
        ),
      );
    }
  }
}

function reportUpgrade(
	result: UpgradeResult,
	projectRoot: string = process.cwd(),
): void {
  const ui = createTui();
  printLines([
    ...ui.title("anamnesis upgrade", result.packageName),
    ...ui.keyValues([
      { key: "registry", value: result.registry },
			{
				key: "version",
				value: `${result.currentVersion} -> ${result.latestVersion}`,
			},
      {
        key: "status",
        value: result.status,
        tone: result.updateAvailable ? "warning" : "success",
      },
    ]),
  ]);
  if (result.updateAvailable) {
    console.log(`  command: ${result.installCommand.join(" ")}`);
    if (!result.applied) {
      console.log(ui.note("dry-run: re-run with --apply to install"));
    }
  } else if (result.status === "local-ahead") {
		console.log(
			ui.note("local package.json is ahead of the registry; no downgrade run"),
		);
  } else if (result.status === "up-to-date") {
    console.log(ui.note("already up to date", "success"));
  } else {
		console.log(
			ui.note(
				"could not compare versions; inspect the registry result before applying",
				"warning",
			),
		);
  }
  for (const line of formatUpgradeProjectGuidance(
    result,
    detectUpgradeProjectGuidance(projectRoot),
  )) {
    console.log(line);
  }
}

function reportRegisteredProjects(
	result: ReturnType<typeof listRegisteredProjects>,
	registryPath?: string,
): void {
	const ui = createTui();
	printLines([
		...ui.title("anamnesis projects", "registered projects"),
		...ui.keyValues([
			{ key: "registry", value: registryPath ?? "user state default" },
			{ key: "projects", value: String(result.length) },
		]),
	]);
	if (result.length === 0) {
		console.log(ui.note("no registered projects"));
		return;
	}
	for (const entry of result) {
		console.log(
			`  ${entry.valid ? "valid" : "stale"} ${entry.project.project_name} ${entry.project.canonical_root}`,
		);
	}
}

function reportRegisteredProjectSync(result: RegisteredProjectsResult): void {
	const ui = createTui();
	printLines([
		...ui.title(
			result.apply ? "anamnesis projects apply" : "anamnesis projects plan",
			"registered projects",
		),
		...ui.keyValues([
			{ key: "registry", value: result.registry_path },
			{ key: "projects", value: String(result.summary.total) },
			{ key: "current", value: String(result.summary.current) },
			{ key: "ready", value: String(result.summary.ready) },
			{ key: "applied", value: String(result.summary.applied) },
			{ key: "skipped", value: String(result.summary.skipped) },
			{ key: "stale", value: String(result.summary.stale) },
			{ key: "errors", value: String(result.summary.errors) },
		]),
	]);
	for (const entry of result.projects) {
		const changes = entry.summary ? ` ${changeSummaryLine(entry.summary)}` : "";
		console.log(
			`  ${entry.status.padEnd(13)} ${entry.project.project_name} ${entry.project.canonical_root}${changes}`,
		);
		if (entry.error) console.log(`    ${entry.error}`);
	}
}

function reportUpgradePlan(result: UpgradePlanResult): void {
  const ui = createTui();
  printLines([
    ...ui.title("anamnesis upgrade plan", result.package.packageName),
    ...ui.keyValues([
      { key: "generated", value: result.generatedAt },
      { key: "registry", value: result.package.registry },
      {
        key: "package",
        value: `${result.package.currentVersion} -> ${result.package.latestVersion} [${result.package.status}]`,
        tone: result.package.updateAvailable ? "warning" : "success",
      },
    ]),
  ]);
  if (result.package.updateAvailable) {
    console.log(`    command: ${result.package.installCommand.join(" ")}`);
  }

  const project = result.project;
  printLines([
    ...ui.section("Project"),
    ...ui.keyValues([{ key: "kind", value: project.kind }]),
  ]);
  if (project.agentfilePath) {
    console.log(`    Agentfile: ${project.agentfilePath}`);
  }
  if (project.schema) {
    console.log(
      `    schema: ${project.schema.currentVersion} -> ${project.schema.supportedVersion}` +
				(project.schema.migrationRequired
					? " (migration required)"
					: " (supported)"),
    );
  }
  if (project.settingsPolicy) {
    const materialized = project.settingsPolicy.defaults.filter(
      (entry) => entry.materialized,
    ).length;
    console.log(
      `    settings: ${project.settingsPolicy.materialization} (${materialized}/${project.settingsPolicy.defaults.length} defaults materialized)`,
    );
    console.log(`      ${project.settingsPolicy.message}`);
    console.log(`      next: ${project.settingsPolicy.next}`);
  }
  if (project.statusSummary) {
    console.log(
      `    fragments: updates=${project.statusSummary.fragmentUpdatesAvailable}, pinned=${project.statusSummary.fragmentPinned}, missing=${project.statusSummary.fragmentLibraryMissing}`,
    );
    console.log(
      `    drift: clean=${project.statusSummary.entriesClean}, user-modified=${project.statusSummary.entriesUserModified}, missing=${project.statusSummary.entriesMissing}`,
    );
    console.log(
      `    partial upgrades: ${project.statusSummary.partialAdoptions}`,
    );
  }
  if (project.updateSummary) {
    console.log(
      `    apply preview (safe mode, executable adapters blocked unless allowed): create=${project.updateSummary.create} update=${project.updateSummary.update} blocked=${project.updateSummary.blocked} user-modified=${project.updateSummary.userModified}`,
    );
  }
  if (project.doctorSummary) {
    console.log(
      `    doctor: errors=${project.doctorSummary.errors} warnings=${project.doctorSummary.warnings} info=${project.doctorSummary.info}`,
    );
  }
  if (project.error) {
    console.log(`    error: ${project.error}`);
  }

  if (project.gates.length > 0) {
    printLines(ui.section("Gates"));
    for (const gate of project.gates) {
			console.log(
				`    ${gate.severity.padEnd(7)} ${gate.kind}: ${gate.message}`,
			);
      console.log(`      next: ${gate.next}`);
    }
  } else {
    printLines([...ui.section("Gates"), ui.note("none", "success")]);
  }

  if (project.choices.length > 0) {
    printLines(ui.section("Choices"));
    for (const choice of project.choices) {
      const recommended = choice.recommended ? " recommended" : "";
      console.log(
        `    ${choice.id} [${choice.effect}${recommended}]: ${choice.label}`,
      );
      if (choice.command) {
        console.log(`      command: ${choice.command}`);
      }
      console.log(`      outcome: ${choice.outcome}`);
    }
  } else {
    printLines([...ui.section("Choices"), ui.note("none")]);
  }

  printLines(ui.section("Next Commands"));
  for (const command of project.commands) {
    console.log(`    ${command}`);
  }
}

function reportUpgradeApplyChoice(result: UpgradeApplyChoiceResult): void {
  const ui = createTui();
  printLines([
    ...ui.title("anamnesis upgrade apply-choice", result.choiceId),
    ...ui.keyValues([
      {
        key: "status",
        value: result.status,
        tone: result.status === "applied" ? "success" : "accent",
      },
      { key: "effect", value: result.choice.effect },
      { key: "operation", value: result.operation },
      { key: "label", value: result.choice.label },
    ]),
  ]);
  if (result.command) {
    console.log(`  command: ${result.command}`);
  }
  if (result.previewCommand) {
    console.log(`  preview: ${result.previewCommand}`);
  }
  console.log(`  message: ${result.message}`);
  if (result.summary.length > 0) {
    printLines(ui.section("Summary"));
    for (const line of result.summary) {
      console.log(`    ${line}`);
    }
  }
}

function reportUpgradeChoose(result: UpgradeChooseResult): void {
  console.log(`anamnesis upgrade choose — ${result.selectedChoiceId}`);
  console.log(`  interactive: ${result.interactive}`);
  console.log(`  choices: ${result.menu.length}`);
  console.log("");
  reportUpgradeApplyChoice(result.execution);
}

function requiredWorkFlag(flags: ParsedArgs["flags"], name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`--${name} requires a value`);
  }
  return value;
}

function optionalWorkFlag(
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

function requiredWorkPositiveIntegerFlag(
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

function workHookClient(flags: ParsedArgs["flags"]): WorkHookClient {
  const value = requiredWorkFlag(flags, "client");
  if (value === "codex") return "codex";
  if (value === "claude-code") return "claude";
  throw new Error("--client must be codex or claude-code");
}

function workTimestamp(flags: ParsedArgs["flags"], required: boolean): string {
  const value = optionalWorkFlag(flags, "occurred-at");
  if (!value) {
    if (required) throw new Error("--occurred-at is required");
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    throw new Error("--occurred-at must be a canonical UTC ISO timestamp");
  }
  return value;
}

function workMutationInput(
  flags: ParsedArgs["flags"],
  subcommand: "create" | "amend" | "transition",
): WorkMutationInput {
	const projectRoot = optionalWorkFlag(flags, "project-root") ?? process.cwd();
  const occurredAt = workTimestamp(flags, true);
  const sourceFile = optionalWorkFlag(flags, "source-file");
  const sourceStdin = flags["source-stdin"] === true;
  const sourceCount = (sourceFile ? 1 : 0) + (sourceStdin ? 1 : 0);
  if (subcommand !== "transition" && sourceCount !== 1) {
		throw new Error(
			"exactly one of --source-file or --source-stdin is required",
		);
  }
  if (subcommand === "transition" && sourceCount > 1) {
		throw new Error(
			"at most one of --source-file or --source-stdin is allowed",
		);
  }
  const fidelityValue = optionalWorkFlag(flags, "fidelity") ?? "client_exact";
  if (
    fidelityValue !== "native_exact" &&
    fidelityValue !== "client_exact" &&
    fidelityValue !== "agent_observed"
  ) {
    throw new Error(
      "--fidelity must be native_exact, client_exact, or agent_observed",
    );
  }
  const sourceEventId =
    sourceCount > 0 ? requiredWorkFlag(flags, "source-event-id") : undefined;
  const source: WorkRawSource | undefined = sourceEventId
    ? {
    event_id: sourceEventId,
    captured_at: optionalWorkFlag(flags, "captured-at") ?? occurredAt,
    client: optionalWorkFlag(flags, "client") ?? "anamnesis-cli",
    content_type:
					optionalWorkFlag(flags, "content-type") ??
					"text/plain; charset=utf-8",
    fidelity: fidelityValue,
    allocation_status: "allocated",
    body: sourceFile
      ? fs.readFileSync(path.resolve(projectRoot, sourceFile))
      : fs.readFileSync(0),
      }
    : undefined;
  const draftPath = requiredWorkFlag(flags, "draft");
  return {
    project_root: projectRoot,
    state_root: optionalWorkFlag(flags, "state-root"),
    work_id: requiredWorkFlag(flags, "work"),
    event_id: requiredWorkFlag(flags, "event-id"),
    occurred_at: occurredAt,
    draft: fs.readFileSync(path.resolve(projectRoot, draftPath)),
		expected_head:
			subcommand === "create" ? null : requiredWorkFlag(flags, "expected-head"),
    ...(sourceFile && source
      ? { source_file: source }
      : sourceStdin && source
        ? { source_stdin: source }
        : {}),
  };
}

function workEvidenceMutationInput(
	flags: ParsedArgs["flags"],
): WorkEvidenceMutationInput {
	const projectRoot = optionalWorkFlag(flags, "project-root") ?? process.cwd();
	return {
		project_root: projectRoot,
		state_root: optionalWorkFlag(flags, "state-root"),
		work_id: requiredWorkFlag(flags, "work"),
		event_id: requiredWorkFlag(flags, "event-id"),
		occurred_at: workTimestamp(flags, true),
		expected_head: requiredWorkFlag(flags, "expected-head"),
		draft: fs.readFileSync(
			path.resolve(projectRoot, requiredWorkFlag(flags, "draft")),
		),
	};
}

function workCloseInput(flags: ParsedArgs["flags"]): WorkCloseInput {
	return {
		...workEvidenceMutationInput(flags),
		expected_contract_revision: requiredWorkPositiveIntegerFlag(
			flags,
			"expected-contract-revision",
		),
		expected_contract_hash: requiredWorkFlag(flags, "expected-contract-hash"),
	};
}

function workEvidenceSource(
	flags: ParsedArgs["flags"],
	projectRoot: string,
	occurredAt: string,
): { source_file?: WorkRawSource; source_stdin?: WorkRawSource } {
	const sourceFile = optionalWorkFlag(flags, "source-file");
	const sourceStdin = flags["source-stdin"] === true;
	if ((sourceFile ? 1 : 0) + (sourceStdin ? 1 : 0) !== 1) {
		throw new Error(
			"exactly one of --source-file or --source-stdin is required",
		);
	}
	const source: WorkRawSource = {
		event_id: requiredWorkFlag(flags, "source-event-id"),
		captured_at: optionalWorkFlag(flags, "captured-at") ?? occurredAt,
		client: optionalWorkFlag(flags, "client") ?? "anamnesis-cli",
		content_type:
			optionalWorkFlag(flags, "content-type") ?? "text/plain; charset=utf-8",
		fidelity: "client_exact",
		allocation_status: "allocated",
		body: sourceFile
			? fs.readFileSync(path.resolve(projectRoot, sourceFile))
			: fs.readFileSync(0),
	};
	return sourceFile ? { source_file: source } : { source_stdin: source };
}

function reportWorkMutation(result: WorkMutationResult): void {
  console.log(`Work ${result.work_id}`);
  console.log(`  revision: ${result.projection.contract_revision}`);
  console.log(`  lifecycle: ${result.projection.lifecycle}`);
  console.log(`  progress: ${result.projection.progress.percent}%`);
  console.log(
    `  source: ${result.allocation?.source.envelope.event_id ?? "evidence-only transition"}`,
  );
}

function reportWorkExecutionMutation(result: WorkMutationResult): void {
	const output = publicWorkExecutionMutation(result);
	const contract = output.execution_contract;
	console.log(`Work ${output.work_id}`);
	console.log(`  ledger head: ${output.ledger_head ?? "(none)"}`);
	console.log(`  contract: ${contract.kind}`);
	for (const [key, value] of Object.entries(contract)) {
		if (key === "kind") continue;
		if (Array.isArray(value)) {
			console.log(`  ${key}: ${value.length > 0 ? value.join(", ") : "none"}`);
		} else if (typeof value === "object" && value !== null) {
			const ref = value as { provider?: string; ref?: string };
			console.log(
				`  ${key}: ${ref.provider ?? "unknown"}:${ref.ref ?? "unknown"}`,
			);
		} else {
			console.log(`  ${key}: ${String(value)}`);
		}
	}
	if (output.readiness) {
		console.log(
			`  readiness: ${output.readiness.allowed ? "allowed" : "blocked"}`,
		);
	}
}

function reportWorkPromptResolution(result: WorkPromptResolutionResult): void {
  console.log(`Work prompt ${result.capture_id}`);
  console.log(`  resolution: ${result.resolution}`);
  console.log(`  outcome: ${result.outcome.outcome}`);
  if (result.work_id) console.log(`  work: ${result.work_id}`);
  if (result.projection) {
    console.log(`  revision: ${result.projection.contract_revision}`);
    console.log(`  progress: ${result.projection.progress.percent}%`);
  }
}

function reportWorkStatus(result: WorkStatusResult): void {
  const projection = result.projection;
	console.log(
		`${projection.title ?? projection.work_id} (${projection.work_id})`,
	);
  console.log(`  revision: ${projection.contract_revision}`);
  console.log(`  lifecycle: ${projection.lifecycle}`);
	console.log(
		`  completion contract: ${projection.completion_contract ?? "(none)"}`,
	);
  console.log(
    `  configured required gates: ${projection.configured_required_gates.join(", ") || "none"}`,
  );
	for (const gate of projection.review_gates) {
		if (gate.enforcement === "off") continue;
		console.log(
			`  review ${gate.gate}: ${gate.state}; next=${gate.next_provider ?? "none"}; reviewers=${gate.passing_reviewer_refs.map((item) => `${item.provider}:${item.ref}`).join(",") || "none"}; findings=${gate.finding_refs.join(",") || "none"}; failures=${gate.failure_refs.join(",") || "none"}`,
		);
	}
	if (projection.parallelism.mode !== "off") {
		console.log(
			`  delegation: ${projection.parallelism.recorded_state}; assessment=${projection.parallelism.assessment_id ?? "none"}; next=${projection.parallelism.next_provider ?? "none"}; failures=${projection.parallelism.failure_refs.join(",") || "none"}`,
		);
	}
	if (result.readiness) console.log(`  readiness: ${result.readiness}`);
  if (result.policy_drift?.drifted) {
		console.log(
			"  policy drift: current project policy differs; frozen Work policy retained",
		);
  }
  console.log("  requirements:");
  for (const requirement of projection.requirements) {
    console.log(
      `    - ${requirement.id} [${requirement.status}] — ${requirement.summary}`,
    );
  }
  const progressDetail = projection.progress.weighted
    ? `${projection.progress.verified_weight ?? 0}/${projection.progress.applicable_weight ?? 0} verified weight`
    : `${projection.progress.verified}/${projection.progress.applicable} verified requirements`;
	console.log(
		`  progress: ${projection.progress.percent}% (${progressDetail})`,
	);
}

function formatWorkBrief(result: WorkBriefResult): string {
	const lines = [
		`Work briefing — ${result.briefing.work.title ?? result.work_id}`,
	];
  for (const section of result.sections) {
    lines.push("", `${section.label}:`);
    if (section.values.length === 0) lines.push("  - none");
    else lines.push(...section.values.map((value) => `  - ${value}`));
  }
	for (const gate of result.projection.review_gates) {
		if (gate.enforcement === "off") continue;
		lines.push(
			"",
			`Review ${gate.gate}: ${gate.state}`,
			`  refs: ${gate.passing_reviewer_refs.map((item) => `${item.provider}:${item.ref}`).join(", ") || "none"}`,
			`  findings: ${gate.finding_refs.join(", ") || "none"}`,
			`  failures: ${gate.failure_refs.join(", ") || "none"}`,
		);
	}
	if (result.projection.parallelism.mode !== "off") {
		lines.push(
			"",
			`Delegation: ${result.projection.parallelism.recorded_state}`,
			`  assessment: ${result.projection.parallelism.assessment_id ?? "none"}`,
			`  failures: ${result.projection.parallelism.failure_refs.join(", ") || "none"}`,
		);
	}
	if (result.readiness) lines.push("", `Readiness: ${result.readiness}`);
  lines.push(
    "",
    `Delivery: pending (${result.delivery_token})`,
    "Continue the active Work from the listed next requirements.",
  );
  return lines.join("\n");
}

function writeStdoutFully(value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      process.stdout.off("error", onError);
      reject(error);
    };
    process.stdout.once("error", onError);
    process.stdout.write(value, (error) => {
      process.stdout.off("error", onError);
      if (error) reject(error);
      else resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  const { command, positional, flags } = parseArgs(argv);

  if (flags.help || flags.h) {
    printHelp(flags.all === true);
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
      try {
        const projectRoot =
          (flags["project-root"] as string | undefined) ?? process.cwd();
        const result = init({
          projectRoot,
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          dryRun: flags["dry-run"] === true,
          allowExecAdapters: flags["allow-exec-adapters"] === true,
          tools: parseToolsFlag(flags["tools"]),
          projectName: flags["project-name"] as string | undefined,
          monorepo: flags["monorepo"] === true,
          noBootstrap: flags["no-bootstrap"] === true,
          noContextBootstrap: flags["no-context-bootstrap"] === true,
          scaffoldDocs: flags["scaffold-docs"] === true,
          enhanceDocs: flags["enhance-docs"] === true,
					projectRegistryPath: defaultProjectRegistryPath(),
        });
				reportInit(result, projectRoot, flags["allow-exec-adapters"] === true);
        return 0;
      } catch (e) {
        if (e instanceof InitError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }

    case "apply":
      try {
        const projectRoot =
          (flags["project-root"] as string | undefined) ?? process.cwd();
        if (flags["dry-run"] === true && flags["apply"] === true) {
          throw new UpdateError(
            "`anamnesis apply` cannot combine --dry-run and --apply",
          );
        }
        const result = update({
          projectRoot,
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          apply: flags["dry-run"] !== true,
          bumpPinned: flags["bump-pinned"] === true,
          allowExecAdapters: flags["allow-exec-adapters"] === true,
        });
        reportUpdate(result, { commandName: "apply", projectRoot });
        return 0;
      } catch (e) {
        if (e instanceof UpdateError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }

    case "update":
      try {
        const projectRoot =
          (flags["project-root"] as string | undefined) ?? process.cwd();
        printUpdateDeprecationWarning();
        const result = update({
          projectRoot,
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          apply: flags["apply"] === true,
          bumpPinned: flags["bump-pinned"] === true,
          allowExecAdapters: flags["allow-exec-adapters"] === true,
        });
        reportUpdate(result, { commandName: "update", projectRoot });
        return 0;
      } catch (e) {
        if (e instanceof UpdateError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }

    case "upgrade":
      try {
        if (positional[0] === "choose") {
          const result = await upgradeChoose({
            choiceInput:
              (flags["choice"] as string | undefined) ?? positional[1],
            projectRoot:
              (flags["project-root"] as string | undefined) ?? process.cwd(),
            libraryRoot:
              (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
            registry: flags["registry"] as string | undefined,
            apply: flags["apply"] === true,
          });
          if (flags["json"] === true) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            reportUpgradeChoose(result);
          }
          return result.execution.status === "unsupported" ? 1 : 0;
        }
        if (positional[0] === "apply-choice") {
          const choiceId = positional[1];
          if (!choiceId) {
            console.error("error: usage: anamnesis upgrade apply-choice <id>");
            return 1;
          }
          const result = upgradeApplyChoice({
            choiceId,
            projectRoot:
              (flags["project-root"] as string | undefined) ?? process.cwd(),
            libraryRoot:
              (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
            registry: flags["registry"] as string | undefined,
            apply: flags["apply"] === true,
          });
          if (flags["json"] === true) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            reportUpgradeApplyChoice(result);
          }
          return result.status === "unsupported" ? 1 : 0;
        }
        if (positional[0] === "plan") {
          const result = upgradePlan({
            projectRoot:
              (flags["project-root"] as string | undefined) ?? process.cwd(),
            libraryRoot:
              (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
            registry: flags["registry"] as string | undefined,
          });
          if (flags["json"] === true) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            reportUpgradePlan(result);
          }
          return 0;
        }
        const result = upgrade({
          registry: flags["registry"] as string | undefined,
          apply: flags["apply"] === true,
        });
				const projectSync =
					flags["apply"] === true
						? syncProjectsAfterUpgrade(result, {
								registryPath: flags["registry-file"] as string | undefined,
								libraryRoot: resolveLibraryRoot(),
							})
						: undefined;
        if (flags["json"] === true) {
					console.log(
						JSON.stringify(
							projectSync ? { package: result, projects: projectSync } : result,
							null,
							2,
						),
					);
        } else {
          reportUpgrade(result, process.cwd());
					if (projectSync) reportRegisteredProjectSync(projectSync);
        }
        return 0;
      } catch (e) {
        if (
          e instanceof UpgradeError ||
          e instanceof UpgradeApplyChoiceError ||
          e instanceof UpgradeChooseError
        ) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }

		case "projects":
			try {
				const action = positional[0] ?? "list";
				const registryPath = flags["registry-file"] as string | undefined;
				if (action === "list") {
					const result = listRegisteredProjects({ registryPath });
					if (flags.json === true) console.log(JSON.stringify(result, null, 2));
					else reportRegisteredProjects(result, registryPath);
					return 0;
				}
				if (action === "register") {
					const registered = registerManagedProject({
						projectRoot:
							(flags["project-root"] as string | undefined) ?? process.cwd(),
						allowExecAdapters: flags["allow-exec-adapters"] === true,
						registryPath,
					});
					if (flags.json === true)
						console.log(JSON.stringify(registered, null, 2));
					else
						console.log(
							`registered: ${registered.project_name} (${registered.canonical_root})`,
						);
					return 0;
				}
				if (action === "unregister") {
					const target = positional[1] ?? process.cwd();
					const removed = unregisterManagedProject({
						idOrRoot: target,
						registryPath,
					});
					if (flags.json === true) {
						console.log(JSON.stringify({ target, removed }, null, 2));
					} else {
						console.log(
							removed ? `unregistered: ${target}` : `not registered: ${target}`,
						);
					}
					return removed ? 0 : 1;
				}
				if (action === "prune") {
					const stale = listRegisteredProjects({ registryPath })
						.filter((entry) => !entry.valid)
						.map((entry) => entry.project);
					const removed =
						flags.apply === true
							? pruneRegisteredProjects({ registryPath })
							: [];
					const result = {
						apply: flags.apply === true,
						stale,
						removed,
					};
					if (flags.json === true) console.log(JSON.stringify(result, null, 2));
					else {
						console.log(`stale registrations: ${stale.length}`);
						console.log(
							flags.apply === true
								? `removed: ${removed.length}`
								: "preview only; re-run with --apply to remove them",
						);
					}
					return 0;
				}
				if (["plan", "apply", "sync"].includes(action)) {
					const apply = action === "apply" || flags.apply === true;
					const result = syncRegisteredProjects({
						libraryRoot:
							(flags.library as string | undefined) ?? resolveLibraryRoot(),
						registryPath,
						apply,
					});
					if (flags.json === true) console.log(JSON.stringify(result, null, 2));
					else reportRegisteredProjectSync(result);
					return result.summary.errors > 0 ? 1 : 0;
				}
				throw new ProjectsError(
					`unknown projects action '${action}'; expected list, register, plan, apply, unregister, or prune`,
				);
			} catch (error) {
				if (
					error instanceof ProjectsError ||
					error instanceof ProjectRegistryError
				) {
					console.error(`error: ${error.message}`);
					return 1;
				}
				throw error;
			}

    case "status":
      try {
        const projectRoot =
          (flags["project-root"] as string | undefined) ?? process.cwd();
        const codexHookTrust = await inspectCodexHookTrust(projectRoot);
        const result = status({
          projectRoot,
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          codexHookTrust,
        });
        if (flags["json"] === true) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          reportStatus(result, projectRoot);
        }
        return 0;
      } catch (e) {
        if (e instanceof StatusError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }

    case "doctor":
      try {
        const projectRoot =
          (flags["project-root"] as string | undefined) ?? process.cwd();
        const codexHookTrust = await inspectCodexHookTrust(projectRoot);
        const result = doctor({
          projectRoot,
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          append: flags["append"] === true,
          outputPath: flags["output"] as string | undefined,
          codexHookTrust,
        });
        reportDoctor(result);
        return result.ok ? 0 : 1;
      } catch (e) {
        if (e instanceof DoctorError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }

    case "release": {
      const sub = positional[0];
      if (sub !== "check") {
        console.error(
          `error: unknown 'release' subcommand: ${sub ?? "(none)"}`,
        );
        console.error(
          `usage: anamnesis release check [--json] [--append] [--project-root=<path>] [--library=<path>]`,
        );
        return 1;
      }
      try {
        const projectRoot =
          (flags["project-root"] as string | undefined) ?? process.cwd();
        const codexHookTrust = await inspectCodexHookTrust(projectRoot);
        const result = releaseCheck({
          projectRoot,
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          append: flags["append"] === true,
          codexHookTrust,
        });
        if (flags["json"] === true) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          reportReleaseCheck(result);
        }
        return result.ok ? 0 : 1;
      } catch (e) {
        if (
          e instanceof StatusError ||
          e instanceof UpdateError ||
          e instanceof DoctorError
        ) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }
    }

    case "hooks": {
      const sub = positional[0];
      if (sub === "codex" && positional[1] === "trust") {
        const dryRun = flags["dry-run"] === true;
        const apply = flags["apply"] === true;
        if (dryRun === apply) {
					console.error(
						"error: choose exactly one of --dry-run or --apply for explicit Codex hook trust review",
					);
          console.error(
            "usage: anamnesis hooks codex trust (--dry-run|--apply) [--json] [--project-root=<path>]",
          );
          return 1;
        }
        try {
          const projectRoot =
            (flags["project-root"] as string | undefined) ?? process.cwd();
          const result = await trustCodexHooks(projectRoot, { apply });
          if (flags["json"] === true) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            reportCodexHookTrust(result);
          }
          return apply && !result.inspection.available ? 1 : 0;
        } catch (error) {
          if (error instanceof CodexHookTrustChangedError) {
            console.error(`error: ${error.message}`);
            return 1;
          }
          throw error;
        }
      }
      if (sub !== "summary") {
				console.error(`error: unknown 'hooks' subcommand: ${sub ?? "(none)"}`);
        console.error(
          `usage: anamnesis hooks summary [--json] [--append] [--output=<path>] [--source=<path>] | anamnesis hooks codex trust (--dry-run|--apply)`,
        );
        return 1;
      }
      try {
        const result = hookSummary({
          projectRoot:
            (flags["project-root"] as string | undefined) ?? process.cwd(),
          sourcePath: flags["source"] as string | undefined,
          append: flags["append"] === true,
          outputPath: flags["output"] as string | undefined,
        });
        if (flags["json"] === true) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          reportHookSummary(result);
        }
        return result.ok ? 0 : 1;
      } catch (e) {
        if (e instanceof HookSummaryError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }
    }

    case "dogfood": {
      const sub = positional[0];
      if (sub !== "check") {
        console.error(
          `error: unknown 'dogfood' subcommand: ${sub ?? "(none)"}`,
        );
        console.error(
          `usage: anamnesis dogfood check [--append] [--output=<path>]`,
        );
        return 1;
      }
      try {
        const projectRoot =
          (flags["project-root"] as string | undefined) ?? process.cwd();
        const codexHookTrust = await inspectCodexHookTrust(projectRoot);
        const result = dogfoodCheck({
          projectRoot,
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          append: flags["append"] === true,
          outputPath: flags["output"] as string | undefined,
          codexHookTrust,
        });
        reportDogfood(result);
        return result.ok ? 0 : 1;
      } catch (e) {
        if (e instanceof DogfoodError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }
    }

    case "work": {
      const sub = positional[0];
      if (sub === undefined) {
        console.log(formatNamespaceHelp("work"));
        return 0;
      }
      if (
        sub !== "create" &&
        sub !== "amend" &&
        sub !== "transition" &&
        sub !== "close" &&
				sub !== "review" &&
				sub !== "delegation" &&
				sub !== "readiness" &&
        sub !== "status" &&
        sub !== "brief" &&
        sub !== "confirm" &&
        sub !== "switch" &&
        sub !== "prompt" &&
        sub !== "hook-policy-probe" &&
        sub !== "hook-user-prompt" &&
        sub !== "hook-post-tool-use"
      ) {
        console.error(`error: unknown 'work' subcommand: ${sub}`);
				console.error(
					"usage: anamnesis work <create|amend|transition|close|review|delegation|readiness|status|brief|confirm|switch> [options]",
				);
        return 1;
      }
      try {
        if (sub === "hook-policy-probe") {
          const projectRoot =
            optionalWorkFlag(flags, "project-root") ?? process.cwd();
          let enabled = false;
          try {
            const agentfile = readAgentfile(projectRoot);
            enabled =
              agentfile.version === 2 &&
              normalizeWorkPromptCapturePolicy(
                agentfile.settings?.work_prompt_capture,
              ).enabled;
          } catch {
            enabled = false;
          }
          await writeStdoutFully(
            `${JSON.stringify({
              schema_version: "anamnesis.work-prompt-policy-probe.v1",
              capture_enabled: enabled,
            })}\n`,
          );
          return 0;
        }

        if (sub === "prompt") {
          const action = positional[1];
          if (
            action !== "allocate-same" &&
            action !== "allocate-new" &&
            action !== "retain" &&
            action !== "discard" &&
			action !== "gc"
          ) {
            throw new Error(
              "work prompt requires allocate-same, allocate-new, retain, discard, or gc",
            );
          }
          const projectRoot =
            optionalWorkFlag(flags, "project-root") ?? process.cwd();
          const stateRoot = optionalWorkFlag(flags, "state-root");
		  if (action === "gc") {
			const gcResult = gcStagedWorkPromptEntries({
				project_root: projectRoot,
				state_root: stateRoot,
				now: optionalWorkFlag(flags, "now"),
			});
			if (flags.json === true) {
				await writeStdoutFully(`${JSON.stringify(gcResult, null, 2)}\n`);
			} else {
							console.log(
								`Work prompt GC removed ${gcResult.removed.length} stage(s)`,
							);
				if (gcResult.skipped_locked.length > 0)
					console.log(`  locked: ${gcResult.skipped_locked.length}`);
				if (gcResult.skipped_indeterminate.length > 0)
								console.log(
									`  indeterminate: ${gcResult.skipped_indeterminate.length}`,
								);
			}
			return 0;
		  }
          const captureId = requiredWorkFlag(flags, "stage");
          const occurredAt = workTimestamp(flags, false);
          let resolution: WorkPromptResolutionResult;
          if (action === "retain") {
            resolution = retainStagedPromptProvisional({
              project_root: projectRoot,
              state_root: stateRoot,
              capture_id: captureId,
              resolved_at: occurredAt,
              draft: fs.readFileSync(
                path.resolve(projectRoot, requiredWorkFlag(flags, "draft")),
              ),
            });
          } else if (action === "discard") {
            const reason = requiredWorkFlag(flags, "reason");
            if (reason !== "interruption" && reason !== "non_requirement") {
              throw new Error(
                "--reason must be interruption or non_requirement",
              );
            }
            resolution = discardStagedPrompt({
              project_root: projectRoot,
              state_root: stateRoot,
              capture_id: captureId,
              resolved_at: occurredAt,
              reason,
            });
          } else {
            const allocationInput = {
              project_root: projectRoot,
              state_root: stateRoot,
              capture_id: captureId,
              work_id: requiredWorkFlag(flags, "work"),
              occurred_at: occurredAt,
              draft: fs.readFileSync(
                path.resolve(projectRoot, requiredWorkFlag(flags, "draft")),
              ),
              expected_head:
                action === "allocate-same"
                  ? requiredWorkFlag(flags, "expected-head")
                  : null,
              expected_contract_revision:
                action === "allocate-same"
                  ? requiredWorkPositiveIntegerFlag(
                      flags,
                      "expected-contract-revision",
                    )
                  : null,
              expected_contract_hash:
                action === "allocate-same"
                  ? requiredWorkFlag(flags, "expected-contract-hash")
                  : null,
            };
            resolution =
              action === "allocate-same"
                ? allocateStagedPromptToSameWork(allocationInput)
                : allocateStagedPromptToNewWork(allocationInput);
          }
          if (flags.json === true) {
            await writeStdoutFully(
				`${JSON.stringify(publicWorkPromptResolution(resolution), null, 2)}\n`,
			);
          } else {
            reportWorkPromptResolution(resolution);
          }
          return 0;
        }

        if (sub === "hook-user-prompt" || sub === "hook-post-tool-use") {
          let payload: unknown;
          try {
            const source = new TextDecoder("utf-8", { fatal: true }).decode(
              fs.readFileSync(0),
            );
            payload = JSON.parse(source);
          } catch {
            return 0;
          }
          const hookInput = {
            project_root:
              optionalWorkFlag(flags, "project-root") ?? process.cwd(),
            state_root: optionalWorkFlag(flags, "state-root"),
            client: workHookClient(flags),
            payload,
            now: workTimestamp(flags, false),
          };
          const result =
            sub === "hook-user-prompt"
              ? handleWorkUserPromptSubmit(hookInput)
              : handleWorkPostToolBoundary(hookInput);
          if (flags.json === true) {
            await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
          } else if (result.context) {
            await writeStdoutFully(`${result.context}\n`);
          }
          return 0;
        }

				if (sub === "review" || sub === "delegation") {
					const action = positional[1];
					if (sub === "review" && action !== "request" && action !== "record") {
						throw new Error("work review requires request or record");
					}
					if (
						sub === "delegation" &&
						action !== "assess" &&
						action !== "record" &&
						action !== "waive"
					) {
						throw new Error(
							"work delegation requires assess, record, or waive",
						);
					}
					const evidenceInput = workEvidenceMutationInput(flags);
					const result =
						sub === "review" && action === "request"
							? (() => {
									const gate = requiredWorkFlag(flags, "gate");
									if (gate !== "planning" && gate !== "completion") {
										throw new Error("--gate must be planning or completion");
									}
									return requestWorkReview({
										...evidenceInput,
										gate,
										activity_id: requiredWorkFlag(flags, "activity-id"),
									});
								})()
							: sub === "review"
								? recordWorkReview(evidenceInput)
								: action === "assess"
									? assessWorkDelegation(evidenceInput)
									: action === "record"
										? recordWorkDelegation(evidenceInput)
										: waiveWorkDelegation({
												...evidenceInput,
												...workEvidenceSource(
													flags,
													evidenceInput.project_root,
													evidenceInput.occurred_at,
												),
											});
					if (flags.json === true) {
						await writeStdoutFully(
							`${JSON.stringify(publicWorkExecutionMutation(result), null, 2)}\n`,
						);
					} else {
						reportWorkExecutionMutation(result);
					}
					return 0;
				}

				if (sub === "readiness") {
					const projectRoot =
						optionalWorkFlag(flags, "project-root") ?? process.cwd();
					const action = requiredWorkFlag(flags, "action");
					if (action !== "implementation-entry" && action !== "completion") {
						throw new Error(
							"--action must be implementation-entry or completion",
						);
					}
					const inputsPath = optionalWorkFlag(flags, "inputs");
					const parsed = inputsPath
						? parseSingleWorkDraft(
								fs.readFileSync(path.resolve(projectRoot, inputsPath)),
								workExecutionInputsSchema,
							)
						: undefined;
					const result = readinessWork({
						project_root: projectRoot,
						state_root: optionalWorkFlag(flags, "state-root"),
						work_id: requiredWorkFlag(flags, "work"),
						action:
							action === "implementation-entry"
								? "implementation_entry"
								: "completion",
						execution_inputs: parsed,
					});
					if (flags.json === true) {
						await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
					} else {
						console.log(
							`Work readiness: ${result.allowed ? "allowed" : "blocked"}`,
						);
						console.log(`  review: ${result.contextual_state.review}`);
						console.log(
							`  parallelism: ${result.contextual_state.parallelism}`,
						);
						for (const reason of result.reason_codes)
							console.log(`  reason: ${reason}`);
					}
					return result.allowed ? 0 : 1;
				}

        if (sub === "create" || sub === "amend" || sub === "transition") {
          const input = workMutationInput(flags, sub);
          const result =
            sub === "create"
              ? createWork(input)
              : sub === "amend"
                ? amendWork(input)
                : transitionWork(input);
          if (flags.json === true) {
            await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
          } else {
            reportWorkMutation(result);
          }
          return 0;
        }

        if (sub === "close") {
          const result = closeWork(workCloseInput(flags));
          if (flags.json === true) {
            await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
          } else {
            reportWorkMutation(result);
          }
          return 0;
        }

        const projectRoot =
          optionalWorkFlag(flags, "project-root") ?? process.cwd();
        const stateRoot = optionalWorkFlag(flags, "state-root");
        const workId = requiredWorkFlag(flags, "work");
        if (sub === "status") {
          const result = statusWork({
            project_root: projectRoot,
            state_root: stateRoot,
            work_id: workId,
          });
          if (flags.json === true) {
            await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
          } else {
            reportWorkStatus(result);
          }
          return 0;
        }

        const cursorId = requiredWorkFlag(flags, "session");
        if (sub === "brief") {
          const occurredAt = workTimestamp(flags, false);
          const result = briefWork({
            project_root: projectRoot,
            state_root: stateRoot,
            work_id: workId,
            cursor_id: cursorId,
            client_session_ref:
              optionalWorkFlag(flags, "client-session-ref") ?? null,
            occurred_at: occurredAt,
          });
          const json = flags.json === true;
          await deliverWorkBriefing({
            rendered: `${json ? JSON.stringify(result, null, 2) : formatWorkBrief(result)}\n`,
            direct_tty: process.stdout.isTTY === true,
            structured: json,
            write: writeStdoutFully,
            confirm: () => {
              confirmWorkBrief({
                project_root: projectRoot,
                state_root: stateRoot,
                work_id: workId,
                cursor_id: cursorId,
                delivery_token: result.delivery_token,
                confirmed_at: new Date().toISOString(),
              });
            },
          });
          return 0;
        }

        if (sub === "confirm") {
          const result = confirmWorkBrief({
            project_root: projectRoot,
            state_root: stateRoot,
            work_id: workId,
            cursor_id: cursorId,
            delivery_token: requiredWorkFlag(flags, "delivery-token"),
            confirmed_at: workTimestamp(flags, false),
          });
          if (flags.json === true) {
            await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
          } else {
            console.log(`Work briefing confirmed: ${result.delivery_token}`);
          }
          return 0;
        }

        const occurredAt = workTimestamp(flags, false);
        const result = switchWork(
          {
            project_root: projectRoot,
            state_root: stateRoot,
            work_id: workId,
            cursor_id: cursorId,
            client_session_ref:
              optionalWorkFlag(flags, "client-session-ref") ?? null,
            occurred_at: occurredAt,
          },
          {
            switchWork: (input) => {
              const truth = {
                work_id: input.work_id,
                revision: input.projection.contract_revision,
                last_event_id: input.projection.last_event_id,
                projection_hash: input.projection.projection_hash,
              };
              const read = readWorkCursor(
                input.state_root,
                input.cursor_id,
                undefined,
                input.worktree_fingerprint,
              );
              if (read.status === "corrupt") throw new Error(read.error);
              if (read.status === "switched") {
                throw new Error("Work cursor belongs to another worktree");
              }
              if (read.cursor) {
                switchWorkCursorAtomic(
                  input.state_root,
                  { ...read.cursor, updated_at: input.occurred_at },
                  truth,
                );
              } else {
                writeWorkCursorAtomic(
                  input.state_root,
                  newWorkCursor({
                    cursor_id: input.cursor_id,
                    client_session_ref: input.client_session_ref,
                    worktree_fingerprint: input.worktree_fingerprint,
                    updated_at: input.occurred_at,
                    truth,
                  }),
                  { expectedCursorRevision: null },
                );
              }
              const current = readWorkCursor(
                input.state_root,
                input.cursor_id,
                truth,
                input.worktree_fingerprint,
              );
              if (!current.cursor) throw new Error("Work cursor write failed");
              return {
                schema_version: "anamnesis.work-switch.v1" as const,
                work_id: input.work_id,
                cursor: current.cursor,
              };
            },
          },
        );
        if (flags.json === true) {
          await writeStdoutFully(`${JSON.stringify(result, null, 2)}\n`);
        } else {
          console.log(`Session ${cursorId} switched to Work ${workId}`);
        }
        return 0;
      } catch (error) {
        console.error(`error: ${(error as Error).message}`);
        return 1;
      }
    }

    case "context": {
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

    case "handoff": {
      const sub = positional[0];
      if (sub === undefined) {
        console.log(formatNamespaceHelp("handoff"));
        return 0;
      }
      if (sub !== "draft" && sub !== "close" && sub !== "deprecate") {
        console.error(
          `error: unknown 'handoff' subcommand: ${sub ?? "(none)"}`,
        );
        console.error(
          `usage: anamnesis handoff draft [--json] [--write] [--output=<path>]`,
        );
        console.error(
          `       anamnesis handoff close --archive=<path> [--apply] [--summary=<text>] [--reason=<text>]`,
        );
        console.error(
          `       anamnesis handoff deprecate --archive=<path> [--apply] [--superseded-by=<path>] [--summary=<text>] [--reason=<text>]`,
        );
        return 1;
      }
      try {
        if (sub === "draft") {
          const result = handoffDraft({
            projectRoot:
              (flags["project-root"] as string | undefined) ?? process.cwd(),
            write: flags["write"] === true,
            outputPath: flags["output"] as string | undefined,
          });
          if (flags["json"] === true) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            reportHandoffDraft(result);
          }
          return 0;
        }

        const result = handoffAction({
          projectRoot:
            (flags["project-root"] as string | undefined) ?? process.cwd(),
          mode: sub,
          archive: flags["archive"] as string | undefined,
          apply: flags["apply"] === true,
          summary: flags["summary"] as string | undefined,
          reason: flags["reason"] as string | undefined,
          supersededBy: flags["superseded-by"] as string | undefined,
        });
        if (flags["json"] === true) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          reportHandoffAction(result);
        }
        return 0;
      } catch (e) {
        if (e instanceof HandoffActionError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }
    }

    case "gc":
      try {
        const result = gc({
          projectRoot:
            (flags["project-root"] as string | undefined) ?? process.cwd(),
          dryRun: flags["dry-run"] === true,
          apply: flags["apply"] === true,
          maxCurrentAgeDays: parseGcPositiveIntegerFlag(
            flags["max-current-age-days"],
            "--max-current-age-days",
          ),
          maxCurrentHarnesses: parseGcPositiveIntegerFlag(
            flags["max-current-harnesses"],
            "--max-current-harnesses",
          ),
          maxReusableHarnesses: parseGcPositiveIntegerFlag(
            flags["max-reusable-harnesses"],
            "--max-reusable-harnesses",
          ),
          maxTotalBytes: parseGcPositiveIntegerFlag(
            flags["max-total-bytes"],
            "--max-total-bytes",
          ),
          maxWarmHandoffArchives: parseGcNonnegativeIntegerFlag(
            flags["max-warm-handoff-archives"],
            "--max-warm-handoff-archives",
          ),
          maxColdHandoffAgeDays: parseGcNonnegativeIntegerFlag(
            flags["max-cold-handoff-age-days"],
            "--max-cold-handoff-age-days",
          ),
          maxHandoffBytes: parseGcPositiveIntegerFlag(
            flags["max-handoff-bytes"],
            "--max-handoff-bytes",
          ),
        });
        if (flags["json"] === true) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          reportGc(result);
        }
        return 0;
      } catch (e) {
        if (e instanceof GcError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }

    case "benchmark": {
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

    case "migrate": {
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

    case "promote": {
      const source = (positional[0] as string | undefined) ?? "";
      const fragmentId = flags["as"] as string | undefined;
      if (!source) {
				console.error(
					"error: promote requires a source path positional argument.",
				);
        console.error(
          "usage: anamnesis promote <source> --as=<fragment-id> [--type=<capability>]",
        );
        return 1;
      }
      if (!fragmentId) {
        console.error("error: promote requires --as=<fragment-id>");
        return 1;
      }
      try {
        const result = promote({
          projectRoot:
            (flags["project-root"] as string | undefined) ?? process.cwd(),
          libraryRoot:
            (flags["library"] as string | undefined) ?? resolveLibraryRoot(),
          source,
          fragmentId,
          capabilityType: flags["type"] as PromotableType | undefined,
          name: flags["name"] as string | undefined,
          region: flags["region"] as string | undefined,
          description: flags["description"] as string | undefined,
        });
        reportPromote(result);
        return 0;
      } catch (e) {
        if (e instanceof PromoteError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }
    }

    case "ontology": {
      const sub = positional[0];
      if (sub !== "bootstrap") {
        console.error(
          `error: unknown 'ontology' subcommand: ${sub ?? "(none)"}`,
        );
        console.error(
          `usage: anamnesis ontology bootstrap [--scope=<path>] [--fragment=<id>] [--dry-run]`,
        );
        return 1;
      }
      try {
        const result = bootstrap({
          projectRoot:
            (flags["project-root"] as string | undefined) ?? process.cwd(),
          scope: flags["scope"] as string | undefined,
          fragment: flags["fragment"] as string | undefined,
          dryRun: flags["dry-run"] === true,
        });
        reportBootstrap(result);
        return 0;
      } catch (e) {
        if (e instanceof OntologyBootstrapError) {
          console.error(`error: ${e.message}`);
          return 1;
        }
        throw e;
      }
    }

    default:
      console.error(`unknown command: ${command}`);
      console.error(`run 'anamnesis --help' for usage.`);
      return 1;
  }
}

function migrateJson(result: MigrateAgentfileResult): object {
  return {
    agentfilePath: result.agentfilePath,
    currentVersion: result.currentVersion,
    targetVersion: result.targetVersion,
    applied: result.applied,
    changed: result.changed,
    migrations: result.migrations,
    backupPath: result.backupPath,
    nextCommand: result.nextCommand,
  };
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
