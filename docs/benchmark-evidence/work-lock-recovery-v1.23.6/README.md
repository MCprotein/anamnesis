# Work lock recovery follow-up

The v1.23.5 Publish workflow stopped at its test gate before registry publication:
[failed run](https://github.com/MCprotein/anamnesis/actions/runs/34082331150).
One CLI status test exceeded 30 seconds and the 64-way PostToolUse test returned
`cursor_unavailable`. Local targeted execution of that unchanged source passed
29 tests, so this was not treated as enough evidence to rerun CI until green.

A Node 24 Linux container limited to 2 CPUs and 7 GiB reproduced 40 lock acquisition
timeouts in the 64-way fanout. The unchanged 30-second lock deadline expired.
The test finished in 103.89 seconds with 28 passes and one failure. This establishes
load-induced lock exhaustion in the reproduction; it does not prove that every
CI error had that cause. Two 4 GiB diagnostic attempts terminated with exit 137;
neither is counted as a successful test. An additional setup-aborted attempt is
retained separately.

Independent Astra source review found a distinct ownership race: after reading
dead owner A, a reclaimer could remove newly acquired B's lock. Four deterministic
race regressions failed on the old implementation and passed after repair.
The replacement uses an exclusive per-nonce claim and held inode/owner identities,
with death proof before final validation. Unknown identities and abandoned claims
remain fail closed. It assumes cooperating upgraded lock users; concurrent manual
claim removal and mixed old/new reclaimers are outside that safety guarantee.

A direct-loader-only comparison under the same 2 CPU / 7 GiB limits still failed:
it recorded lock timeouts and exposed premature stdout collection. The final
candidate combines the lock repair, direct Node loader, and collection at stdio
close. All 64 concurrent calls and the exact final count of 67 remain required.
That candidate passed all 29 targeted tests in 72.30 seconds, including the CLI
status test. Timeout budgets and assertions were not relaxed.

The duration is one diagnostic observation, not a statistical performance result.
No model benchmark was rerun for this core locking change. The prior Astra native
steering/compaction experiments remain evidence for their explicitly recorded
source; this follow-up supplies separate lock and process-collection regressions.
The final full Linux suite and tag workflow are separate release gates.
