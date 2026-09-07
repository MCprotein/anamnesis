import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assertWorkPromptStagePrivacyBoundary } from "../core/work_prompt_stage.js";
import { resolveWorkStateRoot } from "../core/work_storage.js";
import { init } from "./init.js";
import { update } from "./update.js";
import { readAgentfile, writeAgentfile } from "../core/agentfile.js";
import { emptyManifest } from "../core/manifest.js";
import {
	assertWorkPromptPrivacyOwnership,
	planWorkPromptPrivacy,
} from "../core/work_prompt_privacy.js";
import { handleWorkUserPromptSubmit } from "./work_hook.js";

const libraryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-init-privacy-"),
	);
	roots.push(root);
	execFileSync("git", ["init", "-q", root]);
	return root;
}

function install(projectRoot: string, dryRun = false) {
	return init({
		projectRoot,
		libraryRoot,
		dryRun,
		allowExecAdapters: false,
		noBootstrap: true,
		noContextBootstrap: true,
	});
}

function apply(projectRoot: string, write = true) {
	return update({
		projectRoot,
		libraryRoot,
		apply: write,
		allowExecAdapters: false,
	});
}

function ignorePath(root: string): string {
	return path.join(root, ".anamnesis/.gitignore");
}

function snapshot(root: string): unknown {
	return fs
		.readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.name !== ".git")
		.map((entry) => {
			const target = path.join(root, entry.name);
			return [
				entry.name,
				entry.isDirectory()
					? snapshot(target)
					: fs.readFileSync(target).toString("base64"),
			];
		});
}

