# Public API Boundary

anamnesis is primarily a CLI. The supported TypeScript import surface is
intentionally small and semver-governed from v1.0 forward.

## Supported Import

```ts
import {
  parseAgentfile,
  stringifyAgentfile,
  readAgentfile,
  type Agentfile,
} from "@mcprotein/anamnesis";
```

The package `exports` map only exposes:

- `@mcprotein/anamnesis`
- `@mcprotein/anamnesis/package.json`

Deep imports such as `@mcprotein/anamnesis/cli/dist/core/agentfile.js` are not
supported. They may change without notice and are intentionally blocked by the
`exports` map.

## Stability Contract

- Symbols listed below are the supported public TypeScript API.
- Adding a new public symbol is a minor-version change after v1.0.
- Removing a public symbol, changing its meaning, or changing its type contract
  is a major-version change after v1.0.
- Package-level imports must go through `@mcprotein/anamnesis` or
  `@mcprotein/anamnesis/package.json`.
- Deep imports remain internal even if the generated files are present inside
  the npm package.

## Current Public Symbols

- `DISCOVERY_ORDER`
- `AgentfileParseError`
- `agentfileSchema`
- `findAgentfile`
- `fragmentAdapterEnabled`
- `parseAgentfile`
- `readAgentfile`
- `stringifyAgentfile`
- `writeAgentfile`
- `Agentfile`
- `Fragment`
- `ToolName`

## Not Public Yet

Command functions such as `init`, `update`, `status`, `doctor`, `benchmark`,
`migrateAgentfile`, and `ontology bootstrap` remain internal. Their CLI
behavior is supported, but their TypeScript result shapes may still change
during v0.x stabilization.

If a command result becomes a supported API later, it should be re-exported
from `cli/src/api.ts`, documented here, and covered by package-level import
tests before release.
