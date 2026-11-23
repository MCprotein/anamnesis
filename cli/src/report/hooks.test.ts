import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type CodexAppServerTransport,
	inspectCodexHookTrust,
} from "../core/codex_hook_trust.js";
import { codexHookTrustFindings } from "./hooks.js";

const missingCodex: CodexAppServerTransport = {
	listHooks: () =>
		Promise.reject(new Error("Codex app-server process error: spawn codex ENOENT")),
	readConfig: () => Promise.reject(new Error("unused")),
	batchWrite: () => Promise.reject(new Error("unused")),
};

describe("codexHookTrustFindings", () => {
	it("reports nothing when Codex is unavailable and no Anamnesis Codex hooks are registered", async () => {
		const project = fs.mkdtempSync(
			path.join(os.tmpdir(), "anamnesis-hooks-report-"),
		);
		const inspection = await inspectCodexHookTrust(project, {
			transport: missingCodex,
		});

		expect(inspection.available).toBe(false);
		expect(inspection.summary.registered).toBe(0);
		expect(codexHookTrustFindings(inspection)).toEqual({
			attention: [],
			notes: [],
		});
	});

	it("still reports an unavailable Codex when Anamnesis Codex hooks are registered", async () => {
		const project = fs.mkdtempSync(
			path.join(os.tmpdir(), "anamnesis-hooks-report-"),
		);
		const inspection = await inspectCodexHookTrust(project, {
			transport: missingCodex,
		});
		const registered = {
			...inspection,
			summary: { ...inspection.summary, registered: 1, unknown: 1 },
		};

		const { attention } = codexHookTrustFindings(registered);
		expect(attention.map((finding) => finding.topic)).toEqual([
			"hook discovery",
			"hook trust",
		]);
	});
});
