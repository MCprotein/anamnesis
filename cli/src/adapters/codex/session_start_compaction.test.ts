import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function fixture(): {
	projectRoot: string;
	shimPath: string;
	capturePath: string;
} {
	const projectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "anamnesis-session-compact-"),
	);
	roots.push(projectRoot);
	fs.mkdirSync(path.join(projectRoot, ".anamnesis", "ontology"), {
		recursive: true,
	});
	fs.writeFileSync(
		path.join(projectRoot, ".anamnesis", "ontology", "base.yaml"),
		"managed_by: anamnesis\n",
	);
	const shimPath = path.join(projectRoot, "anamnesis-shim.mjs");
	const capturePath = path.join(projectRoot, "captured.json");
	fs.writeFileSync(
		shimPath,
		`#!${process.execPath}\nimport fs from "node:fs";\nconst chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);\nfs.writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({argv:process.argv.slice(2),stdin:Buffer.concat(chunks).toString("utf8")}));\nprocess.stdout.write(JSON.stringify({schema_version:"anamnesis.work-hook-result.v1",status:"briefing_due",reason:"briefing_due",context:"Anamnesis Work briefing: recovered session\\nCompletion contract: preserve this line",cursor_id:"cursor",boundary_id:null}));\n`,
	);
	fs.chmodSync(shimPath, 0o755);
	return { projectRoot, shimPath, capturePath };
}

function run(
	projectRoot: string,
	shimPath: string,
	capturePath: string,
	payload: unknown,
) {
	return spawnSync(
		process.execPath,
		[path.resolve("base/adapters/codex/hooks/session-start.mjs")],
		{
			cwd: projectRoot,
			env: {
				...process.env,
				ANAMNESIS_BIN: shimPath,
				CAPTURE_PATH: capturePath,
			},
			input: JSON.stringify(payload),
			encoding: "utf8",
		},
	);
}

