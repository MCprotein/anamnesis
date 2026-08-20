import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { sha256 } from "../util/hash.js";
import {
	WORK_EXECUTION_LIMITS,
	externalEffectSchema,
	repoFileRefSchema,
	repositoryScopeSchema,
	runtimeAttestedCapabilitySchema,
	runtimeAttestedInlineArtifactSchema,
	verificationAssertionSchema,
	type ExternalEffect,
	type RepositoryScope,
	type RuntimeAttestedCapability,
} from "./work_contract.js";
import {
	calculateAssessmentInputHash,
	calculateReviewInputHash,
	type CanonicalExecutionInputsView,
} from "./work_execution_contract.js";
import { worktreeFingerprint } from "./work_storage.js";

const uniqueArray = <T extends z.ZodTypeAny>(
	schema: T,
	maxLength: number,
	identity: (value: z.infer<T>) => string = (value) => canonicalJson(value),
) =>
	z
		.array(schema)
		.max(maxLength)
		.superRefine((values, context) => {
			const seen = new Set<string>();
			for (const [index, value] of values.entries()) {
				const key = identity(value);
				if (seen.has(key)) {
					context.addIssue({
						code: z.ZodIssueCode.custom,
						message: `duplicate value: ${key}`,
						path: [index],
					});
				}
				seen.add(key);
			}
		});

const boundedRef = z
	.string()
	.min(1)
	.refine(
		(value) => Buffer.from(value, "utf8").toString("utf8") === value,
		"value contains an invalid Unicode scalar",
	)
	.refine((value) => value === value.trim(), "value must be trimmed")
	.refine(
		(value) => Buffer.byteLength(value, "utf8") <= WORK_EXECUTION_LIMITS.maxRefUtf8Bytes,
		`value exceeds ${WORK_EXECUTION_LIMITS.maxRefUtf8Bytes} UTF-8 bytes`,
	);
const gitRef = boundedRef.refine(
	(value) =>
		/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value) &&
		!value.includes("..") &&
		!value.includes("//") &&
		!value.endsWith("/") &&
		!value.endsWith(".") &&
		!value.endsWith(".lock"),
	"Git ref contains forbidden syntax",
);

const artifactInputSchema = z.discriminatedUnion("kind", [
	repoFileRefSchema,
	runtimeAttestedInlineArtifactSchema,
]);

export const workExecutionInputsSchema = z
	.object({
		planning_review_inputs: z
			.object({
				artifacts: uniqueArray(
					artifactInputSchema,
					WORK_EXECUTION_LIMITS.maxArtifacts,
					(value) => (value.kind === "repo_file" ? value.path : value.ref),
				).min(1),
			})
			.strict()
			.optional(),
		completion_review_inputs: z
			.object({
				base_ref: gitRef,
				head_ref: gitRef,
				verification_assertions: uniqueArray(
					verificationAssertionSchema,
					WORK_EXECUTION_LIMITS.maxVerificationAssertions,
					(value) => value.requirement_id,
				),
				evidence_refs: uniqueArray(
					boundedRef,
					WORK_EXECUTION_LIMITS.maxEvidenceRefs,
					String,
				),
			})
			.strict()
			.optional(),
		parallelism_inputs: z
			.object({
				material_scope: z
					.object({
						repository_scopes: uniqueArray(
							repositoryScopeSchema,
							WORK_EXECUTION_LIMITS.maxRepositoryScopesPerLane,
						),
						external_effects: uniqueArray(
							externalEffectSchema,
							WORK_EXECUTION_LIMITS.maxExternalEffectsPerLane,
						),
					})
					.strict(),
				runtime_capability: runtimeAttestedCapabilitySchema,
			})
			.strict()
			.optional(),
	})
	.strict();

export type WorkExecutionInputs = z.infer<typeof workExecutionInputsSchema>;

export interface CanonicalArtifactFact {
	kind: "repo_file" | "runtime_attested_inline";
	ref: string;
	hash: string;
	bytes: number;
	assurance: "repository" | "runtime_attested";
}

export interface CanonicalCompletionFacts {
	base_ref: string;
	base_object: string;
	head_ref: string;
	head_object: string;
	diff_hash: string;
	verification_hash: string;
	verification_assertions: Array<{ requirement_id: string; outcome: "passed" | "failed" }>;
	evidence_refs: string[];
}

