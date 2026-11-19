import type { ReleaseCheckResult } from "../commands/release_check.js";

export function reportReleaseCheck(result: ReleaseCheckResult): void {
  console.log(
    `anamnesis release check — ${result.projectName} (${result.ok ? "ok" : "blocked"})`,
  );
  console.log(`  generated: ${result.generatedAt}`);
  console.log(
    `  checks: pass=${result.summary.pass} warn=${result.summary.warn} fail=${result.summary.fail} skip=${result.summary.skip}`,
  );
  console.log(
    `  status: fragments updates=${result.statusSummary.fragmentUpdatesAvailable}, partial=${result.statusSummary.partialAdoptions}; drift modified=${result.statusSummary.entriesUserModified}, missing=${result.statusSummary.entriesMissing}`,
  );
  console.log(
    `  apply preview: create=${result.updateSummary.create} update=${result.updateSummary.update} blocked=${result.updateSummary.blocked} user-modified=${result.updateSummary.userModified}`,
  );
  console.log(
    `  doctor: errors=${result.doctorSummary.errors} warnings=${result.doctorSummary.warnings} info=${result.doctorSummary.info}`,
  );
  for (const check of result.checks) {
    console.log(`  ${check.status.padEnd(4)} ${check.label}: ${check.detail}`);
    if (check.next) {
      console.log(`       next: ${check.next}`);
    }
  }
  if (result.evidencePath) {
    console.log(`  evidence: ${result.evidencePath}`);
  }
}
