import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Find the library root relative to the CLI entrypoint.
 *
 * Layout:
 *   <library>/cli/dist/index.js   (built, npm-installed)
 *   <library>/cli/src/index.ts    (dev via tsx)
 *
 * In both cases the library root is two levels up from __dirname.
 */
export function resolveLibraryRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}
