import type { MigrateAgentfileResult } from "../commands/migrate.js";

export function reportMigrate(result: MigrateAgentfileResult): void {
  const verdict = result.changed
    ? result.applied
      ? "applied"
      : "changes available"
    : "no changes";
  console.log(`anamnesis migrate agentfile — ${verdict}`);
  console.log(`  path: ${result.agentfilePath}`);
  console.log(`  version: ${result.currentVersion} -> ${result.targetVersion}`);
  if (result.migrations.length === 0) {
    console.log("  migrations: none");
  } else {
    console.log("  migrations:");
    for (const migration of result.migrations) {
      console.log(`    ${migration.id}: ${migration.title}`);
    }
  }
  if (result.backupPath) {
    console.log(`  backup: ${result.backupPath}`);
  }
  if (result.changed && !result.applied) {
    console.log("  (dry-run — re-run with --apply to actually write)");
    for (const line of formatWholeFileDiff(result)) {
      console.log(line);
    }
  }
  console.log(`  next: ${result.nextCommand}`);
}

function formatWholeFileDiff(result: MigrateAgentfileResult): string[] {
  if (result.currentContent === result.newContent) return [];
  const lines = [
    `--- a/${result.agentfilePath}`,
    `+++ b/${result.agentfilePath}`,
  ];
  for (const line of result.currentContent.split(/\r?\n/)) {
    lines.push(`-${line}`);
  }
  for (const line of result.newContent.split(/\r?\n/)) {
    lines.push(`+${line}`);
  }
  return lines;
}

export function migrateJson(result: MigrateAgentfileResult): object {
  return {
    agentfilePath: result.agentfilePath,
    currentVersion: result.currentVersion,
    targetVersion: result.targetVersion,
    applied: result.applied,
    changed: result.changed,
    migrations: result.migrations,
    backupPath: result.backupPath,
    nextCommand: result.nextCommand,
  };
}
