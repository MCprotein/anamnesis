# Repository documentation audit — 2026-09-21

## Scope and method

Inventoried all 179 tracked Markdown files at audit start, plus the existing
untracked `docs/plans/` and `docs/references/` notes. Current repository claims
were checked against command dispatch, schemas, adapters, source templates and
package scripts. Historical snapshots received classification/reference checks,
not a rewrite or a rerun of historical benchmarks. Local `_workspace/` blog
drafts are working artifacts rather than product documentation.

The audit did not certify every third-party recommendation against every
framework version. Specific outdated Next.js, Prisma and Remix statements were
checked against official versioned documentation linked in the updated templates.

## Findings and disposition

- Keep `rulebook.md`: it is parsed at runtime. Correct initial auto-selection versus later suggestions, literal path matching, and substring-based Python detection.
- Keep `capabilities/README.md`: replace obsolete implementation plans and the five-type matrix with the six-type schema and canonical adapter links.
- Replace the CLI placeholder README and stale base/fragment/AGENTS layout descriptions.
- Align current setup, migration, handoff, Work, ontology and diagnostics guidance with implemented behavior.
- Label unimplemented registry/signing/sync/plugin and older design examples explicitly; retain the decision history.
- Fix the Claude entrypoint renderer and regenerate its managed region through the planner/applier; active/warm handoffs only at startup.
- Refresh version-sensitive Next.js, Prisma and Remix templates; preserve the previous fragment versions before incrementing versions.
- Add a documentation map to distinguish current contracts, proposals and historical material.

No file was proven safe and useful to delete: runtime inputs, pinned fragment
versions and linked design/evidence history have distinct consumers. Retaining
them with accurate status avoids breaking loaders or losing decision evidence.
Preexisting roadmap additions, evidence-log changes and local notes were preserved.

## Verification

- Relative Markdown targets: no missing local targets across the original inventory (fenced code examples excluded).
- Regression: generated Claude handoff scope test failed before the renderer correction and passed afterward.
- Targeted parser, fragment, adapter and continuity tests: 8 files / 84 tests passed.
- `npm run typecheck`, `npm run lint`, and `git diff --check`: passed.
- Final local-link check including new documents and archives: 186 Markdown files, no missing targets.
- Three-adapter sanitized initialization dry-run selected `nextjs@2`, `prisma@3`, `remix@2`; previous versions still load and no Agentfile was written.
- `context diagnose`: zero warnings; two informational notices remain (stale disposable index cache and optional document catalog absent).
- Independent reviewer found incorrect init dry-run/default-file claims and a capabilities-directory description; all three were corrected and re-reviewed with no remaining concrete blockers.
- New fragment archives: all ten files match their previous HEAD content byte-for-byte.
- No release, remote publish, live agent migration or benchmark model rerun performed.

## Original inventory

