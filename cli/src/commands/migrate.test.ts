import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseAgentfileV1, parseAgentfileV2 } from "../core/agentfile.js";
import {
  CURRENT_AGENTFILE_VERSION,
  migrateAgentfile,
  MigrateError,
  type AgentfileMigration,
} from "./migrate.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const MIN_AGENTFILE = `version: 1
project:
  name: migrate-fixture
tools:
  - claude-code
fragments: []
`;

function writeAgentfile(root: string, content = MIN_AGENTFILE): string {
  const filepath = path.join(root, "Agentfile");
  fs.writeFileSync(filepath, content, "utf8");
  return filepath;
}

const addBackupRetention: AgentfileMigration = {
  id: "v1-add-backup-retention",
  fromVersion: 1,
  toVersion: 1,
  title: "Add backup retention default",
  applies(raw) {
    const settings = (raw as { settings?: Record<string, unknown> }).settings;
    return settings?.backup_retention === undefined;
  },
  apply(raw) {
    const object = raw as Record<string, unknown>;
    const settings = {
      ...((object.settings as Record<string, unknown> | undefined) ?? {}),
      backup_retention: 10,
    };
    return { ...object, settings };
  },
};

describe("migrateAgentfile", () => {
  it("errors when no Agentfile is present", () => {
    expect(() =>
      migrateAgentfile({
        projectRoot: tmpDir("anamnesis-migrate-"),
        apply: false,
      }),
    ).toThrow(MigrateError);
  });

  it("plans the built-in v1 to v2 migration without writing during dry-run", () => {
    const project = tmpDir("anamnesis-migrate-");
    writeAgentfile(project);

    const result = migrateAgentfile({ projectRoot: project, apply: false });

    expect(result).toMatchObject({
      agentfilePath: "Agentfile",
      currentVersion: 1,
      targetVersion: 2,
      applied: false,
      changed: true,
      migrations: [{ id: "v1-to-v2-work-policy", fromVersion: 1, toVersion: 2 }],
      backupPath: null,
      nextCommand: "anamnesis migrate agentfile --apply",
    });
    expect(result.newContent).toContain("version: 2");
    expect(result.newContent).not.toContain("work_policy");
    expect(fs.readFileSync(path.join(project, "Agentfile"), "utf8")).toBe(
      MIN_AGENTFILE,
    );
    expect(fs.existsSync(path.join(project, ".anamnesis"))).toBe(false);
  });

  it("preserves all v1 semantic content while changing only the version", () => {
    const project = tmpDir("anamnesis-migrate-");
    const content = `version: 1
project:
  name: rich-fixture
  description: Preserve every field
  scopes:
    - path: .
    - path: apps/api
      extends: .
tools: [claude-code, codex]
fragments:
  - id: base
    version: 8
    pinned: true
    params: { mode: compact }
declined:
  - id: nextjs
    reason: backend-only
settings:
  backup_retention: 3
  max_handoff_bytes: 131072
overrides:
  files:
    - path: AGENTS.md
      locked: true
`;
    writeAgentfile(project, content);

    const before = parseAgentfileV1(content);
    const result = migrateAgentfile({ projectRoot: project, apply: false });
    const after = parseAgentfileV2(result.newContent);
    const { version: beforeVersion, ...beforeContent } = before;
    const { version: afterVersion, ...afterContent } = after;

    expect(beforeVersion).toBe(1);
    expect(afterVersion).toBe(2);
    expect(afterContent).toEqual(beforeContent);
    expect(after.settings).not.toHaveProperty("work_policy");
  });

  it("preserves comments and formatting when the Agentfile is already v2", () => {
    const project = tmpDir("anamnesis-migrate-");
    const content = `# managed by hand
version: 2
project:
  name: migrate-fixture
