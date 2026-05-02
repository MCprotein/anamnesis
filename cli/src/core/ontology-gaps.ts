// Ontology gap analysis.
//
// This is a read-only lifecycle diagnostic: static ontology slices prove that
// anamnesis installed baseline context, while bootstrap/enriched files show how
// far the current project has progressed toward useful project-specific facts.

import * as fs from "node:fs";
import * as path from "node:path";
import type { FragmentDefinition } from "./fragments.js";
import type { EffectiveScope } from "./scope.js";
import { IntrospectorRegistry } from "./introspector.js";
import { renderBootstrapOntology } from "./ontology-bootstrap-render.js";
import { ProjectContext } from "./triggers.js";

export type OntologyGapKind =
  | "static-missing"
  | "bootstrap-missing"
  | "bootstrap-stale"
  | "enrichment-missing"
  | "introspector-unavailable"
  | "introspector-not-applicable";

export type OntologyGapSeverity = "warning" | "info";

export interface OntologyGap {
  scopePath: string;
  fragmentId: string;
  kind: OntologyGapKind;
  severity: OntologyGapSeverity;
  target?: string;
  detail: string;
  next: string;
}

export interface OntologyGapSummary {
  total: number;
  warnings: number;
  info: number;
  staticMissing: number;
  bootstrapMissing: number;
  bootstrapStale: number;
  enrichmentMissing: number;
  introspectorUnavailable: number;
  introspectorNotApplicable: number;
}

export interface OntologyGapStatus {
  gaps: OntologyGap[];
  summary: OntologyGapSummary;
}

export interface CollectOntologyGapsOptions {
  projectRoot: string;
  scopes: EffectiveScope[];
  library: Map<string, FragmentDefinition>;
  registry: IntrospectorRegistry;
}

export function collectOntologyGaps(
  opts: CollectOntologyGapsOptions,
): OntologyGapStatus {
  const gaps: OntologyGap[] = [];
  const projectRoot = path.resolve(opts.projectRoot);

  for (const scope of opts.scopes) {
    const scopeRoot = scopeAbsPath(projectRoot, scope.path);
    const ctx = new ProjectContext(scopeRoot);

    for (const installed of scope.fragments) {
      const fragment = opts.library.get(installed.id);
      if (!fragment || !hasOntologyCapability(fragment)) continue;

      const staticRel = scopedOntologyRelPath(scope.path, installed.id, "");
      if (!fs.existsSync(path.join(projectRoot, staticRel))) {
        gaps.push({
          scopePath: scope.path,
          fragmentId: installed.id,
          kind: "static-missing",
          severity: "warning",
          target: staticRel,
          detail: `static ontology slice for '${installed.id}' is missing`,
          next: "Run `anamnesis update --dry-run` to inspect the managed ontology repair, then `anamnesis update --apply` if the plan is acceptable.",
        });
      }

      const introspector = opts.registry.for(installed.id);
      if (!introspector) {
        gaps.push({
          scopePath: scope.path,
          fragmentId: installed.id,
          kind: "introspector-unavailable",
          severity: "info",
          detail: `no deterministic Layer A introspector is registered for '${installed.id}'`,
          next: "Use the static ontology slice and `/ontology-enrich`; add an introspector only if dogfood shows missing project facts hurt agent effectiveness.",
        });
        continue;
      }

      if (!introspector.appliesTo(ctx)) {
        gaps.push({
          scopePath: scope.path,
          fragmentId: installed.id,
          kind: "introspector-not-applicable",
          severity: "info",
          detail: `Layer A introspector for '${installed.id}' found no matching project files in this scope`,
          next: "No bootstrap file is expected until matching project files exist in this scope.",
        });
        continue;
      }

      const bootstrapRel = scopedOntologyRelPath(
        scope.path,
        installed.id,
        ".bootstrap",
      );
      if (!fs.existsSync(path.join(projectRoot, bootstrapRel))) {
        gaps.push({
          scopePath: scope.path,
          fragmentId: installed.id,
          kind: "bootstrap-missing",
          severity: "warning",
          target: bootstrapRel,
          detail: `deterministic Layer A facts for '${installed.id}' have not been bootstrapped`,
          next: "Run `anamnesis ontology bootstrap --dry-run` to inspect generated facts, then run without `--dry-run` to write them.",
        });
        continue;
      }
      const expectedBootstrap = renderBootstrapOntology(
        introspector,
        introspector.introspect(ctx),
      );
      const currentBootstrap = fs.readFileSync(
        path.join(projectRoot, bootstrapRel),
        "utf8",
      );
      if (currentBootstrap !== expectedBootstrap) {
        gaps.push({
          scopePath: scope.path,
          fragmentId: installed.id,
          kind: "bootstrap-stale",
          severity: "warning",
          target: bootstrapRel,
          detail: `deterministic Layer A facts for '${installed.id}' are stale`,
          next: "Run `anamnesis ontology bootstrap --dry-run` to inspect the changed facts, then run without `--dry-run` to refresh them.",
        });
      }

      const enrichedRel = scopedOntologyRelPath(
        scope.path,
        installed.id,
        ".enriched",
      );
      if (!fs.existsSync(path.join(projectRoot, enrichedRel))) {
        gaps.push({
          scopePath: scope.path,
          fragmentId: installed.id,
          kind: "enrichment-missing",
          severity: "warning",
          target: enrichedRel,
          detail: `semantic Layer B enrichment for '${installed.id}' is missing`,
          next: "Run `/ontology-enrich` in an agent to add relationships, flows, intent, and operational notes.",
        });
      }
    }
  }

  gaps.sort(compareOntologyGaps);
  return {
    gaps,
    summary: summarizeOntologyGaps(gaps),
  };
}

