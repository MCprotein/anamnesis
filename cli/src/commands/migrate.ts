// `anamnesis migrate agentfile` — schema migration skeleton.
//
// This command migrates Agentfile content only. It deliberately does not
// render fragments, update managed files, run ontology bootstrap, or diagnose
// adapter wiring.

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  AgentfileParseError,
  findAgentfile,
  parseAgentfile,
} from "../core/agentfile.js";

export const CURRENT_AGENTFILE_VERSION = 1;

export interface AgentfileMigration {
  id: string;
  fromVersion: number;
  toVersion: number;
  title: string;
  applies(raw: unknown): boolean;
  apply(raw: unknown): unknown;
}

export interface AgentfileMigrationSummary {
  id: string;
  title: string;
  fromVersion: number;
  toVersion: number;
}

export interface MigrateAgentfileOptions {
  projectRoot: string;
  apply: boolean;
  targetVersion?: number;
  migrations?: readonly AgentfileMigration[];
  now?: Date;
}

export interface MigrateAgentfileResult {
  agentfilePath: string;
  currentVersion: number;
  targetVersion: number;
  applied: boolean;
  changed: boolean;
  migrations: AgentfileMigrationSummary[];
  backupPath: string | null;
  nextCommand: string;
  currentContent: string;
  newContent: string;
}

export class MigrateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrateError";
  }
}

export const builtinAgentfileMigrations: readonly AgentfileMigration[] = [];

export function migrateAgentfile(
  opts: MigrateAgentfileOptions,
): MigrateAgentfileResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const agentfilePath = findAgentfile(projectRoot);
  if (!agentfilePath) {
    throw new MigrateError(
      `no Agentfile found in ${projectRoot}. Run 'anamnesis init' first.`,
    );
  }

  const currentContent = fs.readFileSync(agentfilePath, "utf8");
  const raw = parseRawAgentfile(currentContent, agentfilePath);
  const currentVersion = rawVersion(raw, agentfilePath);
  const targetVersion = opts.targetVersion ?? CURRENT_AGENTFILE_VERSION;

  if (currentVersion > CURRENT_AGENTFILE_VERSION) {
    throw new MigrateError(
      `Agentfile version ${currentVersion} is newer than this CLI supports (${CURRENT_AGENTFILE_VERSION})`,
    );
  }
  if (targetVersion < currentVersion) {
    throw new MigrateError(
      `cannot migrate Agentfile from version ${currentVersion} down to ${targetVersion}`,
    );
  }
  if (targetVersion > CURRENT_AGENTFILE_VERSION) {
    throw new MigrateError(
      `no Agentfile migrations are available for target version ${targetVersion}; current CLI supports up to ${CURRENT_AGENTFILE_VERSION}`,
    );
  }

  const migrations = opts.migrations ?? builtinAgentfileMigrations;
  const plan = planAgentfileMigrations({
    raw,
    currentVersion,
    targetVersion,
    migrations,
  });

  let nextRaw = raw;
  for (const migration of plan) {
    nextRaw = migration.apply(nextRaw);
  }

  const newContent =
    plan.length === 0
      ? currentContent
      : stringifyYaml(nextRaw, { indent: 2, lineWidth: 100 });
  if (plan.length > 0 && targetVersion === CURRENT_AGENTFILE_VERSION) {
    try {
      parseAgentfile(newContent);
    } catch (e) {
      if (e instanceof AgentfileParseError) {
        throw new MigrateError(
          `planned migration produced invalid Agentfile:\n${e.message}`,
        );
      }
      throw e;
    }
  }
  const changed = newContent !== currentContent;
  let backupPath: string | null = null;

  if (opts.apply && changed) {
    backupPath = writeAgentfileBackup({
      projectRoot,
      agentfilePath,
      content: currentContent,
      now: opts.now ?? new Date(),
    });
    fs.writeFileSync(agentfilePath, newContent, "utf8");
  }

  return {
    agentfilePath: path.relative(projectRoot, agentfilePath) || "Agentfile",
    currentVersion,
    targetVersion,
    applied: opts.apply && changed,
    changed,
    migrations: plan.map((migration) => ({
      id: migration.id,
      title: migration.title,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
    })),
    backupPath,
    nextCommand:
      changed && !opts.apply
        ? "anamnesis migrate agentfile --apply"
        : "anamnesis doctor",
    currentContent,
    newContent,
  };
}

export function planAgentfileMigrations(opts: {
  raw: unknown;
  currentVersion: number;
  targetVersion: number;
  migrations: readonly AgentfileMigration[];
}): AgentfileMigration[] {
  const plan: AgentfileMigration[] = [];
  const seenIds = new Set<string>();
  let version = opts.currentVersion;
  let raw = opts.raw;

  while (version <= opts.targetVersion) {
    const candidates = opts.migrations.filter(
      (migration) =>
        !seenIds.has(migration.id) &&
        migration.fromVersion === version &&
        migration.toVersion <= opts.targetVersion &&
        migration.applies(raw),
    );
    if (candidates.length === 0) break;

    candidates.sort(
      (a, b) => a.toVersion - b.toVersion || a.id.localeCompare(b.id),
    );
    const migration = candidates[0]!;
    plan.push(migration);
    seenIds.add(migration.id);
    raw = migration.apply(raw);
    version = migration.toVersion;
  }

  if (version < opts.targetVersion) {
    throw new MigrateError(
      `no migration path from Agentfile version ${version} to ${opts.targetVersion}`,
    );
  }

  return plan;
}

function parseRawAgentfile(content: string, filepath: string): unknown {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (e) {
    throw new MigrateError(
      `${filepath}: YAML parse error: ${(e as Error).message}`,
    );
  }

  const version = rawVersion(raw, filepath);
  if (version === CURRENT_AGENTFILE_VERSION) {
    try {
      parseAgentfile(content);
    } catch (e) {
      if (e instanceof AgentfileParseError) {
        throw new MigrateError(e.message);
      }
      throw e;
    }
  }
  return raw;
}

function rawVersion(raw: unknown, filepath: string): number {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new MigrateError(`${filepath}: Agentfile must be a YAML object`);
  }
  const version = (raw as { version?: unknown }).version;
  if (!Number.isInteger(version) || (version as number) < 1) {
    throw new MigrateError(
      `${filepath}: Agentfile version must be a positive integer`,
    );
  }
  return version as number;
}

function writeAgentfileBackup(opts: {
  projectRoot: string;
  agentfilePath: string;
  content: string;
  now: Date;
}): string {
  const backupRoot = path.join(
    opts.projectRoot,
    ".anamnesis",
    "backups",
    timestampedBackupName(opts.now),
  );
  const rel = path.relative(opts.projectRoot, opts.agentfilePath) || "Agentfile";
  const backupPath = path.join(backupRoot, rel);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, opts.content, "utf8");
  return backupPath;
}

function timestampedBackupName(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}