describe("init prompt capture privacy", () => {
	it("protects both raw paths before the first native Codex prompt after actual all-adapter init", () => {
		const projectRoot = fixture();
		init({
			projectRoot,
			libraryRoot,
			dryRun: false,
			allowExecAdapters: true,
			tools: ["claude-code", "codex", "cursor"],
			noBootstrap: true,
			noContextBootstrap: true,
		});
		assertWorkPromptStagePrivacyBoundary(
			projectRoot,
			resolveWorkStateRoot(projectRoot).state_root,
		);
		const capture = handleWorkUserPromptSubmit({
			project_root: projectRoot,
			client: "codex",
			payload: {
				session_id: "privacy-session",
				turn_id: "privacy-turn",
				prompt: "Synthetic privacy regression prompt",
			},
		});
		expect(capture.status, JSON.stringify(capture)).toBe("capture_staged");
		for (const raw of ["work-prompt-stage", "work-inputs"]) {
			const candidate = `.anamnesis/${raw}/nested/body.bin`;
			expect(
				execFileSync(
					"git",
					["-C", projectRoot, "check-ignore", "--", candidate],
					{ encoding: "utf8" },
				).trim(),
			).toBe(candidate);
		}
		expect(
			execFileSync(
				"git",
				[
					"-C",
					projectRoot,
					"ls-files",
					"--",
					".anamnesis/work-prompt-stage",
					".anamnesis/work-inputs",
				],
				{ encoding: "utf8" },
			),
		).toBe("");
	});

	it("reports exact planned protection without writing during init or apply preview", () => {
		const projectRoot = fixture();
		const before = snapshot(projectRoot);
		const preview = install(projectRoot, true);
		expect(snapshot(projectRoot)).toEqual(before);
		expect(preview.changes).toContainEqual(
			expect.objectContaining({
				target: "file",
				path: ".anamnesis/.gitignore",
				status: "create",
				reason: expect.stringContaining(
					".anamnesis/work-prompt-stage/ and .anamnesis/work-inputs/",
				),
			}),
		);
		install(projectRoot);
		fs.unlinkSync(ignorePath(projectRoot));
		const installed = snapshot(projectRoot);
		expect(apply(projectRoot, false).changes).toContainEqual(
			expect.objectContaining({
				path: ".anamnesis/.gitignore",
				status: "create",
			}),
		);
		expect(snapshot(projectRoot)).toEqual(installed);
	});

	it("repairs older bounded installs and is idempotent across repeated apply", () => {
		const projectRoot = fixture();
		install(projectRoot);
		fs.unlinkSync(ignorePath(projectRoot));
		const first = apply(projectRoot);
		assertWorkPromptStagePrivacyBoundary(
			projectRoot,
			path.join(projectRoot, ".anamnesis"),
		);
		expect(first.changes).toContainEqual(
			expect.objectContaining({
				path: ".anamnesis/.gitignore",
				status: "create",
			}),
		);
		const protectedText = fs.readFileSync(ignorePath(projectRoot), "utf8");
		for (let i = 0; i < 2; i++) {
			expect(apply(projectRoot).changes).toContainEqual(
				expect.objectContaining({
					path: ".anamnesis/.gitignore",
					status: "noop",
				}),
			);
			expect(fs.readFileSync(ignorePath(projectRoot), "utf8")).toBe(
				protectedText,
			);
		}
		expect(
			first.nextManifest.files.some(
				(entry) => entry.path === ".anamnesis/.gitignore",
			),
		).toBe(false);
	});

	it.each([
		"off",
		"absent",
	] as const)("does not install protection for %s capture policy and preserves existing protection", (policy) => {
		const projectRoot = fixture();
		install(projectRoot);
		const agentfile = readAgentfile(projectRoot);
		if (agentfile.version !== 2) throw new Error("expected v2");
		agentfile.settings!.work_prompt_capture =
			policy === "off" ? { preset: "off" } : undefined;
		writeAgentfile(projectRoot, agentfile);
		const installed = fs.readFileSync(ignorePath(projectRoot), "utf8");
		expect(
			apply(projectRoot).changes.some(
				(change) =>
					change.target === "file" && change.path === ".anamnesis/.gitignore",
			),
		).toBe(false);
		expect(fs.readFileSync(ignorePath(projectRoot), "utf8")).toBe(installed);
		fs.unlinkSync(ignorePath(projectRoot));
		apply(projectRoot);
		expect(fs.existsSync(ignorePath(projectRoot))).toBe(false);
	});

	it("preserves arbitrary user rules and defeats descendant negations without rewriting them", () => {
		const projectRoot = fixture();
		fs.mkdirSync(path.join(projectRoot, ".anamnesis/work-inputs"), {
			recursive: true,
		});
		const userText = "# user rules\r\n/cache/\r\n!keep.txt";
		fs.writeFileSync(ignorePath(projectRoot), userText);
		fs.writeFileSync(
			path.join(projectRoot, ".gitignore"),
			"# root rules\n*.tmp\n",
		);
		const child = path.join(projectRoot, ".anamnesis/work-inputs/.gitignore");
		fs.writeFileSync(child, "!*\n");
		install(projectRoot);
		expect(
			fs
				.readFileSync(ignorePath(projectRoot), "utf8")
				.startsWith(`${userText}\n`),
		).toBe(true);
		expect(fs.readFileSync(child, "utf8")).toBe("!*\n");
		expect(fs.readFileSync(path.join(projectRoot, ".gitignore"), "utf8")).toBe(
			"# root rules\n*.tmp\n",
		);
		expect(
			execFileSync(
				"git",
				[
					"-C",
					projectRoot,
					"check-ignore",
					"--",
					".anamnesis/work-inputs/body.txt",
				],
				{ encoding: "utf8" },
			).trim(),
		).toBe(".anamnesis/work-inputs/body.txt");
		fs.appendFileSync(
			ignorePath(projectRoot),
			"# later user rule\n/another-cache/\n",
		);
		const before = fs.readFileSync(ignorePath(projectRoot), "utf8");
		apply(projectRoot);
		expect(
			fs.readFileSync(ignorePath(projectRoot), "utf8").startsWith(before),
		).toBe(true);
	});

	it.each([
		".anamnesis",
		".anamnesis/.gitignore",
		".anamnesis/work-prompt-stage",
		".anamnesis/work-inputs",
	])("rejects unsafe symlink %s before any init writes", (unsafe) => {
		const projectRoot = fixture();
		const outside = fixture();
		fs.mkdirSync(path.dirname(path.join(projectRoot, unsafe)), {
			recursive: true,
		});
		fs.symlinkSync(outside, path.join(projectRoot, unsafe));
		const before = snapshot(outside);
		for (const dryRun of [true, false])
			expect(() => install(projectRoot, dryRun)).toThrow(
				/unsafe raw Work privacy/,
			);
		expect(fs.existsSync(path.join(projectRoot, "Agentfile"))).toBe(false);
		expect(snapshot(outside)).toEqual(before);
	});

	it("rejects hardlinked ignore ownership and tracked raw paths without changing the index", () => {
		const projectRoot = fixture();
		fs.mkdirSync(path.join(projectRoot, ".anamnesis/work-inputs"), {
			recursive: true,
		});
		const original = path.join(projectRoot, "user-ignore");
		fs.writeFileSync(original, "# owned elsewhere\n");
		fs.linkSync(original, ignorePath(projectRoot));
		expect(() => install(projectRoot)).toThrow(
			/unsafe raw Work privacy ignore file/,
		);
		expect(fs.readFileSync(original, "utf8")).toBe("# owned elsewhere\n");
		fs.unlinkSync(ignorePath(projectRoot));
		const rawPath = ".anamnesis/work-inputs/synthetic.txt";
		fs.writeFileSync(path.join(projectRoot, rawPath), "synthetic test data");
		execFileSync("git", ["-C", projectRoot, "add", "--", rawPath]);
		const index = fs.readFileSync(path.join(projectRoot, ".git/index"));
		expect(() => install(projectRoot)).toThrow(/already tracked/);
		expect(fs.readFileSync(path.join(projectRoot, ".git/index"))).toEqual(
			index,
		);
		expect(fs.existsSync(path.join(projectRoot, "Agentfile"))).toBe(false);
	});

	it("fails apply before writes when ignore ownership becomes unsafe", () => {
		const projectRoot = fixture();
		install(projectRoot);
		fs.unlinkSync(ignorePath(projectRoot));
		fs.symlinkSync(
			path.join(projectRoot, "Agentfile"),
			ignorePath(projectRoot),
		);
		const agentfile = fs.readFileSync(path.join(projectRoot, "Agentfile"));
		for (const write of [false, true])
			expect(() => apply(projectRoot, write)).toThrow(
				/unsafe raw Work privacy ignore file/,
			);
		expect(fs.readFileSync(path.join(projectRoot, "Agentfile"))).toEqual(
			agentfile,
		);
	});

	it("protects non-Git installs when Git is initialized later", () => {
		const projectRoot = fixture();
		fs.rmSync(path.join(projectRoot, ".git"), { recursive: true });
		install(projectRoot);
		execFileSync("git", ["init", "-q", projectRoot]);
		assertWorkPromptStagePrivacyBoundary(
			projectRoot,
			path.join(projectRoot, ".anamnesis"),
		);
	});

	it("fails closed without writes when nested Git capture belongs to the root project", () => {
		const root = fixture();
		const nested = path.join(root, "nested");
		fs.mkdirSync(nested);
		const before = snapshot(root);
		for (const dryRun of [true, false]) {
			expect(() => install(nested, dryRun)).toThrow(
				/storage is outside this installation/,
			);
			expect(snapshot(root)).toEqual(before);
		}
	});

	it("allows an already protected shared root without writing its privacy files", () => {
		const root = fixture();
		install(root);
		const protection = fs.readFileSync(ignorePath(root));
		const nested = path.join(root, "nested");
		fs.mkdirSync(nested);
		expect(planWorkPromptPrivacy(nested, {preset: "bounded"})).toEqual([]);
		install(nested);
		expect(fs.readFileSync(ignorePath(root))).toEqual(protection);
		expect(fs.existsSync(ignorePath(nested))).toBe(false);
		// Revalidate on each plan, even if an earlier lookup was protected.
		fs.writeFileSync(ignorePath(root), "# coverage removed\n");
		expect(() => planWorkPromptPrivacy(nested, {preset: "bounded"})).toThrow(/lacks verified privacy/);
	});

	it("installs and updates a real linked worktree without changing protected primary storage", () => {
		const root = fixture();
		install(root);
		execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture"]);
		const linked = `${root}-linked`;
		roots.push(linked);
		execFileSync("git", ["-C", root, "worktree", "add", "--detach", linked], { stdio: "pipe" });
		const before = snapshot(root);
		install(linked);
		apply(linked);
		expect(snapshot(root)).toEqual(before);
		expect(resolveWorkStateRoot(linked).state_root).toBe(path.join(fs.realpathSync(root), ".anamnesis"));
		expect(fs.existsSync(ignorePath(linked))).toBe(false);
		fs.writeFileSync(ignorePath(root), "# protection removed\n");
		expect(() => apply(linked)).toThrow(/lacks verified privacy/);
	});

	it("rejects shared storage protected only by sentinel names or exposed descendant rules", () => {
		const root = fixture();
		install(root);
		const nested = path.join(root, "nested");
		fs.mkdirSync(nested);
		for (const suffix of [".privacy-check", "*"]) {
			fs.writeFileSync(ignorePath(root), `/work-prompt-stage/${suffix}\n/work-inputs/${suffix}\n!/work-inputs/objects/\n`);
			const before = snapshot(root);
			expect(() => install(nested)).toThrow(/lacks verified privacy/);
			expect(snapshot(root)).toEqual(before);
		}
	});

	it("rejects shared raw directory negations without modifying the owner", () => {
		const root = fixture();
		install(root);
		const nested = path.join(root, "nested");
		fs.mkdirSync(nested);
		fs.writeFileSync(ignorePath(root), "/work-prompt-stage\n!/work-prompt-stage/\n/work-inputs\n!/work-inputs/\n");
		for (const create of [false, true]) {
			if (create) for (const raw of ["work-prompt-stage", "work-inputs"])
				fs.mkdirSync(path.join(root, ".anamnesis", raw), { recursive: true });
			const before = snapshot(root);
			expect(() => install(nested)).toThrow(/lacks verified privacy/);
			expect(snapshot(root)).toEqual(before);
		}
	});

	it("rejects combined synthetic-child coverage in shared storage without owner writes", () => {
		const root = fixture();
		install(root);
		const nested = path.join(root, "nested");
		fs.mkdirSync(nested);
		fs.writeFileSync(ignorePath(root), ["work-prompt-stage", "work-inputs"].map((raw) => `/${raw}\n!/${raw}/\n/${raw}/*\n!/${raw}/objects/\n`).join(""));
		for (const create of [false, true]) {
			if (create) for (const raw of ["work-prompt-stage", "work-inputs"])
				fs.mkdirSync(path.join(root, ".anamnesis", raw, "objects"), { recursive: true });
			const before = snapshot(root);
			expect(() => install(nested)).toThrow(/lacks verified privacy/);
			expect(snapshot(root)).toEqual(before);
		}
	});

	it("rejects normalized adapter ownership conflicts", () => {
		const root = fixture();
		const changes = planWorkPromptPrivacy(root, { preset: "bounded" });
		expect(() =>
			assertWorkPromptPrivacyOwnership(
				root,
				changes,
				[
					{
						kind: "file",
						path: ".anamnesis/./.gitignore",
						fragmentId: "other",
						fragmentVersion: 1,
						content: "",
					},
				],
				emptyManifest(),
			),
		).toThrow(/ownership conflicts/);
		const manifest = emptyManifest();
		manifest.files.push({
			path: path.join(root, ".anamnesis/.gitignore"),
			fragment_id: "other",
			fragment_version: 1,
			last_applied_hash: `sha256:${"0".repeat(64)}`,
			current_user_hash: `sha256:${"0".repeat(64)}`,
		});
		expect(() =>
			assertWorkPromptPrivacyOwnership(root, changes, [], manifest),
		).toThrow(/ownership conflicts/);
	});
});
