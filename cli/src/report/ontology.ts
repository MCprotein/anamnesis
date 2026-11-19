import type { BootstrapResult } from "../commands/ontology.js";
import {
	formatBootstrapGenerationBoundaryLines,
} from "../core/generation-boundary.js";

export function reportBootstrap(result: BootstrapResult): void {
  console.log(`anamnesis ontology bootstrap`);
  for (const e of result.entries) {
    let suffix = "";
    if (e.outcome === "written" || e.outcome === "unchanged") {
      suffix = ` → ${e.path}`;
    }
    const scope =
			e.scopePath === "." || e.scopePath === "" ? "" : ` [${e.scopePath}]`;
    console.log(`  ${e.fragmentId.padEnd(20)} ${e.outcome}${scope}${suffix}`);
  }
  if (!result.writtenToDisk) {
    console.log("  (dry-run or nothing changed — no files written)");
  }
  for (const line of formatBootstrapGenerationBoundaryLines(result)) {
    console.log(line);
  }
  const enrichmentTargets = bootstrapEnrichmentTargets(result);
  if (enrichmentTargets.length > 0) {
    console.log("  semantic follow-up:");
    console.log(
      "    Layer A facts are only the baseline. Ask the active agent to run /ontology-enrich next.",
    );
    for (const target of enrichmentTargets) {
      console.log(`    /ontology-enrich -> ${target}`);
    }
  }
}

function bootstrapEnrichmentTargets(result: BootstrapResult): string[] {
  const targets = new Set<string>();
  for (const entry of result.entries) {
    if (
      entry.path &&
      (entry.outcome === "written" || entry.outcome === "unchanged")
    ) {
      targets.add(entry.path.replace(/\.bootstrap\.yaml$/, ".enriched.yaml"));
    }
  }
  return Array.from(targets).sort();
}
