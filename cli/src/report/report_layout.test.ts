import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import type { WorkStatusResult } from "../commands/work.js";
import {
	ambiguousWidthCharacters,
	CHIP_WIDTH,
	stripAnsi,
	visibleLength,
} from "../core/tui.js";
import { reportWorkStatus } from "./work.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const tsxCli = path.join(repositoryRoot, "node_modules/tsx/dist/cli.mjs");
const anamnesisCli = path.join(repositoryRoot, "cli/src/index.ts");
const roots: string[] = [];
const CHIP_LINE = /^ {2}\[( OK |WARN|FAIL|INFO|TODO|WORK)\]/;

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	roots.push(root);
	return root;
}

function runCli(
	cwd: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	input?: Buffer,
) {
	const base = { ...process.env };
	delete base.NO_COLOR;
	delete base.FORCE_COLOR;
	return spawnSync(process.execPath, [tsxCli, anamnesisCli, ...args], {
		cwd,
		encoding: "utf8",
		env: {
			...base,
			ANAMNESIS_STATE_HOME: path.join(cwd, ".state-home"),
			...env,
		},
		input,
	});
}

function textColumns(output: string): number[] {
	return stripAnsi(output)
		.split("\n")
		.filter((line) => CHIP_LINE.test(line))
		.map((line) => {
			const characters = [...line];
			let index = 2 + CHIP_WIDTH;
			while (characters[index] === " ") index += 1;
			return visibleLength(characters.slice(0, index).join(""));
		});
}

function captureWorkStatus(width: number, verbose = false): string {
	vi.stubEnv("COLUMNS", String(width));
	vi.stubEnv("NO_COLOR", "");
	const columns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
	Object.defineProperty(process.stdout, "columns", {
		configurable: true,
		value: 0,
	});
	const lines: string[] = [];
	vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
		lines.push(String(line ?? ""));
	});
	try {
		reportWorkStatus(workFixture(), { verbose });
	} finally {
		if (columns) Object.defineProperty(process.stdout, "columns", columns);
		else Reflect.deleteProperty(process.stdout, "columns");
	}
	return lines.join("\n");
}

function workFixture(): WorkStatusResult {
	const requirement = (id: string, status: string, summary: string) => ({
		id,
		summary,
		status,
		source_event_ids: [],
		evidence_refs: [],
	});
	return {
		schema_version: "anamnesis.work-status.v1",
		work_id: "add-login-form",
		ledger_path: "/tmp/ledger",
		policy_drift: null,
		readiness: "current_inputs_required",
		projection: {
			work_id: "add-login-form",
			title: "로그인 화면 추가",
			lifecycle: "open",
			contract_revision: 2,
			completion_contract: null,
			configured_required_gates: [],
			progress: {
				percent: 40,
				blocked: 0,
				weighted: false,
				verified: 2,
				applicable: 5,
			},
			review_gates: [
				{
					gate: "planning",
					enforcement: "required",
					state: "passed",
					passing_reviewer_refs: [],
					next_provider: null,
					finding_refs: [],
					failure_refs: [],
				},
			],
			parallelism: { mode: "off" },
			requirements: [
				requirement("req_form", "in_progress", "로그인 화면 추가"),
				requirement("req_docs", "pending", "fix docs links"),
				requirement("req_api", "verified", "API 연결"),
			],
		},
	} as unknown as WorkStatusResult;
}

describe("report layout", () => {
	it.each([48, 80, 120])(
		"aligns work status chips and keeps progress single at %i columns",
		(width) => {
			const output = captureWorkStatus(width);
			const columns = textColumns(output);

			expect(columns.length).toBeGreaterThanOrEqual(4);
			expect(new Set(columns)).toEqual(new Set([2 + CHIP_WIDTH + 2]));
			expect(output).toContain("[WORK]  req_form");
			expect(output).toContain("[TODO]  req_docs");
			expect(stripAnsi(output).match(/40%/g)).toHaveLength(1);
			expect(ambiguousWidthCharacters(output)).toEqual([]);
			for (const line of output.split("\n"))
				expect(visibleLength(line)).toBeLessThanOrEqual(width);
		},
	);

	it("aligns status and init dry-run chips and avoids repeated next commands", () => {
		const project = tempRoot("anamnesis-report-layout-");
		spawnSync("git", ["init", "-q"], { cwd: project });
		const env = { COLUMNS: "80", FORCE_COLOR: "1" };
		const init = runCli(project, ["init", "--dry-run", "--yes"], env);
		expect(init.status, init.stderr).toBe(0);
		expect(init.stdout).toContain("\x1b[");
		expect(ambiguousWidthCharacters(init.stdout)).toEqual([]);
		expect(new Set(textColumns(init.stdout))).toEqual(
			new Set([2 + CHIP_WIDTH + 2]),
		);
		const next = stripAnsi(init.stdout).split("Next steps")[1] ?? "";
		const commands = next
			.split("\n")
			.map((line) => line.trim().split(/\s{2,}/)[0])
			.filter((command): command is string => Boolean(command));
		expect(new Set(commands).size).toBe(commands.length);

		const applied = runCli(project, ["init", "--yes"], env);
		expect(applied.status, applied.stderr).toBe(0);
		for (const args of [["status"], ["doctor"]]) {
			const result = runCli(project, args, env);
			expect(result.stderr).toBe("");
			expect(ambiguousWidthCharacters(result.stdout)).toEqual([]);
			const columns = textColumns(result.stdout);
			if (columns.length > 0)
				expect(new Set(columns)).toEqual(new Set([2 + CHIP_WIDTH + 2]));
			for (const line of result.stdout.split("\n"))
				expect(visibleLength(line)).toBeLessThanOrEqual(80);
		}
	}, 60_000);

	it("keeps hook subcommand and JSON output free of ANSI under FORCE_COLOR", () => {
		const project = tempRoot("anamnesis-hook-ansi-");
		fs.writeFileSync(
			path.join(project, "Agentfile"),
			YAML.stringify({
				version: 2,
				project: { name: "hook-ansi" },
				tools: ["codex"],
				fragments: [],
				settings: { work_prompt_capture: { preset: "bounded" } },
			}),
		);
		const env = { FORCE_COLOR: "1", COLUMNS: "80" };
		const payload = (value: object) => Buffer.from(JSON.stringify(value));
		const runs = [
			runCli(project, ["work", "hook-policy-probe", "--project-root", project], env),
			runCli(
				project,
				["work", "hook-user-prompt", "--client", "codex"],
				env,
				payload({ session_id: "s1", turn_id: "t1", prompt: "add login form" }),
			),
			runCli(
				project,
				["work", "hook-session-start", "--client", "codex"],
				env,
				payload({ session_id: "s1", source: "compact" }),
			),
			runCli(
				project,
				["work", "hook-post-tool-use", "--client", "codex"],
				env,
				payload({ session_id: "s1", turn_id: "t1", tool_name: "Bash" }),
			),
			runCli(project, ["status", "--json"], env),
		];
		expect(runs[0]?.stdout).toContain("capture_enabled");
		expect(runs[1]?.stdout).toMatch(/cap_[a-f0-9]{64}/);
		for (const result of runs) {
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout).not.toContain("\x1b[");
			expect(result.stderr).not.toContain("\x1b[");
		}
	}, 60_000);
});
