import { describe, expect, it } from "vitest";
import type { RegisteredProjectsResult } from "./projects.js";
import type { UpgradeResult } from "./upgrade.js";
import { syncProjectsAfterUpgrade } from "./upgrade_projects.js";

const upgradeResult: UpgradeResult = {
	packageName: "@mcprotein/anamnesis",
	registry: "https://registry.npmjs.org",
	currentVersion: "1.0.0",
	latestVersion: "1.1.0",
	status: "update-available",
	updateAvailable: true,
	applied: true,
	installCommand: ["npm", "install"],
};

const projectResult: RegisteredProjectsResult = {
	registry_path: "/state/projects.json",
	apply: true,
	projects: [],
	summary: {
		total: 0,
		current: 0,
		ready: 0,
		applied: 0,
		skipped: 0,
		stale: 0,
		errors: 0,
	},
};

describe("syncProjectsAfterUpgrade", () => {
	it("accepts valid JSON only from a successful re-executed CLI", () => {
		expect(
			syncProjectsAfterUpgrade(upgradeResult, {
				libraryRoot: "/unused",
				runner: () => ({
					status: 0,
					signal: null,
					stdout: JSON.stringify(projectResult),
					stderr: "",
				}),
			}),
		).toEqual(projectResult);
	});

	it("fails the parent upgrade when project synchronization exits nonzero", () => {
		expect(() =>
			syncProjectsAfterUpgrade(upgradeResult, {
				libraryRoot: "/unused",
				runner: () => ({
					status: 1,
					signal: null,
					stdout: JSON.stringify({
						...projectResult,
						summary: { ...projectResult.summary, errors: 1 },
					}),
					stderr: "one registered project failed",
				}),
			}),
		).toThrow(/status 1: one registered project failed/);
	});
});
