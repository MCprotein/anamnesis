// Builtin introspectors registry.
//
// As more parsers ship, register them here. Keep imports lazy in shape
// (cheap top-level cost) — each introspector is a constant export.

import { IntrospectorRegistry } from "../core/introspector.js";
import { k8sIntrospector } from "./k8s.js";

export function registerBuiltinIntrospectors(
  registry: IntrospectorRegistry,
): void {
  registry.register(k8sIntrospector);
}

export function makeBuiltinIntrospectorRegistry(): IntrospectorRegistry {
  const registry = new IntrospectorRegistry();
  registerBuiltinIntrospectors(registry);
  return registry;
}
