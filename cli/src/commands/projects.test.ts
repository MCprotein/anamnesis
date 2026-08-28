import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { init } from "./init.js";
import {
	listRegisteredProjects,
	pruneRegisteredProjects,
	syncRegisteredProjects,
} from "./projects.js";

function tmpDir(prefix: string): string {
	return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function makeLibrary(version: number, withHook = false): string {
	const library = tmpDir("anamnesis-projects-library-");
	const base = path.join(library, "base");
	fs.mkdirSync(path.join(base, "content"), { recursive: true });
	if (withHook) fs.mkdirSync(path.join(base, "hooks"), { recursive: true });
	fs.writeFileSync(
		path.join(base, "fragment.yaml"),
		`id: base
version: ${version}
capabilities:
  - type: project_memory
    source: content/base.md
    region: anamnesis-base
${
	withHook
		? `  - type: executable_hook
    event: Stop
    source: hooks/stop.sh
    adapters_supported: [claude-code]
`
		: ""
}
`,
	);
	fs.writeFileSync(
		path.join(base, "content", "base.md"),
		`## Managed context

library version ${version}
`,
	);
	fs.writeFileSync(path.join(library, "rulebook.md"), "");
	if (withHook) {
		fs.writeFileSync(
			path.join(base, "hooks", "stop.sh"),
			"#!/usr/bin/env bash\nexit 0\n",
		);
	}
	return library;
}

function initialize(
	projectRoot: string,
	libraryRoot: string,
	registryPath: string,
	allowExecAdapters = false,
): void {
	init({
		projectRoot,
		libraryRoot,
		dryRun: false,
		allowExecAdapters,
		noBootstrap: true,
		noContextBootstrap: true,
		projectRegistryPath: registryPath,
	});
}

describe("registered project commands", () => {
	it("registers successful init metadata including executable-adapter consent", () => {
		const root = tmpDir("anamnesis-projects-");
		const registryPath = path.join(root, "state", "projects.json");
		const project = path.join(root, "project");
		fs.mkdirSync(project);

		initialize(project, makeLibrary(1), registryPath, true);

		const listed = listRegisteredProjects({ registryPath });
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({
			valid: true,
			project: {
				canonical_root: fs.realpathSync(project),
				allow_exec_adapters: true,
				tools: ["claude-code"],
			},
		});
	});

	it("applies safe projects and preserves user-modified projects independently", () => {
		const root = tmpDir("anamnesis-projects-");
		const registryPath = path.join(root, "state", "projects.json");
		const first = path.join(root, "first");
		const second = path.join(root, "second");
		fs.mkdirSync(first);
		fs.mkdirSync(second);
		const v1 = makeLibrary(1);
		const v2 = makeLibrary(2);
		initialize(first, v1, registryPath);
		initialize(second, v1, registryPath);
		const secondAgents = path.join(second, "AGENTS.md");
		fs.writeFileSync(
			secondAgents,
			fs
				.readFileSync(secondAgents, "utf8")
				.replace("library version 1", "library version 1\nuser-owned edit"),
		);

		const plan = syncRegisteredProjects({
			libraryRoot: v2,
			registryPath,
			apply: false,
		});
		expect(plan.projects.map((entry) => entry.status).sort()).toEqual([
			"ready",
			"user-modified",
		]);

		const applied = syncRegisteredProjects({
			libraryRoot: v2,
			registryPath,
			apply: true,
		});
		expect(applied.summary).toMatchObject({
			applied: 1,
			skipped: 1,
			errors: 0,
		});
		expect(fs.readFileSync(path.join(first, "AGENTS.md"), "utf8")).toContain(
			"library version 2",
		);
		expect(fs.readFileSync(path.join(second, "AGENTS.md"), "utf8")).toContain(
			"user-owned edit",
		);
	});

	it("reports a replaced registered path as stale and prunes only on request", () => {
		const root = tmpDir("anamnesis-projects-");
		const registryPath = path.join(root, "state", "projects.json");
		const project = path.join(root, "project");
		fs.mkdirSync(project);
		initialize(project, makeLibrary(1), registryPath);
		fs.renameSync(project, path.join(root, "moved"));
		fs.mkdirSync(project);

		const plan = syncRegisteredProjects({
			libraryRoot: makeLibrary(2),
			registryPath,
		});
		expect(plan.projects[0]?.status).toBe("stale");
		expect(listRegisteredProjects({ registryPath })).toHaveLength(1);

		expect(pruneRegisteredProjects({ registryPath })).toHaveLength(1);
		expect(listRegisteredProjects({ registryPath })).toHaveLength(0);
	});

	it("reuses per-project executable-adapter consent during bulk planning", () => {
		const root = tmpDir("anamnesis-projects-");
		const registryPath = path.join(root, "state", "projects.json");
		const trusted = path.join(root, "trusted");
		const contentOnly = path.join(root, "content-only");
		fs.mkdirSync(trusted);
		fs.mkdirSync(contentOnly);
		const v1 = makeLibrary(1);
		initialize(trusted, v1, registryPath, true);
		initialize(contentOnly, v1, registryPath, false);

		const plan = syncRegisteredProjects({
			libraryRoot: makeLibrary(2, true),
			registryPath,
		});
		const byName = new Map(
			plan.projects.map((entry) => [entry.project.project_name, entry]),
		);
		expect(byName.get("trusted")?.status).toBe("ready");
		expect(byName.get("content-only")?.status).toBe("blocked");
	});
});
