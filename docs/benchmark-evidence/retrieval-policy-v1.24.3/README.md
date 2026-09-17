# Retrieval policy A/B pilot: 1.24.2 vs 1.24.3

Date: 2026-09-17. Model: `gpt-6-astra`, reasoning effort `high`. Three scenarios × two repetitions × two policies = 12 fresh Codex executions.

This measures the baseline AGENTS instruction change, using the exact version-tagged `base/content/agents.snippet.md` files. The installed retrieval engine is held constant at 1.24.3. It is not a full package-version comparison or native SessionStart-hook benchmark.

## Results

Averages per run. Total tokens = reported input + output, including cached input. `Shell calls` excludes native patch calls and is not total tool calls.

| Scenario | Success old → new | Query calls old → new | Shell calls old → new | Tokens old → new | Token delta | Seconds old → new |
| --- | --- | --- | --- | --- | --- | --- |
| known-read | 2/2 → 2/2 | 0 → 0 | 1 → 1 | 33,820 → 34,042 | +0.66% | 14.50 → 15.12 |
| known-edit | 2/2 → 2/2 | 1 → 0 | 3.5 → 3 | 72,407 → 71,775 | -0.87% | 26.48 → 26.34 |
| missing-evidence | 2/2 → 2/2 | 1 → 1 | 4 → 5 | 91,578 → 111,020 | +21.23% | 32.94 → 58.60 |

## Interpretation

All 12 runs passed task correctness and original-source observation. Both policies read the original source once in each run, so this fixture shows no duplicate-read reduction.

For known edit paths, query calls fell from 1 to 0 in both repetitions, while total tokens fell only 0.87% and elapsed time was effectively unchanged (26.49 to 26.34 seconds). This supports the narrower unnecessary-query-removal claim.

For missing evidence, both versions queried once and read the current source. New-policy runs used 5 shell calls versus 4: the old policy batched retrieval with initial inspection, while the new policy inspected the stale pointer and queried in separate calls. Both repetitions show this difference. Total tokens increased 21.23%, while mean uncached input increased only 1.63% (20,151 to 20,480). These are different metrics and neither is a billing estimate. New elapsed times were 83.28 and 33.93 seconds, versus old 33.59 and 32.28 seconds; the large timing outlier must not be generalized.

Recommendation: retain the evidence-quality safeguards, but do not describe 1.24.3 as a general token/latency improvement. Before another optimization, add more repetitions and complex cases, and test whether already-explicit stale evidence can trigger retrieval in the initial independent batch. Separately measure native startup/handoff duplicate reads; this pilot does not test them.

## Scoring and controls

- Pass requires correct final JSON and actual config contents, preserved retry setting, unchanged policy/source document, a successful Codex process, and original source content observed in a completed shell output. The model does not self-score.
- Source-read detection excludes commands containing `anamnesis context query`, because query snippets are not original evidence. It establishes source observation during the run, not a strict read-before-edit ordering proof.
- The missing-evidence case begins with an explicitly obsolete pointer. The actual current policy must be located and read. Query counts are shown separately from task correctness.
- Each run receives an isolated synthetic fixture and isolated CODEX_HOME with auth linked from the active account. User config, global instructions, MCP configuration, and native hooks are not loaded. No production project is changed.
- Baseline order is old/new in repetition 1 and new/old in repetition 2. At most two scenarios run concurrently. Cache state is uncontrolled; cached and uncached input are recorded separately.

## Limits

- Two repetitions per scenario are a pilot, not statistical evidence of general performance improvement. No confidence interval or paid-cost estimate is asserted.
- Fixtures are small and prompts identify the expected task. Large repositories, ambiguous requirements, real handoffs, duplicate startup execution, multiple turns, compaction, and Claude/Cursor are not measured.
- Shell-call and source-output occurrence counts are operational proxies. A command may batch multiple file reads; native patch calls are not counted.
- Timing includes network/backend variability and concurrent execution. Warm cache differences prevent interpreting total-token deltas as billing savings.
- The model can vary its command batching even when the policy-induced query difference is stable. Treat quality and query behavior separately from token/latency claims.

## Reproduce

Run from this checkout, with both version tags present and Anamnesis 1.24.3 installed:

```bash
ANAMNESIS_BENCHMARK_OUTPUT=/private/tmp/anamnesis-policy-benchmark-new python3 docs/benchmark-evidence/retrieval-policy-v1.24.3/run.py
```

The runner uses the active Codex account and runs 12 model invocations; each is capped at 180 seconds. Use a fresh output directory. `ANAMNESIS_BENCHMARK_REPO` optionally overrides the repository path.

Evidence: [manifest.json](manifest.json), [results.json](results.json), [summary.json](summary.json), [run.py](run.py).
