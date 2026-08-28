import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolName } from "./agentfile.js";
import {
	defaultProjectRegistryPath,
	projectRegistrySchema,
	pruneStaleProjects,
	readProjectRegistry,
	registerProject,
	removeRegisteredProject,
	validateRegisteredProject,
} from "./project_registry.js";

function tempDir(): string {
	return fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-registry-")),
	);
}
function project(root: string, name = "demo") {
	fs.mkdirSync(root, { recursive: true });
	return {
		projectRoot: root,
		projectName: name,
		tools: ["claude-code", "codex"] as ToolName[],
		allowExecAdapters: true,
	};
}

describe("project registry", () => {
	it("uses a platform user-state path and honors the override", () => {
		const previous = process.env.ANAMNESIS_STATE_HOME;
		process.env.ANAMNESIS_STATE_HOME = "/tmp/anamnesis-state-test";
		expect(defaultProjectRegistryPath()).toBe(
			path.join(
				fs.realpathSync("/tmp"),
				"anamnesis-state-test/anamnesis/projects.json",
			),
		);
		if (previous === undefined) delete process.env.ANAMNESIS_STATE_HOME;
		else process.env.ANAMNESIS_STATE_HOME = previous;
	});

	it("registers, reads, and upserts a project while preserving its id", () => {
		const dir = tempDir();
		const registryPath = path.join(dir, "state", "projects.json");
		const root = path.join(dir, "repo");
		const first = registerProject({
			...project(root),
			registryPath,
			now: new Date("2026-01-01T00:00:00.000Z"),
		});
		const second = registerProject({
			...project(root, "renamed"),
			registryPath,
			allowExecAdapters: false,
			now: new Date("2026-01-02T00:00:00.000Z"),
		});
		expect(second.id).toBe(first.id);
		expect(readProjectRegistry({ registryPath }).projects).toEqual([second]);
		expect(second.created_at).toBe(first.created_at);
		expect(second.allow_exec_adapters).toBe(false);
	});

	it("validates the root identity and fails closed after replacement", () => {
		const dir = tempDir();
		const root = path.join(dir, "repo");
		const registryPath = path.join(dir, "projects.json");
		const entry = registerProject({ ...project(root), registryPath });
		expect(validateRegisteredProject(entry)).toBe(true);
		fs.renameSync(root, path.join(dir, "old"));
		fs.mkdirSync(root);
		expect(validateRegisteredProject(entry)).toBe(false);
		expect(pruneStaleProjects({ registryPath })).toEqual([entry]);
		expect(readProjectRegistry({ registryPath }).projects).toEqual([]);
	});

	it("rejects symlink project roots and symlink registry files", () => {
		const dir = tempDir();
		const real = path.join(dir, "real");
		const link = path.join(dir, "link");
		fs.mkdirSync(real);
		fs.symlinkSync(real, link, "dir");
		const registryPath = path.join(dir, "projects.json");
		expect(() => registerProject({ ...project(link), registryPath })).toThrow(
			/Symlink/,
		);
		registerProject({ ...project(real), registryPath });
		const swapped = path.join(dir, "swapped.json");
		fs.symlinkSync(registryPath, swapped);
		expect(() => readProjectRegistry({ registryPath: swapped })).toThrow(
			/Symlink/,
		);
	});

	it("removes by id or canonical root and keeps private storage", () => {
		const dir = tempDir();
		const registryPath = path.join(dir, "state", "projects.json");
		const root = path.join(dir, "repo");
		const entry = registerProject({ ...project(root), registryPath });
		expect(fs.statSync(path.dirname(registryPath)).mode & 0o777).toBe(0o700);
		expect(fs.statSync(registryPath).mode & 0o777).toBe(0o600);
		expect(removeRegisteredProject({ idOrRoot: root, registryPath })).toBe(
			true,
		);
		expect(readProjectRegistry({ registryPath }).projects).toHaveLength(0);
		expect(
			projectRegistrySchema.parse(readProjectRegistry({ registryPath })),
		).toBeTruthy();
		expect(removeRegisteredProject({ idOrRoot: entry.id, registryPath })).toBe(
			false,
		);
	});

	it("times out rather than mutating while another writer owns the lock", () => {
		const dir = tempDir();
		const registryPath = path.join(dir, "projects.json");
		const root = path.join(dir, "repo");
		registerProject({ ...project(root), registryPath });
		const lock = path.join(dir, ".projects.lock");
		fs.writeFileSync(lock, "other\n", { mode: 0o600 });
		expect(() =>
			registerProject({
				...project(path.join(dir, "other")),
				registryPath,
				lockTimeoutMs: 5,
			}),
		).toThrow(/Timed out/);
		expect(readProjectRegistry({ registryPath }).projects).toHaveLength(1);
		fs.unlinkSync(lock);
	});

	it("removes the lock when lock initialization fails", () => {
		const dir = tempDir();
		const registryPath = path.join(dir, "projects.json");
		const lock = path.join(dir, ".projects.lock");
		expect(() =>
			registerProject({
				...project(path.join(dir, "repo")),
				registryPath,
				_lockInitializerForTest: () => {
					throw new Error("simulated fsync failure");
				},
			}),
		).toThrow(/simulated fsync failure/);
		expect(fs.existsSync(lock)).toBe(false);
	});
});