describe("Codex SessionStart compact Work recovery", () => {
	it("adds Work context and forwards only the compact source and exact session", () => {
		const { projectRoot, shimPath, capturePath } = fixture();
		const result = run(projectRoot, shimPath, capturePath, {
			cwd: projectRoot,
			source: "compact",
			session_id: "session-compact",
			prompt: "private prompt",
			transcript_path: "/private/transcript",
		});

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const output = JSON.parse(result.stdout);
		expect(output.hookSpecificOutput.additionalContext).toContain(
			"managed ontology slice",
		);
		expect(output.hookSpecificOutput.additionalContext).toContain(
			"Anamnesis Work briefing: recovered session",
		);
		const captured = JSON.parse(fs.readFileSync(capturePath, "utf8"));
		expect(captured.argv).toEqual([
			"work",
			"hook-session-start",
			"--client",
			"codex",
			"--json",
		]);
		expect(JSON.parse(captured.stdin)).toEqual({
			source: "compact",
			session_id: "session-compact",
		});
		expect(captured.stdin).not.toContain("private prompt");
		expect(captured.stdin).not.toContain("transcript");
	});

	it("does not invoke Work recovery for ordinary startup", () => {
		const { projectRoot, shimPath, capturePath } = fixture();
		for (let index = 0; index < 100; index += 1) {
			fs.writeFileSync(
				path.join(
					projectRoot,
					".anamnesis",
					"ontology",
					`startup-${index.toString().padStart(3, "0")}.yaml`,
				),
				`invariant: ${"x".repeat(100)}\n`,
			);
		}
		const result = run(projectRoot, shimPath, capturePath, {
			cwd: projectRoot,
			source: "startup",
			session_id: "session-startup",
		});

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(fs.existsSync(capturePath)).toBe(false);
		const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
		expect(context).toContain("managed ontology slice");
		expect(context).toContain("startup-099.yaml");
		expect(context).not.toContain("compact supplemental context truncated");
		expect(Buffer.byteLength(context, "utf8")).toBeGreaterThan(2_000);
	});

	it("keeps existing SessionStart context when an older CLI lacks recovery", () => {
		const { projectRoot, shimPath, capturePath } = fixture();
		fs.writeFileSync(
			shimPath,
			`#!${process.execPath}\nprocess.stderr.write("error: unknown 'work' subcommand: hook-session-start\\nusage: anamnesis work <command> [options]\\n");\nprocess.exit(1);\n`,
		);
		fs.chmodSync(shimPath, 0o755);
		const result = run(projectRoot, shimPath, capturePath, {
			cwd: projectRoot,
			source: "compact",
			session_id: "session-compact",
		});

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const output = JSON.parse(result.stdout);
		expect(output).not.toHaveProperty("systemMessage");
		expect(output.hookSpecificOutput.additionalContext).toContain(
			"managed ontology slice",
		);
	});

	it.each([
		{
			name: "unexpected command failure",
			body: `process.stderr.write("PRIVATE_COMMAND_ERROR\\n"); process.exit(2);`,
			failureClass: "command_failed",
		},
		{
			name: "malformed stdout",
			body: `process.stdout.write("PRIVATE_MALFORMED_OUTPUT");`,
			failureClass: "malformed_result",
		},
		{
			name: "timed out command",
			body: `setInterval(() => {}, 1000);`,
			failureClass: "timeout",
		},
	])("reports a sanitized $name while preserving startup context", ({ body, failureClass }) => {
		const { projectRoot, shimPath, capturePath } = fixture();
		fs.writeFileSync(shimPath, `#!${process.execPath}\n${body}\n`);
		fs.chmodSync(shimPath, 0o755);
		const result = run(projectRoot, shimPath, capturePath, {
			cwd: projectRoot,
			source: "compact",
			session_id: "session-compact",
			prompt: "PRIVATE_INPUT",
		});

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const output = JSON.parse(result.stdout);
		expect(output.hookSpecificOutput.additionalContext).toContain(
			"managed ontology slice",
		);
		expect(output.systemMessage).toContain(`(${failureClass})`);
		expect(result.stdout).not.toContain("PRIVATE_COMMAND_ERROR");
		expect(result.stdout).not.toContain("PRIVATE_MALFORMED_OUTPUT");
		expect(result.stdout).not.toContain("PRIVATE_INPUT");
	});

	it("reports an executable with a missing interpreter without exposing its path", () => {
		const { projectRoot, shimPath, capturePath } = fixture();
		fs.writeFileSync(shimPath, "#!/PRIVATE_MISSING_INTERPRETER\n");
		const result = run(projectRoot, shimPath, capturePath, {
			cwd: projectRoot,
			source: "compact",
			session_id: "session-compact",
		});
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout).systemMessage).toContain("(spawn_failed)");
		expect(result.stdout).not.toContain("PRIVATE_MISSING_INTERPRETER");
		expect(result.stderr).toBe("");
	});

	it("puts Work first and bounds supplemental compact context", () => {
		const { projectRoot, shimPath, capturePath } = fixture();
		fs.mkdirSync(path.join(projectRoot, ".anamnesis", "handoff"));
		fs.writeFileSync(
			path.join(projectRoot, ".anamnesis", "handoff", "active.md"),
			"# Active handoff index\n\n## Current focus\n- Preserve the in-flight decision\n",
		);
		for (let index = 0; index < 100; index += 1) {
			fs.writeFileSync(
				path.join(
					projectRoot,
					".anamnesis",
					"ontology",
					`overflow-${index.toString().padStart(3, "0")}.yaml`,
				),
				`invariant: ${"x".repeat(100)}\n`,
			);
		}
		const result = run(projectRoot, shimPath, capturePath, {
			cwd: projectRoot,
			source: "compact",
			session_id: "session-compact",
		});

		const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
		expect(context).toMatch(/^Anamnesis Work briefing:/);
		expect(context).toContain("Completion contract: preserve this line");
		expect(context).toContain(".anamnesis/ontology/base.yaml");
		expect(context).toContain(".anamnesis/handoff/active.md");
		expect(context).toContain("compact supplemental context truncated");
		expect(Buffer.byteLength(context, "utf8")).toBeLessThanOrEqual(2_100);
	});
});
