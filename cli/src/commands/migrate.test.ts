import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
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

  it("reports no changes for a current Agentfile with no built-in migrations", () => {
    const project = tmpDir("anamnesis-migrate-");
    writeAgentfile(project);

    const result = migrateAgentfile({ projectRoot: project, apply: false });

    expect(result).toMatchObject({
      agentfilePath: "Agentfile",
      currentVersion: 1,
      targetVersion: 1,
      applied: false,
      changed: false,
      migrations: [],
      backupPath: null,
      nextCommand: "anamnesis doctor",
    });
    expect(fs.readFileSync(path.join(project, "Agentfile"), "utf8")).toBe(
      MIN_AGENTFILE,
    );
    expect(fs.existsSync(path.join(project, ".anamnesis"))).toBe(false);
  });

  it("preserves comments and formatting when no built-in migration applies", () => {
    const project = tmpDir("anamnesis-migrate-");
    const content = `# managed by hand
version: 1
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
        targetVersion: 2,
      }),
    ).toThrow(/target version 2/);
  });

  it("plans injected migrations without writing during dry-run", () => {
    const project = tmpDir("anamnesis-migrate-");
    writeAgentfile(project);

    const result = migrateAgentfile({
      projectRoot: project,
      apply: false,
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
      migrations: [addBackupRetention],
      now,
    });

    expect(second.changed).toBe(false);
    expect(second.applied).toBe(false);
    expect(second.backupPath).toBeNull();
    expect(second.nextCommand).toBe("anamnesis doctor");
    expect(second.migrations).toEqual([]);
  });
});
