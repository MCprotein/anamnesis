# Retrieval batching improvement plan

1. Preserve the 1.24.3 policy as control; keep the retrieval engine and model fixed.
2. Lock the emitted shared/Codex/Claude batching and source-safety contract with the existing rendered/process tests.
3. Change only redundant discovery and already-known retrieval scheduling. Preserve required ontology/handoff inspection and original-source verification; dependent reads stay sequential.
4. Run 3 repetitions of the existing three scenarios per condition (18 invocations), alternating condition order. Keep failed/slow runs in the results.
5. Accept only with every task/source check passing, no inappropriate queries on known paths, necessary retrieval retained, and a measured reduction in excess shell calls and total tokens in the missing-evidence case. Do not equate cached tokens with paid costs or claim general latency improvement.
6. Validate affected adapters, typecheck/lint, and report limitations. Publishing another release is outside this experiment.
