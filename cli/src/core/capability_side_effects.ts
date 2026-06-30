import type { Capability, CapabilitySideEffect } from "./fragments.js";

export function capabilitySideEffects(
  capability: Capability,
): CapabilitySideEffect[] {
  if ("side_effects" in capability && capability.side_effects) {
    return capability.side_effects;
  }
  if (capability.type === "executable_hook") {
    return ["local-write"];
  }
  return [];
}

export function mergeSideEffects(
  ...groups: readonly CapabilitySideEffect[][]
): CapabilitySideEffect[] {
  const merged = new Set<CapabilitySideEffect>();
  for (const group of groups) {
    for (const effect of group) merged.add(effect);
  }
  return [...merged];
}

export function formatSideEffects(
  effects: readonly CapabilitySideEffect[],
): string {
  return effects.map((effect) => `\`${effect}\``).join(", ");
}
