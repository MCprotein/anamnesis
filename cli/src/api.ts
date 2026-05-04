// Public TypeScript API boundary.
//
// Keep this file intentionally small. Exports from this file are the
// semver-governed import surface from v1.0 forward. CLI commands and core
// implementation modules remain internal unless they are re-exported here and
// documented in docs/API.md.

export {
  DISCOVERY_ORDER,
  AgentfileParseError,
  agentfileSchema,
  findAgentfile,
  fragmentAdapterEnabled,
  parseAgentfile,
  readAgentfile,
  stringifyAgentfile,
  writeAgentfile,
  type Agentfile,
  type Fragment,
  type ToolName,
} from "./core/agentfile.js";
