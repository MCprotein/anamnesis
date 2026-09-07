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

Use `scripts/benchmarks/instruction_efficiency.py` to freeze source/runtime/fixtures before `run`; never edit a frozen plan. The exact fresh task definitions and oracles are in `reserved-tasks.json`; pass that file to `freeze --suite reserved --holdout <path>`. These tasks are now public and must not be treated as unseen holdout for future tuning. `instruction_efficiency_linked.py` validates original development and fresh reserved evidence with distinct pinned evaluators. See each script's `--help`. `results.json` contains all scored sample metrics and pair calculations; the original local raw artifacts are in `/tmp/anamnesis-efficiency-loop-20260907/`, including rejected/partial variants, frozen manifests, evaluator snapshots, raw events and source locks. Authentication files and raw home directories are intentionally not published.

## Default Work compatibility: semantic failure retained

The separate three-case check passed its numeric/transport checks: sum baseline/candidate submitted9 once; cancelled candidate submitted nothing until explicit resumption, then12 once. Both sum cases preserved requirements and verified Work progress across compaction and fresh threads. However, the resumed cancellation case left all3 applicable Work requirements pending despite successful submission and completed TASK.md. The fresh session correctly exposed the discrepancy. This was a **semantic failure and release blocker**, not a successful full-stack validation. The original failure is retained; the V7/V8 follow-up below addresses it. The V6 primary efficiency result remains valid only for its frozen scope.

## V7 Work repair: correctness passed, costs increased

Four new matched runs (V6/V7 then V7/V6) passed submission, evidence-backed progress and read-only Work-ledger checks; manual answers also retained cancellation through compaction, answered45, resumed once with12 and restored the latest rule in a fresh thread. Both V6 controls passed too: the earlier V6 omission is intermittent, and2/2 V7 passes do not establish elimination. Final requirement counts vary by model decomposition and are recorded in work-completion-v7.json.

Paired median V7/V6 total-token ratio1.0358 and elapsed ratio1.0668 show no cost improvement in this small targeted study. All outcomes are retained. V8 shortens the added guidance and limits transitions to newly verified requirements using existing evidence; the completed comparison is below. The V7 action added112UTF8 bytes per open briefing; V8 reduces that340-byte text to276bytes. These are text sizes, not measured token savings.


## V8 Work follow-up: measured acceptance passed

V8 `7e662ac` versus V7 `1f1d6d8` used four fresh account-authenticated Astra/high executions, ordered baseline/candidate then candidate/baseline. The cost contract was hashed before execution: all four semantic/transport checks pass, median paired total-token ratio <=1.00 and elapsed ratio <=1.05. No retries, excluded outcomes or changed thresholds.

All four passed, including direct review of cancellation, side-question45, compaction, resumed submission12 exactly once, evidence-backed completion and fresh-session retention. Each run's Work ledger was unchanged through both read-only turns. Final lifecycle remained open with100% applicable requirements verified, which is permitted; closing Work was not required. This removes the observed release blocker in the targeted validation, not proof that an intermittent omission can never recur.

| Pair | V7 tokens | V8 tokens | Token ratio | V7 seconds | V8 seconds | Time ratio |
|---|---:|---:|---:|---:|---:|---:|
|0|904,237|878,868|0.9719|391.07|372.39|0.9522|
|1|1,163,499|792,092|0.6808|415.88|342.53|0.8236|

Median paired tokens fell **17.4%**, elapsed **11.2%**. Commands totaled61→58. Cached input totaled1,841,024→1,444,608, but uncached input totaled210,406→212,157 (+0.8%); therefore total-token savings are not a claim of lower uncached usage or monetary cost. All fields and completion projections are retained in work-completion-v8.json.

This is only two targeted pairs with perturbed row values, after tuning the same cancellation scenario; it is **not an independent holdout**, confidence interval, or general latency result. Model-generated requirement counts and service variation contribute uncertainty. V6's primary Work-disabled study and V8's Work-enabled follow-up have separate source identities and cannot be combined into a single exact-version whole-stack claim. Experimental context management remains unmeasured as an independent variable.

V8 changes only the open Work action wording; terminal, evidence and authority boundaries remain. Independent native GPT-6 Astra/high code review returned CLEAR for the delta and harness, not performance approval.48 targeted Work/compaction tests and31 evaluator tests passed; typecheck, lint and build passed. The earlier1,279-test full run belongs to V6 and is not relabeled as a fresh V8 full run. Merge/release readiness remains a separate repository gate.
