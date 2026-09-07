import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, expect, it } from "vitest";
import { normalizeRegionContent, renderRegion } from "../core/regions.js";
import {
	contextInstructionAudit,
	formatInstructionAudit,
} from "./context_instruction_audit.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-instruction-audit-"),
	);
	roots.push(root);
	return root;
}
function write(root: string, file: string, body: string) {
	fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
	fs.writeFileSync(path.join(root, file), body);
}
const paragraph =
	"Read the exact project source before changing a requirement, and preserve ownership boundaries throughout the task.\nA standalone orientation request ends after the answer; an auxiliary context lookup continues the original authorized work.";
const digest = (text: string) =>
	`sha256:${createHash("sha256").update(text).digest("hex")}`;

it("maps mixed ownership, drift and literal copies without giving permission to remove compatibility", () => {
	const root = fixture();
	const region = {
		id: "codex-skill-orient",
		fragmentId: "base",
		fragmentVersion: 25,
		content: paragraph,
	};
	const native = ".codex/skills/orient/SKILL.md";
	const full = `<!-- OMX:AGENTS:START -->\nKeep required checks.\n<!-- OMX:AGENTS:END -->\n\n${renderRegion(region)}\nUser instructions remain.\n`;
	write(root, "AGENTS.md", full);
	write(root, native, `${paragraph}\n`);
	write(
		root,
		".anamnesis/manifest.json",
		JSON.stringify({
			version: 1,
			regions: [
				{
					file: "AGENTS.md",
					region_id: region.id,
					fragment_id: "base",
					fragment_version: 25,
					template_version: 1,
					base_rendered_hash: digest(normalizeRegionContent(paragraph)),
					last_applied_hash: digest(normalizeRegionContent(paragraph)),
					current_user_hash: digest(normalizeRegionContent(paragraph)),
				},
			],
			files: [
				{
					path: "AGENTS.md",
					fragment_id: "base",
					fragment_version: 25,
					last_applied_hash: digest(full),
					current_user_hash: digest(full),
				},
			],
		}),
	);
	const result = contextInstructionAudit({ projectRoot: root });
	expect(result.complete).toBe(true);
	expect(
		result.surfaces
			.filter((s) => s.source_path === "AGENTS.md")
			.map((s) => [s.owner, s.drift]),
	).toEqual([
		["user-or-other", "unknown"],
		["anamnesis-recorded", "unchanged"],
		["user-or-other", "unknown"],
	]);
	expect(
		result.findings.find((f) => f.code === "literal-duplicate")?.refs,
	).toEqual([`${native}:1`, "AGENTS.md:6"]);
	expect(result.findings.some((f) => f.code === "native-fallback-pair")).toBe(
		true,
	);
	expect(result.summary.instruction_bytes).toBe(
		Buffer.byteLength(full) + Buffer.byteLength(`${paragraph}\n`),
	);
	write(root, "AGENTS.md", full.replace(paragraph, `${paragraph}\nChanged.`));
	expect(
		contextInstructionAudit({ projectRoot: root }).surfaces.find(
			(s) => s.region_id,
		)?.drift,
	).toBe("modified");
	expect(fs.readFileSync(path.join(root, native), "utf8")).toBe(
		`${paragraph}\n`,
	);
});

it("does not follow directory/file symlinks, nonregular files, or oversized inputs", () => {
	const root = fixture();
	const outside = fixture();
	write(outside, "SKILL.md", paragraph);
	fs.mkdirSync(path.join(root, ".codex/skills"), { recursive: true });
	fs.symlinkSync(outside, path.join(root, ".codex/skills/external"));
	fs.symlinkSync(path.join(outside, "SKILL.md"), path.join(root, "AGENTS.md"));
	fs.mkdirSync(path.join(root, "CLAUDE.md"));
	write(root, ".cursorrules", "x".repeat(1_048_577));
	const result = contextInstructionAudit({ projectRoot: root });
	expect(result.complete).toBe(false);
	expect(result.surfaces).toEqual([]);
	expect(result.warnings).toEqual(
		expect.arrayContaining([
			"Skipped symlink: AGENTS.md",
			"Skipped symlink: .codex/skills/external",
			"Skipped non-regular file: CLAUDE.md",
			"Read budget exceeded: .cursorrules",
		]),
	);
	expect(result.summary.bytes_read).toBe(0);
});

it("keeps marker-only ownership unverified and reports malformed regions without inferring ownership", () => {
	const root = fixture();
	write(
		root,
		"AGENTS.md",
		renderRegion({
			id: "unknown",
			fragmentId: "base",
			fragmentVersion: 25,
			content: "Stop. Do not continue the task.",
		}),
	);
	write(
		root,
		"CLAUDE.md",
		"<!-- anamnesis:region id=bad fragment=base@1 -->\nUnclosed",
	);
	write(root, ".anamnesis/manifest.json", "{bad");
	const result = contextInstructionAudit({ projectRoot: root });
	expect(result.surfaces.map((s) => s.owner)).toEqual(["unverified-marker"]);
	expect(result.warnings).toEqual([
		"Invalid manifest; ownership remains unverified.",
		"Malformed regions: CLAUDE.md; ownership is not inferred.",
	]);
	expect(result.findings[0]?.classification).toBe("review-candidate");
	expect(formatInstructionAudit(result)).toContain(
		"Disk bytes are not model token usage",
	);
});

it("bounds directory enumeration and file inventory and ignores unrelated project data", () => {
	const root = fixture();
	for (let i = 0; i < 258; i++)
		write(
			root,
			`.codex/agents/agent-${i.toString().padStart(3, "0")}.md`,
			"Scoped agent",
		);
	write(root, "src/private.md", paragraph);
	const result = contextInstructionAudit({ projectRoot: root });
	expect(result.summary.files).toBe(256);
	expect(result.complete).toBe(false);
	expect(result.warnings).toContain(
		"File limit reached; inventory is partial.",
	);
	expect(result.surfaces.some((s) => s.source_path === "src/private.md")).toBe(
		false,
	);
});

it("reports missing registered files and regions while optional absent surfaces stay silent", () => {
	const root = fixture();
	const entry = {
		fragment_id: "base",
		fragment_version: 25,
		last_applied_hash: digest("old"),
		current_user_hash: digest("old"),
	};
	write(
		root,
		".anamnesis/manifest.json",
		JSON.stringify({
			version: 1,
			files: [
				{ ...entry, path: ".codex/skills/missing/SKILL.md" },
				{
					...entry,
					path: ".anamnesis/codex-instructions/file-AGENTS.md/missing.md",
				},
				{ ...entry, path: "AGENTS.override.md" },
			],
			regions: [
				{
					...entry,
					file: "AGENTS.md",
					region_id: "missing",
					template_version: 1,
					base_rendered_hash: digest("old"),
				},
			],
		}),
	);
	write(root, "AGENTS.md", "User-only instructions.");
	const result = contextInstructionAudit({ projectRoot: root });
	expect(result.complete).toBe(false);
	expect(result.warnings).toEqual([
		"Missing registered instruction file: .anamnesis/codex-instructions/file-AGENTS.md/missing.md",
		"Missing registered instruction file: .codex/skills/missing/SKILL.md",
		"Missing registered region: AGENTS.md#missing",
		"Missing registered instruction file: AGENTS.override.md",
	]);
	expect(result.surfaces[0]?.owner).toBe("user-or-other");
});
