import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { isHash, sha256 } from "../util/hash.js";
import {
	parseTypedWorkEvent,
	validateWorkLedgerSemantics,
} from "./work_contract.js";
import {
	readWorkLedger,
	type WorkLedgerRecord,
	withWorkLedgerLock,
} from "./work_ledger.js";
import type { ReviewGateName, WorkPolicySnapshot } from "./work_policy.js";

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
	pending: number;
	in_progress: number;
	verified: number;
	implemented_unverified: number;
	blocked: number;
	waived: number;
	percent: number;
	weighted: boolean;
	denominator_empty: boolean;
	verified_weight?: number;
	applicable_weight?: number;
}

export interface WorkProjection {
	schema_version: typeof WORK_PROJECTION_SCHEMA_VERSION;
	work_id: string;
	title: string | null;
	completion_contract: string | null;
	contract_revision: number;
	lifecycle: WorkLifecycle;
	boundary_hash: string | null;
	contract_hash: string | null;
	policy_hash: string | null;
	policy_snapshot: WorkPolicySnapshot | null;
	configured_required_gates: ReviewGateName[];
	ledger_head: string | null;
	last_event_id: string | null;
	requirements: ProjectedRequirement[];
	conflicts: string[];
	diagnostics: string[];
	progress: WorkProjectionProgress;
	requirements_ready: boolean;
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
	let title: string | null = null;
	let completionContract: string | null = null;
	let created = false;
	let contractRevision = 0;
	let lifecycle: WorkLifecycle = "open";
	let boundaryHash: string | null = null;
	let typedBoundaryState: "provisional" | "needs_user" | "accepted" | null =
		null;
	let contractHash: string | null = null;
	let policyHash: string | null = null;
	let policySnapshot: WorkPolicySnapshot | null = null;
	const requirements = new Map<string, ProjectedRequirement>();
	const conflicts = new Set<string>();
	const diagnostics = new Set<string>();
	validateWorkLedgerSemantics(records);

