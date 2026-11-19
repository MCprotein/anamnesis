import {
	formatCompactHelp,
	formatGettingStartedGuide,
} from "../core/cli_guide.js";
import { PACKAGE_VERSION } from "../core/version.js";

export const VERSION = PACKAGE_VERSION;

export function printWorkHelp(): void {
  console.log(`anamnesis work — exact requirements and durable progress

Read-only:
  anamnesis work status --work <id> --json
  anamnesis work --help

For a hook-staged prompt, use its opaque token. Do not read or copy staged
bytes. The token locates this prompt; it does not authorize a Work or action.
Write a draft based on the user's actual requirements, using this strict shape:

\`\`\`yaml
work:
  title: Replace with the task title
  completion_contract: Replace with observable completion criteria
boundary:
  state: accepted
  classification: new_unit
  reason_codes: [explicit_user_requirement]
  confidence: high
requirements:
  - id: r1
    summary: Replace with one exact requirement
    source_event_ids: ["@staged"]
open_conflicts: []
\`\`\`

New Work:
  anamnesis work prompt allocate-new --stage <token> --work <new-id> --draft <file>

Same Work: first read status. Preserve EVERY previous requirement, including
superseded ones, with unchanged id, summary, weight and supersedes fields.
Preserve existing source_event_ids; append @staged only where supported.
For a changed requirement, keep the old definition and append a new one:
  - id: r2
    summary: The newly requested replacement requirement
    source_event_ids: ["@staged"]
    supersedes: [r1]
Do not remove r1, rewrite its summary, or use superseded_by. Unrelated new
requirements are appended without supersedes; unchanged requirements stay intact.
Use classification: same_unit, and supply the exact current authority from status:
  anamnesis work prompt allocate-same --stage <token> --work <id> --draft <file>
    --expected-head <ledger_head> --expected-contract-revision <contract_revision>
    --expected-contract-hash <contract_hash>
(The wrapped command above must be submitted as one command.)

Allocation and session linkage are separate. Use only the exact session cursor
ID supplied by the current hook when explicitly selecting this Work.
For Codex native compact recovery, also carry its exact raw session reference:
  anamnesis work switch --work <id> --session '<cursor-id>' --client-session-ref '<native-session-id>'
Copy the hook's shell-quoted command; these IDs are locators, not Work authority.
For an existing null-reference cursor, explicitly select the intended Work and
rerun that command to bind it. A different nonnull reference is rejected.
Claude session selection may omit --client-session-ref.

Questions or interruptions that do not change requirements:
  anamnesis work prompt discard --stage <token> --reason non_requirement
Use reason interruption for an interruption. Discard is not cancellation of a
Work lifecycle and does not authorize resuming cancelled work.

Unclear boundary: use prompt retain, with a draft containing only boundary and
question. boundary fields: state (needs_user or provisional), classification
(same_unit or new_unit), reason_codes (nonempty list), confidence (low or medium).
  anamnesis work prompt retain --stage <token> --draft <file>

Progress: a transition draft contains requirement_id, status and evidence_refs.
Verified requires real evidence; tool completion alone is not verification.
  anamnesis work transition --work <id> --event-id <unique-id> --occurred-at <ISO>
    --expected-head <ledger_head> --draft <file>

Use anamnesis --help --all for other Work commands and source-input flags.
`);
}

export function printHelp(full = false): void {
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
  context audit-instructions    Read-only instruction ownership and duplication audit.
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
  --verbose                     Show fragments, hashes, evidence, and detailed
                                  diagnostic context

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

export function printGettingStartedGuide(): void {
  console.log(formatGettingStartedGuide(VERSION));
}
