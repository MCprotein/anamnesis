import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { isHash, sha256 } from "../util/hash.js";
import {
	readWorkLedger,
	type WorkLedgerRecord,
	withWorkLedgerLock,
} from "./work_ledger.js";

export const WORK_PROJECTION_SCHEMA_VERSION =
	"anamnesis.work-projection.v1" as const;

export const WORK_REQUIREMENT_STATES = [
	"pending",
	"in_progress",
	"implemented_unverified",
	"verified",
	"blocked",
	"waived",
] as const;
export type WorkRequirementState = (typeof WORK_REQUIREMENT_STATES)[number];
export type WorkLifecycle = "open" | "completed" | "abandoned" | "superseded";

export interface ProjectedRequirement {
	id: string;
	summary: string;
	status: WorkRequirementState;
	source_event_ids: string[];
	evidence_refs: string[];
	weight?: number;
	superseded_by?: string;
	updated_at: string;
}

export interface WorkProjectionProgress {
	applicable: number;
	verified: number;
	implemented_unverified: number;
	blocked: number;
	waived: number;
	percent: number;
	weighted: boolean;
	verified_weight?: number;
	applicable_weight?: number;
}

export interface WorkProjection {
	schema_version: typeof WORK_PROJECTION_SCHEMA_VERSION;
	work_id: string;
	contract_revision: number;
	lifecycle: WorkLifecycle;
	boundary_hash: string | null;
	policy_hash: string | null;
	ledger_head: string | null;
	last_event_id: string | null;
	requirements: ProjectedRequirement[];
	conflicts: string[];
	progress: WorkProjectionProgress;
	projection_hash: string;
}

export interface WorkProjectionLimits {
	maxRecords?: number;
	maxRequirements?: number;
	maxSummaryUtf8Bytes?: number;
	maxReferencesPerRequirement?: number;
}

export interface RebuildWorkProjectionOptions {
	lockTimeoutMs?: number;
	lockRetryMs?: number;
	onProjectionFolded?: (projection: WorkProjection) => void;
}

const DEFAULT_LIMITS: Required<WorkProjectionLimits> = {
	maxRecords: 10_000,
	maxRequirements: 1_000,
	maxSummaryUtf8Bytes: 16_384,
	maxReferencesPerRequirement: 256,
};

const requirementStates = new Set<string>(WORK_REQUIREMENT_STATES);
const lifecycles = new Set<string>([
	"open",
	"completed",
	"abandoned",
	"superseded",
]);

