import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  promote,
  detectCapabilityType,
  PromoteError,
} from "./promote.js";
import { loadFragment } from "../core/fragments.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Empty library — no fragments yet. */
function emptyLibrary(): string {
  const lib = tmpDir("anamnesis-lib-");
  fs.mkdirSync(path.join(lib, "fragments"), { recursive: true });
  return lib;
}

/** Project with seeded files in standard locations. */
function seededProject(): string {
  const proj = tmpDir("anamnesis-proj-");
  fs.mkdirSync(path.join(proj, ".claude/hooks"), { recursive: true });
  fs.mkdirSync(path.join(proj, ".claude/commands"), { recursive: true });
  fs.mkdirSync(path.join(proj, ".claude/skills/my-skill"), { recursive: true });
  fs.mkdirSync(path.join(proj, ".anamnesis/ontology"), { recursive: true });
  fs.mkdirSync(path.join(proj, ".anamnesis/task-harnesses"), { recursive: true });

  fs.writeFileSync(
    path.join(proj, ".claude/hooks/my-validate.sh"),
    "#!/bin/sh\necho hi\n",
  );
  fs.writeFileSync(
    path.join(proj, ".claude/commands/my-cmd.md"),
    "## /my-cmd\n\ndescribe behavior.\n",
  );
  fs.writeFileSync(
    path.join(proj, ".claude/skills/my-skill/SKILL.md"),
    "# my-skill\n\nbody.\n",
  );
  fs.writeFileSync(
    path.join(proj, ".claude/skills/my-skill/refs.md"),
    "supporting.\n",
  );
  fs.writeFileSync(
    path.join(proj, ".anamnesis/ontology/my.yaml"),
    "key: value\n",
  );
  fs.writeFileSync(
    path.join(proj, ".anamnesis/task-harnesses/context-continuity.yaml"),
    [
      'schema_version: "anamnesis.task_harness.v1"',
      'id: "context-continuity"',
      'title: "Context continuity"',
      "",
    ].join("\n"),
  );
  return proj;
}

// ---------------------------------------------------------------------------

