import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { init } from "./init.js";
import { doctor, DoctorError } from "./doctor.js";
import { upsertRegion } from "../core/regions.js";
import { readAgentfile, writeAgentfile } from "../core/agentfile.js";

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
    expect(result.issues).toEqual([]);
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
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "tracked-entry-user-modified",
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
        }),
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
    expect(result.issues).toEqual([]);
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
});