export function foldWorkProjection(
	records: readonly WorkLedgerRecord[],
	suppliedLimits: WorkProjectionLimits = {},
): WorkProjection {
	const limits = { ...DEFAULT_LIMITS, ...suppliedLimits };
	for (const [name, value] of Object.entries(limits)) {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new Error(
				`Work projection limit ${name} must be a positive safe integer`,
			);
		}
	}
	if (records.length > limits.maxRecords) {
		throw new Error(
			`Work projection record limit exceeded (${limits.maxRecords})`,
		);
	}

	let workId: string | undefined;
	let created = false;
	let contractRevision = 0;
	let lifecycle: WorkLifecycle = "open";
	let boundaryHash: string | null = null;
	let policyHash: string | null = null;
	const requirements = new Map<string, ProjectedRequirement>();
	const conflicts = new Set<string>();

	for (const record of records) {
		const payload = record.payload;

		switch (record.kind) {
			case "work_created": {
				if (created) {
					throw new Error(
						"Work projection contains repeated work_created event",
					);
				}
				workId = requiredString(payload.work_id, "work_id");
				created = true;
				contractRevision =
					optionalNonNegativeInteger(
						payload.contract_revision,
						"contract_revision",
					) ?? 1;
				lifecycle = optionalLifecycle(payload.lifecycle) ?? "open";
				boundaryHash =
					optionalHash(payload.boundary_hash, "boundary_hash") ?? null;
				policyHash = optionalHash(payload.policy_hash, "policy_hash") ?? null;
				break;
			}
			case "contract_revised":
			case "work_contract_revised": {
				assertCreated(created, record.kind);
				assertMatchingWorkId(payload.work_id, workId);
				const revision = requiredNonNegativeInteger(
					payload.contract_revision,
					"contract_revision",
				);
				if (revision < contractRevision) {
					throw new Error("Work projection contract revision moved backwards");
				}
				contractRevision = revision;
				boundaryHash =
					optionalHash(payload.boundary_hash, "boundary_hash") ?? boundaryHash;
				policyHash =
					optionalHash(payload.policy_hash, "policy_hash") ?? policyHash;
				break;
			}
			case "requirement_added":
			case "requirement_recorded": {
				assertCreated(created, record.kind);
				assertMatchingWorkId(payload.work_id, workId);
				const id = requiredString(payload.requirement_id, "requirement_id");
				const summary = requiredString(payload.summary, "summary");
				if (Buffer.byteLength(summary, "utf8") > limits.maxSummaryUtf8Bytes) {
					throw new Error(
						`Work requirement summary exceeds ${limits.maxSummaryUtf8Bytes} UTF-8 bytes`,
					);
				}
				const sources = stringArray(
					payload.source_event_ids,
					"source_event_ids",
					limits,
				);
				const existing = requirements.get(id);
				if (existing) {
					existing.source_event_ids = appendUnique(
						existing.source_event_ids,
						sources,
						limits,
					);
					break;
				}
				if (requirements.size >= limits.maxRequirements) {
					throw new Error(
						`Work projection requirement limit exceeded (${limits.maxRequirements})`,
					);
				}
				const status = optionalRequirementState(payload.status) ?? "pending";
				if (status !== "waived" && sources.length === 0) {
					throw new Error(
						"active Work requirement requires source_event_ids provenance",
					);
				}
				const weight = optionalPositiveNumber(payload.weight, "weight");
				requirements.set(id, {
					id,
					summary,
					status,
					source_event_ids: sources,
					evidence_refs: stringArray(
						payload.evidence_refs,
						"evidence_refs",
						limits,
					),
					...(weight === undefined ? {} : { weight }),
					updated_at: record.occurred_at,
				});
				break;
			}
			case "requirement_status_changed":
			case "requirement_transitioned": {
				assertCreated(created, record.kind);
				assertMatchingWorkId(payload.work_id, workId);
				const requirement = existingRequirement(
					requirements,
					payload.requirement_id,
				);
				requirement.status = requiredRequirementState(payload.status);
				requirement.evidence_refs = appendUnique(
					requirement.evidence_refs,
					stringArray(payload.evidence_refs, "evidence_refs", limits),
					limits,
				);
				requirement.updated_at = record.occurred_at;
				break;
			}
			case "requirement_superseded": {
				assertCreated(created, record.kind);
				assertMatchingWorkId(payload.work_id, workId);
				const requirement = existingRequirement(
					requirements,
					payload.requirement_id,
				);
				requirement.superseded_by = requiredString(
					payload.superseded_by,
					"superseded_by",
				);
				requirement.status = "waived";
				requirement.updated_at = record.occurred_at;
				break;
			}
			case "work_lifecycle_changed":
			case "lifecycle_changed":
				assertCreated(created, record.kind);
				assertMatchingWorkId(payload.work_id, workId);
				lifecycle = requiredLifecycle(payload.lifecycle);
				break;
			case "conflict_recorded":
				assertCreated(created, record.kind);
				assertMatchingWorkId(payload.work_id, workId);
				conflicts.add(requiredString(payload.conflict_id, "conflict_id"));
				break;
			case "conflict_resolved":
				assertCreated(created, record.kind);
				assertMatchingWorkId(payload.work_id, workId);
				conflicts.delete(requiredString(payload.conflict_id, "conflict_id"));
				break;
			default:
				// Provenance, review, checkpoint, and future events remain authoritative
				// in the ledger but do not alter this v1 bounded current view.
				break;
		}
	}

	if (!workId)
		throw new Error("Work projection requires a committed work_created event");
	const requirementList = [...requirements.values()];
	const unsigned: Omit<WorkProjection, "projection_hash"> = {
		schema_version: WORK_PROJECTION_SCHEMA_VERSION,
		work_id: workId,
		contract_revision: contractRevision,
		lifecycle,
		boundary_hash: boundaryHash,
		policy_hash: policyHash,
		ledger_head: records.at(-1)?.record_hash ?? null,
		last_event_id: records.at(-1)?.event_id ?? null,
		requirements: requirementList,
		conflicts: [...conflicts],
		progress: calculateWorkProgress(requirementList),
	};
	return { ...unsigned, projection_hash: sha256(canonicalJson(unsigned)) };
}