describe("detectCapabilityType", () => {
  it("infers from .claude/hooks/", () => {
    expect(detectCapabilityType(".claude/hooks/x.sh")).toBe("executable_hook");
  });

  it("infers from .claude/commands/", () => {
    expect(detectCapabilityType(".claude/commands/x.md")).toBe("slash_command");
  });

  it("infers from .claude/skills/", () => {
    expect(detectCapabilityType(".claude/skills/foo")).toBe("skill");
  });

  it("infers from .anamnesis/ontology/", () => {
    expect(detectCapabilityType(".anamnesis/ontology/x.yaml")).toBe("ontology");
  });

  it("infers from .anamnesis/task-harnesses/", () => {
    expect(detectCapabilityType(".anamnesis/task-harnesses/x.yaml")).toBe(
      "task_harness",
    );
  });

  it("falls back to extension for shell scripts", () => {
    expect(detectCapabilityType("scripts/x.sh")).toBe("executable_hook");
  });

  it("falls back to extension for yaml", () => {
    expect(detectCapabilityType("config/x.yaml")).toBe("ontology");
  });

  it("returns undefined when no signal", () => {
    expect(detectCapabilityType("README.md")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("promote — new fragment", () => {
  let project: string;
  let library: string;

  beforeEach(() => {
    project = seededProject();
    library = emptyLibrary();
  });

  it("promotes a hook into a brand-new fragment", () => {
    const result = promote({
      projectRoot: project,
      libraryRoot: library,
      source: ".claude/hooks/my-validate.sh",
      fragmentId: "my-stack",
    });

    expect(result.isNewFragment).toBe(true);
    expect(result.capability.type).toBe("executable_hook");
    expect(result.filesWritten).toContain(
      "adapters/claude-code/hooks/my-validate.sh",
    );

    const dir = path.join(library, "fragments", "my-stack");
    const def = loadFragment(dir);
    expect(def.id).toBe("my-stack");
    expect(def.version).toBe(1);
    expect(def.capabilities).toHaveLength(1);
    expect(def.capabilities[0]).toMatchObject({
      type: "executable_hook",
      side_effects: ["local-write"],
    });

    // Hook file is executable.
    const hookFp = path.join(dir, "adapters/claude-code/hooks/my-validate.sh");
    expect(fs.existsSync(hookFp)).toBe(true);
    expect(fs.statSync(hookFp).mode & 0o777).toBe(0o755);
  });

  it("promotes a slash_command, deriving name from filename", () => {
    const result = promote({
      projectRoot: project,
      libraryRoot: library,
      source: ".claude/commands/my-cmd.md",
      fragmentId: "my-stack",
    });

    expect(result.capability.type).toBe("slash_command");
    if (result.capability.type === "slash_command") {
      expect(result.capability.name).toBe("my-cmd");
    }
  });

  it("promotes a slash_command with explicit --name override", () => {
    const result = promote({
      projectRoot: project,
      libraryRoot: library,
      source: ".claude/commands/my-cmd.md",
      fragmentId: "my-stack",
      name: "renamed",
    });
    if (result.capability.type === "slash_command") {
      expect(result.capability.name).toBe("renamed");
    }
    expect(
      fs.existsSync(
        path.join(
          library,
          "fragments/my-stack/adapters/claude-code/commands/renamed.md",
        ),
      ),
    ).toBe(true);
  });

  it("promotes a skill directory, copying nested files", () => {
    const result = promote({
      projectRoot: project,
      libraryRoot: library,
      source: ".claude/skills/my-skill",
      fragmentId: "my-stack",
    });

    expect(result.capability.type).toBe("skill");
    const skillDir = path.join(
      library,
      "fragments/my-stack/adapters/claude-code/skills/my-skill",
    );
    expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, "refs.md"))).toBe(true);
  });

  it("promotes an ontology slice", () => {
    const result = promote({
      projectRoot: project,
      libraryRoot: library,
      source: ".anamnesis/ontology/my.yaml",
      fragmentId: "my-stack",
    });

    expect(result.capability.type).toBe("ontology");
    expect(
      fs.existsSync(
        path.join(library, "fragments/my-stack/content/ontology.snippet.yaml"),
      ),
    ).toBe(true);
  });

  it("promotes a task_harness, deriving name from filename", () => {
    const result = promote({
      projectRoot: project,
      libraryRoot: library,
      source: ".anamnesis/task-harnesses/context-continuity.yaml",
      fragmentId: "my-stack",
    });

    expect(result.capability.type).toBe("task_harness");
    if (result.capability.type === "task_harness") {
      expect(result.capability.name).toBe("context-continuity");
      expect(result.capability.lifecycle).toBe("reusable");
      expect(result.capability.source).toBe(
        "task-harnesses/context-continuity.yaml",
      );
    }
    expect(
      fs.existsSync(
        path.join(
          library,
          "fragments/my-stack/task-harnesses/context-continuity.yaml",
        ),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("promote — existing fragment", () => {
  let project: string;
  let library: string;

  beforeEach(() => {
    project = seededProject();
    library = emptyLibrary();
    // First promote creates the fragment.
    promote({
      projectRoot: project,
      libraryRoot: library,
      source: ".claude/hooks/my-validate.sh",
      fragmentId: "my-stack",
    });
  });

  it("appends a new capability without overwriting fragment.yaml", () => {
    promote({
      projectRoot: project,
      libraryRoot: library,
      source: ".claude/commands/my-cmd.md",
      fragmentId: "my-stack",
    });
    const def = loadFragment(path.join(library, "fragments/my-stack"));
    expect(def.capabilities).toHaveLength(2);
    const types = def.capabilities.map((c) => c.type).sort();
    expect(types).toEqual(["executable_hook", "slash_command"]);
  });

  it("rejects duplicate hook source", () => {
    expect(() =>
      promote({
        projectRoot: project,
        libraryRoot: library,
        source: ".claude/hooks/my-validate.sh",
        fragmentId: "my-stack",
      }),
    ).toThrow(/already declared/);
  });

  it("rejects duplicate slash_command name", () => {
    promote({
      projectRoot: project,
      libraryRoot: library,
      source: ".claude/commands/my-cmd.md",
      fragmentId: "my-stack",
    });
    // Try to promote another command with the same derived name.
    fs.writeFileSync(
      path.join(project, ".claude/commands/dup.md"),
      "x\n",
    );
    expect(() =>
      promote({
        projectRoot: project,
        libraryRoot: library,
        source: ".claude/commands/dup.md",
        fragmentId: "my-stack",
        name: "my-cmd",
      }),
    ).toThrow(/already declared/);
  });

  it("appends ontology content instead of adding a second capability", () => {
    promote({
      projectRoot: project,
      libraryRoot: library,
      source: ".anamnesis/ontology/my.yaml",
      fragmentId: "my-stack",
    });
    // Add another ontology snippet
    fs.writeFileSync(
      path.join(project, ".anamnesis/ontology/extra.yaml"),
      "extra: data\n",
    );
    promote({
      projectRoot: project,
      libraryRoot: library,
      source: ".anamnesis/ontology/extra.yaml",
      fragmentId: "my-stack",
    });
    const def = loadFragment(path.join(library, "fragments/my-stack"));
    const ontologies = def.capabilities.filter((c) => c.type === "ontology");
    expect(ontologies).toHaveLength(1);
    const ontologyContent = fs.readFileSync(
      path.join(
        library,
        "fragments/my-stack/content/ontology.snippet.yaml",
      ),
      "utf8",
    );
    expect(ontologyContent).toContain("key: value");
    expect(ontologyContent).toContain("extra: data");
  });

  it("rejects duplicate task_harness name", () => {
    promote({
      projectRoot: project,
      libraryRoot: library,
      source: ".anamnesis/task-harnesses/context-continuity.yaml",
      fragmentId: "my-stack",
    });
    fs.writeFileSync(
      path.join(project, ".anamnesis/task-harnesses/other.yaml"),
      'schema_version: "anamnesis.task_harness.v1"\n',
    );

    expect(() =>
      promote({
        projectRoot: project,
        libraryRoot: library,
        source: ".anamnesis/task-harnesses/other.yaml",
        fragmentId: "my-stack",
        name: "context-continuity",
      }),
    ).toThrow(/already declared/);
  });
});

// ---------------------------------------------------------------------------

describe("promote — error cases", () => {
  let project: string;
  let library: string;

  beforeEach(() => {
    project = seededProject();
    library = emptyLibrary();
  });

  it("errors when source does not exist", () => {
    expect(() =>
      promote({
        projectRoot: project,
        libraryRoot: library,
        source: ".claude/hooks/missing.sh",
        fragmentId: "x",
      }),
    ).toThrow(/source not found/);
  });

  it("errors when capability type cannot be inferred", () => {
    fs.writeFileSync(path.join(project, "README.md"), "x");
    expect(() =>
      promote({
        projectRoot: project,
        libraryRoot: library,
        source: "README.md",
        fragmentId: "x",
      }),
    ).toThrow(/cannot infer capability type/);
  });

  it("accepts project_memory promotion (v0.2+)", () => {
    fs.writeFileSync(
      path.join(project, "snippet.md"),
      "## My Stack\n\nuse semantic versioning.\n",
    );
    const result = promote({
      projectRoot: project,
      libraryRoot: library,
      source: "snippet.md",
      fragmentId: "my-stack",
      capabilityType: "project_memory",
    });
    expect(result.capability.type).toBe("project_memory");
    if (result.capability.type === "project_memory") {
      expect(result.capability.region).toBe("my-stack");
      expect(result.capability.source).toBe("content/agents.snippet.md");
    }
  });

  it("rejects skill source missing SKILL.md", () => {
    fs.mkdirSync(path.join(project, ".claude/skills/bad"));
    fs.writeFileSync(path.join(project, ".claude/skills/bad/note.md"), "x");
    expect(() =>
      promote({
        projectRoot: project,
        libraryRoot: library,
        source: ".claude/skills/bad",
        fragmentId: "x",
      }),
    ).toThrow(/missing SKILL\.md/);
  });

  it("rejects executable_hook source that's a directory", () => {
    fs.mkdirSync(path.join(project, "scripts"), { recursive: true });
    expect(() =>
      promote({
        projectRoot: project,
        libraryRoot: library,
        source: "scripts",
        fragmentId: "x",
        capabilityType: "executable_hook",
      }),
    ).toThrow(/must be a file/);
  });

  it("aborts when existing fragment.yaml is corrupt", () => {
    fs.mkdirSync(path.join(library, "fragments/broken"), { recursive: true });
    fs.writeFileSync(
      path.join(library, "fragments/broken/fragment.yaml"),
      "id: broken\nversion: not-a-number\ncapabilities: 'should-be-array'\n",
    );
    expect(() =>
      promote({
        projectRoot: project,
        libraryRoot: library,
        source: ".claude/hooks/my-validate.sh",
        fragmentId: "broken",
      }),
    ).toThrow(/schema validation/);
  });
});

// ---------------------------------------------------------------------------

describe("promote — project_memory region extraction", () => {
  let project: string;
  let library: string;

  beforeEach(() => {
    project = seededProject();
    library = emptyLibrary();
  });

  it("extracts a named region from AGENTS.md when --region is given", () => {
    const agentsMd = `# Project doc

## Random user prose
Stuff here.

<!-- anamnesis:region id=my-stack fragment=my-stack@1 -->
## My Stack
This region's content goes into the fragment.
<!-- /anamnesis:region -->

More user prose after the region.
`;
    fs.writeFileSync(path.join(project, "AGENTS.md"), agentsMd);

    const result = promote({
      projectRoot: project,
      libraryRoot: library,
      source: "AGENTS.md",
      fragmentId: "my-stack",
      capabilityType: "project_memory",
      region: "my-stack",
    });

    const written = fs.readFileSync(
      path.join(library, "fragments/my-stack/content/agents.snippet.md"),
      "utf8",
    );
    expect(written).toContain("## My Stack");
    expect(written).toContain("This region's content");
    // User prose outside the region MUST NOT be copied.
    expect(written).not.toContain("Random user prose");
    expect(written).not.toContain("More user prose");
    if (result.capability.type === "project_memory") {
      expect(result.capability.region).toBe("my-stack");
    }
  });

  it("uses whole file content when no matching region found", () => {
    fs.writeFileSync(
      path.join(project, "snippet.md"),
      "## Plain content\nno regions here.\n",
    );
    promote({
      projectRoot: project,
      libraryRoot: library,
      source: "snippet.md",
      fragmentId: "plain",
      capabilityType: "project_memory",
    });
    const written = fs.readFileSync(
      path.join(library, "fragments/plain/content/agents.snippet.md"),
      "utf8",
    );
    expect(written).toBe("## Plain content\nno regions here.\n");
  });

  it("rejects duplicate project_memory in the same fragment", () => {
    fs.writeFileSync(
      path.join(project, "first.md"),
      "first content",
    );
    fs.writeFileSync(
      path.join(project, "second.md"),
      "second content",
    );
    promote({
      projectRoot: project,
      libraryRoot: library,
      source: "first.md",
      fragmentId: "x",
      capabilityType: "project_memory",
    });
    expect(() =>
      promote({
        projectRoot: project,
        libraryRoot: library,
        source: "second.md",
        fragmentId: "x",
        capabilityType: "project_memory",
      }),
    ).toThrow(/already declared/);
  });

  it("default region id is the fragment id when --region omitted", () => {
    fs.writeFileSync(path.join(project, "snippet.md"), "x");
    const result = promote({
      projectRoot: project,
      libraryRoot: library,
      source: "snippet.md",
      fragmentId: "my-frag",
      capabilityType: "project_memory",
    });
    if (result.capability.type === "project_memory") {
      expect(result.capability.region).toBe("my-frag");
    }
  });
});

describe("promote — fragment.yaml output cleanliness", () => {
  it("omits empty default arrays from fragment.yaml", () => {
    const project = seededProject();
    const library = emptyLibrary();
    promote({
      projectRoot: project,
      libraryRoot: library,
      source: ".claude/hooks/my-validate.sh",
      fragmentId: "clean",
    });
    const yaml = fs.readFileSync(
      path.join(library, "fragments/clean/fragment.yaml"),
      "utf8",
    );
    expect(yaml).not.toContain("requires: []");
    expect(yaml).not.toContain("conflicts: []");
    expect(yaml).not.toContain("owns: []");
    // But required fields must be present.
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed.id).toBe("clean");
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.capabilities)).toBe(true);
  });
});
