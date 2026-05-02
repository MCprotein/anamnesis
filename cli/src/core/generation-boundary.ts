import * as fs from "node:fs";
import * as path from "node:path";

interface BootstrapGenerationResult {
  writtenToDisk: boolean;
  entries: Array<{
    outcome:
      | "written"
      | "unchanged"
      | "skipped-not-applicable"
      | "skipped-no-introspector";
  }>;
}

export interface GenerationBoundaryStatus {
  hasManagedAgentsMd: boolean;
  hasManagedClaudeMd: boolean;
  staticOntologyFiles: string[];
  bootstrapOntologyFiles: string[];
  enrichedOntologyFiles: string[];
  hasActiveHandoff: boolean;
}

export function collectGenerationBoundaryStatus(
  projectRoot: string,
): GenerationBoundaryStatus {
  const root = path.resolve(projectRoot);
  const ontologyFiles = findOntologyYamlFiles(root);
  const agentsPath = path.join(root, "AGENTS.md");
  const agentsText = fs.existsSync(agentsPath)
    ? fs.readFileSync(agentsPath, "utf8")
    : "";
  const claudePath = path.join(root, "CLAUDE.md");
  const claudeText = fs.existsSync(claudePath)
    ? fs.readFileSync(claudePath, "utf8")
    : "";

  return {
    hasManagedAgentsMd: agentsText.includes("anamnesis:region"),
    hasManagedClaudeMd: claudeText.includes(
      "anamnesis-claude-code-entrypoint",
    ),
    staticOntologyFiles: ontologyFiles.filter(isStaticOntologySlice),
    bootstrapOntologyFiles: ontologyFiles.filter((file) =>
      path.basename(file).endsWith(".bootstrap.yaml"),
    ),
    enrichedOntologyFiles: ontologyFiles.filter((file) =>
      path.basename(file).endsWith(".enriched.yaml"),
    ),
    hasActiveHandoff: fs.existsSync(
      path.join(root, ".anamnesis", "handoff", "active.md"),
    ),
  };
}

export function formatGenerationBoundaryLines(
  status: GenerationBoundaryStatus,
): string[] {
  const bootstrapNext =
    status.bootstrapOntologyFiles.length === 0
      ? "run `anamnesis ontology bootstrap` for deterministic project facts when supported fragments are installed"
      : "re-run `anamnesis ontology bootstrap` after structural project changes";
  const enrichNext =
    status.enrichedOntologyFiles.length === 0
      ? "run `/ontology-enrich` in an agent for relationships, flows, intent, and operational notes"
      : "re-run `/ontology-enrich` after semantic or architectural changes";
  const handoffNext = status.hasActiveHandoff
    ? "refresh `/handoff-prepare` before switching agents if the active task changed"
    : "run `/handoff-prepare` before switching agents with in-progress work";

  return [
    "  generation boundary:",
    `    cli-generated: ${formatManagedAgentsMd(status)}; Claude Code entrypoint=${status.hasManagedClaudeMd ? "present" : "not found"}; ontology static=${status.staticOntologyFiles.length}, bootstrap=${status.bootstrapOntologyFiles.length}`,
    `    agent-required: semantic ontology via /ontology-enrich (.enriched.yaml=${status.enrichedOntologyFiles.length}); task handoff via /handoff-prepare (active=${status.hasActiveHandoff ? "yes" : "no"})`,
    `    next: ${bootstrapNext}; ${enrichNext}; ${handoffNext}`,
  ];
}

function formatManagedAgentsMd(status: GenerationBoundaryStatus): string {
  return status.hasManagedAgentsMd
    ? "AGENTS.md managed context present"
    : "AGENTS.md managed context not found";
}

export function formatBootstrapGenerationBoundaryLines(
  result: BootstrapGenerationResult,
): string[] {
  const factFiles = result.entries.filter(
    (entry) => entry.outcome === "written" || entry.outcome === "unchanged",
  ).length;
  const skipped = result.entries.length - factFiles;
  const writeState = result.writtenToDisk
    ? `${factFiles} .bootstrap.yaml fact file(s) written/updated`
    : `${factFiles} .bootstrap.yaml fact file(s) planned or unchanged`;

  return [
    "  generation boundary:",
    `    cli-generated: Layer A deterministic facts only (${writeState}; ${skipped} skipped); bootstrap files are regenerable`,
    "    agent-required: run `/ontology-enrich` for relationships, flows, intent, and operational notes in `.enriched.yaml`",
  ];
}

function findOntologyYamlFiles(projectRoot: string): string[] {
  if (!fs.existsSync(projectRoot)) return [];
  const files: string[] = [];
  walk(projectRoot, projectRoot, files);
  return files.sort();
}

function walk(root: string, dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.name === "backups" && path.basename(dir) === ".anamnesis") {
        continue;
      }
      walk(root, abs, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = toPosix(path.relative(root, abs));
    if (
      rel.includes("/.anamnesis/ontology/") ||
      rel.startsWith(".anamnesis/ontology/")
    ) {
      if (rel.endsWith(".yaml")) files.push(rel);
    }
  }
}

function isStaticOntologySlice(file: string): boolean {
  const name = path.basename(file);
  return (
    name.endsWith(".yaml") &&
    !name.endsWith(".bootstrap.yaml") &&
    !name.endsWith(".enriched.yaml")
  );
}

function toPosix(file: string): string {
  return file.split(path.sep).join(path.posix.sep);
}
