import type { DogfoodResult } from "../commands/dogfood.js";

export function reportDogfood(result: DogfoodResult): void {
  console.log(
    `anamnesis dogfood check — ${result.status.agentfile.project.name}`,
  );
  const previous =
		result.score.previous === null
			? "no previous score"
			: `${result.score.previous}/5`;
  console.log(
    `  continuity readiness: ${result.score.passed}/${result.score.total} (${result.score.trend}; ${previous})`,
  );
  console.log(`  tools: ${result.status.agentfile.tools.join(", ")}`);
  console.log(
    `  status: ${result.status.summary.entriesClean} clean, ${result.status.summary.entriesUserModified} modified, ${result.status.summary.entriesMissing} missing`,
  );
  console.log(
    `  doctor: ${result.doctor.ok ? "ok" : "issues"} (${result.doctor.summary.errors} errors, ${result.doctor.summary.warnings} warnings)`,
  );
  for (const criterion of result.criteria) {
    console.log(`  ${criterion.status.padEnd(4)} ${criterion.label}`);
  }
  for (const check of result.checks) {
    console.log(
      `  ${check.outcome.padEnd(7)} ${check.command.join(" ")} (${check.durationMs}ms)`,
    );
    // A failure without its reason cannot be acted on.
    if (check.outcome === "fail" && check.detail) {
      console.log(`          ${check.detail.split("\n")[0]!.slice(0, 300)}`);
    }
  }
  if (result.appendedPath) {
    console.log(`  appended: ${result.appendedPath}`);
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}
