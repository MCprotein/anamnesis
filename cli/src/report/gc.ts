import type { GcResult } from "../commands/gc.js";

export function reportGc(result: GcResult): void {
  console.log(`anamnesis gc — ${result.mode}`);
  console.log(
    `  task harnesses: total=${result.summary.total}, current=${result.summary.current}, reusable=${result.summary.reusable}, unknown=${result.summary.unknown}`,
  );
  console.log(
    `  origin: managed=${result.summary.managed}, user-authored=${result.summary.userAuthored}`,
  );
  console.log(
    `  disk: ${result.summary.totalBytes}/${result.thresholds.maxTotalBytes} bytes${result.summary.diskBudgetExceeded ? " (over budget)" : ""}`,
  );
  console.log(
    `  candidates: ${result.summary.candidates} (delete=${result.summary.deleteCandidates}, review=${result.summary.reviewUserAuthored})`,
  );
  console.log(
    `  handoffs: archives=${result.handoff.summary.archives}, active_refs=${result.handoff.summary.activeReferences}, hot=${result.handoff.summary.hot}, warm=${result.handoff.summary.warm}, cold=${result.handoff.summary.cold}, deprecated=${result.handoff.summary.deprecated}`,
  );
  console.log(
    `  handoff disk: ${result.handoff.summary.totalBytes}/${result.handoff.thresholds.maxTotalBytes} bytes${result.handoff.summary.diskBudgetExceeded ? " (over budget)" : ""}`,
  );
  console.log(
    `  handoff candidates: ${result.handoff.summary.candidates} (review=${result.handoff.summary.reviewUserAuthored}, protected=${result.handoff.summary.protectedByActiveReference})`,
  );
  if (result.warnings.length > 0) {
    console.log(`  warnings: ${result.warnings.length}`);
    for (const warning of result.warnings.slice(0, 5)) {
      console.log(`    - ${warning}`);
    }
  }
  for (const candidate of result.candidates) {
    console.log(
      `  ${candidate.recommendation} ${candidate.path} ${candidate.lifecycle} ${candidate.origin}`,
    );
    console.log(`      reasons: ${candidate.reasons.join(", ")}`);
    console.log(`      age=${candidate.ageDays}d bytes=${candidate.bytes}`);
    if (candidate.supersededBy) {
      console.log(`      superseded_by: ${candidate.supersededBy}`);
    }
  }
  for (const candidate of result.handoff.candidates) {
    console.log(
      `  ${candidate.recommendation} ${candidate.path} ${candidate.tier}`,
    );
    console.log(`      reasons: ${candidate.reasons.join(", ")}`);
    console.log(`      age=${candidate.ageDays}d bytes=${candidate.bytes}`);
    if (candidate.supersededBy) {
      console.log(`      superseded_by: ${candidate.supersededBy}`);
    }
  }
  if (result.applied) {
    console.log(
      `  deleted task harnesses: ${result.deleted.taskHarnesses.length}`,
    );
    if (result.backupDir) {
      console.log(`  backup: ${result.backupDir}`);
    }
    for (const deleted of result.deleted.taskHarnesses.slice(0, 10)) {
      console.log(`    - ${deleted}`);
    }
    console.log(
      `  skipped user-authored task harnesses: ${result.skipped.userAuthoredTaskHarnesses.length}`,
    );
    console.log(
      `  skipped user-modified task harnesses: ${result.skipped.userModifiedTaskHarnesses.length}`,
    );
    console.log(
      `  skipped handoff archives: ${result.skipped.handoffs.length} (review-only)`,
    );
    if (result.evidencePath) {
      console.log(`  evidence: ${result.evidencePath}`);
    }
  } else {
    console.log("  (dry-run — no files deleted)");
  }
}
