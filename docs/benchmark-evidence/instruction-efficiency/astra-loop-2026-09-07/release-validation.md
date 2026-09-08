# Release validation scope

Version1.24.0 is prepared in a separate clone. The original working tree and its
staged evidence edits are preserved. No global CLI upgrade or original-project
adapter application is part of this release.

The clone initially lacked the manifest-tracked Git pre-commit bridge and Codex
runtime trust. The bridge was restored byte-for-byte against manifest SHA256
7540150da6cab04377afe418a2aef88f1a78a54d7f81dc966809dee64db7f44e.
A separate temporary CODEX_HOME was used to discover and explicitly trust only
the five anamnesis-owned project hooks through the CLI trust workflow. Final
inspection reports5 trusted,0 unknown/untrusted/modified; no user home trust
settings were changed. These are installation checks, not model-performance evidence.

The repo's own generated adapters were still at base25. Reviewed apply preview
reported11 creates,15 updates,0 blocked/user-modified; clone-local application
adopted base27. Subsequent release preflight reported8 pass,1 warning,0 failures,
zero pending writes,57 clean managed surfaces and58 no-op actions. Product source
remains the reviewed/measured V8 implementation; generated delivery now adopts it.

## Reviewed warnings

Seven missing-path warnings refer to optional agent-authored handoff files absent
from a clean clone: AGENT-SWITCHING-GUIDE:86, CONTEXT-INDEX-DESIGN:10/40,
HANDOFF-LIFECYCLE:22, historical ROADMAP:124/1631, SWITCHING-SCENARIOS:6.
Their surrounding text describes runtime outputs, source categories or historical
contracts, rather than asserting a handoff is committed in every clone. Reviewed
as valid guidance; no dummy handoff was created merely to silence diagnostics.

The eighth warning identifies a July subagent-injection benchmark as stale.
That historical result is not refreshed or represented as new Astra evidence.
Current bounded Astra measurements and actual review model identities are reported
separately. The optional doc-catalog suggestion is informational.

Earlier preparation failures and verification outputs are retained under
/tmp/anamnesis-release-124-*.log. Failed dogfood snapshots remain in DOGFOOD.md and
the evidence ledger; only later successful checks establish readiness. Public
availability requires the official release runner and post-publish verification.


## Initial publication attempt retained

The1.24.0 tag workflow [run34141177326](https://github.com/MCprotein/anamnesis/actions/runs/34141177326)
passed install, lint and typecheck, then passed1,278 of1,279 tests. The namespace
help test took36.7 seconds for three sequential CLI processes and exceeded its
shared30-second deadline. Build, both registry publications and Release creation
were skipped. Publication failed; no behavior-assertion failure was reported.
Runner load is a plausible contributor, not a proven cause from this log alone.

The1.24.1 correction parameterizes those same three invocations as independent
cases under the existing timeout, retaining every assertion and process call.
It does not relax a global timeout, retry failures or alter product code. Two
additional reported test cases do not mean two additional CLI executions. The
failed tag is preserved; normal runner preparation/publication/verification is
used for the replacement patch.


## Post-release adoption follow-up (1.24.2)

The global CLI upgrade to 1.24.1 installed successfully, but its project-sync
child returned exit code 0 with a 65,536-byte truncated JSON response. A
read-only `projects plan --json` subprocess reproduced the truncation. This
is an output-delivery defect, not proof that synchronization rolled back.
The repair reuses the existing awaited stdout writer for project list,
prune, plan/apply/sync and upgrade's combined result. Three isolated large
registry cases fail before the repair and pass after it; stale entries and
registry bytes remain unchanged. CLI integration tests now isolate their
registry state to avoid leaving fixture registrations in user state.

The earlier CI stall remains unexplained. In v1.24.1 attempt 1, 107 of 108
files completed, but `cli/src/index.test.ts` produced no completion output;
the run was cancelled after eight minutes without further test output.
The same file passed 21 cases in 13.61 seconds in a separate Linux aarch64
Node 24 container. The unchanged GitHub x64 source then passed all 1,281
cases twice. Attempt 2 published both packages but hit a transient 404 on
immediate parity lookup; attempt 3 completed publication verification and
Release creation. The stdout repair and test-registry isolation do not
establish or claim a fix for that stall.
