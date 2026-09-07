import * as fs from "node:fs";
import * as path from "node:path";
import { manifestSchema, type Manifest } from "../core/manifest.js";
import { parseRegions } from "../core/regions.js";
import { sha256 as hash } from "../util/hash.js";

const LIMITS = {
	files: 256,
	entries: 2048,
	depth: 8,
	fileBytes: 1_048_576,
	totalBytes: 8_388_608,
	findings: 100,
};

type Owner = "anamnesis-recorded" | "unverified-marker" | "user-or-other";
interface Surface {
	source_path: string;
	start_line: number;
	end_line: number;
	region_id?: string;
	owner: Owner;
	fragment?: string;
	bytes: number;
	content_hash: string;
	drift: "unchanged" | "modified" | "unknown";
	loading: string;
}
interface Finding {
	code: "literal-duplicate" | "review-stop-scope" | "native-fallback-pair";
	classification: "review-candidate";
	refs: string[];
	recommendation: string;
}
export interface InstructionAuditResult {
	schema_version: "anamnesis.instruction-audit.v1";
	projectRoot: string;
	complete: boolean;
	limits: typeof LIMITS;
	summary: {
		files: number;
		bytes_read: number;
		instruction_bytes: number;
		surfaces: number;
		findings: number;
	};
	surfaces: Surface[];
	findings: Finding[];
	warnings: string[];
	limitations: string[];
}

