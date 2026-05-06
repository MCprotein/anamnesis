import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { init } from "./init.js";
import { update } from "./update.js";
import { doctor, DoctorError } from "./doctor.js";
import { upsertRegion } from "../core/regions.js";
import {
  readAgentfile,
  writeAgentfile,
  type ToolName,
} from "../core/agentfile.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeLibrary(opts: { version?: number; extraHook?: boolean } = {}): string {
  const lib = tmpDir("anamnesis-doctor-lib-");
  const base = path.join(lib, "base");
  fs.mkdirSync(path.join(base, "content"), { recursive: true });
  fs.mkdirSync(
    path.join(base, "adapters", "claude-code", "hooks"),
    { recursive: true },
  );
  fs.writeFileSync(
    path.join(base, "fragment.yaml"),
    `id: base
version: ${opts.version ?? 1}
capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: anamnesis-base
  - type: executable_hook
    event: SessionStart
    source: adapters/claude-code/hooks/test-hook.sh
    adapters_supported: [claude-code]
${opts.extraHook === true ? `  - type: executable_hook
    event: Stop
    source: adapters/claude-code/hooks/new-hook.sh
    adapters_supported: [claude-code]
` : ""}
`,
  );
  fs.writeFileSync(
    path.join(base, "content", "agents.snippet.md"),
    "## anamnesis baseline\n",
  );
  fs.writeFileSync(
    path.join(base, "adapters", "claude-code", "hooks", "test-hook.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  if (opts.extraHook === true) {
    fs.writeFileSync(
      path.join(base, "adapters", "claude-code", "hooks", "new-hook.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
  }
  return lib;
}

function addBaseArchive(
  library: string,
  version: number,
  opts: { declaredVersion?: number } = {},
): void {
  const archive = path.join(library, "base", ".versions", String(version));
  fs.mkdirSync(path.join(archive, "content"), { recursive: true });
  fs.mkdirSync(
    path.join(archive, "adapters", "claude-code", "hooks"),
    { recursive: true },
  );
  fs.writeFileSync(
    path.join(archive, "fragment.yaml"),
    `id: base
version: ${opts.declaredVersion ?? version}
capabilities:
  - type: project_memory
    source: content/agents.snippet.md
    region: anamnesis-base
  - type: executable_hook
    event: SessionStart
    source: adapters/claude-code/hooks/test-hook.sh
    adapters_supported: [claude-code]
`,
  );
  fs.writeFileSync(
    path.join(archive, "content", "agents.snippet.md"),
    "## anamnesis baseline\n",
  );
  fs.writeFileSync(
    path.join(archive, "adapters", "claude-code", "hooks", "test-hook.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
}

function installProject(): { project: string; library: string } {
  const project = tmpDir("anamnesis-doctor-proj-");
  const library = makeLibrary();
  init({
    projectRoot: project,
    libraryRoot: library,
    dryRun: false,
    allowExecAdapters: true,
    noBootstrap: true,
  });
  return { project, library };
}

function installContinuityProject(): { project: string; library: string } {
  const project = tmpDir("anamnesis-doctor-continuity-");
  const library = process.cwd();
  init({
    projectRoot: project,
    libraryRoot: library,
    dryRun: false,
    allowExecAdapters: true,
    noBootstrap: true,
  });
  const af = readAgentfile(project);
  af.tools = ["claude-code", "codex", "cursor"] satisfies ToolName[];
  writeAgentfile(project, af);
  update({
    projectRoot: project,
    libraryRoot: library,
    apply: true,
    allowExecAdapters: true,
  });
  return { project, library };
}

function writeActiveHandoff(project: string, archivePath: string): void {
  const handoffDir = path.join(project, ".anamnesis", "handoff");
  fs.mkdirSync(handoffDir, { recursive: true });
  fs.writeFileSync(
    path.join(handoffDir, "active.md"),
    [
      "---",
      "updated: 2026-04-30T00:00:00.000Z",
      "agent: codex",
      "git_ref: test-fixture",
      "---",
      "",
      "# Active handoff index",
      "",
      "## Current focus",
      `- stale handoff fixture — archive: \`${archivePath}\``,
      "",
      "## Active tasks",
      `- [in-flight] stale handoff fixture — next: verify stale diagnostics — archive: \`${archivePath}\``,
      "",
    ].join("\n"),
    "utf8",
  );
}

describe("doctor — preconditions", () => {
  it("errors when no Agentfile is present", () => {
    expect(() =>
      doctor({
        projectRoot: tmpDir("anamnesis-doctor-proj-"),
        libraryRoot: makeLibrary(),
      }),
    ).toThrow(DoctorError);
  });
});

describe("doctor — installation integrity", () => {
  it("reports ok for a clean install with hook registration", () => {
    const { project, library } = installProject();

    const result = doctor({ projectRoot: project, libraryRoot: library });

    expect(result.ok).toBe(true);
    expect(result.summary.errors).toBe(0);
  });

  it("reports missing manifest as an error", () => {
    const { project, library } = installProject();
    fs.unlinkSync(path.join(project, ".anamnesis", "manifest.json"));

    const result = doctor({ projectRoot: project, libraryRoot: library });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "manifest-missing" }),
      ]),
    );
  });

  it("reports tracked region edits as warnings", () => {
    const { project, library } = installProject();
    const agentsPath = path.join(project, "AGENTS.md");
    const edited = upsertRegion(fs.readFileSync(agentsPath, "utf8"), {
      id: "anamnesis-base",
      fragmentId: "base",
      fragmentVersion: 1,
      content: "USER EDITED",
    });
    fs.writeFileSync(agentsPath, edited);

    const result = doctor({ projectRoot: project, libraryRoot: library });

    expect(result.ok).toBe(true);
    expect(result.summary.errors).toBe(0);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "tracked-entry-user-modified",
          repair: expect.stringContaining("manual merge review"),
        }),
      ]),
    );
  });

  it("reports installed hooks missing from settings.json", () => {
    const { project, library } = installProject();
    fs.writeFileSync(
      path.join(project, ".claude", "settings.json"),
      "{}\n",
      "utf8",
    );

    const result = doctor({ projectRoot: project, libraryRoot: library });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "hook-registration-missing",
          repair: expect.stringContaining("allow-exec-adapters"),
        }),
      ]),
    );
  });

  it("does not require adapter wiring for fragments disabled on that adapter", () => {
    const project = tmpDir("anamnesis-doctor-proj-");
    const library = makeLibrary();
    fs.writeFileSync(
      path.join(project, "Agentfile"),
      `version: 1
project:
  name: disabled-adapter
tools:
  - claude-code
fragments:
  - id: base
    version: 1
    adapters:
      claude-code: false
`,
    );
    update({
      projectRoot: project,
      libraryRoot: library,
      apply: true,
      allowExecAdapters: true,
    });

    const result = doctor({ projectRoot: project, libraryRoot: library });

    expect(result.ok).toBe(true);
    expect(result.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "hook-registration-missing" }),
        expect.objectContaining({ code: "adapter-renderer-missing" }),
        expect.objectContaining({ code: "render-plan-failed" }),
      ]),
    );
  });

  it("uses archived definitions for pinned fragments", () => {
    const { project } = installProject();
    const af = readAgentfile(project);
    af.fragments = af.fragments.map((f) =>
      f.id === "base" ? { ...f, pinned: true } : f,
    );
    writeAgentfile(project, af);

    const v2Library = makeLibrary({ version: 2, extraHook: true });
    addBaseArchive(v2Library, 1);

    const result = doctor({ projectRoot: project, libraryRoot: v2Library });

    expect(result.ok).toBe(true);
    expect(result.summary.errors).toBe(0);
  });

  it("reports pinned archives whose declared version does not match the archive", () => {
    const { project } = installProject();
    const af = readAgentfile(project);
    af.fragments = af.fragments.map((f) =>
      f.id === "base" ? { ...f, pinned: true } : f,
    );
    writeAgentfile(project, af);

    const v2Library = makeLibrary({ version: 2, extraHook: true });
    addBaseArchive(v2Library, 1, { declaredVersion: 2 });

    const result = doctor({ projectRoot: project, libraryRoot: v2Library });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "fragment-library-missing",
          fragmentId: "base",
          message: expect.stringContaining("archive declares version 2"),
        }),
      ]),
    );
  });

  it("reports continuity-specific issues when an enabled adapter surface is missing", () => {
    const { project, library } = installContinuityProject();
    fs.unlinkSync(path.join(project, ".cursor/rules/load-context.mdc"));

    const result = doctor({ projectRoot: project, libraryRoot: library });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "continuity-adapter-surface-missing",
          target: expect.stringContaining(".cursor/rules/load-context.mdc"),
          repair: expect.stringContaining("user-modified managed files"),
        }),
      ]),
    );
  });

  it("reports stale active handoff state as a continuity warning", () => {
    const { project, library } = installContinuityProject();
    writeActiveHandoff(project, ".anamnesis/handoff/missing.md");

    const result = doctor({ projectRoot: project, libraryRoot: library });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "continuity-active-handoff-stale",
          target: expect.stringContaining(".anamnesis/handoff/missing.md"),
          repair: expect.stringContaining(".anamnesis/handoff/active.md"),
        }),
      ]),
    );
  });

  it("reports advisory Codex hook ownership warnings", () => {
    const { project, library } = installContinuityProject();
    const hooksPath = path.join(project, ".codex", "hooks.json");
    const hooksConfig = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>>;
    };
    hooksConfig.hooks.SessionStart![0]!.hooks.push({
      type: "command",
      command: 'node ".anamnesis/codex-native-hooks/session-start.mjs"',
    });
    fs.writeFileSync(hooksPath, JSON.stringify(hooksConfig, null, 2));

    const result = doctor({ projectRoot: project, libraryRoot: library });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "codex-hook-ownership-warning",
          target: ".codex/hooks.json",
          message: expect.stringContaining("relative project path"),
          repair: expect.stringContaining("--allow-exec-adapters"),
        }),
      ]),
    );
  });

  it("reports declined entries that no longer match the current rulebook", () => {
    const { project, library } = installContinuityProject();
    const af = readAgentfile(project);
    af.declined = [
      { id: "prisma", reason: "old opt-out", declined_at: "2026-01-01" },
    ];
    writeAgentfile(project, af);

    const result = doctor({ projectRoot: project, libraryRoot: library });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "declined-rule-stale",
          target: "Agentfile declined:prisma",
          repair: expect.stringContaining("Agentfile.declined"),
        }),
      ]),
    );
  });

  it("reports missing ontology bootstrap facts as an actionable warning", () => {
    const project = tmpDir("anamnesis-doctor-ontology-gap-");
    const library = process.cwd();
    fs.mkdirSync(path.join(project, "prisma"), { recursive: true });
    fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");
    init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
      noBootstrap: true,
    });

    const result = doctor({ projectRoot: project, libraryRoot: library });

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "ontology-bootstrap-missing",
          fragmentId: "prisma",
          target: ".anamnesis/ontology/prisma.bootstrap.yaml",
          repair: expect.stringContaining("ontology bootstrap --dry-run"),
        }),
      ]),
    );
    const issue = result.issues.find(
      (i) => i.code === "ontology-bootstrap-missing",
    );
    expect(issue?.repair).toContain("/ontology-enrich");
    expect(issue?.repair).toContain(
      ".anamnesis/ontology/prisma.enriched.yaml",
    );
  });

  it("reports stale ontology bootstrap facts as an actionable warning", () => {
    const project = tmpDir("anamnesis-doctor-ontology-stale-");
    const library = process.cwd();
    fs.mkdirSync(path.join(project, "prisma"), { recursive: true });
    fs.writeFileSync(path.join(project, "prisma", "schema.prisma"), "");
    init({
      projectRoot: project,
      libraryRoot: library,
      dryRun: false,
      allowExecAdapters: false,
    });
    fs.writeFileSync(
      path.join(project, "prisma", "schema.prisma"),
      [
        "model User {",
        "  id Int @id",
        "  email String",
        "}",
        "",
      ].join("\n"),
    );

    const result = doctor({ projectRoot: project, libraryRoot: library });

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "ontology-bootstrap-stale",
          fragmentId: "prisma",
          target: ".anamnesis/ontology/prisma.bootstrap.yaml",
          repair: expect.stringContaining("ontology bootstrap --dry-run"),
        }),
      ]),
    );
    const issue = result.issues.find(
      (i) => i.code === "ontology-bootstrap-stale",
    );
    expect(issue?.repair).toContain("/ontology-enrich");
    expect(issue?.repair).toContain(
      ".anamnesis/ontology/prisma.enriched.yaml",
    );
  });
});
