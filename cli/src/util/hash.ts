import { createHash } from "node:crypto";

// Content-addressed hash used throughout the manifest.
// Prefix keeps format explicit in serialized form.
export const HASH_PREFIX = "sha256:";

export function sha256(content: string | Buffer): string {
  return HASH_PREFIX + createHash("sha256").update(content).digest("hex");
}

export function isHash(value: unknown): value is string {
  return (
    typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value)
  );
}