export interface CanonicalWorkExecutionInputs extends CanonicalExecutionInputsView {
	planning_review: ({ artifacts: CanonicalArtifactFact[] } & NonNullable<
		CanonicalExecutionInputsView["planning_review"]
	>) | null;
	completion_review:
		| (CanonicalCompletionFacts & { review_input_hash: string })
		| { unavailable: "git_unavailable" | "ref_unresolvable" | "git_output_limit_exceeded" }
		| null;
	parallelism:
		| {
				material_scope: {
					repository_scopes: RepositoryScope[];
					external_effects: ExternalEffect[];
				};
				runtime_capability: RuntimeAttestedCapability;
				worktree_fingerprint: string;
				assessment_input_hash: string;
		  }
		| null;
}

export interface GitExecutionRequest {
	executable: "git";
	argv: readonly string[];
	cwd: string;
	maxOutputBytes: number;
}

export type GitExecutor = (request: GitExecutionRequest) => Buffer;

export interface ResolveWorkExecutionInputsOptions {
	repositoryRoot: string;
	stateRoot?: string;
	workId: string;
	contractRevision: number;
	contractHash: string;
	policyHash: string;
	executionInputs?: unknown;
	execGit?: GitExecutor;
}

class GitFactError extends Error {
	constructor(
		readonly code:
			| "git_unavailable"
			| "ref_unresolvable"
			| "git_output_limit_exceeded",
		message: string,
	) {
		super(message);
	}
}

export function resolveWorkExecutionInputs(
	options: ResolveWorkExecutionInputsOptions,
): CanonicalWorkExecutionInputs {
	const parsed = workExecutionInputsSchema.parse(options.executionInputs ?? {});
	const repositoryRoot = canonicalDirectory(options.repositoryRoot);
	if (options.stateRoot) canonicalDirectory(options.stateRoot);
	const execGit = options.execGit ?? defaultGitExecutor;

	const planning = parsed.planning_review_inputs
		? resolvePlanningInputs(repositoryRoot, parsed.planning_review_inputs.artifacts)
		: null;
	const planningReview = planning
		? {
				artifacts: planning,
				review_input_hash: calculateReviewInputHash({
					gate: "planning",
					work_id: options.workId,
					contract_revision: options.contractRevision,
					contract_hash: options.contractHash,
					policy_hash: options.policyHash,
					inputs: { artifacts: planning },
				}),
			}
		: null;
	const completionReview = parsed.completion_review_inputs
		? resolveCompletionInputs(options, repositoryRoot, parsed.completion_review_inputs, execGit)
		: null;
	const parallelism = parsed.parallelism_inputs
		? resolveParallelismInputs(options, repositoryRoot, parsed.parallelism_inputs)
		: null;
	return deepFreeze({
		planning_review: planningReview,
		completion_review: completionReview,
		parallelism,
	});
}

function resolvePlanningInputs(
	repositoryRoot: string,
	artifacts: WorkExecutionInputs["planning_review_inputs"] extends infer _T
		? NonNullable<WorkExecutionInputs["planning_review_inputs"]>["artifacts"]
		: never,
): CanonicalArtifactFact[] {
	return artifacts
		.map((artifact): CanonicalArtifactFact => {
			if (artifact.kind === "runtime_attested_inline") {
				const bytes = Buffer.from(artifact.content, "utf8");
				return {
					kind: artifact.kind,
					ref: artifact.ref,
					hash: sha256(bytes),
					bytes: bytes.length,
					assurance: "runtime_attested",
				};
			}
			const bytes = readBoundedRepositoryFile(repositoryRoot, artifact.path);
			return {
				kind: artifact.kind,
				ref: artifact.path,
				hash: sha256(bytes),
				bytes: bytes.length,
				assurance: "repository",
			};
		})
		.sort((left, right) => compareCodeUnits(left.ref, right.ref));
}

