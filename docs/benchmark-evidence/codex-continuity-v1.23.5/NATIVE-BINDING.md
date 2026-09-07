# Native session binding follow-up

The final independent review found a real integration gap in the earlier eight-run
comparison: normal Work selection omitted the raw native session reference.
Those runs recovered answers but did **not** prove native Work context injection.
This follow-up changes the advertised connection command and supports explicit
binding of existing null-reference cursors. Compaction ownership checks remain intact.

Three runs were declared before execution, with Codex 0.153.4, GPT-6 Astra/high,
experimental context management disabled, and isolated configuration and registry.
The candidate was frozen at 963 files; all frozen hashes and the final product
source hashes matched after execution. The baseline is the earlier frozen candidate.

| Case | Exact native reference bound | Actual post-compaction Work context | Work remains open |
| --- | --- | --- | --- |
| Prior normal connection | No | No | Yes |
| Fixed normal connection | Yes | Yes | Yes |
| Existing null-reference cursor, explicit rebind | Yes | Yes | Yes |

The synthetic Work retains `saffron` and limit `17`; after real compaction the
side question is answered as `45`. The native hook output, not the answer alone,
is the injection oracle. No TASK.md or handoff scaffolding was provided.
The existing-cursor case uses a second native thread and an ordinary CLI selection
without a reference, then explicit user-directed rebind; no cursor YAML is patched.

[Machine-readable results](native-binding-results.json) include model observations,
usage including compaction, result hashes, and Work progress. These three runs prove
these bounded integration paths; they are not blind holdouts, a statistical quality
comparison, or evidence of token/time savings.

The first audit script filtered uppercase `SessionStart` inside the compaction API
operation. Codex 0.153.4 actually emits `sessionStart` on the following user turn.
The audit was corrected to inspect that actual event after the completed compaction.
The original audit and its false-negative output were preserved; model inputs,
product source and runs were not changed or repeated to obtain this result.
The correction hashes are included in the machine-readable report.

Current product regression verification: 1,257 tests across 105 files passed.
The portable benchmark auditor also rejects a transcript that omits only the
compaction response usage or contains invalid negative, noninteger, missing, or
out-of-range counters. The fault matrix covers compaction, ordinary responses,
and thread totals; four harness unit tests passed. Re-auditing the eight original
raw runs with the stricter counter validation passed without changing measurements.
