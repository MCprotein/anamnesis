import { describe, expect, it } from "vitest";
import { DEFAULT_UPGRADE_REGISTRY, upgrade, UpgradeError } from "./upgrade.js";

describe("upgrade", () => {
  it("reports an available npm upgrade without applying by default", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = upgrade({
      currentVersion: "0.7.0",
      latestVersion: "1.6.0",
      runner(command, args) {
        calls.push({ command, args });
        return "";
      },
    });

    expect(result).toMatchObject({
      currentVersion: "0.7.0",
      latestVersion: "1.6.0",
      status: "update-available",
      updateAvailable: true,
      applied: false,
    });
    expect(result.installCommand).toEqual([
      "npm",
      "install",
      "-g",
      "@mcprotein/anamnesis@1.6.0",
      "--registry",
      DEFAULT_UPGRADE_REGISTRY,
    ]);
    expect(calls).toEqual([]);
  });

  it("runs npm install only when apply is requested and latest is newer", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = upgrade({
      currentVersion: "0.7.0",
      latestVersion: "1.6.0",
      apply: true,
      runner(command, args) {
        calls.push({ command, args });
        return "";
      },
    });

    expect(result.applied).toBe(true);
    expect(calls).toEqual([
      {
        command: "npm",
        args: [
          "install",
          "-g",
          "@mcprotein/anamnesis@1.6.0",
          "--registry",
          DEFAULT_UPGRADE_REGISTRY,
        ],
      },
    ]);
  });

  it("does not downgrade when the local version is ahead of the registry", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = upgrade({
      currentVersion: "1.6.0",
      latestVersion: "0.7.0",
      apply: true,
      runner(command, args) {
        calls.push({ command, args });
        return "";
      },
    });

    expect(result.status).toBe("local-ahead");
    expect(result.updateAvailable).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.installCommand).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("queries npmjs.org for the latest version when not supplied", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = upgrade({
      currentVersion: "0.7.0",
      runner(command, args) {
        calls.push({ command, args });
        return "1.6.0\n";
      },
    });

    expect(result.latestVersion).toBe("1.6.0");
    expect(calls).toEqual([
      {
        command: "npm",
        args: [
          "view",
          "@mcprotein/anamnesis@latest",
          "version",
          "--registry",
          DEFAULT_UPGRADE_REGISTRY,
        ],
      },
    ]);
  });

  it("surfaces registry lookup failures as UpgradeError", () => {
    expect(() =>
      upgrade({
        currentVersion: "0.7.0",
        runner() {
          throw new Error("network unavailable");
        },
      }),
    ).toThrow(UpgradeError);
  });
});
