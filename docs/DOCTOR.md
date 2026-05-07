# Doctor Checks

`anamnesis doctor` is the read-only integrity check for installed fragments,
managed drift, adapter wiring, Codex hook ownership, continuity state, and
ontology gaps.

Run:

```bash
anamnesis doctor
anamnesis doctor --append
```

Append runs write a markdown snapshot here and a `doctor-check` runtime
evidence record to `.anamnesis/evidence/events.jsonl`. Use this when a release
or benchmark claim depends on install integrity, not just context-quality
scorecards.
