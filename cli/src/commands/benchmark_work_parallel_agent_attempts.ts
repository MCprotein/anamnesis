import * as fs from "node:fs";
import * as path from "node:path";
import {
	type ParallelBenchmarkResult,
	WORK_PARALLEL_AGENT_ATTEMPT_LEDGER,
} from "./benchmark_work_parallel_agent_types.js";
import {
	assertNoSymlinkPath,
	isFileExistsError,
	isFileNotFoundError,
} from "./benchmark_work_parallel_agent_util.js";

interface FinalAttemptRecord {
	schema_version?: unknown;
	phase?: unknown;
	implementation_git_sha?: unknown;
	[key: string]: unknown;
}

export function parallelPaidAttemptIndexPath(projectRoot: string): string {
	const indexPath = path.resolve(
		projectRoot,
		WORK_PARALLEL_AGENT_ATTEMPT_LEDGER,
	);
	if (
		indexPath === projectRoot ||
		!indexPath.startsWith(`${path.resolve(projectRoot)}${path.sep}`)
	) {
		throw new Error("benchmark attempt ledger escapes project root");
	}
	assertNoSymlinkPath(path.resolve(projectRoot), path.dirname(indexPath));
	return indexPath;
}

export function recordPaidAttempt(
	projectRoot: string,
	result: ParallelBenchmarkResult,
	phase: "evaluated" | "published",
): void {
	const indexPath = parallelPaidAttemptIndexPath(projectRoot);
	appendParallelPaidAttemptLocked(indexPath, {
		schema_version: "anamnesis.work_parallel_agent_attempt.v1",
		protocol: result.protocol,
		phase,
		generated_at: result.generated_at,
		implementation_git_sha: result.implementation_git_sha,
		harness_hash: result.harness_hash,
		fixture_hash: result.fixture_hash,
		model: result.model,
		verdict: result.comparison.verdict,
		harness_valid: result.harness_validity.ok,
		diagnostic_contract_pass: result.evaluation.diagnostic_contract_pass,
		enabled_quality_pass: result.evaluation.enabled_quality_pass,
		planned_initial_invocations: result.planned_initial_invocations,
		actual_invocations: result.actual_invocations,
		enabled_aggregate_defects: result.comparison.enabled_aggregate_defects,
		accuracy_gate: result.comparison.accuracy_gate,
		cost_gate: result.comparison.cost_gate,
		stage_cost_gate: result.comparison.stage_cost_gate,
		latency_gate: result.comparison.latency_gate,
		efficiency_signal_gate: result.comparison.efficiency_signal_gate,
	});
}

export function appendParallelPaidAttemptLocked(
	indexPath: string,
	record: Record<string, unknown>,
	uniqueImplementationSha?: string,
): number {
	fs.mkdirSync(path.dirname(indexPath), { recursive: true });
	const lockPath = `${indexPath}.lock`;
	let lock: PaidAttemptLock | undefined;
	try {
		lock = acquirePaidAttemptLock(lockPath);
		const previous = fs.existsSync(indexPath)
			? fs.readFileSync(indexPath, "utf8")
			: "";
		const attempts = previous
			.split(/\r?\n/u)
			.filter(Boolean)
			.map((line) => JSON.parse(line) as FinalAttemptRecord);
		if (
			uniqueImplementationSha !== undefined &&
			attempts.some(
				(attempt) => attempt.implementation_git_sha === uniqueImplementationSha,
			)
		) {
			throw new Error(
				"paid protocol already ran for this implementation commit",
			);
		}
		const attemptsBefore = attempts.filter(
			(attempt) => attempt.phase === "started",
		).length;
		const completeRecord =
			record.phase === "started"
				? { ...record, attempt_number: attemptsBefore + 1 }
				: record;
		const temporary = `${indexPath}.tmp-${process.pid}-${Date.now()}`;
		fs.writeFileSync(
			temporary,
			`${previous}${JSON.stringify(completeRecord)}\n`,
			{
				flag: "wx",
				mode: 0o600,
			},
		);
		fs.renameSync(temporary, indexPath);
		return attemptsBefore;
	} finally {
		if (lock !== undefined) {
			releasePaidAttemptLock(lockPath, lock);
		}
	}
}

interface PaidAttemptLock {
	fd: number;
	dev: number;
	ino: number;
}

function acquirePaidAttemptLock(lockPath: string): PaidAttemptLock {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		let createdFd: number | undefined;
		try {
			const fd = fs.openSync(lockPath, "wx", 0o600);
			createdFd = fd;
			fs.writeFileSync(
				fd,
				`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`,
			);
			const stat = fs.fstatSync(fd);
			return { fd, dev: stat.dev, ino: stat.ino };
		} catch (error) {
			if (createdFd !== undefined) {
				fs.closeSync(createdFd);
				fs.rmSync(lockPath, { force: true });
				throw error;
			}
			if (!isFileExistsError(error)) throw error;
			const staleIdentity =
				attempt === 0 ? stalePaidAttemptLockIdentity(lockPath) : undefined;
			if (staleIdentity) {
				const current = fs.lstatSync(lockPath);
				if (
					current.dev !== staleIdentity.dev ||
					current.ino !== staleIdentity.ino
				) {
					throw new Error("paid benchmark lock changed during stale recovery");
				}
				fs.unlinkSync(lockPath);
				continue;
			}
			throw new Error("another paid benchmark attempt is being recorded");
		}
	}
	throw new Error("another paid benchmark attempt is being recorded");
}

function stalePaidAttemptLockIdentity(
	lockPath: string,
): { dev: number; ino: number } | undefined {
	try {
		const stat = fs.lstatSync(lockPath);
		if (!stat.isFile() || stat.isSymbolicLink()) return;
		const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
			pid?: unknown;
			created_at?: unknown;
		};
		if (
			!Number.isInteger(parsed.pid) ||
			(parsed.pid as number) <= 0 ||
			typeof parsed.created_at !== "string"
		) {
			return;
		}
		const createdAt = Date.parse(parsed.created_at);
		if (!Number.isFinite(createdAt) || Date.now() - createdAt < 60_000) {
			return;
		}
		return processIsAlive(parsed.pid as number)
			? undefined
			: { dev: stat.dev, ino: stat.ino };
	} catch {
		return;
	}
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return !(
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "ESRCH"
		);
	}
}

function releasePaidAttemptLock(lockPath: string, lock: PaidAttemptLock): void {
	fs.closeSync(lock.fd);
	try {
		const stat = fs.lstatSync(lockPath);
		if (stat.dev === lock.dev && stat.ino === lock.ino) fs.unlinkSync(lockPath);
	} catch (error) {
		if (!isFileNotFoundError(error)) throw error;
	}
}