function hasOntologyCapability(fragment: FragmentDefinition): boolean {
  return fragment.capabilities.some((cap) => cap.type === "ontology");
}

function scopeAbsPath(projectRoot: string, scopePath: string): string {
  if (scopePath === "." || scopePath === "") return projectRoot;
  return path.join(projectRoot, scopePath);
}

function scopedOntologyRelPath(
  scopePath: string,
  fragmentId: string,
  suffix: "" | ".bootstrap" | ".enriched",
): string {
  const parts =
    scopePath === "." || scopePath === ""
      ? [".anamnesis", "ontology", `${fragmentId}${suffix}.yaml`]
      : [scopePath, ".anamnesis", "ontology", `${fragmentId}${suffix}.yaml`];
  return parts.join("/");
}

function summarizeOntologyGaps(gaps: OntologyGap[]): OntologyGapSummary {
  return {
    total: gaps.length,
    warnings: gaps.filter((g) => g.severity === "warning").length,
    info: gaps.filter((g) => g.severity === "info").length,
    staticMissing: gaps.filter((g) => g.kind === "static-missing").length,
    bootstrapMissing: gaps.filter((g) => g.kind === "bootstrap-missing")
      .length,
    bootstrapStale: gaps.filter((g) => g.kind === "bootstrap-stale").length,
    enrichmentMissing: gaps.filter((g) => g.kind === "enrichment-missing")
      .length,
    introspectorUnavailable: gaps.filter(
      (g) => g.kind === "introspector-unavailable",
    ).length,
    introspectorNotApplicable: gaps.filter(
      (g) => g.kind === "introspector-not-applicable",
    ).length,
  };
}

function compareOntologyGaps(a: OntologyGap, b: OntologyGap): number {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    a.scopePath.localeCompare(b.scopePath) ||
    a.fragmentId.localeCompare(b.fragmentId) ||
    a.kind.localeCompare(b.kind) ||
    (a.target ?? "").localeCompare(b.target ?? "")
  );
}

function severityRank(severity: OntologyGapSeverity): number {
  return severity === "warning" ? 0 : 1;
}