export function calculateWorkProgress(
	requirements: readonly ProjectedRequirement[],
): WorkProjectionProgress {
	const applicable = requirements.filter(
		(requirement) => requirement.status !== "waived",
	);
	const verified = applicable.filter(
		(requirement) => requirement.status === "verified",
	);
	const explicitlyWeighted =
		requirements.length > 0 &&
		requirements.every((item) => item.weight !== undefined);
	const base = {
		applicable: applicable.length,
		verified: verified.length,
		implemented_unverified: applicable.filter(
			(item) => item.status === "implemented_unverified",
		).length,
		blocked: applicable.filter((item) => item.status === "blocked").length,
		waived: requirements.length - applicable.length,
	};
	if (explicitlyWeighted) {
		const applicableWeight = applicable.reduce(
			(sum, item) => sum + (item.weight ?? 0),
			0,
		);
		const verifiedWeight = verified.reduce(
			(sum, item) => sum + (item.weight ?? 0),
			0,
		);
		return {
			...base,
			percent:
				applicableWeight === 0
					? 100
					: roundPercent(verifiedWeight / applicableWeight),
			weighted: true,
			verified_weight: verifiedWeight,
			applicable_weight: applicableWeight,
		};
	}
	return {
		...base,
		percent:
			applicable.length === 0
				? 100
				: roundPercent(verified.length / applicable.length),
		weighted: false,
	};
}

export function rebuildWorkProjection(
	ledgerPath: string,
	projectionPath: string,
	limits: WorkProjectionLimits = {},
	options: RebuildWorkProjectionOptions = {},
): WorkProjection {
	assertProjectionLocation(ledgerPath, projectionPath);
	return withWorkLedgerLock(ledgerPath, options, () => {
		const projection = foldWorkProjection(
			readWorkLedger(ledgerPath).records,
			limits,
		);
		options.onProjectionFolded?.(projection);
		writeWorkProjectionAtomic(projectionPath, projection);
		return projection;
	});
}

