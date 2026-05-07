import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION, readPackageVersion } from "./version.js";

describe("package version metadata", () => {
  it("reads the current package version from package.json", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };

    expect(PACKAGE_VERSION).toBe(pkg.version);
    expect(readPackageVersion()).toBe(pkg.version);
  });
});
