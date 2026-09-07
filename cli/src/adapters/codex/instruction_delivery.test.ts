import { describe, expect, it } from "vitest";
import type { RenderAction, RegionAction } from "../../core/render.js";
import { compactInstructionDelivery } from "./instruction_delivery.js";

const region: RegionAction = {
	kind: "region",
	file: "AGENTS.md",
	regionId: "codex-hook-check",
	fragmentId: "base",
	fragmentVersion: 20,
	sideEffects: ["local-write"],
	content:
		"### base hook: `check.sh`\n\n**When:** `Stop`\n\n**Declared side effects:** `local-write`.\n\n**Intent:** the script below documents the fallback.\n\n```bash\n#!/bin/bash\nprintf 'do not lose this behavior'\n```",
};

describe("Codex instruction delivery", () => {
	it("keeps the full fallback recoverable with the same declared side effects", () => {
		const original = structuredClone(region);
		const actions = compactInstructionDelivery([region]);
		const short = actions.find((a) => a.kind === "region");
		const full = actions.find((a) => a.kind === "file");
		expect(full?.kind).toBe("file");
		if (full?.kind !== "file" || short?.kind !== "region")
			throw Error("missing delivery pair");
		expect(full.content).toBe(original.content);
		expect(full.sideEffects).toEqual(original.sideEffects);
		expect(short.sideEffects).toEqual(original.sideEffects);
		expect(short.content).toContain(full.path);
		expect(short.content).toContain("Stop");
		expect(short.content).not.toContain("printf");
		expect(short.content).toContain(
			"without reading or replaying the hook implementation",
		);
		expect(short.content).toContain(
			"Output from another hook on the same event does not establish this",
		);
		expect(region).toEqual(original);
	});

	it("keeps concise command procedures inline without a second retrieval", () => {
		const command = {
			...region,
			regionId: "codex-cmd-example",
			content: "é".repeat(1024),
		};
		expect(compactInstructionDelivery([command])).toEqual([command]);
		const longer = { ...command, content: command.content + "x" };
		const actions = compactInstructionDelivery([longer]);
		expect(actions).toHaveLength(2);
		expect(actions.find((a) => a.kind === "file")?.content).toBe(
			longer.content,
		);
	});

	it("preserves native files and ordinary project memory", () => {
		const memory: RegionAction = { ...region, regionId: "anamnesis-base" };
		const native: RenderAction = {
			kind: "file",
			path: ".codex/hooks.json",
			fragmentId: "base",
			fragmentVersion: 20,
			content: "native",
			sideEffects: ["local-write"],
		};
		expect(compactInstructionDelivery([memory, native])).toEqual([
			memory,
			native,
		]);
	});

	it("keeps different scopes distinct and delivery stable", () => {
		const nested = { ...region, file: "apps/api/AGENTS.md" };
		const files = compactInstructionDelivery([region, nested]).filter(
			(a) => a.kind === "file",
		);
		expect(new Set(files.map((a) => a.path)).size).toBe(2);
		expect(
			files.every((a) => a.path.startsWith(".anamnesis/codex-instructions/")),
		).toBe(true);
		expect(files.map((a) => a.path)).toEqual([
			".anamnesis/codex-instructions/file-AGENTS.md/codex-hook-check.md",
			".anamnesis/codex-instructions/file-apps%2Fapi%2FAGENTS.md/codex-hook-check.md",
		]);
	});
});