export function writeWorkProjectionAtomic(
	projectionPath: string,
	projection: WorkProjection,
): void {
	const directory = path.dirname(projectionPath);
	fs.mkdirSync(directory, { recursive: true });
	assertManagedWritePath(directory, projectionPath);
	const temporary = `${projectionPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
	let file: number | undefined;
	try {
		file = fs.openSync(
			temporary,
			fs.constants.O_WRONLY |
				fs.constants.O_CREAT |
				fs.constants.O_EXCL |
				fs.constants.O_NOFOLLOW,
			0o600,
		);
		fs.writeFileSync(file, YAML.stringify(projection), "utf8");
		fs.fsyncSync(file);
		fs.closeSync(file);
		file = undefined;
		fs.renameSync(temporary, projectionPath);
		const dir = fs.openSync(directory, "r");
		try {
			fs.fsyncSync(dir);
		} finally {
			fs.closeSync(dir);
		}
	} catch (error) {
		if (file !== undefined) fs.closeSync(file);
		try {
			fs.unlinkSync(temporary);
		} catch {
			// A projection is a rebuildable cache; cleanup is best effort.
		}
		throw error;
	}
}

function existingRequirement(
	requirements: Map<string, ProjectedRequirement>,
	value: unknown,
): ProjectedRequirement {
	const id = requiredString(value, "requirement_id");
	const requirement = requirements.get(id);
	if (!requirement)
		throw new Error(`Work projection references unknown requirement: ${id}`);
	return requirement;
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`invalid ${field}`);
	return value;
}

function assertCreated(created: boolean, kind: string): void {
	if (!created)
		throw new Error(`Work semantic event ${kind} precedes work_created`);
}

function assertMatchingWorkId(
	value: unknown,
	workId: string | undefined,
): void {
	const eventWorkId = optionalString(value, "work_id");
	if (eventWorkId !== undefined && eventWorkId !== workId) {
		throw new Error(
			`Work projection event targets different work ID: ${eventWorkId}`,
		);
	}
}

function optionalString(value: unknown, field: string): string | undefined {
	return value === undefined ? undefined : requiredString(value, field);
}

function requiredNonNegativeInteger(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		throw new Error(`invalid ${field}`);
	return value as number;
}

function optionalNonNegativeInteger(
	value: unknown,
	field: string,
): number | undefined {
	return value === undefined
		? undefined
		: requiredNonNegativeInteger(value, field);
}

function optionalPositiveNumber(
	value: unknown,
	field: string,
): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
		throw new Error(`invalid ${field}`);
	return value;
}

function requiredRequirementState(value: unknown): WorkRequirementState {
	if (typeof value !== "string" || !requirementStates.has(value))
		throw new Error("invalid requirement status");
	return value as WorkRequirementState;
}

function optionalRequirementState(
	value: unknown,
): WorkRequirementState | undefined {
	return value === undefined ? undefined : requiredRequirementState(value);
}

function requiredLifecycle(value: unknown): WorkLifecycle {
	if (typeof value !== "string" || !lifecycles.has(value))
		throw new Error("invalid Work lifecycle");
	return value as WorkLifecycle;
}

function optionalLifecycle(value: unknown): WorkLifecycle | undefined {
	return value === undefined ? undefined : requiredLifecycle(value);
}

function optionalHash(value: unknown, field: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isHash(value)) throw new Error(`invalid ${field}`);
	return value;
}

function stringArray(
	value: unknown,
	field: string,
	limits: Required<WorkProjectionLimits>,
): string[] {
	if (value === undefined) return [];
	if (
		!Array.isArray(value) ||
		value.some((entry) => typeof entry !== "string" || entry.length === 0)
	) {
		throw new Error(`invalid ${field}`);
	}
	const result = [...new Set(value as string[])];
	if (result.length > limits.maxReferencesPerRequirement)
		throw new Error(`${field} limit exceeded`);
	return result;
}

function appendUnique(
	current: string[],
	incoming: string[],
	limits: Required<WorkProjectionLimits>,
): string[] {
	const result = [...new Set([...current, ...incoming])];
	if (result.length > limits.maxReferencesPerRequirement)
		throw new Error("Work requirement reference limit exceeded");
	return result;
}

function roundPercent(ratio: number): number {
	return Math.round(ratio * 10_000) / 100;
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
		.join(",")}}`;
}

function assertProjectionLocation(
	ledgerPath: string,
	projectionPath: string,
): void {
	if (
		path.dirname(path.resolve(ledgerPath)) !==
		path.dirname(path.resolve(projectionPath))
	) {
		throw new Error("Work projection must be stored beside its ledger");
	}
}

function assertManagedWritePath(root: string, target: string): void {
	const resolvedRoot = path.resolve(root);
	const resolvedTarget = path.resolve(target);
	const relative = path.relative(resolvedRoot, resolvedTarget);
	if (
		relative.startsWith("..") ||
		path.isAbsolute(relative) ||
		relative === ""
	) {
		throw new Error("managed Work path escapes its root");
	}
	for (const candidate of [resolvedRoot, resolvedTarget]) {
		try {
			if (fs.lstatSync(candidate).isSymbolicLink()) {
				throw new Error(
					`managed Work path must not be a symbolic link: ${candidate}`,
				);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}
