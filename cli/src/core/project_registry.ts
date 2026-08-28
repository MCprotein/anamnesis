import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import type { ToolName } from "./agentfile.js";

const REGISTRY_VERSION = 1;
const REGISTRY_DIR = "anamnesis";
const REGISTRY_FILE = "projects.json";
const LOCK_FILE = ".projects.lock";
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 25;

const identitySchema = z
	.object({
		dev: z.number().int().nonnegative(),
		ino: z.number().int().nonnegative(),
	})
	.strict();
export const registeredProjectSchema = z
	.object({
		id: z.string().uuid(),
		canonical_root: z.string().min(1),
		root_identity: identitySchema,
		project_name: z.string().min(1),
		tools: z.array(z.enum(["claude-code", "codex", "cursor"])),
		allow_exec_adapters: z.boolean(),
		created_at: z.string().datetime({ offset: true }),
		updated_at: z.string().datetime({ offset: true }),
	})
	.strict();
export const projectRegistrySchema = z
	.object({
		version: z.literal(REGISTRY_VERSION),
		projects: z.array(registeredProjectSchema),
	})
	.strict();

export type RootIdentity = z.infer<typeof identitySchema>;
export type RegisteredProject = z.infer<typeof registeredProjectSchema>;
export type ProjectRegistry = z.infer<typeof projectRegistrySchema>;
export type RegistryOptions = {
	registryPath?: string;
	lockTimeoutMs?: number;
	/** Internal fault-injection seam; production callers must leave unset. */
	_lockInitializerForTest?: (fd: number) => void;
};

export interface RegisterProjectOptions extends RegistryOptions {
	projectRoot: string;
	projectName: string;
	tools: ToolName[];
	allowExecAdapters: boolean;
	now?: Date;
}

export class ProjectRegistryError extends Error {
	constructor(
		message: string,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = "ProjectRegistryError";
	}
}

function stateHome(): string {
	const override = process.env.ANAMNESIS_STATE_HOME;
	if (override) return path.resolve(override);
	if (process.platform === "darwin")
		return path.join(os.homedir(), "Library", "Application Support");
	if (process.platform === "win32")
		return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
	return (
		process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
	);
}

export function defaultProjectRegistryPath(): string {
	return path.join(
		canonicalMissingPath(stateHome()),
		REGISTRY_DIR,
		REGISTRY_FILE,
	);
}

