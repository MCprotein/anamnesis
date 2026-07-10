---
name: doc-freshness-review
description: |
  Review project prose docs for semantic freshness after moves, deletes,
  architecture changes, or `anamnesis context diagnose` warnings. Use when the
  CLI can detect path drift but cannot prove whether present-tense README,
  CLAUDE, or docs claims still describe the current project.
---

# doc-freshness-review

Use this skill to review prose documentation for stale meaning that deterministic
CLI checks cannot safely prove.

This is a semantic freshness review, not a deterministic file-existence check.
`anamnesis context diagnose` catches missing project-local path references. This
skill is the agent-facing second pass: it compares doc claims against current
repo evidence and reports likely stale architecture, workflow, setup, release,
or operational statements.

## Default Mode

Read-only review. Do not edit files unless the user explicitly asks for doc
updates after seeing the report.

## Steps

1. Run or inspect `anamnesis context diagnose` first. Treat
   `doc-file-reference-missing` warnings as deterministic evidence, not agent
   judgment.

2. Identify candidate prose docs:
   - `README.md`
   - `CLAUDE.md`
   - `docs/**/*.md`

   Skip generated or historical material unless it is clearly presented as
   current user guidance:
   - `AGENTS.md`
   - `docs/deprecated/**`
   - benchmark evidence snapshots
   - vendored, generated, cache, or build directories

3. Gather current-state evidence before judging a claim:
   - `git status --short`
   - recent changed, moved, or deleted paths from git history
   - current repo tree around the claimed path, command, config, or workflow
   - `Agentfile`, `.anamnesis/manifest.json`, and generated managed regions
     when the claim is about installed anamnesis surfaces
   - `anamnesis context query "<terms>"` for related roadmap, handoff,
     ontology, or document pointers; read the returned `source_path` /
     `stable_ref` before treating it as evidence

4. Review only claims that affect a future agent or user:
   - present-tense architecture or directory claims
   - setup, release, publish, or upgrade commands
   - agent-surface availability claims for Claude Code, Codex, or Cursor
   - lifecycle or retention behavior that could change what enters context
   - file paths that still exist but no longer support the described behavior

5. Produce a report grouped by severity:
   - `stale-current-claim`: evidence strongly contradicts the doc claim
   - `stale-path-claim`: path exists or once existed, but the surrounding claim
     appears outdated
   - `needs-human-confirmation`: evidence is mixed or intent cannot be inferred
   - `ok`: reviewed high-risk claims with no issue found

6. For each issue, include:
   - doc path and line when available
   - the claim being reviewed
   - current evidence
   - confidence: `high`, `medium`, or `low`
   - recommended edit in one sentence

7. Stop after the report. If the user asks you to apply fixes, make the smallest
   doc edits needed and run `anamnesis context diagnose` again.

## Boundaries

- Do not ingest or summarize full past chat transcripts.
- Do not treat semantic judgment as deterministic CLI truth.
- Do not rewrite examples, old release notes, or deprecated docs just because
  they mention historical paths.
- Prefer `needs-human-confirmation` over a confident stale claim when evidence
  is weak.
