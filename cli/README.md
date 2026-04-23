# cli

TypeScript source for the `anamnesis` CLI.

## Status

v0.1 pre-alpha. Only a placeholder entrypoint (`src/index.ts`) exists — it prints help text and exits. Real command implementations are not yet written.

## Planned structure (v0.1)

```
cli/src/
├── index.ts                 # entrypoint, arg dispatch
├── commands/
│   ├── init.ts
│   ├── update.ts
│   ├── promote.ts
│   └── status.ts
├── capabilities/            # rendering contracts (one file per capability)
│   ├── project_memory.ts
│   ├── ontology.ts
│   ├── executable_hook.ts
│   ├── skill.ts
│   └── slash_command.ts
├── adapters/
│   └── claude-code/         # v0.1: CC only
│       ├── project_memory.ts
│       ├── ontology.ts
│       ├── executable_hook.ts
│       ├── skill.ts
│       └── slash_command.ts
├── core/
│   ├── agentfile.ts         # Agentfile read/write/validate
│   ├── manifest.ts          # .anamnesis/manifest.json read/write
│   ├── regions.ts           # anchor-based region merge
│   ├── rulebook.ts          # trigger evaluation
│   └── fragments.ts         # fragment loader
└── util/
    ├── fs.ts
    ├── hash.ts
    └── diff.ts
```

## Build & run

```bash
npm install
npm run build
./cli/dist/index.js --help
```

Local development via `npm run dev` (tsc watch mode).

## Principles

- **Pure functions** where possible — rendering should be deterministic given (content, params, adapter).
- **No implicit file writes** — every write goes through a single applier that respects `--dry-run`.
- **No network calls** in v0.1 — fragments are local; registry comes in v1.0.
- **Error messages must name the offending file and line** — this tool generates files the user will read; errors should do the same.
