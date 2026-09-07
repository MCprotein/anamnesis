# Astra instruction delivery: measured optimization loop

The frozen V6 candidate passed the predeclared token/time gates on all 66 executions (18 development, 48 fresh reserved). Median paired tokens fell 26.7% on development and 18.2% on reserved tasks. Elapsed time fell 2.3% on development but rose 1.8% on reserved tasks. This establishes bounded token savings, **not a general speedup**.

Baseline is PR #7 revision `07f2531`; candidate product is `4c0853b`. Both arms use anamnesis. This is not an anamnesis on/off comparison. Codex 0.153.4, GPT-6 Astra/high, identical tools, three counterbalanced repetitions per task. Work prompt capture and Stop reminders are disabled in both primary arms; experimental context management is off. Account-authenticated Codex executions are used. Review/fixture-author usage is excluded from scored metrics.

Acceptance was frozen before execution: every correctness/state/mutation check valid, median paired total-token ratio <=0.90 and elapsed ratio <=1.05 in development and reserved separately. Ratios compare candidate/baseline for each pair; they are not ratios of aggregate totals. All 66 original samples are retained. Raw response usage includes controlled compaction; cumulative/cache fields remain separately available in results.json. Cache observations do not prove control of model reasoning or cache policy.

## Revisions and failed experiments

| Revision | Scope | Token ratio | Time ratio | Outcome |
|---|---|---:|---:|---|
| V1 | lookup development | .9241 | 1.1326 | failed |
| V2 | development | .7848 | 1.0020 | aggregate pass; orientation slowdown, revised |
| V3 | development | .7930 | .7885 | passed |
| V3 | reserved | .8067 | 1.0903 | failed; reserved set retired |
| V4 | lookup development | 1.1895 | 1.6647 | failed; 10 completed and one interrupted execution retained |
| V5 | development | .8170 | .9791 | aggregate pass; lookup/orientation slowdowns, revised |
| V6 | development | .7330 | .9773 | passed |
| V6 | fresh reserved | .8177 | 1.0177 | passed |

V4's first attempt executed zero model calls: shared Vitest bookkeeping changed a source lock. Only that non-executable cache was subsequently excluded; executable dependencies remain pinned. The interrupted V4 sample was not retried or counted as complete. Original incorrect path-based diagnostic audits are retained alongside the canonical-path audit, not reclassified as product failures.

## Per-task results

Each row has three pairs; a ratio over 1 means worse. Small samples and service latency variation limit generalization. These slowdowns remain reported even though aggregate gates pass.

| Task | Median token ratio | Median time ratio |
|---|---:|---:|
| lookup | 0.5416 | 0.6798 |
| orientation | 0.5438 | 0.7817 |
| handoff | 0.7452 | 1.1047 |
| fresh_gallery_caption | 0.8167 | 1.0381 |
| fresh_reservation_decision | 0.6116 | 0.7813 |
| fresh_find_return_route | 0.6649 | 0.7908 |
| fresh_nested_secure_queue | 0.8241 | 1.0708 |
| fresh_config_retry_policy | 0.6951 | 0.9419 |
| fresh_auxiliary_handoff_selection | 0.9652 | 1.1362 |
| fresh_delayed_filter_revision | 0.8211 | 1.0911 |
| fresh_compaction_packlist_retention | 0.8256 | 1.0437 |

## Secondary observations

Across the same primary executions, tool calls fell from 33 to 23 on development and from 83 to 66 on reserved tasks. These are descriptive totals, not separately preregistered acceptance gates. All 60 distinct non-final assistant messages were read after measurement; none asked the user for clarification/permission or paused awaiting an answer. Structured final answers were validated for every turn. Unnecessary-question count is therefore zero in both arms for these bounded tasks; no improvement on that metric is demonstrated.

Cached input totals were 793,088 → 561,408 (development) and 2,145,152 → 1,599,872 (reserved), alongside reduced total input. Lower absolute cached tokens alone do not indicate worse caching. Individual raw/cumulative usage fields are retained in results.json; no cache-control causal claim is made.

## Evaluation correction disclosed

The original frozen grader incorrectly required exactly two normal turns around compaction. The fresh task intentionally has three: initial requirements, side question after compaction, and original completion. It rejected six otherwise completed executions. The unchanged original runner executed all 48 reserved samples once. The correction inserts the single compaction at the task's declared position among **all** normal turns; it does not change prompts, expected answers, quality checks, token accounting, thresholds or product source.

The original pre-measurement manifest and failed audit are preserved. A separate post-measurement corrected manifest pins that original manifest and execution evaluator, requires unchanged measurement identities/protocol/chronology, and records its later creation. Execution still rejects changed harnesses; historical harness selection is audit-only. The corrected auditor validated all 66 original executions. Local negative tests cover reordered/duplicate compaction and tampered historical execution artifacts. Independent Astra review found one report-overwrite defect; exclusive corrected-report creation and byte-preservation checks fixed it. A separate Astra follow-up returned CLEAR. Product review and linked-evidence directory checks were independently reviewed earlier; review is not a substitute for measurement.

## Overfitting and scope

V6 was selected using unchanged development tasks. A separate Astra agent authored eight fresh reserved tasks after product freeze, without previous task results. The leader inspected task content and deterministic oracles before execution: outcome-unseen, **not content-blind**. Earlier reserved tasks were retired. No reserved failures were replaced and no product tuning followed these fresh outcomes. Repeated candidate selection and synthetic tasks remain limitations; this is not a confidence interval or a guarantee for arbitrary repositories.

Default Work/Stop compatibility is a separate three-case semantic check, not a timing comparison or full eight-case benchmark. Its status must be reported separately. Unit-test counts, static instruction bytes and cleanup timings are not runtime model gains. Claude Code/Cursor and required permission/state/source guards retain their contracts.

## Reproduction and evidence

Use `scripts/benchmarks/instruction_efficiency.py` to freeze source/runtime/fixtures before `run`; never edit a frozen plan. `instruction_efficiency_linked.py` validates original development and fresh reserved evidence with distinct pinned evaluators. See each script's `--help`. `results.json` contains all scored sample metrics and pair calculations; the original local raw artifacts are in `/tmp/anamnesis-efficiency-loop-20260907/`, including rejected/partial variants, frozen manifests, evaluator snapshots, raw events and source locks. Authentication files and raw home directories are intentionally not published.