function resolveCompletionInputs(
	options: ResolveWorkExecutionInputsOptions,
	repositoryRoot: string,
	input: NonNullable<WorkExecutionInputs["completion_review_inputs"]>,
	execGit: GitExecutor,
): CanonicalWorkExecutionInputs["completion_review"] {
	try {
		assertGitRepository(repositoryRoot, execGit);
		const baseObject = resolveCommit(repositoryRoot, input.base_ref, execGit);
		const headObject = resolveCommit(repositoryRoot, input.head_ref, execGit);
		const diff = runGit(
			repositoryRoot,
			["diff", "--binary", "--no-ext-diff", "--no-textconv", baseObject, headObject, "--"],
			execGit,
			"ref_unresolvable",
		);
		const assertions = [...input.verification_assertions].sort((left, right) =>
			compareCodeUnits(left.requirement_id, right.requirement_id),
		);
		const evidenceRefs = [...input.evidence_refs].sort(compareCodeUnits);
		const facts: CanonicalCompletionFacts = {
			base_ref: input.base_ref,
			base_object: baseObject,
			head_ref: input.head_ref,
			head_object: headObject,
			diff_hash: sha256(diff),
			verification_hash: sha256(canonicalJson({ assertions, evidence_refs: evidenceRefs })),
			verification_assertions: assertions,
			evidence_refs: evidenceRefs,
		};
		return {
			...facts,
			review_input_hash: calculateReviewInputHash({
				gate: "completion",
				work_id: options.workId,
				contract_revision: options.contractRevision,
				contract_hash: options.contractHash,
				policy_hash: options.policyHash,
				inputs: facts,
			}),
		};
	} catch (error) {
		if (error instanceof GitFactError) return { unavailable: error.code };
		throw error;
	}
}

function resolveParallelismInputs(
	options: ResolveWorkExecutionInputsOptions,
	repositoryRoot: string,
	input: NonNullable<WorkExecutionInputs["parallelism_inputs"]>,
): NonNullable<CanonicalWorkExecutionInputs["parallelism"]> {
	const materialScope = {
		repository_scopes: [...input.material_scope.repository_scopes].sort((left, right) =>
			compareCodeUnits(canonicalJson(left), canonicalJson(right)),
		),
		external_effects: [...input.material_scope.external_effects].sort((left, right) =>
			compareCodeUnits(canonicalJson(left), canonicalJson(right)),
		),
	};
	const capability = {
		...input.runtime_capability,
		providers: [...input.runtime_capability.providers].sort((left, right) =>
			compareCodeUnits(left.provider, right.provider),
		),
	};
	const canonicalWorktreeFingerprint = worktreeFingerprint(repositoryRoot);
	return {
		material_scope: materialScope,
		runtime_capability: capability,
		worktree_fingerprint: canonicalWorktreeFingerprint,
		assessment_input_hash: calculateAssessmentInputHash({
			work_id: options.workId,
			contract_revision: options.contractRevision,
			contract_hash: options.contractHash,
			policy_hash: options.policyHash,
			material_scope: materialScope,
			runtime_capability: capability,
			worktree_fingerprint: canonicalWorktreeFingerprint,
		}),
	};
}

function assertGitRepository(repositoryRoot: string, execGit: GitExecutor): void {
	const output = runGit(
		repositoryRoot,
		["rev-parse", "--show-toplevel"],
		execGit,
		"git_unavailable",
	).toString("utf8").trim();
	let actual: string;
	try {
		actual = fs.realpathSync(output);
	} catch {
		throw new GitFactError("git_unavailable", "Git top-level path is unavailable");
	}
	if (actual !== repositoryRoot) {
		throw new GitFactError("git_unavailable", "repository root does not match Git top-level");
	}
}

function resolveCommit(repositoryRoot: string, ref: string, execGit: GitExecutor): string {
	const object = runGit(
		repositoryRoot,
		["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
		execGit,
		"ref_unresolvable",
	)
		.toString("utf8")
		.trim();
	if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(object)) {
		throw new GitFactError("ref_unresolvable", "Git ref did not resolve to one object identity");
	}
	return object;
}

function runGit(
	repositoryRoot: string,
	argv: readonly string[],
	execGit: GitExecutor,
	failureCode: "git_unavailable" | "ref_unresolvable",
): Buffer {
	assertAllowedGitArguments(argv);
	try {
		const output = execGit({
			executable: "git",
			argv: ["-C", repositoryRoot, "--no-optional-locks", ...argv],
			cwd: repositoryRoot,
			maxOutputBytes: WORK_EXECUTION_LIMITS.maxGitOutputUtf8Bytes,
		});
		if (!Buffer.isBuffer(output)) throw new Error("Git executor must return a Buffer");
		if (output.length > WORK_EXECUTION_LIMITS.maxGitOutputUtf8Bytes) {
			throw new GitFactError("git_output_limit_exceeded", "Git output exceeds bounded input limit");
		}
		return output;
	} catch (error) {
		if (error instanceof GitFactError) throw error;
		if (isMaxBufferError(error)) {
			throw new GitFactError("git_output_limit_exceeded", "Git output exceeds bounded input limit");
		}
		throw new GitFactError(failureCode, error instanceof Error ? error.message : String(error));
	}
}

