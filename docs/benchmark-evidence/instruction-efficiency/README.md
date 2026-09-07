# Instruction audit and test efficiency

Baseline: `f5d2a145f182b079a0b9fdd0e97391a543764ea4` (v1.23.6).
The candidate adds the explicit [instruction audit](../../INSTRUCTION-AUDIT.md)
and simplifies tests without changing production benchmark behavior.

The baseline inventory contains **106 TypeScript test files and two Python test
files**. [test-inventory.json](test-inventory.json) records every baseline path and
hash. No separate Node release-runner test file exists at this revision. Passing
Vitest does not validate release behavior or live model performance by itself.

## Changes and retained witnesses

| Change | Coverage retained |
| --- | --- |
| Remove six adapter registration/coexistence tests from three adapter `index.test.ts` files | `adapters/parity.test.ts` registers all three together and checks every adapter/capability. Public renderer array/type checks and duplicate-registration rejection stay. |
| Consolidate two identical reviewer-repair benchmark cases | The surviving case retains product success, non-exclusion, both condition passes, final accuracy, reviewer correctness and the transferred `process_perfect_pct` assertion. `repairFinal` affected an unreachable fake model stage; unknown stages now throw. Real child-overlap timers/assertions stay. |
| Call the existing publisher directly in three publication-fault tests | Every injected rename failure and rollback/recovery-file assertion stays. Successful end-to-end publication and invalid-destination integration tests still run the complete benchmark. |
| Add five focused audit tests plus one piped CLI test | Mixed ownership, drift, duplicate evidence, compatibility candidates, malformed/missing metadata, bounded reads, symlink/nonregular inputs, >64 KiB JSON output, rejected write intent and preserved user files. |

The net count is **1,281 → 1,280**, not a removal quota. Most tests protect distinct
contracts. Lock reclamation, privacy, concurrent 64-call fanout, native recovery,
malformed protocol/usage, source authority, release eligibility and fallback
compatibility tests remain. Test count is a poor proxy for cost: removing repeated
fixture generation produced most of the observed benefit.

## Measured results

Raw totals and artifact hashes are in [results.json](results.json).

| Measurement | Baseline | Candidate |
| --- | ---: | ---: |
| Full Vitest run, unchanged default workers | 80.552 s | 68.690 s |
| Full run passed/failed | 1,281 / 0 | 1,280 / 0 |
| Work-agent benchmark tests, first focused run (one worker) | 35.640 s | 11.836 s |
| Work-agent benchmark tests, second focused run (one worker) | 50.474 s | 20.053 s |

The focused execution order was A1, B1, B2, A2; each ran the same 12 tests.
The three changed publication-fault cases took approximately 7–8 seconds each
in A1 and about 2 milliseconds each in B1, because they no longer rebuild all
fake benchmark scenarios. No assertion or production repetition minimum was
weakened to obtain that result.

The full-suite timing precedes the final missing-root-file registration correction.
That final predicate and its updated missing-file regression passed all five audit
tests; lint, typecheck and build passed again. The earlier large piped JSON CLI
regression also passed. No timing sample was replaced after this correction.

The whole-suite observation is about **14.7% faster**; it is one execution per
condition, not a confidence interval or portable guarantee. Background host load
and read-only review activity were not controlled. B2 also overlapped a single
0.5-second CLI smoke check at startup, contrary to the exclusive-execution plan.
All four results remain reported; no rerun was substituted for a slower sample.
Parallel file durations must not be summed into a wall-clock saving.

Lint, typecheck, build and four Python transport/auditor tests passed. The Python
checks use fake local processes and data; they do not call a model.

## Claims deliberately not made

This change does not demonstrate reduced Astra input/output tokens, cache losses,
model latency, improved model accuracy or benefits on unseen projects. No new
model benchmark was run. The new command reports physical bytes and candidates;
it does not automatically shorten instructions or inject new per-prompt work.
Real instruction changes require a separate matched, held-out behavior and usage
comparison as described in the audit guide.

Test cleanup was selected from structural redundancy and retained behavioral
witnesses, not from relaxing tests that happened to fail. The fake benchmark tasks
remain developer-visible test fixtures, not a model evaluation holdout.

## Independent review

Actual native GPT-6 Astra `code-reviewer` children reviewed the implementation and
test removals. The first review found stdout-draining, missing-file completeness
and changelog-heading issues. The next found the missing registered root-file
case. All were fixed, and the same final reviewer rechecked the last two-file delta
and returned **CLEAR**. No review was claimed from a prompt-only role/model label.

Reviewer threads: `01a07a51-fd6a-7bb1-9171-5ff94b0034e7` and
`01a07a57-fb05-75d0-b710-c1b8f4faa105`; native session metadata and turn contexts
confirmed `code-reviewer` and `gpt-6-astra`. Reviews were static; the leader ran the
reported tests.
