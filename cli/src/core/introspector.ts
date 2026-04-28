// Introspector — fragment-specific parser that reads project files and
// returns structured facts ("Layer A" of hybrid ontology bootstrap).
//
// See docs/ONTOLOGY-BOOTSTRAP.md for the design.
//
// Each fragment that wants bootstrap support registers an Introspector
// keyed by its fragment id. `anamnesis ontology bootstrap` walks the
// Agentfile, looks up the introspector for each installed fragment,
// runs it against the project root, and writes the result to
// `.anamnesis/ontology/<id>.bootstrap.yaml`.
//
// Layer B (agent-driven enrichment) is shipped as a regular `skill`
// capability of the base fragment and is independent of this module.

import { ProjectContext } from "./triggers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Free-form structured data that an introspector returns. The bootstrap
 * command serializes this object to YAML and writes it to disk.
 *
 * Convention: keys at the top level become top-level YAML keys. Arrays
 * should be sorted by a stable field (name, path, etc.) so re-runs
 * produce byte-identical output absent project changes.
 */
export type OntologyFacts = Record<string, unknown>;

export interface Introspector {
  /** Fragment id this introspector belongs to (e.g. "k8s", "prisma"). */
  fragmentId: string;
  /**
   * Fast pre-flight check. Should be cheap (existence checks, glob
   * counts). Skip the introspector if it returns false.
   */
  appliesTo(ctx: ProjectContext): boolean;
  /**
   * Parse project files and return facts. Must be deterministic — same
   * project state yields same output.
   */
  introspect(ctx: ProjectContext): OntologyFacts;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class IntrospectorError extends Error {
  constructor(
    public readonly fragmentId: string,
    message: string,
  ) {
    super(`[${fragmentId}] ${message}`);
    this.name = "IntrospectorError";
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class IntrospectorRegistry {
  private readonly byId = new Map<string, Introspector>();

  register(introspector: Introspector): void {
    if (this.byId.has(introspector.fragmentId)) {
      throw new IntrospectorError(
        introspector.fragmentId,
        `introspector already registered for fragment '${introspector.fragmentId}'`,
      );
    }
    this.byId.set(introspector.fragmentId, introspector);
  }

  for(fragmentId: string): Introspector | undefined {
    return this.byId.get(fragmentId);
  }

  has(fragmentId: string): boolean {
    return this.byId.has(fragmentId);
  }

  all(): Introspector[] {
    return [...this.byId.values()];
  }
}