export function assertAllowedGitArguments(argv: readonly string[]): void {
	const command = argv[0];
	const allowed =
		(command === "rev-parse" &&
			(argv.length === 2 && argv[1] === "--show-toplevel" ||
				argv.length === 4 && argv[1] === "--verify" && argv[2] === "--end-of-options")) ||
		(command === "diff" &&
			argv.length === 7 &&
			argv[1] === "--binary" &&
			argv[2] === "--no-ext-diff" &&
			argv[3] === "--no-textconv" &&
			argv[6] === "--");
	if (!allowed || argv.some((item) => item.includes("\0"))) {
		throw new Error("Git arguments are not on the read-only allowlist");
	}
}

function defaultGitExecutor(request: GitExecutionRequest): Buffer {
	if (request.executable !== "git") throw new Error("only git is allowed");
	return execFileSync(request.executable, [...request.argv], {
		cwd: request.cwd,
		encoding: "buffer",
		maxBuffer: request.maxOutputBytes + 1,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function readBoundedRepositoryFile(
	repositoryRoot: string,
	relativePath: string,
): Buffer {
	const absolutePath = path.resolve(repositoryRoot, ...relativePath.split("/"));
	if (!isInside(repositoryRoot, absolutePath)) {
		throw new Error(`repository artifact is outside the repository: ${relativePath}`);
	}
	const segments = relativePath.split("/");
	let current = repositoryRoot;
	for (const [index, segment] of segments.entries()) {
		current = path.join(current, segment);
		const stat = fs.lstatSync(current);
		if (stat.isSymbolicLink()) throw new Error(`repository artifact follows a symlink: ${relativePath}`);
		if (index < segments.length - 1 && !stat.isDirectory()) {
			throw new Error(`repository artifact ancestor is not a directory: ${relativePath}`);
		}
		if (index === segments.length - 1 && !stat.isFile()) {
			throw new Error(`repository artifact is not a regular file: ${relativePath}`);
		}
	}
	const noFollow = fs.constants.O_NOFOLLOW ?? 0;
	let descriptor: number;
	try {
		descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | noFollow);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ELOOP") {
			throw new Error(`repository artifact follows a symlink: ${relativePath}`);
		}
		throw error;
	}
	try {
		const descriptorStat = fs.fstatSync(descriptor);
		if (!descriptorStat.isFile()) {
			throw new Error(`repository artifact is not a regular file: ${relativePath}`);
		}
		if (descriptorStat.size > WORK_EXECUTION_LIMITS.maxInlineArtifactUtf8Bytes) {
			throw new Error("repository artifact exceeds bounded input limit");
		}
		const resolved = fs.realpathSync(absolutePath);
		if (!isInside(repositoryRoot, resolved)) {
			throw new Error(`repository artifact is outside the repository: ${relativePath}`);
		}
		const resolvedStat = fs.statSync(resolved);
		if (
			resolvedStat.dev !== descriptorStat.dev ||
			resolvedStat.ino !== descriptorStat.ino
		) {
			throw new Error(`repository artifact changed during secure open: ${relativePath}`);
		}
		const bytes = Buffer.alloc(descriptorStat.size);
		let offset = 0;
		while (offset < bytes.length) {
			const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
			if (count === 0) break;
			offset += count;
		}
		const finalStat = fs.fstatSync(descriptor);
		if (
			offset !== descriptorStat.size ||
			finalStat.size !== descriptorStat.size ||
			finalStat.dev !== descriptorStat.dev ||
			finalStat.ino !== descriptorStat.ino
		) {
			throw new Error(`repository artifact changed during bounded read: ${relativePath}`);
		}
		return bytes;
	} finally {
		fs.closeSync(descriptor);
	}
}

function canonicalDirectory(value: string): string {
	const resolved = fs.realpathSync(value);
	if (!fs.statSync(resolved).isDirectory()) throw new Error(`not a directory: ${value}`);
	return resolved;
}

function isInside(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isMaxBufferError(error: unknown): boolean {
	return (
		error instanceof Error &&
		("code" in error && (error as NodeJS.ErrnoException).code === "ENOBUFS" ||
			error.message.includes("maxBuffer"))
	);
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object") {
		Object.freeze(value);
		for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
	}
	return value;
}

function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("canonical JSON rejects non-finite numbers");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([left], [right]) => compareCodeUnits(left, right))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
			.join(",")}}`;
	}
	throw new Error(`canonical JSON rejects ${typeof value}`);
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
