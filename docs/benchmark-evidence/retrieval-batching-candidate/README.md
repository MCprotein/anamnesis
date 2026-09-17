# Retrieval batching candidate: measured instruction optimization

Compared with released 1.24.3 using GPT-6 Astra, high effort, 2026-09-17. Main cohort: 3 scenarios × 3 repetitions × 2 policies = 18 executions. Separately defined missing-path holdout: 2 repetitions × 2 policies = 4 executions. All 22 executions passed.

## Results

Means per execution. Total tokens include cached input, plus output; these are not billing savings. Shell commands exclude native patches and do not equal model round trips.

| Scenario | Success control → candidate | Queries | Shell commands | Total tokens | Token delta | Uncached input delta | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| known-read | 3/3 → 3/3 | 0.00 → 0.00 | 1.00 → 1.67 | 35,212 → 35,002 | -0.60% | +64.56% | 13.97 → 14.94 |
| known-edit | 3/3 → 3/3 | 0.00 → 0.00 | 3.00 → 2.33 | 73,519 → 53,069 | -27.82% | -8.65% | 32.07 → 23.87 |
| missing-evidence | 3/3 → 3/3 | 1.00 → 1.00 | 5.00 → 4.00 | 113,702 → 72,335 | -36.38% | -57.10% | 33.50 → 31.75 |
| missing-path | 2/2 → 2/2 | 1.00 → 1.00 | 4.50 → 4.00 | 98,866 → 99,232 | +0.37% | -29.77% | 35.27 → 36.67 |

## Interpretation

The candidate removes preliminary repository enumeration and rereading the same loaded AGENTS.md when paths are known. When the request/current evidence already establishes a retrieval need, the query joins independent startup checks; reading newly returned originals still follows the query result. Required ontology/handoff checks, source evidence, and edit constraints remain.

Compare shell-command records in results.json: the expensive control runs list files and reread AGENTS.md before opening originals. Candidate runs go directly to required originals/startup checks and keep necessary queries in the missing-evidence and missing-path cases. Some independent shell commands run in one model turn, so shell-count reductions and token reductions need not match.

The candidate reduced total tokens in all three paired known-edit runs (mean -27.82%) and all three paired missing-evidence runs (mean -36.38%). Simple reads were approximately unchanged (-0.60%, only one of three pairs lower); missing-path holdout was also approximately unchanged (+0.37%, one of two pairs lower). Cache variation is large: simple-read uncached input increased 64.56%, so the total-token result must not be called a cost reduction. The candidate is adopted for the measured reduction in redundant discovery, with wider and native-hook validation still outstanding.

Every run observes the original source once. This supports no source-read regression, but does not establish duplicate startup reduction. The holdout starts with a nonexistent path and requires recovery to an actual current document; its evidence is reported separately.

## Method and limits

- Exact control and candidate policy snapshots and SHA-256 hashes are included. The retrieval engine stays at installed 1.24.3. This isolates shared AGENTS policy, not an end-to-end package or native hook comparison.
- Same prompts/fixtures/model/reasoning per pair, fresh independent sessions, alternating order (control first in rounds 1/3, candidate first in round 2).
- Automated scoring checks JSON answer, actual edited config, preserved retries, unchanged source and policy, successful process, and source body in completed non-query shell output. Query snippets do not count as original source. No self-reported success is used.
- The source-observation scorer does not prove exact read-before-edit ordering. Real hooks, multiple turns, compaction, large repositories, unrelated projects, and Claude/Cursor runtime behavior are not measured.
- Main scenarios have only 3 pairs; holdout has 2. This is controlled pilot evidence, not a broad guarantee or statistical claim. No failures or slow runs are removed.
- Caches are uncontrolled, and the main/holdout cohorts partly overlap (up to 3 concurrent invocations). Use timings descriptively; do not infer billing savings from cached total tokens.
- Artifact key `tool_calls` means completed shell command executions, not all tools or model turns. Individual command output occurrences are not a full filesystem audit.

## Reproduce

Requires Codex CLI access with the active account and Anamnesis 1.24.3 on PATH. Runners use isolated temporary CODEX_HOME with an auth symlink; user configuration/MCP/native project hooks are not loaded. Fixture writes remain local. Each invocation has a 180-second deadline. Output directories must be new.

```bash
ANAMNESIS_BENCHMARK_OUTPUT=/private/tmp/batching-main-new python3 docs/benchmark-evidence/retrieval-batching-candidate/run-main.py
ANAMNESIS_BENCHMARK_OUTPUT=/private/tmp/batching-holdout-new python3 docs/benchmark-evidence/retrieval-batching-candidate/run-holdout.py
```

The scripts perform 18 and 4 real model calls respectively and save JSON results.

Artifacts: [results.json](results.json), [summary.json](summary.json), [manifest.json](manifest.json), [policy-1.24.3.md](policy-1.24.3.md), [policy-candidate.md](policy-candidate.md), [run-main.py](run-main.py), [run-holdout.py](run-holdout.py).
