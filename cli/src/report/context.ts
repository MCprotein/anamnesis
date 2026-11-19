import type {
	ContextDiagnosticsResult,
} from "../commands/context_diagnostics.js";
import type { ContextDocsResult } from "../commands/context_docs.js";
import type {
	ContextIndexResult,
	ContextQueryResult,
} from "../commands/context_index.js";
import type {
	ContextResumeResult,
	ContextSubagentPreambleResult,
} from "../commands/context_resume.js";

export function reportContextIndex(result: ContextIndexResult): void {
  console.log("anamnesis context index");
  console.log(`  sources: ${result.summary.sources}`);
  console.log(`  entries: ${result.summary.entries}`);
  const byKind = Object.entries(result.summary.byKind)
    .filter(([, total]) => total > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (byKind.length > 0) {
    console.log(
      `  kinds: ${byKind.map(([kind, total]) => `${kind}=${total}`).join(", ")}`,
    );
  }
  if (result.warnings.length > 0) {
    console.log(`  warnings: ${result.warnings.length}`);
    for (const warning of result.warnings.slice(0, 5)) {
      console.log(`    - ${warning}`);
    }
  }
  if (result.writtenPath) {
    console.log(`  written: ${result.writtenPath}`);
  } else {
    console.log("  (dry-run - re-run with --write to write the index)");
  }
}

export function reportContextDocs(result: ContextDocsResult): void {
  console.log("anamnesis context docs");
	console.log(
		`  pages: ${result.summary.pages} (${result.summary.canonicalPages} canonical)`,
	);
  console.log(`  headings: ${result.summary.headings}`);
  console.log(
    `  links: ${result.summary.links} ` +
      `(internal=${result.summary.internalLinks}, external=${result.summary.externalLinks}, broken=${result.summary.brokenLinks})`,
  );
  console.log(
    `  backlinks: ${result.summary.backlinks}, ontology refs: ${result.summary.ontologyRefs} ` +
      `(missing=${result.summary.missingOntologyRefs})`,
  );
  if (result.catalog.path) {
    console.log(`  catalog: ${result.catalog.path}`);
  } else {
    console.log("  catalog: default roots");
  }
  const canonical = result.pages.filter((page) => page.canonical);
  if (canonical.length > 0) {
    console.log("  canonical docs:");
    for (const page of canonical.slice(0, 8)) {
			console.log(
				`    - ${page.source_path} (${page.heading_count} heading(s))`,
			);
    }
  }
  const broken = result.links.filter(
    (link) => link.status === "missing" || link.status === "missing-anchor",
  );
  if (broken.length > 0) {
    console.log("  broken links:");
    for (const link of broken.slice(0, 8)) {
      console.log(
        `    - ${link.source_path}:${link.line} -> ${link.target} (${link.status})`,
      );
    }
  }
	const missingOntologyRefs = result.ontology_refs.filter(
		(ref) => ref.status === "missing",
	);
  if (missingOntologyRefs.length > 0) {
    console.log("  missing ontology refs:");
    for (const ref of missingOntologyRefs.slice(0, 8)) {
      console.log(`    - ${ref.source_path}:${ref.line} -> ${ref.target}`);
    }
  }
  if (result.warnings.length > 0) {
    console.log(`  warnings: ${result.warnings.length}`);
    for (const warning of result.warnings.slice(0, 5)) {
      console.log(`    - ${warning}`);
    }
  }
}

export function reportContextQuery(result: ContextQueryResult): void {
  console.log(`anamnesis context query - ${result.query}`);
  if (result.kind) {
    console.log(`  kind: ${result.kind}`);
  }
  console.log(
    `  searched: ${result.summary.entriesSearched}, matches: ${result.summary.matches}`,
  );
  console.log(`  index: ${result.summary.indexStatus}`);
  if (
    result.summary.changedSources > 0 ||
    result.summary.missingSources > 0 ||
    result.summary.newSources > 0 ||
    result.summary.missingGeneratedKinds > 0
  ) {
    console.log(
      `  freshness: changed=${result.summary.changedSources}, missing=${result.summary.missingSources}, ` +
        `new=${result.summary.newSources}, missing-kinds=${result.summary.missingGeneratedKinds}`,
    );
  }
  if (result.warnings.length > 0) {
    console.log(`  warnings: ${result.warnings.length}`);
    for (const warning of result.warnings.slice(0, 5)) {
      console.log(`    - ${warning}`);
    }
  }
  for (const match of result.matches) {
    const entry = match.entry;
    console.log(
      `  [${match.score}] ${entry.kind} ${entry.source_path} ${entry.stable_ref}`,
    );
    console.log(`      ${entry.title}`);
    if (entry.snippet) {
      console.log(`      ${entry.snippet}`);
    }
  }
}

export function reportContextDiagnostics(result: ContextDiagnosticsResult): void {
  console.log(`anamnesis context diagnose - ${result.ok ? "ok" : "issues"}`);
  console.log(
    `  issues: ${result.summary.warnings} warning(s), ${result.summary.info} info`,
  );
  for (const issue of result.issues) {
    console.log(
      `  ${issue.severity.padEnd(7)} ${issue.code} ${issue.source_path} ${issue.stable_ref}`,
    );
    console.log(`      ${issue.message}`);
    if (issue.repair) {
      console.log(`      repair: ${issue.repair}`);
    }
  }
}

export function reportContextResume(result: ContextResumeResult): void {
  console.log(result.bundle);
  console.log("");
  console.log(
    `summary: ${result.summary.lines} lines, ${result.summary.chars} chars, ~${result.summary.estimatedTokens} tokens`,
  );
  if (result.writtenPath) {
    console.log(`written: ${result.writtenPath}`);
  }
}

export function reportContextSubagentPreamble(
  result: ContextSubagentPreambleResult,
): void {
  console.log(result.preamble);
  console.log("");
  console.log(
    `summary: ${result.summary.lines} lines, ${result.summary.chars} chars, ` +
      `~${result.summary.estimatedTokens} tokens, ` +
      `${result.summary.startupSourcePointers} startup pointer(s), ` +
      `${result.summary.agentControlSources} control source(s)`,
  );
  if (result.writtenPath) {
    console.log(`written: ${result.writtenPath}`);
  }
}
