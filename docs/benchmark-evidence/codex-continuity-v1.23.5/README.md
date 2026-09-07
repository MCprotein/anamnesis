# Codex continuity: targeted release evidence

This evaluation tests concrete continuity defects; it does not establish that
anamnesis makes Astra generally faster, cheaper or more accurate. The previous
PR head could compute updated answers but could not reliably allocate a second
prompt delivered within the same Codex turn. The candidate separates prompt
capture deliveries while preserving the actual turn/session accounting identity.

## Results

All eight scheduled runs completed; no execution errors, usage conflicts or
mechanical evidence gaps were found. Each run includes one actual compaction
and a new independent thread. Candidate 3/3 and OFF 3/3 satisfy numeric submission
rules; the two baseline runs fail at same-turn prompt capture. Candidate keeps
updated requirements in the same Work, answers 45 without resubmitting, and
retains cancellation until explicit resume. These runs do not prove native Work
context injection: their selected cursors lacked native session references, and
compact hook outputs contained no Work section. Recovery used available
conversation/files and later reads. Independent review caught this normal-selection
defect; a subsequent binding fix needs its own frozen evidence. No premature or duplicate submission
was observed. Baseline computed the correct numbers but asked for resending the
updated instruction, leaving the task unsubmitted.

| Case / arm | Submission | Capture failures | Commands | Tokens incl. compaction | Elapsed seconds |
|---|---|---:|---:|---:|---:|
| cancel-candidate | 12 once (resume) | 0 | 33 | 1,082,459 | 400.47 |
| cancel-off | 12 once (resume) | 0 | 13 | 361,638 | 195.90 |
| maximum-baseline | none | 1 | 21 | 850,331 | 271.19 |
| maximum-candidate | -3 once (first) | 0 | 23 | 944,004 | 329.52 |
| maximum-off | -3 once (first) | 0 | 10 | 268,180 | 137.65 |
| sum-baseline | none | 1 | 20 | 846,457 | 275.90 |
| sum-candidate | 9 once (first) | 0 | 22 | 968,634 | 359.11 |
| sum-off | 9 once (first) | 0 | 10 | 220,805 | 132.17 |

Candidate total workflow tokens and elapsed time exceed OFF in every paired case.
There is no demonstrated savings or accuracy advantage over OFF on these small
tasks. The supported improvement is recovery from an identified anamnesis failure,
plus maintained Work requirements and history, not universal superiority.

[Machine-readable results](results.json) include cached/uncached input, output,
reasoning counters, compaction overhead, failed commands, hook occurrences and
actual model provenance. [Frozen protocol](FINAL-PROTOCOL.md) records the criteria.
Raw event/result logs remain private local artifacts; result hashes enable matching
those originals. This repository copy contains no account credentials.

All candidate Work lifecycles remain open; verified requirement counts do not mean
the evaluator or adapter auto-closed the task. Some persistence requirements were
marked verified when TASK.md was written, before later recovery probes; the host
then independently observed successful recovery. Such early self-reported progress
is not used as standalone proof of future behavior or automatic completion.

## Reproduction

Use a Git checkout, Python 3, Node, Git, an authenticated Codex CLI and two built
anamnesis checkouts with dependencies installed. This consumes Codex account
usage. It does not use API keys, choose a cheaper fallback or estimate currency
charges. Do not commit the output directory, isolated authentication symlinks or
raw synthetic session logs.

```sh
python3 scripts/benchmarks/codex_continuity.py \
  --candidate /path/to/built-candidate \
  --baseline /path/to/built-baseline \
  --output /tmp/new-private-continuity-run
python3 scripts/benchmarks/codex_continuity_audit.py \
  --output /tmp/new-private-continuity-run
```

The runner refuses an existing output directory, records source/build/fragment/rulebook/dependency and harness identities plus
Codex version before execution, rechecks them before and after each case, uses eight fixed runs, and preserves failures.
The portable runner isolates both CODEX_HOME and ANAMNESIS_STATE_HOME. The original
measurement runner isolated CODEX_HOME but accidentally registered its temporary
init fixtures in the user project registry; only those owned registrations were
removed afterward (seven entries; all unrelated registry entries unchanged). This harness correction does not change product code or model
inputs; it was not used to replace failed model runs.

The auditor checks the exact eight-case set, successful required turns, actual
compaction and two threads, Astra/high provenance, positive usage evidence, numeric
submissions and accounting mechanically. A passing
exit status is not proof of all semantic requirements: independently inspect the
saved answers, event ordering, Work projection and TASK.md for requirement
retention, cancellation, side questions and unsupported verified progress.

## Frozen scope and controls

