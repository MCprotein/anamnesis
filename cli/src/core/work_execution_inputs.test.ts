import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { WORK_EXECUTION_LIMITS } from "./work_contract.js";
import {
	assertAllowedGitArguments,
	resolveWorkExecutionInputs,
	workExecutionInputsSchema,
	type GitExecutionRequest,
} from "./work_execution_inputs.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-execution-inputs-"));
	roots.push(root);
	return root;
}

function basis(root: string, executionInputs?: unknown) {
	return {
		repositoryRoot: root,
		workId: "wu_test",
		contractRevision: 1,
		contractHash: `sha256:${"a".repeat(64)}`,
		policyHash: `sha256:${"b".repeat(64)}`,
		executionInputs,
	};
}

describe("resolveWorkExecutionInputs", () => {
	it("enforces every adapter-owned named array/path boundary exactly", () => {
		const root = tempRoot();
		const artifact = (index: number) => ({
			kind: "runtime_attested_inline" as const,
			ref: `artifact:${index}`,
			content: "x",
			assurance: "runtime_attested" as const,
		});
		const assertion = (index: number) => ({ requirement_id: `req_${index}`, outcome: "passed" as const });
		const scope = (index: number) => ({ kind: "file" as const, path: `src/${index}.ts`, access: "read" as const });
		const effect = (index: number) => ({
			resource_kind: "service",
			resource_ref: `service:${index}`,
			access: "read" as const,
			irreversible: false,
		});
		const exact = {
			planning_review_inputs: {
				artifacts: Array.from({ length: WORK_EXECUTION_LIMITS.maxArtifacts }, (_, index) => artifact(index)),
			},
			completion_review_inputs: {
				base_ref: "base",
				head_ref: "head",
				verification_assertions: Array.from(
					{ length: WORK_EXECUTION_LIMITS.maxVerificationAssertions },
					(_, index) => assertion(index),
				),
				evidence_refs: Array.from(
					{ length: WORK_EXECUTION_LIMITS.maxEvidenceRefs },
					(_, index) => `evidence:${index}`,
				),
			},
			parallelism_inputs: {
				material_scope: {
					repository_scopes: Array.from(
						{ length: WORK_EXECUTION_LIMITS.maxRepositoryScopesPerLane },
						(_, index) => scope(index),
					),
					external_effects: Array.from(
						{ length: WORK_EXECUTION_LIMITS.maxExternalEffectsPerLane },
						(_, index) => effect(index),
					),
				},
				runtime_capability: {
					assurance: "runtime_attested" as const,
					capability_ref: "runtime:cap",
					providers: [{ provider: "native_agents" as const, availability: "available" as const, max_agents: 1 }],
				},
			},
		};
		expect(() => workExecutionInputsSchema.parse(exact)).not.toThrow();
		expect(() =>
			workExecutionInputsSchema.parse({
				planning_review_inputs: {
					artifacts: [
						{
							kind: "runtime_attested_inline",
							ref: "inline:exact",
							content: "x".repeat(WORK_EXECUTION_LIMITS.maxInlineArtifactUtf8Bytes),
							assurance: "runtime_attested",
						},
					],
				},
			}),
		).not.toThrow();
		const exactInline = resolveWorkExecutionInputs(
			basis(root, {
				planning_review_inputs: {
					artifacts: [
						{
							kind: "runtime_attested_inline",
							ref: "inline:exact",
							content: "x".repeat(WORK_EXECUTION_LIMITS.maxInlineArtifactUtf8Bytes),
							assurance: "runtime_attested",
						},
					],
				},
			}),
		);
		expect(exactInline.planning_review?.artifacts[0]).toMatchObject({
			bytes: WORK_EXECUTION_LIMITS.maxInlineArtifactUtf8Bytes,
			hash: expect.stringMatching(/^sha256:/),
		});
		for (const limitCase of [
			{ ...exact, planning_review_inputs: { artifacts: [...exact.planning_review_inputs.artifacts, artifact(WORK_EXECUTION_LIMITS.maxArtifacts)] } },
			{ ...exact, completion_review_inputs: { ...exact.completion_review_inputs, verification_assertions: [...exact.completion_review_inputs.verification_assertions, assertion(WORK_EXECUTION_LIMITS.maxVerificationAssertions)] } },
			{ ...exact, completion_review_inputs: { ...exact.completion_review_inputs, evidence_refs: [...exact.completion_review_inputs.evidence_refs, `evidence:${WORK_EXECUTION_LIMITS.maxEvidenceRefs}`] } },
			{ ...exact, parallelism_inputs: { ...exact.parallelism_inputs, material_scope: { ...exact.parallelism_inputs.material_scope, repository_scopes: [...exact.parallelism_inputs.material_scope.repository_scopes, scope(WORK_EXECUTION_LIMITS.maxRepositoryScopesPerLane)] } } },
			{ ...exact, parallelism_inputs: { ...exact.parallelism_inputs, material_scope: { ...exact.parallelism_inputs.material_scope, external_effects: [...exact.parallelism_inputs.material_scope.external_effects, effect(WORK_EXECUTION_LIMITS.maxExternalEffectsPerLane)] } } },
		]) {
			expect(() => workExecutionInputsSchema.parse(limitCase)).toThrow();
		}
		expect(() =>
			workExecutionInputsSchema.parse({
				planning_review_inputs: { artifacts: [{ kind: "repo_file", path: "a".repeat(WORK_EXECUTION_LIMITS.maxPathUtf8Bytes) }] },
			}),
		).not.toThrow();
		expect(() =>
			workExecutionInputsSchema.parse({
				planning_review_inputs: { artifacts: [{ kind: "repo_file", path: "a".repeat(WORK_EXECUTION_LIMITS.maxPathUtf8Bytes + 1) }] },
			}),
		).toThrow();
	});

	it("accepts omission and returns an immutable empty canonical snapshot", () => {
		const root = tempRoot();
		const result = resolveWorkExecutionInputs(basis(root));
		expect(result).toEqual({
			planning_review: null,
			completion_review: null,
			parallelism: null,
		});
		expect(Object.isFrozen(result)).toBe(true);
	});

	it("hashes repository and runtime-attested planning artifacts without exposing bodies", () => {
		const root = tempRoot();
		fs.writeFileSync(path.join(root, "plan.md"), "plan one\n");
		const result = resolveWorkExecutionInputs(
			basis(root, {
				planning_review_inputs: {
					artifacts: [
						{ kind: "repo_file", path: "plan.md" },
						{
							kind: "runtime_attested_inline",
							ref: "runtime:plan",
							content: "bounded plan",
							assurance: "runtime_attested",
						},
					],
				},
			}),
		);
		expect(result.planning_review?.artifacts).toMatchObject([
			{ ref: "plan.md", assurance: "repository" },
			{ ref: "runtime:plan", assurance: "runtime_attested" },
		]);
		expect(JSON.stringify(result)).not.toContain("bounded plan");
		expect(result.planning_review?.review_input_hash).toMatch(/^sha256:/);
	});

	it("keeps linked worktree fingerprints distinct even when state storage is shared", () => {
		const firstRoot = tempRoot();
		const secondRoot = tempRoot();
		const sharedStateRoot = tempRoot();
		const parallelismInputs = {
			parallelism_inputs: {
				material_scope: { repository_scopes: [], external_effects: [] },
				runtime_capability: {
					assurance: "runtime_attested" as const,
					capability_ref: "runtime:cap",
					providers: [
						{
							provider: "native_agents" as const,
							availability: "available" as const,
							max_agents: 2,
						},
					],
				},
			},
		};
		const first = resolveWorkExecutionInputs({
			...basis(firstRoot, parallelismInputs),
			stateRoot: sharedStateRoot,
		});
		const second = resolveWorkExecutionInputs({
			...basis(secondRoot, parallelismInputs),
			stateRoot: sharedStateRoot,
		});
		expect(first.parallelism?.worktree_fingerprint).not.toBe(
			second.parallelism?.worktree_fingerprint,
		);
		expect(first.parallelism?.assessment_input_hash).not.toBe(
			second.parallelism?.assessment_input_hash,
		);
	});

	it("rejects unknown derived fields, duplicates, unsafe paths, and symlinks", () => {
		const root = tempRoot();
		fs.writeFileSync(path.join(root, "plan.md"), "plan");
		expect(() =>
			resolveWorkExecutionInputs(
				basis(root, { planning_review_inputs: { artifacts: [] } }),
			),
		).toThrow();
		expect(() =>
			resolveWorkExecutionInputs(basis(root, { review_input_hash: `sha256:${"a".repeat(64)}` })),
		).toThrow();
		expect(() =>
			resolveWorkExecutionInputs(
				basis(root, {
					completion_review_inputs: {
						base_ref: "$(touch-pwned)",
						head_ref: "--upload-pack=evil",
						verification_assertions: [],
						evidence_refs: [],
					},
				}),
			),
		).toThrow(/forbidden syntax/);
		expect(() =>
			resolveWorkExecutionInputs(
				basis(root, {
					planning_review_inputs: {
						artifacts: [
							{ kind: "repo_file", path: "plan.md" },
							{ kind: "repo_file", path: "plan.md" },
						],
					},
				}),
			),
		).toThrow(/duplicate/);
		expect(() =>
			resolveWorkExecutionInputs(
				basis(root, {
					planning_review_inputs: { artifacts: [{ kind: "repo_file", path: "../escape" }] },
				}),
			),
		).toThrow();
		fs.symlinkSync(path.join(root, "plan.md"), path.join(root, "link.md"));
		expect(() =>
			resolveWorkExecutionInputs(
				basis(root, {
					planning_review_inputs: { artifacts: [{ kind: "repo_file", path: "link.md" }] },
				}),
			),
		).toThrow(/symlink/);
		fs.mkdirSync(path.join(root, "real"));
		fs.writeFileSync(path.join(root, "real", "nested.md"), "nested");
		fs.symlinkSync(path.join(root, "real"), path.join(root, "linked-dir"));
		expect(() =>
			resolveWorkExecutionInputs(
				basis(root, {
					planning_review_inputs: {
						artifacts: [{ kind: "repo_file", path: "linked-dir/nested.md" }],
					},
				}),
			),
		).toThrow(/symlink/);
	});

	it("rejects cross-kind final artifact ref collisions before repository file I/O", () => {
		const root = tempRoot();
		expect(() =>
			resolveWorkExecutionInputs(
				basis(root, {
					planning_review_inputs: {
						artifacts: [
							{ kind: "repo_file", path: "same-ref" },
							{
								kind: "runtime_attested_inline",
								ref: "same-ref",
								content: "inline",
								assurance: "runtime_attested",
							},
						],
					},
				}),
			),
		).toThrow(/duplicate/);
	});

	it("bounds repository artifact allocation from descriptor metadata before reading", () => {
		const root = tempRoot();
		const exactPath = path.join(root, "exact.bin");
		const oversizedPath = path.join(root, "oversized.bin");
		fs.writeFileSync(
			exactPath,
			Buffer.alloc(WORK_EXECUTION_LIMITS.maxInlineArtifactUtf8Bytes),
		);
		fs.writeFileSync(
			oversizedPath,
			Buffer.alloc(WORK_EXECUTION_LIMITS.maxInlineArtifactUtf8Bytes + 1),
		);
		const exact = resolveWorkExecutionInputs(
			basis(root, {
				planning_review_inputs: {
					artifacts: [{ kind: "repo_file", path: "exact.bin" }],
				},
			}),
		);
		expect(exact.planning_review?.artifacts[0]?.bytes).toBe(
			WORK_EXECUTION_LIMITS.maxInlineArtifactUtf8Bytes,
		);
		expect(() =>
			resolveWorkExecutionInputs(
				basis(root, {
					planning_review_inputs: {
						artifacts: [{ kind: "repo_file", path: "oversized.bin" }],
					},
				}),
			),
		).toThrow(/bounded input limit/);
	});

	it("uses only exact git executable plus allowlisted argument arrays and computes completion hashes", () => {
		const root = tempRoot();
		const canonicalRoot = fs.realpathSync(root);
		const requests: GitExecutionRequest[] = [];
		const execGit = (request: GitExecutionRequest): Buffer => {
			requests.push(request);
			const args = request.argv.slice(3);
			if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return Buffer.from(`${canonicalRoot}\n`);
			if (args[0] === "rev-parse") {
				const digit = args[3]?.startsWith("base") ? "1" : "2";
				return Buffer.from(`${digit.repeat(40)}\n`);
			}
			return Buffer.from("diff bytes");
		};
		const result = resolveWorkExecutionInputs({
			...basis(root, {
				completion_review_inputs: {
					base_ref: "base",
					head_ref: "head",
					verification_assertions: [{ requirement_id: "req_a", outcome: "passed" }],
					evidence_refs: ["test:unit"],
				},
			}),
			execGit,
		});
		expect("review_input_hash" in result.completion_review!).toBe(true);
		expect(requests.every((request) => request.executable === "git")).toBe(true);
		expect(
			requests.every(
				(request) =>
					request.argv[0] === "-C" &&
					request.argv[1] === canonicalRoot &&
					request.argv[2] === "--no-optional-locks",
			),
		).toBe(true);
		expect(requests.every((request) => !request.argv.includes("-c"))).toBe(true);
	});

	it("returns typed unavailable completion facts and never fabricates hashes", () => {
		const root = tempRoot();
		const result = resolveWorkExecutionInputs({
			...basis(root, {
				completion_review_inputs: {
					base_ref: "missing",
					head_ref: "missing",
					verification_assertions: [],
					evidence_refs: [],
				},
			}),
			execGit: () => {
				throw new Error("not a git repository");
			},
		});
		expect(result.completion_review).toEqual({ unavailable: "git_unavailable" });
	});

	it("rejects limit+1 inline bytes and detects limit+1 Git output", () => {
		const root = tempRoot();
		expect(() =>
			resolveWorkExecutionInputs(
				basis(root, {
					planning_review_inputs: {
						artifacts: [
							{
								kind: "runtime_attested_inline",
								ref: "inline",
								content: "가".repeat(Math.floor(WORK_EXECUTION_LIMITS.maxInlineArtifactUtf8Bytes / 3) + 1),
								assurance: "runtime_attested",
							},
						],
					},
				}),
			),
		).toThrow();
		let calls = 0;
		const result = resolveWorkExecutionInputs({
			...basis(root, {
				completion_review_inputs: {
					base_ref: "base",
					head_ref: "head",
					verification_assertions: [],
					evidence_refs: [],
				},
			}),
			execGit: () => {
				calls += 1;
				return calls === 1
					? Buffer.from(`${root}\n`)
					: Buffer.alloc(WORK_EXECUTION_LIMITS.maxGitOutputUtf8Bytes + 1);
			},
		});
		expect(result.completion_review).toEqual({ unavailable: "git_output_limit_exceeded" });

		let exactCalls = 0;
		const exactResult = resolveWorkExecutionInputs({
			...basis(root, {
				completion_review_inputs: {
					base_ref: "base",
					head_ref: "head",
					verification_assertions: [],
					evidence_refs: [],
				},
			}),
			execGit: () => {
				exactCalls += 1;
				if (exactCalls === 1) return Buffer.from(`${fs.realpathSync(root)}\n`);
				if (exactCalls <= 3) return Buffer.from(`${String(exactCalls).repeat(40)}\n`);
				return Buffer.alloc(WORK_EXECUTION_LIMITS.maxGitOutputUtf8Bytes);
			},
		});
		expect(exactResult.completion_review).toHaveProperty("review_input_hash");
	});

	it("resolves real Git commit and diff facts in a temporary repository", () => {
		const root = tempRoot();
		execFileSync("git", ["init", "-q", root]);
		execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
		execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
		fs.writeFileSync(path.join(root, "a.txt"), "one\n");
		execFileSync("git", ["-C", root, "add", "a.txt"]);
		execFileSync("git", ["-C", root, "commit", "-qm", "one"]);
		const base = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
		fs.writeFileSync(path.join(root, "a.txt"), "two\n");
		execFileSync("git", ["-C", root, "commit", "-qam", "two"]);
		const result = resolveWorkExecutionInputs(
			basis(root, {
				completion_review_inputs: {
					base_ref: base,
					head_ref: "HEAD",
					verification_assertions: [],
					evidence_refs: [],
				},
			}),
		);
		expect(result.completion_review).toMatchObject({ base_object: base });
	});
});

describe("assertAllowedGitArguments", () => {
	it("rejects commands and flags outside the read-only allowlist", () => {
		expect(() => assertAllowedGitArguments(["commit", "-m", "x"])).toThrow(/allowlist/);
		expect(() => assertAllowedGitArguments(["rev-parse", "-c", "core.hooksPath=x"])).toThrow();
		expect(() => assertAllowedGitArguments(["status", "$(touch pwned)"])).toThrow();
	});
});