tools: [claude-code]
fragments: [] # intentionally empty
`;
    writeAgentfile(project, content);

    const result = migrateAgentfile({ projectRoot: project, apply: true });

    expect(result.changed).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.currentContent).toBe(content);
    expect(result.newContent).toBe(content);
    expect(fs.readFileSync(path.join(project, "Agentfile"), "utf8")).toBe(
      content,
    );
  });

  it("rejects unsupported target versions", () => {
    const project = tmpDir("anamnesis-migrate-");
    writeAgentfile(project);

    expect(() =>
      migrateAgentfile({
        projectRoot: project,
        apply: false,
        targetVersion: CURRENT_AGENTFILE_VERSION + 1,
      }),
    ).toThrow(/target version 3/);
  });

  it("plans injected migrations without writing during dry-run", () => {
    const project = tmpDir("anamnesis-migrate-");
    writeAgentfile(project);

    const result = migrateAgentfile({
      projectRoot: project,
      apply: false,
      targetVersion: 1,
      migrations: [addBackupRetention],
    });

    expect(result.changed).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.nextCommand).toBe("anamnesis migrate agentfile --apply");
    expect(result.migrations.map((m) => m.id)).toEqual([
      "v1-add-backup-retention",
    ]);
    expect(result.newContent).toContain("backup_retention: 10");
    expect(fs.readFileSync(path.join(project, "Agentfile"), "utf8")).toBe(
      MIN_AGENTFILE,
    );
    expect(fs.existsSync(path.join(project, ".anamnesis"))).toBe(false);
  });

  it("applies migrations after backup and is idempotent on repeat", () => {
    const project = tmpDir("anamnesis-migrate-");
    writeAgentfile(project);
    const now = new Date("2026-05-04T00:00:00.000Z");

    const first = migrateAgentfile({
      projectRoot: project,
      apply: true,
      targetVersion: 1,
      migrations: [addBackupRetention],
      now,
    });

    expect(first.changed).toBe(true);
    expect(first.applied).toBe(true);
    expect(first.nextCommand).toBe("anamnesis doctor");
    expect(first.backupPath).toBe(
      path.join(
        project,
        ".anamnesis/backups/2026-05-04T00-00-00-000Z/Agentfile",
      ),
    );
    expect(fs.readFileSync(first.backupPath!, "utf8")).toBe(MIN_AGENTFILE);
    expect(fs.readFileSync(path.join(project, "Agentfile"), "utf8")).toContain(
      "backup_retention: 10",
    );

    const second = migrateAgentfile({
      projectRoot: project,
      apply: true,
      targetVersion: 1,
      migrations: [addBackupRetention],
      now,
    });

    expect(second.changed).toBe(false);
    expect(second.applied).toBe(false);
    expect(second.backupPath).toBeNull();
    expect(second.nextCommand).toBe("anamnesis doctor");
    expect(second.migrations).toEqual([]);
  });

  it("applies v1 to v2 after backing up and remains idempotent", () => {
    const project = tmpDir("anamnesis-migrate-");
    const filepath = writeAgentfile(project);
    const now = new Date("2026-08-13T01:02:03.000Z");

    const first = migrateAgentfile({ projectRoot: project, apply: true, now });

    expect(first).toMatchObject({
      currentVersion: 1,
      targetVersion: 2,
      changed: true,
      applied: true,
      nextCommand: "anamnesis doctor",
    });
    expect(fs.readFileSync(first.backupPath!, "utf8")).toBe(MIN_AGENTFILE);
    const migrated = fs.readFileSync(filepath, "utf8");
    expect(parseAgentfileV2(migrated).version).toBe(2);
    expect(migrated).toContain("version: 2");
    expect(migrated).not.toContain("work_policy");
    expect(migrated.replace("version: 2", "version: 1")).toBe(MIN_AGENTFILE);

    const second = migrateAgentfile({ projectRoot: project, apply: true, now });
    expect(second).toMatchObject({
      currentVersion: 2,
      targetVersion: 2,
      changed: false,
      applied: false,
      migrations: [],
      backupPath: null,
    });
    expect(fs.readFileSync(filepath, "utf8")).toBe(migrated);
  });

  it("rejects invalid v1 content before attempting migration", () => {
    const project = tmpDir("anamnesis-migrate-");
    writeAgentfile(project, `${MIN_AGENTFILE}settings:\n  work_policy: {}\n`);

    expect(() =>
      migrateAgentfile({ projectRoot: project, apply: false }),
    ).toThrow(/Unrecognized key/);
  });
});
