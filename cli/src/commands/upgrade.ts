import { execFileSync } from "node:child_process";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../core/version.js";

export const DEFAULT_UPGRADE_REGISTRY = "https://registry.npmjs.org";

export type UpgradeStatus =
  | "up-to-date"
  | "update-available"
  | "local-ahead"
  | "unknown";

export interface UpgradeResult {
  packageName: string;
  registry: string;
  currentVersion: string;
  latestVersion: string;
  status: UpgradeStatus;
  updateAvailable: boolean;
  applied: boolean;
  installCommand: string[];
}

export interface UpgradeOptions {
  registry?: string;
  apply?: boolean;
  currentVersion?: string;
  latestVersion?: string;
  packageName?: string;
  runner?: CommandRunner;
}

type CommandRunner = (
  command: string,
  args: string[],
  options: { encoding?: BufferEncoding; stdio?: "pipe" | "inherit" },
) => string | Buffer;

export class UpgradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpgradeError";
  }
}

export function upgrade(opts: UpgradeOptions = {}): UpgradeResult {
  const packageName = opts.packageName ?? PACKAGE_NAME;
  const registry = opts.registry ?? DEFAULT_UPGRADE_REGISTRY;
  const currentVersion = opts.currentVersion ?? PACKAGE_VERSION;
  const runner = opts.runner ?? defaultRunner;
  const latestVersion =
    opts.latestVersion ?? readLatestVersion({ packageName, registry, runner });
  const status = upgradeStatus(currentVersion, latestVersion);
  const updateAvailable = status === "update-available";
  const installCommand = updateAvailable
    ? [
        "npm",
        "install",
        "-g",
        `${packageName}@${latestVersion}`,
        "--registry",
        registry,
      ]
    : [];

  if (opts.apply === true && updateAvailable) {
    runner("npm", installCommand.slice(1), { stdio: "inherit" });
  }

  return {
    packageName,
    registry,
    currentVersion,
    latestVersion,
    status,
    updateAvailable,
    applied: opts.apply === true && updateAvailable,
    installCommand,
  };
}

function readLatestVersion(input: {
  packageName: string;
  registry: string;
  runner: CommandRunner;
}): string {
  try {
    const output = input.runner(
      "npm",
      ["view", `${input.packageName}@latest`, "version", "--registry", input.registry],
      { encoding: "utf8" },
    );
    const latest = String(output).trim();
    if (latest.length === 0) {
      throw new UpgradeError("registry returned an empty version");
    }
    return latest;
  } catch (e) {
    if (e instanceof UpgradeError) throw e;
    throw new UpgradeError(
      `could not read ${input.packageName}@latest from ${input.registry}: ${(e as Error).message}`,
    );
  }
}

function upgradeStatus(currentVersion: string, latestVersion: string): UpgradeStatus {
  const cmp = compareSemver(currentVersion, latestVersion);
  if (cmp === undefined) {
    return currentVersion === latestVersion ? "up-to-date" : "unknown";
  }
  if (cmp < 0) return "update-available";
  if (cmp > 0) return "local-ahead";
  return "up-to-date";
}

function compareSemver(a: string, b: string): number | undefined {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) return undefined;

  for (let i = 0; i < 3; i++) {
    const diff = parsedA.core[i]! - parsedB.core[i]!;
    if (diff !== 0) return diff;
  }
  if (parsedA.prerelease === parsedB.prerelease) return 0;
  if (parsedA.prerelease === undefined) return 1;
  if (parsedB.prerelease === undefined) return -1;
  return parsedA.prerelease.localeCompare(parsedB.prerelease);
}

function parseSemver(
  version: string,
): { core: [number, number, number]; prerelease?: string } | undefined {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    ...(match[4] ? { prerelease: match[4] } : {}),
  };
}

function defaultRunner(
  command: string,
  args: string[],
  options: { encoding?: BufferEncoding; stdio?: "pipe" | "inherit" },
): string | Buffer {
  return execFileSync(command, args, options);
}
