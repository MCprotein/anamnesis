import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { FileChange } from "./applier.js";
import type { Manifest } from "./manifest.js";
import type { RenderAction } from "./render.js";
import type { WorkPromptCaptureConfig } from "./work_prompt_policy.js";
import { resolveWorkStateRoot } from "./work_storage.js";
import { assertWorkPromptStagePrivacyBoundary } from "./work_prompt_stage.js";

const IGNORE_PATH = ".anamnesis/.gitignore";
const RAW_DIRS = ["work-prompt-stage", "work-inputs"] as const;
const PROTECTION =
	"# anamnesis: local-private raw Work prompt storage\n/work-prompt-stage/\n/work-inputs/\n";

/** Ancillary append-only plan: never claim ownership of a user's ignore file.
 * The ordinary applier supplies no-follow writes, content CAS and backups.
 * Directory exclusions also prevent descendant .gitignore negations from
 * exposing raw bodies. Install even before git init, so future Git is safe.
 */
export function planWorkPromptPrivacy(
	projectRoot: string,
	policy: WorkPromptCaptureConfig | undefined,
): FileChange[] {
	if (policy?.preset !== "bounded") return [];
	assertDirectory(path.join(projectRoot, ".anamnesis"));
	for (const raw of RAW_DIRS)
		assertDirectory(path.join(projectRoot, ".anamnesis", raw));
	const ownedState = path.join(fs.realpathSync(projectRoot), ".anamnesis");
	const stateRoot = resolveWorkStateRoot(projectRoot).state_root;
	if (stateRoot !== ownedState) {
		// Discovery permits verification, not writes to another checkout. Keep
		// already-protected primary storage usable by nested/linked projects.
		assertDirectory(stateRoot);
		for (const raw of RAW_DIRS) assertDirectory(path.join(stateRoot, raw));
		const ownerRoot = path.dirname(stateRoot);
		assertNoTrackedRawPaths(ownerRoot);
		try {
			assertWorkPromptStagePrivacyBoundary(projectRoot, stateRoot);
		} catch {
			throw new Error("bounded prompt capture storage is outside this installation and lacks verified privacy protection; apply protection from the owning primary/root project");
		}
		return [];
	}
	const target = path.join(projectRoot, IGNORE_PATH);
	let currentContent: string | undefined;
	try {
		const stat = fs.lstatSync(target);
		if (!stat.isFile() || stat.nlink !== 1)
			throw new Error(`unsafe raw Work privacy ignore file: ${IGNORE_PATH}`);
		const fd = fs.openSync(
			target,
			fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
		);
		try {
			const opened = fs.fstatSync(fd);
			if (
				!opened.isFile() ||
				opened.nlink !== 1 ||
				opened.ino !== stat.ino ||
				opened.dev !== stat.dev
			) {
				throw new Error(
					`raw Work privacy ignore file changed during planning: ${IGNORE_PATH}`,
				);
			}
			const bytes = fs.readFileSync(fd);
			currentContent = bytes.toString("utf8");
			if (!Buffer.from(currentContent).equals(bytes))
				throw new Error(
					`raw Work privacy ignore file is not UTF-8: ${IGNORE_PATH}`,
				);
		} finally {
			fs.closeSync(fd);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	assertNoTrackedRawPaths(projectRoot);
	const text = currentContent ?? "";
	// Appending is deliberate: existing user rules remain byte-for-byte intact,
	// and the final positive directory rules take precedence at this scope.
	const newContent = text.endsWith(PROTECTION)
		? text
		: `${text}${text && !text.endsWith("\n") ? "\n" : ""}${PROTECTION}`;
	return [
		{
			target: "file",
			path: IGNORE_PATH,
			fragmentId: "work-prompt-privacy",
			fragmentVersion: 1,
			status:
				currentContent === undefined
					? "create"
					: currentContent === newContent
						? "noop"
						: "update",
			currentContent,
			newContent,
			sideEffects: ["local-write"],
			reason:
				"Protect .anamnesis/work-prompt-stage/ and .anamnesis/work-inputs/ from Git tracking for bounded prompt capture; preserve user ignore rules.",
		},
	];
}

export function assertWorkPromptPrivacyOwnership(
	projectRoot: string,
	changes: readonly FileChange[],
	actions: readonly RenderAction[],
	manifest: Manifest,
): void {
	if (changes.length === 0) return;
	if (
		actions.some(
			(action) =>
				path.resolve(
					projectRoot,
					action.kind === "file" ? action.path : action.file,
				) === path.resolve(projectRoot, IGNORE_PATH),
		) ||
		manifest.files.some(
			(entry) =>
				path.resolve(projectRoot, entry.path) ===
				path.resolve(projectRoot, IGNORE_PATH),
		) ||
		manifest.regions.some(
			(entry) =>
				path.resolve(projectRoot, entry.file) ===
				path.resolve(projectRoot, IGNORE_PATH),
		)
	) {
		throw new Error(
			`raw Work privacy ignore ownership conflicts with a managed adapter: ${IGNORE_PATH}`,
		);
	}
}

function assertDirectory(target: string): void {
	try {
		if (!fs.lstatSync(target).isDirectory())
			throw new Error(`unsafe raw Work privacy directory: ${target}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

function assertNoTrackedRawPaths(projectRoot: string): void {
	let markerExists = false;
	for (
		let current = path.resolve(projectRoot);
		;
		current = path.dirname(current)
	) {
		try {
			const marker = fs.lstatSync(path.join(current, ".git"));
			if (!marker.isDirectory() && !marker.isFile())
				throw new Error("unsafe Git marker for raw Work privacy");
			markerExists = true;
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (path.dirname(current) === current) break;
	}
	let tracked: string;
	try {
		tracked = execFileSync(
			"git",
			[
				"-C",
				projectRoot,
				"ls-files",
				"-z",
				"--",
				...RAW_DIRS.map((raw) => `.anamnesis/${raw}`),
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		);
	} catch (error) {
		if (markerExists)
			throw new Error("cannot verify raw Work privacy against the Git index", {
				cause: error,
			});
		return;
	}
	if (tracked.length > 0)
		throw new Error(
			"raw Work prompt paths are already tracked; privacy protection requires explicit user cleanup",
		);
}
