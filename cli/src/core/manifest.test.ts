import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  emptyManifest,
  readManifest,
  writeManifest,
  upsertRegion,
  upsertFile,
  removeRegion,
  removeFile,
  regionsForFragment,
  filesForFragment,
  findRegion,
  findFile,
  regionDrift,
  fileDrift,
  manifestPath,
  ManifestParseError,
  type RegionEntry,
  type FileEntry,
} from "./manifest.js";
import { sha256 } from "../util/hash.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-manifest-"));
}

const h1 = sha256("v1");
const h2 = sha256("v2");
const h3 = sha256("v3");

function makeRegion(over: Partial<RegionEntry> = {}): RegionEntry {
  return {
    file: "AGENTS.md",
    region_id: "prisma",
    fragment_id: "prisma",
    fragment_version: 1,
    template_version: 1,
    base_rendered_hash: h1,
    last_applied_hash: h1,
    current_user_hash: h1,
    ...over,
  };
}

function makeFile(over: Partial<FileEntry> = {}): FileEntry {
  return {
    path: ".claude/hooks/prisma-validate.sh",
    fragment_id: "prisma",
    fragment_version: 1,
    last_applied_hash: h1,
    current_user_hash: h1,
    ...over,
  };
}

describe("readManifest / writeManifest", () => {
  it("returns empty manifest when file absent", () => {
    const dir = tmpProject();
    expect(readManifest(dir)).toEqual(emptyManifest());
  });

  it("roundtrips through write + read", () => {
    const dir = tmpProject();
    const m = upsertRegion(emptyManifest(), makeRegion());
    writeManifest(dir, m);
    expect(readManifest(dir)).toEqual(m);
  });

  it("creates .anamnesis/ directory if missing", () => {
    const dir = tmpProject();
    writeManifest(dir, emptyManifest());
    expect(fs.existsSync(manifestPath(dir))).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const dir = tmpProject();
    fs.mkdirSync(path.join(dir, ".anamnesis"));
    fs.writeFileSync(manifestPath(dir), "{not json");
    expect(() => readManifest(dir)).toThrow(ManifestParseError);
  });

  it("rejects schema violations", () => {
    const dir = tmpProject();
    fs.mkdirSync(path.join(dir, ".anamnesis"));
    fs.writeFileSync(
      manifestPath(dir),
      JSON.stringify({ version: 1, regions: [{ bad: true }], files: [] }),
    );
    expect(() => readManifest(dir)).toThrow(/validation failed/);
  });

  it("rejects wrong hash format", () => {
    const dir = tmpProject();
    fs.mkdirSync(path.join(dir, ".anamnesis"));
    const region = { ...makeRegion(), base_rendered_hash: "plain-hex" };
    fs.writeFileSync(
      manifestPath(dir),
      JSON.stringify({ version: 1, regions: [region], files: [] }),
    );
    expect(() => readManifest(dir)).toThrow(/validation failed/);
  });
});

describe("upsertRegion / removeRegion", () => {
  it("inserts a new region", () => {
    const m = upsertRegion(emptyManifest(), makeRegion());
    expect(m.regions).toHaveLength(1);
  });

  it("replaces an existing region (same file+region_id)", () => {
    const base = upsertRegion(emptyManifest(), makeRegion());
    const updated = upsertRegion(
      base,
      makeRegion({ last_applied_hash: h2, current_user_hash: h2 }),
    );
    expect(updated.regions).toHaveLength(1);
    expect(updated.regions[0]!.last_applied_hash).toBe(h2);
  });

  it("keeps distinct regions separate (different region_id)", () => {
    let m = upsertRegion(emptyManifest(), makeRegion({ region_id: "a" }));
    m = upsertRegion(m, makeRegion({ region_id: "b" }));
    expect(m.regions).toHaveLength(2);
  });

  it("removeRegion drops only the matching entry", () => {
    let m = upsertRegion(emptyManifest(), makeRegion({ region_id: "a" }));
    m = upsertRegion(m, makeRegion({ region_id: "b" }));
    m = removeRegion(m, "AGENTS.md", "a");
    expect(m.regions).toHaveLength(1);
    expect(m.regions[0]!.region_id).toBe("b");
  });
});

describe("upsertFile / removeFile", () => {
  it("inserts a new file entry", () => {
    const m = upsertFile(emptyManifest(), makeFile());
    expect(m.files).toHaveLength(1);
  });

  it("replaces an existing file entry (same path)", () => {
    const base = upsertFile(emptyManifest(), makeFile());
    const updated = upsertFile(
      base,
      makeFile({ last_applied_hash: h2, current_user_hash: h2 }),
    );
    expect(updated.files).toHaveLength(1);
    expect(updated.files[0]!.last_applied_hash).toBe(h2);
  });

  it("removeFile drops only the matching entry", () => {
    let m = upsertFile(emptyManifest(), makeFile({ path: "a" }));
    m = upsertFile(m, makeFile({ path: "b" }));
    m = removeFile(m, "a");
    expect(m.files).toHaveLength(1);
    expect(m.files[0]!.path).toBe("b");
  });
});

describe("queries", () => {
  it("regionsForFragment filters by fragment_id", () => {
    let m = emptyManifest();
    m = upsertRegion(m, makeRegion({ fragment_id: "prisma", region_id: "p" }));
    m = upsertRegion(m, makeRegion({ fragment_id: "k8s", region_id: "k" }));
    expect(regionsForFragment(m, "prisma")).toHaveLength(1);
    expect(regionsForFragment(m, "prisma")[0]!.region_id).toBe("p");
  });

  it("filesForFragment filters by fragment_id", () => {
    let m = emptyManifest();
    m = upsertFile(m, makeFile({ path: "a", fragment_id: "prisma" }));
    m = upsertFile(m, makeFile({ path: "b", fragment_id: "k8s" }));
    expect(filesForFragment(m, "prisma")).toHaveLength(1);
    expect(filesForFragment(m, "prisma")[0]!.path).toBe("a");
  });

  it("findRegion returns undefined when not found", () => {
    const m = upsertRegion(emptyManifest(), makeRegion());
    expect(findRegion(m, "AGENTS.md", "missing")).toBeUndefined();
  });

  it("findFile returns undefined when not found", () => {
    const m = upsertFile(emptyManifest(), makeFile());
    expect(findFile(m, "missing")).toBeUndefined();
  });
});

describe("drift detection", () => {
  it("regionDrift: clean when hashes match", () => {
    const r = makeRegion({ last_applied_hash: h1, current_user_hash: h1 });
    expect(regionDrift(r)).toBe("clean");
  });

  it("regionDrift: user-modified when hashes diverge", () => {
    const r = makeRegion({ last_applied_hash: h1, current_user_hash: h3 });
    expect(regionDrift(r)).toBe("user-modified");
  });

  it("fileDrift: clean when hashes match", () => {
    const f = makeFile({ last_applied_hash: h1, current_user_hash: h1 });
    expect(fileDrift(f)).toBe("clean");
  });

  it("fileDrift: user-modified when hashes diverge", () => {
    const f = makeFile({ last_applied_hash: h1, current_user_hash: h3 });
    expect(fileDrift(f)).toBe("user-modified");
  });
});

describe("immutability", () => {
  it("upsertRegion does not mutate input manifest", () => {
    const original = emptyManifest();
    const originalRegions = original.regions;
    upsertRegion(original, makeRegion());
    expect(original.regions).toBe(originalRegions);
    expect(original.regions).toHaveLength(0);
  });
});