| File | Review treatment |
| --- | --- |
| `.anamnesis/codex-instructions/file-AGENTS.md/codex-cmd-handoff-prepare.md` | Generated adapter; source/copy boundary checked |
| `.anamnesis/codex-instructions/file-AGENTS.md/codex-hook-handoff-reminder.md` | Generated adapter; source/copy boundary checked |
| `.anamnesis/codex-instructions/file-AGENTS.md/codex-hook-inject-handoff.md` | Generated adapter; source/copy boundary checked |
| `.anamnesis/codex-instructions/file-AGENTS.md/codex-hook-inject-ontology.md` | Generated adapter; source/copy boundary checked |
| `.anamnesis/codex-instructions/file-AGENTS.md/codex-hook-remind-uncommitted.md` | Generated adapter; source/copy boundary checked |
| `.anamnesis/codex-instructions/file-AGENTS.md/codex-hook-work-briefing.md` | Generated adapter; source/copy boundary checked |
| `.anamnesis/codex-instructions/file-AGENTS.md/codex-hook-work-post-tool-use.md` | Generated adapter; source/copy boundary checked |
| `.anamnesis/codex-instructions/file-AGENTS.md/codex-skill-anamnesis-init.md` | Generated adapter; source/copy boundary checked |
| `.anamnesis/codex-instructions/file-AGENTS.md/codex-skill-doc-freshness-review.md` | Generated adapter; source/copy boundary checked |
| `.anamnesis/codex-instructions/file-AGENTS.md/codex-skill-load-context.md` | Generated adapter; source/copy boundary checked |
| `.anamnesis/codex-instructions/file-AGENTS.md/codex-skill-ontology-enrich.md` | Generated adapter; source/copy boundary checked |
| `.claude/commands/handoff-prepare.md` | Generated adapter; source/copy boundary checked |
| `.claude/commands/load-context.md` | Generated adapter; source/copy boundary checked |
| `.claude/skills/anamnesis-init/SKILL.md` | Generated adapter; source/copy boundary checked |
| `.claude/skills/doc-freshness-review/SKILL.md` | Generated adapter; source/copy boundary checked |
| `.claude/skills/load-context/SKILL.md` | Generated adapter; source/copy boundary checked |
| `.claude/skills/ontology-enrich/SKILL.md` | Generated adapter; source/copy boundary checked |
| `.codex/skills/anamnesis-init/SKILL.md` | Generated adapter; source/copy boundary checked |
| `.codex/skills/doc-freshness-review/SKILL.md` | Generated adapter; source/copy boundary checked |
| `.codex/skills/load-context/SKILL.md` | Generated adapter; source/copy boundary checked |
| `.codex/skills/ontology-enrich/SKILL.md` | Generated adapter; source/copy boundary checked |
| `AGENTS.md` | Current source/guidance reviewed |
| `CHANGELOG.md` | Release history retained; unreleased notes added |
| `CLAUDE.md` | Generated adapter; source/copy boundary checked |
| `CONTRIBUTING.md` | Current source/guidance reviewed |
| `DESIGN.md` | Current source/guidance reviewed |
| `README.md` | Current source/guidance reviewed |
| `base/.versions/10/README.md` | Pinned historical version; retained |
| `base/.versions/10/adapters/claude-code/commands/handoff-prepare.md` | Pinned historical version; retained |
| `base/.versions/10/adapters/claude-code/commands/load-context.md` | Pinned historical version; retained |
| `base/.versions/10/adapters/claude-code/skills/load-context/SKILL.md` | Pinned historical version; retained |
| `base/.versions/10/adapters/claude-code/skills/ontology-enrich/SKILL.md` | Pinned historical version; retained |
| `base/.versions/10/content/agents.snippet.md` | Pinned historical version; retained |
| `base/.versions/11/README.md` | Pinned historical version; retained |
| `base/.versions/11/adapters/claude-code/commands/handoff-prepare.md` | Pinned historical version; retained |
| `base/.versions/11/adapters/claude-code/commands/load-context.md` | Pinned historical version; retained |
| `base/.versions/11/adapters/claude-code/skills/anamnesis-init/SKILL.md` | Pinned historical version; retained |
| `base/.versions/11/adapters/claude-code/skills/load-context/SKILL.md` | Pinned historical version; retained |
| `base/.versions/11/adapters/claude-code/skills/ontology-enrich/SKILL.md` | Pinned historical version; retained |
| `base/.versions/11/content/agents.snippet.md` | Pinned historical version; retained |
| `base/.versions/14/README.md` | Pinned historical version; retained |
| `base/.versions/14/adapters/claude-code/commands/handoff-prepare.md` | Pinned historical version; retained |
| `base/.versions/14/adapters/claude-code/commands/load-context.md` | Pinned historical version; retained |
| `base/.versions/14/adapters/claude-code/skills/anamnesis-init/SKILL.md` | Pinned historical version; retained |
| `base/.versions/14/adapters/claude-code/skills/load-context/SKILL.md` | Pinned historical version; retained |
| `base/.versions/14/adapters/claude-code/skills/ontology-enrich/SKILL.md` | Pinned historical version; retained |
| `base/.versions/14/content/agents.snippet.md` | Pinned historical version; retained |
| `base/.versions/18/README.md` | Pinned historical version; retained |
| `base/.versions/18/adapters/claude-code/commands/handoff-prepare.md` | Pinned historical version; retained |
| `base/.versions/18/adapters/claude-code/commands/load-context.md` | Pinned historical version; retained |
| `base/.versions/18/adapters/claude-code/skills/anamnesis-init/SKILL.md` | Pinned historical version; retained |
| `base/.versions/18/adapters/claude-code/skills/doc-freshness-review/SKILL.md` | Pinned historical version; retained |
| `base/.versions/18/adapters/claude-code/skills/load-context/SKILL.md` | Pinned historical version; retained |
| `base/.versions/18/adapters/claude-code/skills/ontology-enrich/SKILL.md` | Pinned historical version; retained |
| `base/.versions/18/content/agents.snippet.md` | Pinned historical version; retained |
| `base/.versions/5/README.md` | Pinned historical version; retained |
| `base/.versions/5/adapters/claude-code/commands/handoff-prepare.md` | Pinned historical version; retained |
| `base/.versions/5/adapters/claude-code/commands/load-context.md` | Pinned historical version; retained |
| `base/.versions/5/adapters/claude-code/skills/load-context/SKILL.md` | Pinned historical version; retained |
| `base/.versions/5/adapters/claude-code/skills/ontology-enrich/SKILL.md` | Pinned historical version; retained |
| `base/.versions/5/content/agents.snippet.md` | Pinned historical version; retained |
| `base/.versions/6/README.md` | Pinned historical version; retained |
| `base/.versions/6/adapters/claude-code/commands/handoff-prepare.md` | Pinned historical version; retained |
| `base/.versions/6/adapters/claude-code/commands/load-context.md` | Pinned historical version; retained |
| `base/.versions/6/adapters/claude-code/skills/load-context/SKILL.md` | Pinned historical version; retained |
| `base/.versions/6/adapters/claude-code/skills/ontology-enrich/SKILL.md` | Pinned historical version; retained |
| `base/.versions/6/content/agents.snippet.md` | Pinned historical version; retained |
| `base/.versions/7/README.md` | Pinned historical version; retained |
| `base/.versions/7/adapters/claude-code/commands/handoff-prepare.md` | Pinned historical version; retained |
| `base/.versions/7/adapters/claude-code/commands/load-context.md` | Pinned historical version; retained |
| `base/.versions/7/adapters/claude-code/skills/load-context/SKILL.md` | Pinned historical version; retained |
| `base/.versions/7/adapters/claude-code/skills/ontology-enrich/SKILL.md` | Pinned historical version; retained |
| `base/.versions/7/content/agents.snippet.md` | Pinned historical version; retained |
| `base/.versions/8/README.md` | Pinned historical version; retained |
| `base/.versions/8/adapters/claude-code/commands/handoff-prepare.md` | Pinned historical version; retained |
| `base/.versions/8/adapters/claude-code/commands/load-context.md` | Pinned historical version; retained |
| `base/.versions/8/adapters/claude-code/skills/load-context/SKILL.md` | Pinned historical version; retained |
| `base/.versions/8/adapters/claude-code/skills/ontology-enrich/SKILL.md` | Pinned historical version; retained |
| `base/.versions/8/content/agents.snippet.md` | Pinned historical version; retained |
| `base/.versions/9/README.md` | Pinned historical version; retained |
| `base/.versions/9/adapters/claude-code/commands/handoff-prepare.md` | Pinned historical version; retained |
| `base/.versions/9/adapters/claude-code/commands/load-context.md` | Pinned historical version; retained |
| `base/.versions/9/adapters/claude-code/skills/load-context/SKILL.md` | Pinned historical version; retained |
| `base/.versions/9/adapters/claude-code/skills/ontology-enrich/SKILL.md` | Pinned historical version; retained |
| `base/.versions/9/content/agents.snippet.md` | Pinned historical version; retained |
| `base/README.md` | Current source/guidance reviewed |
| `base/adapters/claude-code/commands/handoff-prepare.md` | Current source/guidance reviewed |
| `base/adapters/claude-code/commands/load-context.md` | Current source/guidance reviewed |
| `base/adapters/claude-code/skills/anamnesis-init/SKILL.md` | Current source/guidance reviewed |
| `base/adapters/claude-code/skills/doc-freshness-review/SKILL.md` | Current source/guidance reviewed |
| `base/adapters/claude-code/skills/load-context/SKILL.md` | Current source/guidance reviewed |
| `base/adapters/claude-code/skills/ontology-enrich/SKILL.md` | Current source/guidance reviewed |
| `base/content/agents.snippet.md` | Current source/guidance reviewed |
| `capabilities/README.md` | Current source/guidance reviewed |
| `cli/README.md` | Current source/guidance reviewed |
| `docs/ADAPTER-PARITY.md` | Current source/guidance reviewed |
| `docs/AGENT-SWITCHING-GUIDE.md` | Current source/guidance reviewed |
| `docs/AGENT-TASK-BENCHMARKS.md` | Current source/guidance reviewed |
| `docs/AGENTFILE-MIGRATIONS.md` | Current source/guidance reviewed |
| `docs/AGENTFILE-V1-FREEZE.md` | Current source/guidance reviewed |
| `docs/API.md` | Current source/guidance reviewed |
| `docs/BENCHMARK-GALLERY.md` | Current source/guidance reviewed |
| `docs/BENCHMARK-TRACES.md` | Current source/guidance reviewed |
| `docs/BENCHMARKS.md` | Current source/guidance reviewed |
| `docs/CODEX-CONTINUITY.md` | Current source/guidance reviewed |
| `docs/CODEX-PLUGIN-PACKAGING.md` | Current source/guidance reviewed |
| `docs/COMMAND-UX-PLAN.md` | Current source/guidance reviewed |
| `docs/CONTEXT-INDEX-DESIGN.md` | Current source/guidance reviewed |
| `docs/DESIGN.md` | Current source/guidance reviewed |
| `docs/DOCTOR.md` | Current source/guidance reviewed |
| `docs/DOGFOOD.md` | Current source/guidance reviewed |
| `docs/FRAGMENT-AUTHORING.md` | Current source/guidance reviewed |
| `docs/FRAGMENT-REGISTRY.md` | Current source/guidance reviewed |
| `docs/FRAGMENT-SIGNING.md` | Current source/guidance reviewed |
| `docs/HANDOFF-LIFECYCLE.md` | Current source/guidance reviewed |
| `docs/HOOKS.md` | Current source/guidance reviewed |
| `docs/INSTRUCTION-AUDIT.md` | Current source/guidance reviewed |
| `docs/MONOREPO.md` | Current source/guidance reviewed |
| `docs/ONTOLOGY-BOOTSTRAP.md` | Current source/guidance reviewed |
| `docs/README-CLAIMS.md` | Current source/guidance reviewed |
| `docs/REGISTRY-V1-DECISION.md` | Current source/guidance reviewed |
| `docs/RELEASING.md` | Current source/guidance reviewed |
| `docs/REMOTE-SYNC-STRATEGY.md` | Current source/guidance reviewed |
| `docs/REPAIR.md` | Current source/guidance reviewed |
| `docs/ROADMAP.md` | Current source/guidance reviewed |
| `docs/RUNTIME-EVIDENCE.md` | Current source/guidance reviewed |
| `docs/SWITCHING-SCENARIOS.md` | Current source/guidance reviewed |
| `docs/TASK-HARNESS-DESIGN.md` | Current source/guidance reviewed |
| `docs/USER-GUIDE.md` | Current source/guidance reviewed |
| `docs/WORK-UNIT-DESIGN.md` | Current source/guidance reviewed |
| `docs/benchmark-evidence/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/agent-task/series.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/codex-continuity-v1.23.5/FINAL-PROTOCOL.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/codex-continuity-v1.23.5/NATIVE-BINDING.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/codex-continuity-v1.23.5/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/instruction-efficiency/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/instruction-efficiency/astra-loop-2026-09-07/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/instruction-efficiency/astra-loop-2026-09-07/release-validation.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/retrieval-source-pointers/retrieval-source-pointers.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/session-context/session-context.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/subagent-injection/subagent-injection.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/upgrade/upgrade-benchmark.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-agent-ab/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-agent-ab/sol-3pair/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-agent-ab/terra-3pair/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-continuity/retention-stress/work-continuity.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-continuity/work-continuity.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-lock-recovery-v1.23.6/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-parallel-agent-ab/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-parallel-agent-ab/v10-shadow/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-parallel-agent-ab/v4-shadow/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-parallel-agent-ab/v5-shadow/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-parallel-agent-ab/v6-shadow/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-parallel-agent-ab/v7-shadow/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-parallel-agent-ab/v8-shadow/README.md` | Historical benchmark evidence; retained |
| `docs/benchmark-evidence/work-parallel-agent-ab/v9-shadow/README.md` | Historical benchmark evidence; retained |
| `docs/deprecated/AGENTFILE-SCHEMA-AUDIT.md` | Deprecated history; retained |
| `docs/deprecated/DOCS-SITE-PLAN.md` | Deprecated history; retained |
| `docs/deprecated/DOCS-V1-AUDIT.md` | Deprecated history; retained |
| `docs/deprecated/README.md` | Deprecated history; retained |
| `fragments/README.md` | Current source/guidance reviewed |
| `fragments/django/content/agents.snippet.md` | Current source/guidance reviewed |
| `fragments/docker-compose/content/agents.snippet.md` | Current source/guidance reviewed |
| `fragments/fastapi/content/agents.snippet.md` | Current source/guidance reviewed |
| `fragments/go/content/agents.snippet.md` | Current source/guidance reviewed |
| `fragments/k8s/.versions/1/content/agents.snippet.md` | Pinned historical version; retained |
| `fragments/k8s/content/agents.snippet.md` | Current source/guidance reviewed |
| `fragments/nestjs/content/agents.snippet.md` | Current source/guidance reviewed |
| `fragments/nextjs/content/agents.snippet.md` | Current source/guidance reviewed |
| `fragments/nuxt/content/agents.snippet.md` | Current source/guidance reviewed |
| `fragments/prisma/.versions/1/content/agents.snippet.md` | Pinned historical version; retained |
| `fragments/prisma/content/agents.snippet.md` | Current source/guidance reviewed |
| `fragments/python-uv/content/agents.snippet.md` | Current source/guidance reviewed |
| `fragments/rails/content/agents.snippet.md` | Current source/guidance reviewed |
| `fragments/remix/content/agents.snippet.md` | Current source/guidance reviewed |
| `fragments/rust/content/agents.snippet.md` | Current source/guidance reviewed |
| `fragments/sveltekit/content/agents.snippet.md` | Current source/guidance reviewed |
| `rulebook.md` | Current source/guidance reviewed |
| `specs/agentfile.md` | Current source/guidance reviewed |