/** Explicit, bounded disk audit. Never executes hooks, loads skills, or changes files. */
export function contextInstructionAudit(options: {
	projectRoot: string;
}): InstructionAuditResult {
	const root = fs.realpathSync(options.projectRoot);
	if (!fs.statSync(root).isDirectory())
		throw new Error("project root must be a directory");
	const warnings = new Set<string>();
	let bytesRead = 0;
	let entries = 0;
	let files = 0;
	let instructionBytes = 0;
	const surfaces: Surface[] = [];
	const findings: Finding[] = [];
	const blocks = new Map<string, Set<string>>();
	const candidates = new Set([
		"AGENTS.md",
		"AGENTS.override.md",
		"CLAUDE.md",
		".cursorrules",
	]);
	const loaded = new Set<string>();
	const registered = new Set<string>();
	const warn = (message: string) => {
		if (warnings.size < LIMITS.findings) warnings.add(message);
	};
	const addFinding = (finding: Finding) => {
		if (findings.length < LIMITS.findings) findings.push(finding);
		else warn("Finding limit reached; output is partial.");
	};
	// Every component is checked before open; no traversal into symlinked directories.
	function checkedPath(relative: string): string | undefined {
		if (
			path.isAbsolute(relative) ||
			relative.split(/[\\/]/).some((part) => part === "..") ||
			relative.includes("\\")
		) {
			warn(`Skipped unsafe path: ${relative}`);
			return;
		}
		let current = root;
		for (const part of relative.split("/")) {
			current = path.join(current, part);
			try {
				if (fs.lstatSync(current).isSymbolicLink()) {
					warn(`Skipped symlink: ${relative}`);
					return;
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT")
					warn(`Cannot inspect: ${relative}`);
				else if (registered.has(relative))
					warn(`Missing registered instruction file: ${relative}`);
				return;
			}
		}
		return current;
	}
	function read(relative: string): string | undefined {
		const absolute = checkedPath(relative);
		if (!absolute) return;
		let fd: number | undefined;
		try {
			fd = fs.openSync(
				absolute,
				fs.constants.O_RDONLY |
					fs.constants.O_NOFOLLOW |
					fs.constants.O_NONBLOCK,
			);
			const stat = fs.fstatSync(fd);
			if (!stat.isFile()) {
				warn(`Skipped non-regular file: ${relative}`);
				return;
			}
			if (
				stat.size > LIMITS.fileBytes ||
				bytesRead + stat.size > LIMITS.totalBytes
			) {
				warn(`Read budget exceeded: ${relative}`);
				return;
			}
			// Bounded read even if a file grows after stat.
			const buffer = Buffer.alloc(
				Math.min(LIMITS.fileBytes, LIMITS.totalBytes - bytesRead) + 1,
			);
			let count = 0;
			while (count < buffer.length) {
				const n = fs.readSync(fd, buffer, count, buffer.length - count, null);
				if (!n) break;
				count += n;
			}
			bytesRead += count;
			if (count === buffer.length) {
				warn(`File changed or exceeded read budget: ${relative}`);
				return;
			}
			return buffer.subarray(0, count).toString("utf8");
		} catch {
			warn(`Cannot read: ${relative}`);
			return;
		} finally {
			if (fd !== undefined) fs.closeSync(fd);
		}
	}
	let manifest: Manifest = { version: 1, regions: [], files: [] };
	const rawManifest = read(".anamnesis/manifest.json");
	if (rawManifest !== undefined) {
		try {
			manifest = manifestSchema.parse(JSON.parse(rawManifest));
		} catch {
			warn("Invalid manifest; ownership remains unverified.");
		}
	}
	for (const entry of manifest.regions) {
		if (/\.(md|mdc)$/.test(entry.file)) {
			candidates.add(entry.file);
			registered.add(entry.file);
		}
	}
	for (const entry of manifest.files) {
		if (
			candidates.has(entry.path) ||
			(/\.(md|mdc|toml)$/.test(entry.path) &&
				/(?:skills|agents|commands|rules|codex-instructions)\//.test(entry.path))
		) {
			candidates.add(entry.path);
			registered.add(entry.path);
		}
	}
	function walk(relative: string, depth: number): void {
		const absolute = checkedPath(relative);
		if (!absolute) return;
		if (depth > LIMITS.depth) {
			warn(`Depth limit reached: ${relative}`);
			return;
		}
		let dir: fs.Dir | undefined;
		try {
			dir = fs.opendirSync(absolute);
			for (;;) {
				const entry = dir.readSync();
				if (!entry) break;
				if (++entries > LIMITS.entries) {
					warn("Directory entry limit reached; inventory is partial.");
					break;
				}
				const child = `${relative}/${entry.name}`;
				if (entry.isSymbolicLink()) {
					warn(`Skipped symlink: ${child}`);
					continue;
				}
				if (entry.isDirectory()) walk(child, depth + 1);
				else if (entry.isFile() && /\.(md|mdc|toml)$/.test(entry.name))
					candidates.add(child);
			}
		} catch {
			warn(`Cannot scan: ${relative}`);
		} finally {
			dir?.closeSync();
		}
	}
	for (const directory of [
		".codex/skills",
		".anamnesis/codex-instructions",
		".codex/agents",
		".claude/skills",
		".claude/agents",
		".claude/commands",
		".cursor/rules",
	])
		walk(directory, 0);
	function addSurface(
		relative: string,
		text: string,
		body: string,
		start: number,
		end: number,
		region?: ReturnType<typeof parseRegions>[number],
		mixed = false,
	): void {
		if (!body.trim()) return;
		const recorded = region
			? manifest.regions.find(
					(entry) =>
						entry.file === relative &&
						entry.region_id === region.id &&
						entry.fragment_id === region.fragmentId &&
						entry.fragment_version === region.fragmentVersion,
				)
			: mixed
				? undefined
				: manifest.files.find((entry) => entry.path === relative);
		const digest = hash(body);
		const startLine = text.slice(0, start).split("\n").length;
		const ref = `${relative}:${startLine}${region ? `#${region.id}` : ""}`;
		const surface: Surface = {
			source_path: relative,
			start_line: startLine,
			end_line: text.slice(0, end).split("\n").length,
			...(region ? { region_id: region.id } : {}),
			owner: recorded
				? "anamnesis-recorded"
				: region
					? "unverified-marker"
					: "user-or-other",
			...(recorded
				? { fragment: `${recorded.fragment_id}@${recorded.fragment_version}` }
				: {}),
			bytes: Buffer.byteLength(body),
			content_hash: digest,
			drift: recorded
				? recorded.last_applied_hash === digest
					? "unchanged"
					: "modified"
				: "unknown",
			loading: /(?:^|\/)(?:AGENTS(?:\.override)?|CLAUDE)\.md$/.test(relative)
				? "instruction file; client, scope and precedence determine loading (not observed)"
				: "skill, agent or rule; invocation/discovery conditions determine loading (not observed)",
		};
		surfaces.push(surface);
		// Exact multiline paragraphs only; do not call similar wording a semantic duplicate.
		const paragraphPattern = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
		for (const match of body.matchAll(paragraphPattern)) {
			const paragraph = match[0].trim();
			if (paragraph.length < 160 || !paragraph.includes("\n")) continue;
			const key = hash(paragraph);
			const refs = blocks.get(key) ?? new Set<string>();
			refs.add(
				`${relative}:${startLine + body.slice(0, match.index).split("\n").length - 1}`,
			);
			blocks.set(key, refs);
		}
		if (/\bStop\.\s*(?:Do not|Don't) (?:continue|edit|make)/i.test(body))
			addFinding({
				code: "review-stop-scope",
				classification: "review-candidate",
				refs: [ref],
				recommendation:
					"Read this procedure's invocation scope. Preserve stops for standalone requests; only change a stop if it incorrectly terminates an authorized auxiliary task.",
			});
	}
	for (const relative of [...candidates].sort()) {
		if (files >= LIMITS.files) {
			warn("File limit reached; inventory is partial.");
			break;
		}
		const text = read(relative);
		if (text === undefined) continue;
		files++;
		loaded.add(relative);
		instructionBytes += Buffer.byteLength(text);
		try {
			const regions = parseRegions(text);
			for (const expected of manifest.regions.filter(
				(entry) => entry.file === relative,
			)) {
				if (!regions.some((region) => region.id === expected.region_id))
					warn(`Missing registered region: ${relative}#${expected.region_id}`);
			}
			let offset = 0;
			for (const region of regions) {
				// A mixed file's outside text is never owned solely because a file entry exists.
				addSurface(
					relative,
					text,
					text.slice(offset, region.startIndex),
					offset,
					region.startIndex,
					undefined,
					true,
				);
				addSurface(
					relative,
					text,
					region.content,
					region.startIndex + region.openAnchor.length,
					region.endIndex - region.closeAnchor.length,
					region,
				);
				offset = region.endIndex;
			}
			addSurface(
				relative,
				text,
				text.slice(offset),
				offset,
				text.length,
				undefined,
				regions.length > 0,
			);
		} catch {
			warn(`Malformed regions: ${relative}; ownership is not inferred.`);
		}
	}
	for (const refs of blocks.values()) {
		if (refs.size > 1)
			addFinding({
				code: "literal-duplicate",
				classification: "review-candidate",
				refs: [...refs],
				recommendation:
					"Inspect these identical paragraphs. Remove a copy only after proving equivalent loading and preserving ownership and fallback behavior; disk duplication does not prove runtime waste.",
			});
	}
	for (const surface of surfaces) {
		if (!surface.region_id?.startsWith("codex-skill-")) continue;
		const native = `.codex/skills/${surface.region_id.slice("codex-skill-".length)}/SKILL.md`;
		if (loaded.has(native))
			addFinding({
				code: "native-fallback-pair",
				classification: "review-candidate",
				refs: [`${surface.source_path}:${surface.start_line}`, `${native}:1`],
				recommendation:
					"Native skill and fallback coexist. Keep fallback unless target clients are proven to discover the native skill; update the fragment/renderer source, not the generated region.",
			});
	}
	return {
		schema_version: "anamnesis.instruction-audit.v1",
		projectRoot: root,
		complete: warnings.size === 0,
		limits: LIMITS,
		summary: {
			files,
			bytes_read: bytesRead,
			instruction_bytes: instructionBytes,
			surfaces: surfaces.length,
			findings: findings.length,
		},
		surfaces,
		findings,
		warnings: [...warnings],
		limitations: [
			"Project root instructions, registered region files and selected local skill/agent/rule directories only; global/ancestor instructions, unregistered nested instructions, runtime hooks and dynamic context are not inventoried.",
			"Manifest ownership is recorded provenance, not permission to edit. Marker-only, user, OMX and other tool content must be preserved.",
			"Bytes and literal duplicates are disk observations, not model tokens, cache loss, semantic defects or measured savings. Runtime loading is unknown.",
			"Review exact source and invocation conditions before proposing minimal changes. Compare behavior and actual total token/time usage on held-out tasks before adopting an optimization.",
		],
	};
}

export function formatInstructionAudit(result: InstructionAuditResult): string {
	const lines = [
		`Instruction audit: ${result.summary.files} files, ${result.summary.instruction_bytes} instruction bytes, ${result.summary.findings} review candidates${result.complete ? "" : " (partial)"}.`,
		"Largest surfaces:",
		...[...result.surfaces]
			.sort((a, b) => b.bytes - a.bytes)
			.slice(0, 8)
			.map(
				(s) =>
					`- ${s.source_path}:${s.start_line} ${s.bytes} bytes; ${s.owner}; ${s.drift}`,
			),
		...result.findings
			.slice(0, 8)
			.map((f) => `- ${f.code}: ${f.refs.join(", ")}`),
		...result.warnings.slice(0, 5).map((w) => `Warning: ${w}`),
		"Use --json for the full inventory, recommendations and scope limits. No files changed.",
		"Disk bytes are not model token usage. Loading and performance savings require a matched runtime comparison.",
	];
	return lines.join("\n");
}
