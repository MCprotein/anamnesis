import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "@mcprotein/anamnesis";
const UNKNOWN_VERSION = "0.0.0-dev";

interface PackageJson {
  name?: unknown;
  version?: unknown;
}

export function readPackageVersion(startUrl = import.meta.url): string {
  const startDir = path.dirname(fileURLToPath(startUrl));
  let dir = startDir;

  for (let depth = 0; depth < 8; depth++) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as PackageJson;
        if (pkg.name === PACKAGE_NAME && typeof pkg.version === "string") {
          return pkg.version;
        }
      } catch {
        return UNKNOWN_VERSION;
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return UNKNOWN_VERSION;
}

export const PACKAGE_VERSION = readPackageVersion();
