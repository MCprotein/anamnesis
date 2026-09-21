# CLI source

The TypeScript implementation of `@mcprotein/anamnesis`. The package version
and supported Node.js version are defined in [package.json](../package.json).

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | CLI parsing, command dispatch, help and reporting |
| `src/api.ts` | Public programmatic API |
| `src/commands/` | Setup, apply/update, context, Work, diagnostics, benchmarks and other commands |
| `src/core/` | Schemas, fragment loading, render plans, managed writes, context indexing and Work state |
| `src/adapters/` | Claude Code, Codex and Cursor capability renderers |
| `src/introspectors/` | Deterministic ontology bootstrap extractors |
| `src/util/` | Shared filesystem, hashing and terminal utilities |

Capability schemas live in `src/core/fragments.ts`; the renderer contract and
registry live in `src/core/render.ts`. There is no separate `src/capabilities/`
implementation directory. See [capabilities](../capabilities/README.md) and
[architecture](../docs/DESIGN.md).

## Build and verify

Run from the repository root:

```bash
npm install
npx tsx cli/src/index.ts --help --all
npm run typecheck
npm run lint
npm test
npm run build
node cli/dist/index.js --help
```

`npm run dev` runs the TypeScript compiler in watch mode. Tests are colocated
with source as `*.test.ts`. Build output under `cli/dist/` is generated.

Renderers produce declarative file/region actions; application and safety
checks are separate. Commands may also maintain local context and Work state.
Network access is command-specific, including registry and release operations;
the CLI is not an offline-only implementation.

See the [user guide](../docs/USER-GUIDE.md), [API](../docs/API.md) and
[release procedure](../docs/RELEASING.md) for their respective contracts.
