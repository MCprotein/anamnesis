# Public API Boundary

anamnesis is primarily a CLI. The supported TypeScript import surface is
intentionally small until v1.0.

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
supported. They may change without notice before v1.0 and are intentionally
blocked by the `exports` map.

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