	for (const record of records) {
		const payload = record.payload;
		if (
			payload.schema_version === "anamnesis.work-contract-event.v1" ||
			payload.schema_version === "anamnesis.work-progress-event.v1" ||
			payload.schema_version === "anamnesis.work-lifecycle-event.v1"
		) {
			const typed = parseTypedWorkEvent(record);
			if (
				typed.kind === "work_created" ||
				typed.kind === "work_contract_revised"
			) {
				if (typed.kind === "work_created" && created) {
					throw new Error(
						"Work projection contains repeated work_created event",
					);
				}
				if (typed.kind === "work_contract_revised")
					assertCreated(created, typed.kind);
				workId = typed.payload.work_id;
				title = boundedText(typed.payload.contract.work.title, "Work title", limits.maxSummaryUtf8Bytes);
				completionContract = boundedText(typed.payload.contract.work.completion_contract, "Work completion contract", limits.maxSummaryUtf8Bytes);
				created = true;
				contractRevision = typed.payload.contract_revision;
				contractHash = typed.payload.contract_hash;
				policySnapshot = typed.payload.contract.policy_snapshot;
				policyHash = policySnapshot.policy_hash;
				boundaryHash = sha256(canonicalJson(typed.payload.contract.boundary));
				typedBoundaryState = typed.payload.contract.boundary.state;
				const supersededBy = new Map<string, string>();
				for (const definition of typed.payload.contract.requirements) {
					for (const target of definition.supersedes ?? []) supersededBy.set(target, definition.id);
				}
				const nextRequirements = new Map<string, ProjectedRequirement>();
				for (const definition of typed.payload.contract.requirements) {
					const previous = requirements.get(definition.id);
					nextRequirements.set(definition.id, {
						id: definition.id,
						summary: definition.summary,
						status: definition.superseded_by || supersededBy.has(definition.id)
							? "waived"
							: (previous?.status ?? "pending"),
						source_event_ids: [...definition.source_event_ids],
						evidence_refs: [...(previous?.evidence_refs ?? [])],
						...(definition.weight === undefined
							? {}
							: { weight: definition.weight }),
						...((definition.superseded_by ?? supersededBy.get(definition.id)) === undefined
							? {}
							: { superseded_by: definition.superseded_by ?? supersededBy.get(definition.id) }),
						updated_at: record.occurred_at,
					});
				}
				requirements.clear();
				for (const [id, requirement] of nextRequirements)
					requirements.set(id, requirement);
				conflicts.clear();
				for (const conflict of typed.payload.contract.open_conflicts)
					conflicts.add(conflict.id);
			} else if (typed.kind === "work_requirement_transitioned") {
				const requirement = existingRequirement(
					requirements,
					typed.payload.requirement_id,
				);
				requirement.status = typed.payload.status;
				requirement.evidence_refs = appendUnique(
					requirement.evidence_refs,
					typed.payload.evidence_refs,
					limits,
				);
				requirement.updated_at = record.occurred_at;
			} else if (typed.kind === "work_lifecycle_changed") {
				lifecycle = typed.payload.lifecycle;
			}
			continue;
		}

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
				if (
					requirement.status === "verified" &&
					requirement.evidence_refs.length === 0
				) {
					requirement.status = "implemented_unverified";
					diagnostics.add(`legacy_verified_without_evidence:${requirement.id}`);
				}
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
	const progress = calculateWorkProgress(requirementList);
	const configuredRequiredGates =
		policySnapshot?.policy.review.gates
			.filter((gate) => gate.enforcement === "required")
			.map((gate) => gate.gate) ?? [];
	const unsigned: Omit<WorkProjection, "projection_hash"> = {
		schema_version: WORK_PROJECTION_SCHEMA_VERSION,
		work_id: workId,
		title,
		completion_contract: completionContract,
		contract_revision: contractRevision,
		lifecycle,
		boundary_hash: boundaryHash,
		contract_hash: contractHash,
		policy_hash: policyHash,
		policy_snapshot: policySnapshot,
		configured_required_gates: configuredRequiredGates,
		ledger_head: records.at(-1)?.record_hash ?? null,
		last_event_id: records.at(-1)?.event_id ?? null,
		requirements: requirementList,
		conflicts: [...conflicts],
		diagnostics: [...diagnostics].slice(0, limits.maxRequirements),
		progress,
		requirements_ready:
			lifecycle === "open" &&
			(contractHash === null || typedBoundaryState === "accepted") &&
			!progress.denominator_empty &&
			progress.pending === 0 &&
			progress.in_progress === 0 &&
			progress.implemented_unverified === 0 &&
			progress.blocked === 0 &&
			conflicts.size === 0,
	};
	return { ...unsigned, projection_hash: sha256(canonicalJson(unsigned)) };
}

function boundedText(value: string, label: string, maxUtf8Bytes: number): string {
	if (Buffer.byteLength(value, "utf8") > maxUtf8Bytes)
		throw new Error(`${label} exceeds UTF-8 byte limit`);
	return value;
}

export function calculateWorkProgress(
	requirements: readonly ProjectedRequirement[],
): WorkProjectionProgress {
	for (const requirement of requirements) {
		if (
			requirement.weight !== undefined &&
			(!Number.isFinite(requirement.weight) ||
				requirement.weight <= 0 ||
				requirement.weight > Number.MAX_SAFE_INTEGER)
		) {
			throw new Error("Work requirement weight must be finite and positive");
		}
	}
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
		pending: applicable.filter((item) => item.status === "pending").length,
		in_progress: applicable.filter((item) => item.status === "in_progress")
			.length,
		verified: verified.length,
		implemented_unverified: applicable.filter(
			(item) => item.status === "implemented_unverified",
		).length,
		blocked: applicable.filter((item) => item.status === "blocked").length,
		waived: requirements.length - applicable.length,
		denominator_empty: applicable.length === 0,
	};
	if (explicitlyWeighted) {
		const applicableWeight = applicable.reduce(
			(sum, item) => checkedWeightSum(sum, item.weight ?? 0),
			0,
		);
		const verifiedWeight = verified.reduce(
			(sum, item) => checkedWeightSum(sum, item.weight ?? 0),
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

function checkedWeightSum(sum: number, weight: number): number {
	const next = sum + weight;
	if (!Number.isFinite(next) || next > Number.MAX_SAFE_INTEGER)
		throw new Error("Work requirement weight sum exceeds the safe integer range");
	return next;
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
	assertNoSymlinkAncestors(path.resolve(projectionPath));
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

function assertNoSymlinkAncestors(candidate: string): void {
	const absolute = path.resolve(candidate);
	const parsed = path.parse(absolute);
	const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
	if (parts.length === 0) return;
	let current = fs.realpathSync(path.join(parsed.root, parts[0]!));
	for (const part of parts.slice(1)) {
		current = path.join(current, part);
		try {
			if (fs.lstatSync(current).isSymbolicLink())
				throw new Error(`managed Work path contains a symbolic link: ${current}`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
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