function canonicalMissingPath(candidate: string): string {
	const missing: string[] = [];
	let current = path.resolve(candidate);
	while (!fs.existsSync(current)) {
		missing.unshift(path.basename(current));
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return path.join(fs.realpathSync(current), ...missing);
}

function rejectSymlinkPath(target: string, allowMissingFinal = false): void {
	const absolute = path.resolve(target);
	const parts = absolute.split(path.sep);
	let current = parts[0] === "" ? path.sep : parts[0]!;
	for (let i = parts[0] === "" ? 1 : 0; i < parts.length; i += 1) {
		current = path.join(current, parts[i]!);
		try {
			const stat = fs.lstatSync(current);
			if (stat.isSymbolicLink())
				throw new ProjectRegistryError(
					`Symlink path component is not allowed: ${target}`,
				);
		} catch (error) {
			if (
				(error as NodeJS.ErrnoException).code === "ENOENT" &&
				allowMissingFinal
			)
				return;
			if (error instanceof ProjectRegistryError) throw error;
			throw error;
		}
	}
}

function ensurePrivateDirectory(dir: string): void {
	const absolute = path.resolve(dir);
	const parts = absolute.split(path.sep);
	let current = parts[0] === "" ? path.sep : parts[0]!;
	for (let i = parts[0] === "" ? 1 : 0; i < parts.length; i += 1) {
		current = path.join(current, parts[i]!);
		try {
			const stat = fs.lstatSync(current);
			if (stat.isSymbolicLink() || !stat.isDirectory())
				throw new ProjectRegistryError(`Unsafe registry directory: ${current}`);
			if (i === parts.length - 1) fs.chmodSync(current, 0o700);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			fs.mkdirSync(current, { mode: 0o700 });
			const stat = fs.lstatSync(current);
			if (stat.isSymbolicLink() || !stat.isDirectory())
				throw new ProjectRegistryError(`Unsafe registry directory: ${current}`);
			fs.chmodSync(current, 0o700);
		}
	}
}

function registryFile(options?: RegistryOptions): string {
	const file = path.resolve(
		options?.registryPath ?? defaultProjectRegistryPath(),
	);
	try {
		rejectSymlinkPath(path.dirname(file));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	rejectSymlinkPath(file, true);
	return file;
}

function emptyRegistry(): ProjectRegistry {
	return { version: REGISTRY_VERSION, projects: [] };
}

function withRegistryLock<T>(
	file: string,
	timeoutMs: number | undefined,
	lockInitializer: ((fd: number) => void) | undefined,
	action: () => T,
): T {
	ensurePrivateDirectory(path.dirname(file));
	const lockPath = path.join(path.dirname(file), LOCK_FILE);
	const deadline = Date.now() + (timeoutMs ?? LOCK_TIMEOUT_MS);
	let fd: number | undefined;
	while (fd === undefined) {
		try {
			rejectSymlinkPath(lockPath, true);
			fd = fs.openSync(
				lockPath,
				fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
				0o600,
			);
			try {
				if (lockInitializer) lockInitializer(fd);
				else {
					fs.writeFileSync(fd, `${process.pid}\n`, "utf8");
					fs.fsyncSync(fd);
				}
			} catch (error) {
				fs.closeSync(fd);
				fd = undefined;
				try {
					fs.unlinkSync(lockPath);
				} catch (cleanupError) {
					if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
						throw cleanupError;
					}
				}
				throw error;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (Date.now() >= deadline)
				throw new ProjectRegistryError(
					`Timed out acquiring project registry lock: ${lockPath}`,
				);
			sleepSync(Math.min(LOCK_RETRY_MS, Math.max(0, deadline - Date.now())));
		}
	}
	try {
		return action();
	} finally {
		fs.closeSync(fd);
		try {
			fs.unlinkSync(lockPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}

function sleepSync(milliseconds: number): void {
	if (milliseconds <= 0) return;
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function readProjectRegistry(
	options?: RegistryOptions,
): ProjectRegistry {
	const file = registryFile(options);
	if (!fs.existsSync(file)) return emptyRegistry();
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		throw new ProjectRegistryError(
			`Project registry JSON parse error: ${(error as Error).message}`,
		);
	}
	const parsed = projectRegistrySchema.safeParse(raw);
	if (!parsed.success)
		throw new ProjectRegistryError(
			"Project registry validation failed",
			parsed.error.issues,
		);
	return parsed.data;
}

function writeRegistry(file: string, registry: ProjectRegistry): void {
	ensurePrivateDirectory(path.dirname(file));
	rejectSymlinkPath(file, true);
	const temp = path.join(
		path.dirname(file),
		`.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
	);
	const payload =
		JSON.stringify(projectRegistrySchema.parse(registry), null, 2) + "\n";
	let fd: number | undefined;
	try {
		fd = fs.openSync(
			temp,
			fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
			0o600,
		);
		fs.writeFileSync(fd, payload, "utf8");
		fs.fsyncSync(fd);
		fs.closeSync(fd);
		fd = undefined;
		fs.renameSync(temp, file);
		const dirFd = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
		try {
			fs.fsyncSync(dirFd);
		} finally {
			fs.closeSync(dirFd);
		}
		fs.chmodSync(file, 0o600);
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
		try {
			fs.unlinkSync(temp);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}

function projectIdentity(root: string): {
	canonicalRoot: string;
	identity: RootIdentity;
} {
	const absoluteRoot = path.resolve(root);
	const final = fs.lstatSync(absoluteRoot);
	if (final.isSymbolicLink())
		throw new ProjectRegistryError(
			`Symlink project root is not allowed: ${root}`,
		);
	const canonicalRoot = fs.realpathSync(absoluteRoot);
	const stat = fs.statSync(canonicalRoot);
	if (!stat.isDirectory())
		throw new ProjectRegistryError(`Project root is not a directory: ${root}`);
	return {
		canonicalRoot,
		identity: { dev: Number(stat.dev), ino: Number(stat.ino) },
	};
}

export function validateRegisteredProject(entry: RegisteredProject): boolean {
	const parsed = registeredProjectSchema.safeParse(entry);
	if (!parsed.success) return false;
	try {
		const current = projectIdentity(parsed.data.canonical_root);
		return (
			current.canonicalRoot === parsed.data.canonical_root &&
			current.identity.dev === parsed.data.root_identity.dev &&
			current.identity.ino === parsed.data.root_identity.ino
		);
	} catch {
		return false;
	}
}

export function registerProject(
	options: RegisterProjectOptions,
): RegisteredProject {
	const file = registryFile(options);
	const { canonicalRoot, identity } = projectIdentity(options.projectRoot);
	return withRegistryLock(
		file,
		options.lockTimeoutMs,
		options._lockInitializerForTest,
		() => {
			const registry = readProjectRegistry({ registryPath: file });
			const existing = registry.projects.find(
				(entry) => entry.canonical_root === canonicalRoot,
			);
			const timestamp = (options.now ?? new Date()).toISOString();
			const entry: RegisteredProject = {
				id: existing?.id ?? randomUUID(),
				canonical_root: canonicalRoot,
				root_identity: identity,
				project_name: options.projectName,
				tools: [...options.tools],
				allow_exec_adapters: options.allowExecAdapters,
				created_at: existing?.created_at ?? timestamp,
				updated_at: timestamp,
			};
			const projects = existing
				? registry.projects.map((item) =>
						item.id === existing.id ? entry : item,
					)
				: [...registry.projects, entry];
			writeRegistry(file, { version: REGISTRY_VERSION, projects });
			return entry;
		},
	);
}

export function removeRegisteredProject(
	input: { idOrRoot: string } & RegistryOptions,
): boolean {
	const file = registryFile(input);
	return withRegistryLock(
		file,
		input.lockTimeoutMs,
		input._lockInitializerForTest,
		() => {
			const registry = readProjectRegistry({ registryPath: file });
			let canonicalRoot: string | undefined;
			try {
				canonicalRoot = projectIdentity(input.idOrRoot).canonicalRoot;
			} catch {
				canonicalRoot = undefined;
			}
			const projects = registry.projects.filter(
				(entry) =>
					entry.id !== input.idOrRoot &&
					entry.canonical_root !== input.idOrRoot &&
					entry.canonical_root !== canonicalRoot,
			);
			if (projects.length === registry.projects.length) return false;
			writeRegistry(file, { version: REGISTRY_VERSION, projects });
			return true;
		},
	);
}

export function pruneStaleProjects(
	options?: RegistryOptions,
): RegisteredProject[] {
	const file = registryFile(options);
	return withRegistryLock(
		file,
		options?.lockTimeoutMs,
		options?._lockInitializerForTest,
		() => {
			const registry = readProjectRegistry({ registryPath: file });
			const stale = registry.projects.filter(
				(entry) => !validateRegisteredProject(entry),
			);
			if (stale.length)
				writeRegistry(file, {
					version: REGISTRY_VERSION,
					projects: registry.projects.filter((entry) =>
						validateRegisteredProject(entry),
					),
				});
			return stale;
		},
	);
}
