// Builtin introspectors registry.
//
// As more parsers ship, register them here. Keep imports lazy in shape
// (cheap top-level cost) — each introspector is a constant export.

import { IntrospectorRegistry } from "../core/introspector.js";
import { fastapiIntrospector } from "./fastapi.js";
import { k8sIntrospector } from "./k8s.js";
import { nestjsIntrospector } from "./nestjs.js";
import { nextjsIntrospector } from "./nextjs.js";
import { prismaIntrospector } from "./prisma.js";

export function registerBuiltinIntrospectors(
  registry: IntrospectorRegistry,
): void {
  registry.register(fastapiIntrospector);
  registry.register(k8sIntrospector);
  registry.register(nestjsIntrospector);
  registry.register(nextjsIntrospector);
  registry.register(prismaIntrospector);
}

export function makeBuiltinIntrospectorRegistry(): IntrospectorRegistry {
  const registry = new IntrospectorRegistry();
  registerBuiltinIntrospectors(registry);
  return registry;
}
