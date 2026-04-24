import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  planChanges,
  applyChanges,
  backupBeforeApply,
  isExecAdapterPath,
  type RegionChange,
  type FileChange,
} from "./applier.js";
import {
  emptyManifest,
  upsertRegion as upsertRegionEntry,
  upsertFile as upsertFileEntry,
  type Manifest,
  type RegionEntry,
  type FileEntry,
} from "./manifest.js";
import { findRegion, upsertRegion } from "./regions.js";
import { sha256 } from "../util/hash.js";
import type {
  RenderAction,
  RegionAction,
  FileAction,
} from "./render.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-applier-"));
}

function regionAction(over: Partial<RegionAction> = {}): RegionAction {
  return {
    kind: "region",
    file: "AGENTS.md",
    regionId: "prisma",
    fragmentId: "prisma",
    fragmentVersion: 1,
    content: "initial content",
    ...over,
  };
}

function fileAction(over: Partial<FileAction> = {}): FileAction {
  return {
    kind: "file",
    path: "system_graph.yaml",
    fragmentId: "prisma",
    fragmentVersion: 1,
    content: "k: v",
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("isExecAdapterPath", () => {
  it("matches .claude/hooks/*", () => {
    expect(isExecAdapterPath(".claude/hooks/my.sh")).toBe(true);
  });

  it("matches .claude/commands/*", () => {
    expect(isExecAdapterPath(".claude/commands/x.md")).toBe(true);
  });

  it("matches .claude/skills/*", () => {
    expect(isExecAdapterPath(".claude/skills/x/SKILL.md")).toBe(true);
  });

  it("does not match AGENTS.md", () => {
    expect(isExecAdapterPath("AGENTS.md")).toBe(false);
  });

  it("does not match system_graph.yaml", () => {
    expect(isExecAdapterPath("system_graph.yaml")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("planChanges — region", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject();
  });

  it("classifies new region as create", () => {
    const { changes, nextManifest } = planChanges([regionAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.status).toBe("create");
    expect(nextManifest.regions).toHaveLength(1);
    expect(nextManifest.regions[0]!.region_id).toBe("prisma");
  });

  it("classifies unchanged re-run as noop", () => {
    const act = regionAction();
    // First install
    const first = planChanges([act], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    applyChanges(first.changes, { projectRoot: root });
    // Second run with same action + manifest from first
    const second = planChanges([act], {
      projectRoot: root,
      manifest: first.nextManifest,
      allowExecAdapters: false,
    });
    expect(second.changes[0]!.status).toBe("noop");
    expect(second.nextManifest).toEqual(first.nextManifest);
  });

  it("classifies fragment version bump as update", () => {
    const first = planChanges([regionAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    applyChanges(first.changes, { projectRoot: root });
    const bumped = regionAction({ content: "bumped content", fragmentVersion: 2 });
    const second = planChanges([bumped], {
      projectRoot: root,
      manifest: first.nextManifest,
      allowExecAdapters: false,
    });
    expect(second.changes[0]!.status).toBe("update");
    const r = second.nextManifest.regions[0]!;
    expect(r.fragment_version).toBe(2);
    // base_rendered_hash must be preserved (original baseline)
    expect(r.base_rendered_hash).toBe(first.nextManifest.regions[0]!.base_rendered_hash);
  });

  it("detects user edit in region as user-modified", () => {
    const first = planChanges([regionAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    applyChanges(first.changes, { projectRoot: root });
    // User edits the region content directly
    const fp = path.join(root, "AGENTS.md");
    const current = fs.readFileSync(fp, "utf8");
    const edited = upsertRegion(current, {
      id: "prisma",
      fragmentId: "prisma",
      fragmentVersion: 1,
      content: "user-hacked this",
    });
    fs.writeFileSync(fp, edited);
    // Re-plan with same action
    const second = planChanges([regionAction()], {
      projectRoot: root,
      manifest: first.nextManifest,
      allowExecAdapters: false,
    });
    expect(second.changes[0]!.status).toBe("user-modified");
    expect(second.changes[0]!.reason).toContain("differs from last-applied");
    // Manifest unchanged
    expect(second.nextManifest).toEqual(first.nextManifest);
  });

  it("detects deleted region as user-modified", () => {
    const first = planChanges([regionAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    applyChanges(first.changes, { projectRoot: root });
    // User deletes the region contents wholesale
    fs.writeFileSync(path.join(root, "AGENTS.md"), "just some prose\n");
    const second = planChanges([regionAction()], {
      projectRoot: root,
      manifest: first.nextManifest,
      allowExecAdapters: false,
    });
    expect(second.changes[0]!.status).toBe("user-modified");
    expect(second.changes[0]!.reason).toContain("not found on disk");
  });

  it("user-authored region (no manifest) is user-modified", () => {
    // User wrote a region themselves, then adopts anamnesis.
    const preExisting = upsertRegion("", {
      id: "prisma",
      fragmentId: "prisma",
      fragmentVersion: 1,
      content: "hand-authored",
    });
    fs.writeFileSync(path.join(root, "AGENTS.md"), preExisting);
    const { changes, nextManifest } = planChanges([regionAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    expect(changes[0]!.status).toBe("user-modified");
    expect(nextManifest.regions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("planChanges — file", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject();
  });

  it("classifies new file as create and records manifest entry", () => {
    const { changes, nextManifest } = planChanges([fileAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    expect(changes[0]!.status).toBe("create");
    expect(nextManifest.files).toHaveLength(1);
    expect(nextManifest.files[0]!.path).toBe("system_graph.yaml");
  });

  it("classifies unchanged re-run as noop", () => {
    const first = planChanges([fileAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    applyChanges(first.changes, { projectRoot: root });
    const second = planChanges([fileAction()], {
      projectRoot: root,
      manifest: first.nextManifest,
      allowExecAdapters: false,
    });
    expect(second.changes[0]!.status).toBe("noop");
  });

  it("classifies content change as update", () => {
    const first = planChanges([fileAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    applyChanges(first.changes, { projectRoot: root });
    const bumped = fileAction({ content: "new: value", fragmentVersion: 2 });
    const second = planChanges([bumped], {
      projectRoot: root,
      manifest: first.nextManifest,
      allowExecAdapters: false,
    });
    expect(second.changes[0]!.status).toBe("update");
    expect(second.nextManifest.files[0]!.fragment_version).toBe(2);
  });

  it("detects user edit to tracked file as user-modified", () => {
    const first = planChanges([fileAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    applyChanges(first.changes, { projectRoot: root });
    fs.writeFileSync(path.join(root, "system_graph.yaml"), "user: modified");
    const second = planChanges([fileAction()], {
      projectRoot: root,
      manifest: first.nextManifest,
      allowExecAdapters: false,
    });
    expect(second.changes[0]!.status).toBe("user-modified");
  });

  it("detects deleted file as user-modified", () => {
    const first = planChanges([fileAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    applyChanges(first.changes, { projectRoot: root });
    fs.unlinkSync(path.join(root, "system_graph.yaml"));
    const second = planChanges([fileAction()], {
      projectRoot: root,
      manifest: first.nextManifest,
      allowExecAdapters: false,
    });
    expect(second.changes[0]!.status).toBe("user-modified");
  });

  it("preserves `mode` through planning", () => {
    const act = fileAction({
      path: ".claude/hooks/validate.sh",
      content: "#!/bin/sh\n",
      mode: 0o755,
    });
    const { changes } = planChanges([act], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: true,
    });
    expect((changes[0] as FileChange).mode).toBe(0o755);
  });
});

// ---------------------------------------------------------------------------

describe("planChanges — exec-adapter gate", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject();
  });

  it("blocks create of .claude/hooks without allowExecAdapters", () => {
    const act = fileAction({ path: ".claude/hooks/x.sh", mode: 0o755 });
    const { changes } = planChanges([act], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    expect(changes[0]!.status).toBe("blocked");
    expect(changes[0]!.reason).toContain("exec-adapters");
  });

  it("allows create of .claude/hooks with allowExecAdapters", () => {
    const act = fileAction({ path: ".claude/hooks/x.sh", mode: 0o755 });
    const { changes } = planChanges([act], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: true,
    });
    expect(changes[0]!.status).toBe("create");
  });

  it("blocks update of .claude/commands without flag", () => {
    const act1 = fileAction({
      path: ".claude/commands/load.md",
      content: "v1",
    });
    const first = planChanges([act1], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: true,
    });
    applyChanges(first.changes, { projectRoot: root });
    const act2 = fileAction({
      path: ".claude/commands/load.md",
      content: "v2",
      fragmentVersion: 2,
    });
    const second = planChanges([act2], {
      projectRoot: root,
      manifest: first.nextManifest,
      allowExecAdapters: false,
    });
    expect(second.changes[0]!.status).toBe("blocked");
  });

  it("does not block noop even for exec-adapter path", () => {
    const act = fileAction({
      path: ".claude/hooks/x.sh",
      content: "hello",
      mode: 0o755,
    });
    const first = planChanges([act], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: true,
    });
    applyChanges(first.changes, { projectRoot: root });
    // Re-run with the flag OFF. Same content → noop should pass through.
    const second = planChanges([act], {
      projectRoot: root,
      manifest: first.nextManifest,
      allowExecAdapters: false,
    });
    expect(second.changes[0]!.status).toBe("noop");
  });

  it("respects mode alone (no .claude prefix) as exec-gated", () => {
    // Not a typical fragment path, but a file with mode is exec-like.
    const act = fileAction({ path: "scripts/run.sh", mode: 0o755 });
    const { changes } = planChanges([act], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    expect(changes[0]!.status).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------

describe("applyChanges", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject();
  });

  it("writes a region with anchors to disk", () => {
    const { changes } = planChanges([regionAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    applyChanges(changes, { projectRoot: root });
    const text = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
    expect(text).toContain("anamnesis:region id=prisma fragment=prisma@1");
    expect(findRegion(text, "prisma")?.content).toContain("initial content");
  });

  it("writes a FileAction with the requested mode", () => {
    const act = fileAction({
      path: ".claude/hooks/x.sh",
      content: "#!/bin/sh\n",
      mode: 0o755,
    });
    const { changes } = planChanges([act], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: true,
    });
    applyChanges(changes, { projectRoot: root });
    const fp = path.join(root, ".claude/hooks/x.sh");
    expect(fs.existsSync(fp)).toBe(true);
    // On most Unix: mode bits after mkdir/umask include 0o755 for executables.
    const mode = fs.statSync(fp).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it("skips blocked/user-modified/noop statuses", () => {
    const act = fileAction({
      path: ".claude/hooks/blocked.sh",
      content: "hi",
      mode: 0o755,
    });
    const { changes } = planChanges([act], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    expect(changes[0]!.status).toBe("blocked");
    applyChanges(changes, { projectRoot: root });
    expect(fs.existsSync(path.join(root, ".claude/hooks/blocked.sh"))).toBe(
      false,
    );
  });

  it("creates intermediate directories", () => {
    const act = fileAction({
      path: "deep/nested/path/file.yaml",
      content: "x: 1",
    });
    const { changes } = planChanges([act], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    applyChanges(changes, { projectRoot: root });
    expect(
      fs.existsSync(path.join(root, "deep/nested/path/file.yaml")),
    ).toBe(true);
  });

  it("dry-run (not calling applyChanges) does not touch disk", () => {
    planChanges([fileAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    expect(fs.existsSync(path.join(root, "system_graph.yaml"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("backupBeforeApply", () => {
  let root: string;
  beforeEach(() => {
    root = tmpProject();
  });

  it("backs up files that will be updated", () => {
    const first = planChanges([fileAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    applyChanges(first.changes, { projectRoot: root });
    const bumped = fileAction({ content: "v2", fragmentVersion: 2 });
    const second = planChanges([bumped], {
      projectRoot: root,
      manifest: first.nextManifest,
      allowExecAdapters: false,
    });
    const backupDir = path.join(root, ".anamnesis/backups/now");
    const backed = backupBeforeApply(second.changes, {
      projectRoot: root,
      backupDir,
    });
    expect(backed).toContain("system_graph.yaml");
    expect(
      fs.readFileSync(path.join(backupDir, "system_graph.yaml"), "utf8"),
    ).toBe("k: v");
  });

  it("does not back up create (no prior content)", () => {
    const { changes } = planChanges([fileAction()], {
      projectRoot: root,
      manifest: emptyManifest(),
      allowExecAdapters: false,
    });
    const backupDir = path.join(root, ".anamnesis/backups/now");
    const backed = backupBeforeApply(changes, {
      projectRoot: root,
      backupDir,
    });
    expect(backed).toEqual([]);
  });
});
