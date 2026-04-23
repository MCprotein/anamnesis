// .anamnesis/manifest.json — region/file tracking for idempotent updates.
// Schema source of truth: docs/DESIGN.md §6.2.

import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const regionEntrySchema = z.object({
  file: z.string(),
  region_id: z.string(),
  fragment_id: z.string(),
  fragment_version: z.number().int().positive(),
  template_version: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()).optional(),
  base_rendered_hash: hashSchema,
  last_applied_hash: hashSchema,
  current_user_hash: hashSchema,
});

export const fileEntrySchema = z.object({
  path: z.string(),
  fragment_id: z.string(),
  fragment_version: z.number().int().positive(),
  last_applied_hash: hashSchema,
  current_user_hash: hashSchema,
});

export const manifestSchema = z.object({
  version: z.literal(1),
  regions: z.array(regionEntrySchema),
  files: z.array(fileEntrySchema),
});

export type RegionEntry = z.infer<typeof regionEntrySchema>;
export type FileEntry = z.infer<typeof fileEntrySchema>;
export type Manifest = z.infer<typeof manifestSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MANIFEST_DIR = ".anamnesis";
export const MANIFEST_FILE = "manifest.json";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ManifestParseError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ManifestParseError";
  }
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export function emptyManifest(): Manifest {
  return { version: 1, regions: [], files: [] };
}

export function manifestPath(projectRoot: string): string {
  return path.join(projectRoot, MANIFEST_DIR, MANIFEST_FILE);
}

export function readManifest(projectRoot: string): Manifest {
  const fp = manifestPath(projectRoot);
  if (!fs.existsSync(fp)) return emptyManifest();

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch (e) {
    throw new ManifestParseError(
      `manifest.json JSON parse error: ${(e as Error).message}`,
    );
  }

  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`,
    );
    throw new ManifestParseError(
      `manifest.json validation failed:\n${lines.join("\n")}`,
      result.error.issues,
    );
  }
  return result.data;
}

export function writeManifest(projectRoot: string, m: Manifest): string {
  const fp = manifestPath(projectRoot);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  // Trailing newline + 2-space indent — stable for git diffs.
  fs.writeFileSync(fp, JSON.stringify(m, null, 2) + "\n", "utf8");
  return fp;
}

// ---------------------------------------------------------------------------
// Mutations (all pure — return a new manifest)
// ---------------------------------------------------------------------------

export function upsertRegion(m: Manifest, entry: RegionEntry): Manifest {
  const idx = m.regions.findIndex(
    (r) => r.file === entry.file && r.region_id === entry.region_id,
  );
  const regions = m.regions.slice();
  if (idx >= 0) regions[idx] = entry;
  else regions.push(entry);
  return { ...m, regions };
}

export function upsertFile(m: Manifest, entry: FileEntry): Manifest {
  const idx = m.files.findIndex((f) => f.path === entry.path);
  const files = m.files.slice();
  if (idx >= 0) files[idx] = entry;
  else files.push(entry);
  return { ...m, files };
}

export function removeRegion(
  m: Manifest,
  file: string,
  regionId: string,
): Manifest {
  return {
    ...m,
    regions: m.regions.filter(
      (r) => !(r.file === file && r.region_id === regionId),
    ),
  };
}

export function removeFile(m: Manifest, filepath: string): Manifest {
  return { ...m, files: m.files.filter((f) => f.path !== filepath) };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function regionsForFragment(
  m: Manifest,
  fragmentId: string,
): RegionEntry[] {
  return m.regions.filter((r) => r.fragment_id === fragmentId);
}

export function filesForFragment(
  m: Manifest,
  fragmentId: string,
): FileEntry[] {
  return m.files.filter((f) => f.fragment_id === fragmentId);
}

export function findRegion(
  m: Manifest,
  file: string,
  regionId: string,
): RegionEntry | undefined {
  return m.regions.find(
    (r) => r.file === file && r.region_id === regionId,
  );
}

export function findFile(m: Manifest, filepath: string): FileEntry | undefined {
  return m.files.find((f) => f.path === filepath);
}

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

export type DriftStatus = "clean" | "user-modified" | "missing";

export function regionDrift(entry: RegionEntry): DriftStatus {
  if (entry.last_applied_hash !== entry.current_user_hash) {
    return "user-modified";
  }
  return "clean";
}

export function fileDrift(entry: FileEntry): DriftStatus {
  if (entry.last_applied_hash !== entry.current_user_hash) {
    return "user-modified";
  }
  return "clean";
}
