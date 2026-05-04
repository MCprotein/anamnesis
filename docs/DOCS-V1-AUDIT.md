# Docs V1 Audit

Status: v1.0 documentation completeness audit.

This audit maps the v1.0 public documentation requirement to the canonical
repo documents. The goal is not to duplicate every guide, but to make sure a
new user, maintainer, fragment author, and release owner can find the right
entry point without relying on conversation history.

## Required User Paths

| Requirement | Canonical docs | Status |
|---|---|---|
| Install and quickstart | `README.md` quickstart, `README.md` lifecycle | Covered |
| Safe lifecycle commands | `README.md` lifecycle, `docs/REPAIR.md`, `docs/DESIGN.md` | Covered |
| Adapter parity | `docs/ADAPTER-PARITY.md`, `docs/SWITCHING-SCENARIOS.md`, `docs/AGENT-SWITCHING-GUIDE.md` | Covered |
| Agent switching and handoff | `docs/AGENT-SWITCHING-GUIDE.md`, `docs/SWITCHING-SCENARIOS.md` | Covered |
| Ontology generation | `README.md` generation boundary, `docs/ONTOLOGY-BOOTSTRAP.md`, `docs/AGENT-SWITCHING-GUIDE.md` | Covered |
| Monorepo usage | `docs/MONOREPO.md`, `specs/agentfile.md` scopes | Covered |
| Troubleshooting and repair | `docs/REPAIR.md`, `README.md` `status` / `doctor` lifecycle | Covered |
| Release and publish | `docs/RELEASING.md`, `docs/DOGFOOD.md` published smoke evidence | Covered |
| Fragment authoring | `docs/FRAGMENT-AUTHORING.md`, `CONTRIBUTING.md`, `rulebook.md` | Covered |
| Agentfile schema freeze | `specs/agentfile.md`, `docs/AGENTFILE-V1-FREEZE.md`, `docs/AGENTFILE-SCHEMA-AUDIT.md` | Covered |
| Agentfile migration | `docs/AGENTFILE-MIGRATIONS.md`, `README.md` lifecycle | Covered |
| Public TypeScript API | `docs/API.md`, `package.json` exports, `cli/src/api.ts` | Covered |
| Registry/signing scope | `docs/REGISTRY-V1-DECISION.md`, `docs/FRAGMENT-REGISTRY.md`, `docs/FRAGMENT-SIGNING.md` | Covered |
| Remote sync scope | `docs/REMOTE-SYNC-STRATEGY.md` | Covered |
| Evidence-backed claims | `docs/BENCHMARK-GALLERY.md`, `docs/BENCHMARKS.md`, `docs/DOGFOOD-MATRIX.md`, `docs/DOGFOOD.md` | Covered |

## Known Limitations To Keep Visible

- Documentation remains GitHub-first through v1.0. `docs/DOCS-SITE-PLAN.md`
  defines the future generated docs-site path, but no separate site is
  required for v1.0.
- Remote fragment registry installation and signing verification are not
  shipped in v1.0. Use `docs/REGISTRY-V1-DECISION.md` for the exact boundary.
- Broad `anamnesis sync` is not shipped in v1.0. Project context, ontology,
  and handoff state remain local unless a future privacy/trust design changes
  that.
- Ontology is two-layer by design: deterministic Layer A facts plus
  agent-authored Layer B semantic enrichment. Do not claim fully automatic
  deep ontology for every framework.
- Adapter parity means user-facing continuity parity, not identical native UI
  features in every agent.
- README benchmark claims must stay within `docs/BENCHMARK-GALLERY.md`
  approved wording until more public-safe repo shapes are collected.

## Maintenance Rule

When adding or changing a public command, adapter behavior, schema field,
fragment authoring rule, release step, or benchmark claim:

1. Update the canonical guide for that path.
2. Update `README.md` only if the user-facing navigation changes.
3. Update `CHANGELOG.md`.
4. Update `docs/ROADMAP.md` when the change affects a planned milestone.
5. Keep this audit accurate if the public-docs coverage boundary moves.