- Codex 0.153.4; actual GPT-6 Astra, high reasoning, fallback disabled.
- Eight sequential runs: sum baseline/candidate/off, maximum off/candidate/baseline,
  then cancellation candidate/off. Same rows, dynamic tools and user updates.
- Baseline: PR commit `432f7fe2d9d0a083f139a188632e915aeb363fdd`, with only missing
  raw-prompt Git exclusions manually repaired to isolate the steering defect.
  This is not a comparison against the unmodified published 1.23.4 package.
- Candidate production source matches commit
  `71230ee2a6d0f9482c115c926dd0de3251fa9011`; generated adapters use normal all-tool init.
  Later release metadata, report and portable runner changes are outside product code.
- OFF installs no anamnesis. All arms receive TASK.md persistence instructions;
  Work creation/maintenance occurs only in ON arms, so cost measures the whole
  workflow, not an isolated model inference.
- A pending tool receives an acknowledged mid-turn correction before returning
  obsolete instructions. Sum oracle: 9. All-negative approved maximum: -3.
  Cancellation allows no submission before explicit resume; resumed sum: 12.
- Actual compaction, a side question (28 + 17 = 45), and a fresh independent thread
  follow. No extra result submission or new task is allowed.
- Experimental context management is disabled as a separate controlled setting.
  No enabled/disabled experimental comparison was run.
- Full-access isolated synthetic fixtures. A separate workspace-write pilot failed
  because the sandbox denied `ps`, required by existing lock-owner checks. That
  limitation remains; ownership guards were not weakened to make the run pass.

## Metrics

Primary token totals sum unique `rawResponse/completed` response IDs, including
compaction and the fresh thread. For this Codex version, final per-thread token
counters omit compaction; both series are retained and reconciled. Conflicting
usage on a repeated response ID is an audit failure. Cached input is observed
usage, not a causal claim that anamnesis preserves or improves cache hits.

Hook completion occurrences are counted individually: hook run IDs can repeat
across deliveries and cannot identify unique messages. Command items are counted
by item ID. Elapsed time spans the workflow including tools, compaction and fresh
thread; it is not pure model execution time. Currency charges and actual account
billing were not available. Baseline early failure makes its cost incomparable to
candidate successful completion as a performance claim.

## Review and regression evidence

- 1,250 tests across 105 files passed on final product code; build and lint passed.
- A separate actual-Git differential check exercised 512 rule combinations:
  194 accepted, 318 rejected, zero observed false acceptances. This is bounded
  adversarial evidence, not an exhaustive proof.
- Native Astra reviewers found real privacy counterexamples in earlier versions.
  Their failures were preserved and fixed. Final privacy review returned CLEAR
  for guard SHA256
  `3001029ae639675ab2c124ad282ded5d477743bd6083dd285cef6ee3687c4468`.
  Actual child identity: `01a079ce-9829-73c2-aedd-a556d19505ff`, native role
  `code-reviewer`; parent `01a079ce-53cc-78f2-96f8-7d48c32ef4b8`.
- The portable transport additionally fails on malformed records and unexpected
  EOF, retains diagnostics, and bounds cleanup to its owned process group. Four
  free local tests, including an auditor fault-injection matrix, cover malformed data, EOF/already-exited cleanup
  and a process that ignores graceful termination. The original live run used
  the earlier transport, so this hardening is validated locally, not credited as
  a measured product improvement.
- Engineering pilots are excluded from the score. Final v1 was interrupted before
  candidate execution when review found a defect; v2 was never executed. Final v3
  froze the repaired source before all eight measurements. No retry-until-pass.

## Limits and overfitting controls

These small tasks were visible to the author, not independently blinded holdouts.
The negative-only maximum and explicit cancellation probe different behavior
from the initial sum pilot, but are insufficient for statistical generalization.
No task-specific numeric branch or model-name branch was added to product code.

The demonstrated fixes in this eight-run snapshot concern safe initialization
and native steering capture. Native Work compact injection is not established
by these results.
They do not activate async tools, change reasoning levels, control prompt caching,
or replace Codex memory. Claude Code and Cursor have deterministic adapter tests,
not new live end-to-end measurements here. OMX runtime hooks are not included.

Exactly-once transport delivery is not promised when Codex supplies no message ID:
identical deliveries receive separate opaque captures, with no automatic Work
allocation or progress mutation. Selected and allocated Work can be restored after
compaction; pending unallocated prompts are not promised a pre-compaction flush.
Boundary deduplication remains a bounded recent window. Tool completion is not
proof of task completion. Stop reminder replies can still add reporting overhead.

## Native session binding follow-up

The later [three-run native binding proof](NATIVE-BINDING.md) verifies the final
connection fix independently of the earlier eight-run measurements. Do not attribute
its native injection result to the older source measured above.
