// Public TypeScript API boundary.
//
// Keep this file intentionally small. CLI commands and core implementation
// modules may change before v1.0; exports from this file are the supported
// import surface.

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
