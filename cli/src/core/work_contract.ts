import { z } from "zod";

import { isHash, sha256 } from "../util/hash.js";
import {
	type AppendWorkLedgerOptions,
	type AppendWorkLedgerResult,
	readWorkLedger,
	WORK_TYPED_EVENT_KIND_SCHEMA_PAIRS,
	type WorkLedgerEvent,
	type WorkLedgerRecord,
} from "./work_ledger.js";
import {
	type NormalizedDelegationPolicy,
	validateWorkPolicySnapshot,
	type WorkPolicySnapshot,
} from "./work_policy.js";

export const WORK_CONTRACT_EVENT_SCHEMA_VERSION =
	"anamnesis.work-contract-event.v1" as const;
export const WORK_PROGRESS_EVENT_SCHEMA_VERSION =
	"anamnesis.work-progress-event.v1" as const;
export const WORK_LIFECYCLE_EVENT_SCHEMA_VERSION =
	"anamnesis.work-lifecycle-event.v1" as const;
export const WORK_REVIEW_REQUEST_EVENT_SCHEMA_VERSION =
	"anamnesis.work-review-request-event.v1" as const;
export const WORK_REVIEW_ATTEMPT_EVENT_SCHEMA_VERSION =
	"anamnesis.work-review-attempt-event.v1" as const;
export const WORK_PARALLELISM_ASSESSMENT_EVENT_SCHEMA_VERSION =
	"anamnesis.work-parallelism-assessment-event.v1" as const;
export const WORK_DELEGATION_OUTCOME_EVENT_SCHEMA_VERSION =
	"anamnesis.work-delegation-outcome-event.v1" as const;
export const WORK_DELEGATION_WAIVER_EVENT_SCHEMA_VERSION =
	"anamnesis.work-delegation-waiver-event.v1" as const;

export const WORK_EXECUTION_LIMITS = {
	maxRefUtf8Bytes: 1_024,
	maxPathUtf8Bytes: 1_024,
	maxInlineArtifactUtf8Bytes: 65_536,
	maxGitOutputUtf8Bytes: 1_048_576,
	maxArtifacts: 64,
	maxVerificationAssertions: 1_000,
	maxEvidenceRefs: 256,
	maxFindingRefs: 256,
	maxFailureRefs: 64,
	maxRepositoryScopesPerLane: 128,
	maxExternalEffectsPerLane: 128,
	maxChildContracts: 32,
	maxRequirementsPerChild: 1_000,
	maxSourcePointersPerChild: 256,
} as const;

const nonEmpty = z
	.string()
	.min(1)
	.refine((value) => value.trim().length > 0);
const positiveInteger = z
	.number()
	.int()
	.positive()
	.max(Number.MAX_SAFE_INTEGER);
const hash = z.string().refine(isHash, "invalid hash");
const isValidUnicodeScalarString = (value: string): boolean =>
	Buffer.from(value, "utf8").toString("utf8") === value;
const boundedUtf8 = (maxUtf8Bytes: number) =>
	z
		.string()
		.min(1)
		.refine(
			isValidUnicodeScalarString,
			"value contains an invalid Unicode scalar",
		)
		.refine((value) => Buffer.byteLength(value, "utf8") <= maxUtf8Bytes, {
			message: `value exceeds ${maxUtf8Bytes} UTF-8 bytes`,
		});
const boundedTrimmed = (
	maxUtf8Bytes: number = WORK_EXECUTION_LIMITS.maxRefUtf8Bytes,
) =>
	boundedUtf8(maxUtf8Bytes).refine(
		(value) => value === value.trim(),
		"value must be trimmed",
	);
const boundedRef = boundedTrimmed();
const boundedList = <T extends z.ZodTypeAny>(
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
const stringList = z.array(nonEmpty).superRefine((values, context) => {
	const seen = new Set<string>();
	for (const [index, value] of values.entries()) {
		if (seen.has(value)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `duplicate value: ${value}`,
				path: [index],
			});
		}
		seen.add(value);
	}
});

const reviewProviderSchema = z.enum([
	"omx",
	"codex_native",
	"separate_process",
]);
const delegationProviderSchema = z.enum(["native_agents", "tmux_team"]);

export const workInstanceRefSchema = z
	.object({ provider: reviewProviderSchema, ref: boundedRef })
	.strict();
export const workArtifactRefSchema = z
	.object({ ref: boundedRef, hash })
	.strict();
export const repoFileRefSchema = z
	.object({
		kind: z.literal("repo_file"),
		path: boundedTrimmed(WORK_EXECUTION_LIMITS.maxPathUtf8Bytes),
	})
	.strict()
	.superRefine((value, context) =>
		addRepoPathIssue(value.path, context, ["path"]),
	);
export const runtimeAttestedInlineArtifactSchema = z
	.object({
		kind: z.literal("runtime_attested_inline"),
		ref: boundedRef,
		content: boundedUtf8(WORK_EXECUTION_LIMITS.maxInlineArtifactUtf8Bytes),
		assurance: z.literal("runtime_attested"),
	})
	.strict();
export const runtimeAttestedCapabilitySchema = z
	.object({
		assurance: z.literal("runtime_attested"),
		capability_ref: boundedRef,
		providers: boundedList(
			z
				.object({
					provider: delegationProviderSchema,
					availability: z.enum([
						"available",
						"unavailable",
						"runtime_incompatible",
						"authorization_error",
						"unsupported_authority",
					]),
					max_agents: z
						.number()
						.int()
						.min(0)
						.max(WORK_EXECUTION_LIMITS.maxChildContracts),
				})
				.strict(),
			2,
			(value) => value.provider,
		).min(1),
	})
	.strict();
export const providerFailureInputSchema = z
	.object({
		capability_ref: boundedRef,
		authority_ref: boundedRef.optional(),
		diagnostic_ref: boundedRef.optional(),
	})
	.strict();
export const verificationAssertionSchema = z
	.object({
		requirement_id: boundedRef,
		outcome: z.enum(["passed", "failed"]),
	})
	.strict();

const repositoryAccessSchema = z.enum(["read", "write"]);
const repoPathSchema = boundedTrimmed(
	WORK_EXECUTION_LIMITS.maxPathUtf8Bytes,
).superRefine((value, context) => addRepoPathIssue(value, context));
export const repositoryScopeSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("repo"), access: repositoryAccessSchema })
		.strict(),
	z
		.object({
			kind: z.literal("file"),
			path: repoPathSchema,
			access: repositoryAccessSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("tree"),
			path: repoPathSchema,
			access: repositoryAccessSchema,
		})
		.strict(),
]);
export const externalEffectSchema = z
	.object({
		resource_kind: boundedRef,
		resource_ref: boundedRef,
		access: repositoryAccessSchema,
		irreversible: z.boolean(),
	})
	.strict();
export const workParallelLaneSchema = z
	.object({
		lane_id: boundedRef,
		requirement_ids: boundedList(
			boundedRef,
			WORK_EXECUTION_LIMITS.maxRequirementsPerChild,
			String,
		).min(1),
		repository_scopes: boundedList(
			repositoryScopeSchema,
			WORK_EXECUTION_LIMITS.maxRepositoryScopesPerLane,
		).min(1),
		external_effects: boundedList(
			externalEffectSchema,
			WORK_EXECUTION_LIMITS.maxExternalEffectsPerLane,
		),
		depends_on: boundedList(
			boundedRef,
			WORK_EXECUTION_LIMITS.maxChildContracts,
			String,
		),
		verification_owner: z.literal("leader"),
	})
	.strict();
export const childContractSchema = z
	.object({
		lane_id: boundedRef,
		work_id: boundedRef,
		basis_contract_revision: positiveInteger,
		requirement_ids: boundedList(
			boundedRef,
			WORK_EXECUTION_LIMITS.maxRequirementsPerChild,
			String,
		).min(1),
		invariant_refs: boundedList(
			boundedRef,
			WORK_EXECUTION_LIMITS.maxEvidenceRefs,
			String,
		).min(1),
		invariant_hash: hash,
		repository_scopes: boundedList(
			repositoryScopeSchema,
			WORK_EXECUTION_LIMITS.maxRepositoryScopesPerLane,
		).min(1),
		external_effects: boundedList(
			externalEffectSchema,
			WORK_EXECUTION_LIMITS.maxExternalEffectsPerLane,
		),
		side_effect_exclusions: boundedList(
			boundedRef,
			WORK_EXECUTION_LIMITS.maxEvidenceRefs,
			String,
		).min(1),
		expected_artifact_refs: boundedList(
			boundedRef,
			WORK_EXECUTION_LIMITS.maxArtifacts,
			String,
		).min(1),
		expected_evidence_refs: boundedList(
			boundedRef,
			WORK_EXECUTION_LIMITS.maxEvidenceRefs,
			String,
		).min(1),
		source_pointers: boundedList(
			boundedRef,
			WORK_EXECUTION_LIMITS.maxSourcePointersPerChild,
			String,
		).min(1),
	})
	.strict();

export type WorkReviewProvider = z.infer<typeof reviewProviderSchema>;
export type WorkDelegationProvider = z.infer<typeof delegationProviderSchema>;
export type WorkInstanceRef = z.infer<typeof workInstanceRefSchema>;
export type WorkArtifactRef = z.infer<typeof workArtifactRefSchema>;
export type RepoFileRef = z.infer<typeof repoFileRefSchema>;
export type RuntimeAttestedInlineArtifact = z.infer<
	typeof runtimeAttestedInlineArtifactSchema
>;
export type RuntimeAttestedCapability = z.infer<
	typeof runtimeAttestedCapabilitySchema
>;
export type ProviderFailureInput = z.infer<typeof providerFailureInputSchema>;
export type VerificationAssertion = z.infer<typeof verificationAssertionSchema>;
export type RepositoryScope = z.infer<typeof repositoryScopeSchema>;
export type ExternalEffect = z.infer<typeof externalEffectSchema>;
export type WorkParallelLane = z.infer<typeof workParallelLaneSchema>;
export type ChildContract = z.infer<typeof childContractSchema>;

const captureRefShape = {
	source_event_id: nonEmpty.optional(),
	source_envelope_hash: hash.optional(),
	source_object_hash: hash.optional(),
	source_object_path: nonEmpty.optional(),
};

export const workRequirementDefinitionSchema = z
	.object({
		id: nonEmpty,
		summary: nonEmpty,
		source_event_ids: stringList.min(1),
		weight: z
			.number()
			.finite()
			.positive()
			.max(Number.MAX_SAFE_INTEGER)
			.optional(),
		supersedes: stringList.optional(),
		superseded_by: nonEmpty.optional(),
	})
	.strict();

const workBoundarySchema = z
	.object({
		state: z.enum(["provisional", "needs_user", "accepted"]),
		classification: z.enum(["same_unit", "new_unit", "interruption"]),
		reason_codes: stringList,
		confidence: z.enum(["low", "medium", "high"]),
	})
	.strict();

const openConflictSchema = z
	.object({
		id: nonEmpty,
		summary: nonEmpty,
		requirement_ids: stringList.min(1),
		source_event_ids: stringList.min(1),
	})
	.strict();

const contractDefinitionSchema = z
	.object({
		work: z
			.object({
				id: nonEmpty,
				title: nonEmpty,
				completion_contract: nonEmpty,
			})
			.strict(),
		boundary: workBoundarySchema,
		policy_snapshot: z.unknown(),
		requirements: z.array(workRequirementDefinitionSchema),
		open_conflicts: z.array(openConflictSchema),
	})
	.strict();

const contractPayloadSchema = z
	.object({
		schema_version: z.literal(WORK_CONTRACT_EVENT_SCHEMA_VERSION),
		work_id: nonEmpty,
		contract_revision: positiveInteger,
		previous_contract_revision: positiveInteger.nullable(),
		previous_contract_hash: hash.nullable(),
		contract_hash: hash,
		contract: contractDefinitionSchema,
		...captureRefShape,
	})
	.strict();

const progressPayloadSchema = z
	.object({
		schema_version: z.literal(WORK_PROGRESS_EVENT_SCHEMA_VERSION),
		work_id: nonEmpty,
		requirement_id: nonEmpty,
		basis_contract_hash: hash,
		status: z.enum([
			"pending",
			"in_progress",
			"implemented_unverified",
			"verified",
			"blocked",
			"waived",
		]),
		evidence_refs: stringList,
		waiver: z
			.object({
				reason: nonEmpty,
				authority_ref: nonEmpty,
				source_event_id: nonEmpty,
				evidence_refs: stringList.min(1),
			})
			.strict()
			.optional(),
		...captureRefShape,
	})
	.strict();

const lifecyclePayloadSchema = z
	.object({
		schema_version: z.literal(WORK_LIFECYCLE_EVENT_SCHEMA_VERSION),
		work_id: nonEmpty,
		basis_contract_hash: hash,
		lifecycle: z.enum(["open", "completed", "abandoned", "superseded"]),
		...captureRefShape,
	})
	.strict();

const executionBasisShape = {
	work_id: boundedRef,
	basis_contract_revision: positiveInteger,
	basis_contract_hash: hash,
	policy_hash: hash,
};
const artifactRefListSchema = boundedList(
	workArtifactRefSchema,
	WORK_EXECUTION_LIMITS.maxArtifacts,
	(value) => value.ref,
);
const evidenceRefListSchema = boundedList(
	boundedRef,
	WORK_EXECUTION_LIMITS.maxEvidenceRefs,
	String,
);
const findingRefListSchema = boundedList(
	boundedRef,
	WORK_EXECUTION_LIMITS.maxFindingRefs,
	String,
);
const failureRefListSchema = boundedList(
	boundedRef,
	WORK_EXECUTION_LIMITS.maxFailureRefs,
	String,
);

export const workReviewRequestedPayloadSchema = z
	.object({
		schema_version: z.literal(WORK_REVIEW_REQUEST_EVENT_SCHEMA_VERSION),
		...executionBasisShape,
		gate: z.enum(["planning", "completion"]),
		activity_id: boundedRef,
		review_input_hash: hash,
		artifact_refs: artifactRefListSchema.min(1),
		provider_order: boundedList(reviewProviderSchema, 3, String).min(1),
		role_hint: boundedRef,
		minimum_reviewers: positiveInteger,
	})
	.strict();

const reviewAttemptCommonShape = {
	schema_version: z.literal(WORK_REVIEW_ATTEMPT_EVENT_SCHEMA_VERSION),
	...executionBasisShape,
	gate: z.enum(["planning", "completion"]),
	activity_id: boundedRef,
	attempt_id: boundedRef,
	review_input_hash: hash,
	provider: reviewProviderSchema,
	role: boundedRef,
};
const reviewerAttemptPayloadSchema = z
	.object({
		...reviewAttemptCommonShape,
		outcome: z.enum(["passed", "changes_requested"]),
		reviewer_instance_ref: workInstanceRefSchema,
		author_instance_refs: boundedList(
			workInstanceRefSchema,
			WORK_EXECUTION_LIMITS.maxEvidenceRefs,
		).min(1),
		independence_assurance: z.literal("runtime_attested"),
		independence_evidence_refs: evidenceRefListSchema.min(1),
		artifact_refs: artifactRefListSchema.min(1),
		finding_refs: findingRefListSchema,
	})
	.strict()
	.superRefine((value, context) => {
		const reviewer = canonicalJson(value.reviewer_instance_ref);
		if (
			value.author_instance_refs.some(
				(author) => canonicalJson(author) === reviewer,
			)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "reviewer instance must differ from every author instance",
				path: ["reviewer_instance_ref"],
			});
		}
	});
const reviewProviderFailurePayloadSchema = z
	.object({
		...reviewAttemptCommonShape,
		outcome: z.enum([
			"authorization_error",
			"unsupported_authority",
			"unavailable",
		]),
		failure_input: providerFailureInputSchema,
		failure_refs: failureRefListSchema.min(1),
	})
	.strict();
export const workReviewAttemptPayloadSchema = z.union([
	reviewerAttemptPayloadSchema,
	reviewProviderFailurePayloadSchema,
]);

export const workParallelismAssessmentPayloadSchema = z
	.object({
		schema_version: z.literal(WORK_PARALLELISM_ASSESSMENT_EVENT_SCHEMA_VERSION),
		...executionBasisShape,
		assessment_id: boundedRef,
		assessment_input_hash: hash,
		decision: z.enum(["parallel", "solo", "not_parallelizable"]),
		lanes: boundedList(
			workParallelLaneSchema,
			WORK_EXECUTION_LIMITS.maxChildContracts,
			(value) => value.lane_id,
		).min(1),
		selected_provider: delegationProviderSchema.nullable(),
		rationale_codes: evidenceRefListSchema.min(1),
		evidence_refs: evidenceRefListSchema.min(1),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.decision === "parallel") {
			if (value.lanes.length < 2) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "parallel assessment requires at least two lanes",
					path: ["lanes"],
				});
			}
			if (value.selected_provider === null) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "parallel assessment requires a selected provider",
					path: ["selected_provider"],
				});
			}
		} else if (value.selected_provider !== null) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "non-parallel assessment cannot select a provider",
				path: ["selected_provider"],
			});
		}
	});

const delegationOutcomeCommonShape = {
	schema_version: z.literal(WORK_DELEGATION_OUTCOME_EVENT_SCHEMA_VERSION),
	...executionBasisShape,
	assessment_id: boundedRef,
	assessment_input_hash: hash,
	provider: delegationProviderSchema,
};
const delegationProviderFailurePayloadSchema = z
	.object({
		...delegationOutcomeCommonShape,
		outcome: z.enum([
			"authorization_error",
			"unsupported_authority",
			"unavailable",
			"runtime_incompatible",
		]),
		failure_input: providerFailureInputSchema,
		failure_refs: failureRefListSchema.min(1),
		failure_fingerprint: hash,
	})
	.strict();
const delegationRecordedPayloadSchema = z
	.object({
		...delegationOutcomeCommonShape,
		outcome: z.literal("delegated"),
		child_contracts: boundedList(
			childContractSchema,
			WORK_EXECUTION_LIMITS.maxChildContracts,
			(value) => value.lane_id,
		).min(1),
		delegation_contract_hash: hash,
	})
	.strict();
const delegationResultsPayloadSchema = z
	.object({
		...delegationOutcomeCommonShape,
		outcome: z.literal("results_recorded"),
		delegation_contract_hash: hash,
		result_refs: evidenceRefListSchema.min(1),
	})
	.strict();
export const workDelegationOutcomePayloadSchema = z.union([
	delegationProviderFailurePayloadSchema,
	delegationRecordedPayloadSchema,
	delegationResultsPayloadSchema,
]);

export const workDelegationWaiverPayloadSchema = z
	.object({
		schema_version: z.literal(WORK_DELEGATION_WAIVER_EVENT_SCHEMA_VERSION),
		...executionBasisShape,
		assessment_id: boundedRef,
		assessment_input_hash: hash,
		reason: boundedRef,
		authority_ref: boundedRef,
		source_event_id: boundedRef,
		evidence_refs: evidenceRefListSchema.min(1),
		source_envelope_hash: hash.optional(),
		source_object_hash: hash.optional(),
		source_object_path: boundedRef.optional(),
	})
	.strict();

export type WorkRequirementDefinition = z.infer<
	typeof workRequirementDefinitionSchema
>;
export type WorkContractDefinition = Omit<
	z.infer<typeof contractDefinitionSchema>,
	"policy_snapshot"
> & { policy_snapshot: WorkPolicySnapshot };
export type WorkContractPayload = Omit<
	z.infer<typeof contractPayloadSchema>,
	"contract"
> & { contract: WorkContractDefinition };
export type WorkProgressPayload = z.infer<typeof progressPayloadSchema>;
export type WorkLifecyclePayload = z.infer<typeof lifecyclePayloadSchema>;
export type WorkReviewRequestedPayload = z.infer<
	typeof workReviewRequestedPayloadSchema
>;
export type WorkReviewAttemptPayload = z.infer<
	typeof workReviewAttemptPayloadSchema
>;
export type WorkParallelismAssessmentPayload = z.infer<
	typeof workParallelismAssessmentPayloadSchema
>;
export type WorkDelegationOutcomePayload = z.infer<
	typeof workDelegationOutcomePayloadSchema
>;
export type WorkDelegationWaiverPayload = z.infer<
	typeof workDelegationWaiverPayloadSchema
>;

export type TypedWorkEvent =
	| (Omit<WorkLedgerEvent, "kind" | "payload"> & {
			kind: "work_created" | "work_contract_revised";
			payload: WorkContractPayload;
	  })
	| (Omit<WorkLedgerEvent, "kind" | "payload"> & {
			kind: "work_requirement_transitioned";
			payload: WorkProgressPayload;
	  })
	| (Omit<WorkLedgerEvent, "kind" | "payload"> & {
			kind: "work_lifecycle_changed";
			payload: WorkLifecyclePayload;
	  })
	| SourceFreeWorkEvidenceEvent
	| WorkDelegationWaiverEvent;

export type SourceFreeWorkEvidenceEvent =
	| (Omit<WorkLedgerEvent, "kind" | "payload"> & {
			kind: "work_review_requested";
			payload: WorkReviewRequestedPayload;
	  })
	| (Omit<WorkLedgerEvent, "kind" | "payload"> & {
			kind: "work_review_attempt_recorded";
			payload: WorkReviewAttemptPayload;
	  })
	| (Omit<WorkLedgerEvent, "kind" | "payload"> & {
			kind: "work_parallelism_assessed";
			payload: WorkParallelismAssessmentPayload;
	  })
	| (Omit<WorkLedgerEvent, "kind" | "payload"> & {
			kind: "work_delegation_outcome_recorded";
			payload: WorkDelegationOutcomePayload;
	  });

export type WorkDelegationWaiverEvent = Omit<
	WorkLedgerEvent,
	"kind" | "payload"
> & {
	kind: "work_delegation_waived";
	payload: WorkDelegationWaiverPayload;
};

export interface AppendTypedWorkEventOptions
	extends Omit<AppendWorkLedgerOptions, "event"> {
	event: TypedWorkEvent;
}

const LEGACY_SEMANTIC_ALIASES = new Set([
	"contract_revised",
	"work_contract_revised",
	"requirement_added",
	"requirement_recorded",
	"requirement_status_changed",
	"requirement_transitioned",
	"work_requirement_transitioned",
	"requirement_superseded",
	"lifecycle_changed",
	"work_lifecycle_changed",
	"conflict_recorded",
	"conflict_resolved",
]);
const CANONICAL_TYPED_KINDS = new Set([
	...Object.keys(WORK_TYPED_EVENT_KIND_SCHEMA_PAIRS),
]);

export function calculateWorkContractHash(
	contract: WorkContractDefinition,
): string {
	const parsed = parseContractDefinition(contract);
	assertContractGraph(parsed.requirements);
	const requirements = parsed.requirements
		.map((item) => ({
			...item,
			source_event_ids: sortedStrings(item.source_event_ids),
			...(item.supersedes
				? { supersedes: sortedStrings(item.supersedes) }
				: {}),
		}))
		.sort((left, right) => compareCodeUnits(left.id, right.id));
	const openConflicts = parsed.open_conflicts
		.map((item) => ({
			...item,
			requirement_ids: sortedStrings(item.requirement_ids),
			source_event_ids: sortedStrings(item.source_event_ids),
		}))
		.sort((left, right) => compareCodeUnits(left.id, right.id));
	return sha256(
		canonicalJson({
			work: parsed.work,
			boundary: {
				...parsed.boundary,
				reason_codes: sortedStrings(parsed.boundary.reason_codes),
			},
			policy: {
				policy: parsed.policy_snapshot.policy,
				policy_hash: parsed.policy_snapshot.policy_hash,
			},
			requirements,
			open_conflicts: openConflicts,
		}),
	);
}

export function parseTypedWorkEvent(event: WorkLedgerEvent): TypedWorkEvent {
	switch (event.kind) {
		case "work_created":
		case "work_contract_revised":
			return {
				...event,
				kind: event.kind,
				payload: parseContractPayload(event.payload),
			};
		case "work_requirement_transitioned":
			return {
				...event,
				kind: event.kind,
				payload: progressPayloadSchema.parse(event.payload),
			};
		case "work_lifecycle_changed":
			return {
				...event,
				kind: event.kind,
				payload: lifecyclePayloadSchema.parse(event.payload),
			};
		case "work_review_requested":
			return {
				...event,
				kind: event.kind,
				payload: workReviewRequestedPayloadSchema.parse(event.payload),
			};
		case "work_review_attempt_recorded":
			return {
				...event,
				kind: event.kind,
				payload: workReviewAttemptPayloadSchema.parse(event.payload),
			};
		case "work_parallelism_assessed":
			return {
				...event,
				kind: event.kind,
				payload: workParallelismAssessmentPayloadSchema.parse(event.payload),
			};
		case "work_delegation_outcome_recorded":
			return {
				...event,
				kind: event.kind,
				payload: workDelegationOutcomePayloadSchema.parse(event.payload),
			};
		case "work_delegation_waived":
			return {
				...event,
				kind: event.kind,
				payload: workDelegationWaiverPayloadSchema.parse(event.payload),
			};
		default:
			throw new Error(`not a typed Work event: ${event.kind}`);
	}
}

export function validateWorkEventAppend(
	records: readonly WorkLedgerRecord[],
	event: WorkLedgerEvent,
): void {
	const mode = ledgerMode(records);
	const typed = isTypedPayload(event.payload);
	if (CANONICAL_TYPED_KINDS.has(event.kind) && !typed) {
		if (event.kind !== "work_created" || mode === "typed") {
			throw new Error(
				`canonical typed Work event ${event.kind} requires its exact schema discriminator`,
			);
		}
	}

	if (
		mode === "typed" &&
		((LEGACY_SEMANTIC_ALIASES.has(event.kind) && !typed) ||
			(event.kind === "work_created" && !typed))
	) {
		throw new Error(
			`legacy semantic mutation ${event.kind} is forbidden after typed work_created`,
		);
	}
	if (mode === "legacy" && typed) {
		throw new Error("typed Work mutations cannot be appended to a legacy Work");
	}
	if (!typed) return;

	const parsed = parseTypedWorkEvent(event);
	const state = typedState(records);
	if (parsed.kind === "work_created") {
		if (mode !== "empty")
			throw new Error("typed work_created requires an empty Work ledger");
		assertContractRevision(parsed.payload, null, null);
		assertInitialContractGraph(parsed.payload.contract.requirements);
		return;
	}
	if (mode !== "typed" || !state) {
		throw new Error("typed Work mutation requires typed work_created");
	}
	if (parsed.payload.work_id !== state.work_id) {
		throw new Error("typed Work event targets a different work ID");
	}
	if (parsed.kind === "work_contract_revised") {
		assertContractRevision(parsed.payload, state.revision, state.contract_hash);
		assertContractLineage(
			state.requirements,
			parsed.payload.contract.requirements,
		);
		if (parsed.payload.contract_hash === state.contract_hash) {
			throw new Error("no-op Work contract revision is forbidden");
		}
		return;
	}
	if (
		!("basis_contract_hash" in parsed.payload) ||
		parsed.payload.basis_contract_hash !== state.contract_hash
	) {
		throw new Error("typed Work event basis_contract_hash is stale");
	}
	if (
		"basis_contract_revision" in parsed.payload &&
		parsed.payload.basis_contract_revision !== state.revision
	) {
		throw new Error("typed Work event basis_contract_revision is stale");
	}
	if (
		"policy_hash" in parsed.payload &&
		parsed.payload.policy_hash !== state.policy_snapshot.policy_hash
	) {
		throw new Error("typed Work event policy_hash is stale");
	}
	if (
		parsed.kind === "work_requirement_transitioned" &&
		parsed.payload.status === "verified" &&
		parsed.payload.evidence_refs.length === 0
	) {
		throw new Error("verified Work requirement transition requires evidence");
	}
	if (parsed.kind === "work_requirement_transitioned") {
		if (parsed.payload.status === "waived" && !parsed.payload.waiver) {
			throw new Error(
				"waived Work requirement transition requires reason, authority, source, and evidence",
			);
		}
		if (parsed.payload.status !== "waived" && parsed.payload.waiver) {
			throw new Error(
				"Work requirement waiver metadata is only valid for waived transitions",
			);
		}
	}
	if (parsed.kind === "work_lifecycle_changed") {
		throw new Error(
			"typed Work lifecycle transitions are not supported until closure orchestration is available",
		);
	}
	if (
		parsed.kind === "work_requirement_transitioned" &&
		!state.requirement_ids.has(parsed.payload.requirement_id)
	) {
		throw new Error(
			`unknown typed Work requirement: ${parsed.payload.requirement_id}`,
		);
	}
	assertExecutionEvidenceEvent(records, parsed, state);
}

export function validateWorkLedgerSemantics(
	records: readonly WorkLedgerRecord[],
): void {
	const mode = ledgerMode(records);
	if (mode === "typed") {
		typedState(records);
		return;
	}
	if (
		mode === "legacy" &&
		records.some((record) => isTypedPayload(record.payload))
	) {
		throw new Error("typed Work mutations cannot exist on a legacy Work");
	}
}

export function appendTypedWorkEvent(
	options: AppendTypedWorkEventOptions,
): AppendWorkLedgerResult {
	validateWorkEventAppend(
		readWorkLedger(options.ledgerPath).records,
		options.event,
	);
	throw new Error(
		"typed Work events require the official source publication API",
	);
}

function parseContractDefinition(value: unknown): WorkContractDefinition {
	const parsed = contractDefinitionSchema.parse(value);
	return {
		...parsed,
		policy_snapshot: validateWorkPolicySnapshot(parsed.policy_snapshot),
	};
}

function parseContractPayload(value: unknown): WorkContractPayload {
	const parsed = contractPayloadSchema.parse(value);
	const contract = parseContractDefinition(parsed.contract);
	if (parsed.work_id !== contract.work.id) {
		throw new Error(
			"Work contract payload work_id does not match contract.work.id",
		);
	}
	if (contract.policy_snapshot.revision !== parsed.contract_revision) {
		throw new Error(
			"Work policy snapshot revision does not match contract revision",
		);
	}
	if (calculateWorkContractHash(contract) !== parsed.contract_hash) {
		throw new Error("Work contract hash mismatch");
	}
	assertUniqueIds(
		contract.requirements.map((item) => item.id),
		"requirement",
	);
	assertUniqueIds(
		contract.open_conflicts.map((item) => item.id),
		"conflict",
	);
	assertContractGraph(contract.requirements);
	return { ...parsed, contract };
}

function assertInitialContractGraph(
	requirements: readonly WorkRequirementDefinition[],
): void {
	for (const requirement of requirements) {
		if ((requirement.supersedes?.length ?? 0) > 0)
			throw new Error(
				"initial Work contract cannot supersede prior requirements",
			);
		if (requirement.superseded_by)
			throw new Error(
				"initial Work contract cannot contain superseded requirements",
			);
	}
}

function assertContractGraph(
	requirements: readonly WorkRequirementDefinition[],
): void {
	const byId = new Map(requirements.map((item) => [item.id, item]));
	for (const requirement of requirements) {
		if (requirement.superseded_by !== undefined)
			throw new Error(
				"Work contracts use canonical supersedes linkage; superseded_by is forbidden",
			);
		if (
			requirement.supersedes?.includes(requirement.id) ||
			requirement.superseded_by === requirement.id
		)
			throw new Error("Work requirement cannot supersede itself");
		if (requirement.superseded_by && !byId.has(requirement.superseded_by))
			throw new Error("Work requirement superseded_by target is unknown");
	}
	for (const requirement of requirements) {
		const seen = new Set<string>();
		let cursor: WorkRequirementDefinition | undefined = requirement;
		while (cursor?.superseded_by) {
			if (seen.has(cursor.id))
				throw new Error("Work requirement supersession cycle");
			seen.add(cursor.id);
			cursor = byId.get(cursor.superseded_by);
		}
	}
}

function assertContractRevision(
	payload: WorkContractPayload,
	previousRevision: number | null,
	previousHash: string | null,
): void {
	const expected = previousRevision === null ? 1 : previousRevision + 1;
	if (payload.contract_revision !== expected) {
		throw new Error(`Work contract revision must be exactly ${expected}`);
	}
	if (
		payload.previous_contract_revision !== previousRevision ||
		payload.previous_contract_hash !== previousHash
	) {
		throw new Error(
			"Work contract previous revision/hash precondition mismatch",
		);
	}
}

function typedState(records: readonly WorkLedgerRecord[]): {
	work_id: string;
	revision: number;
	contract_hash: string;
	requirement_ids: Set<string>;
	requirements: WorkRequirementDefinition[];
	policy_snapshot: WorkPolicySnapshot;
	terminal_history: boolean;
} | null {
	let state: ReturnType<typeof typedState> = null;
	for (const [index, record] of records.entries()) {
		const expectedSchema =
			WORK_TYPED_EVENT_KIND_SCHEMA_PAIRS[
				record.kind as keyof typeof WORK_TYPED_EVENT_KIND_SCHEMA_PAIRS
			];
		if (
			expectedSchema !== undefined &&
			record.payload.schema_version !== expectedSchema
		) {
			throw new Error(
				`canonical typed Work event ${record.kind} requires its exact schema discriminator`,
			);
		}
		if (
			state &&
			LEGACY_SEMANTIC_ALIASES.has(record.kind) &&
			!isTypedPayload(record.payload)
		) {
			throw new Error(
				`legacy semantic mutation ${record.kind} is forbidden after typed work_created`,
			);
		}
		if (!isTypedPayload(record.payload)) continue;
		const parsed = parseTypedWorkEvent(record);
		if (parsed.kind === "work_created") {
			if (state) throw new Error("repeated typed work_created");
			assertContractRevision(parsed.payload, null, null);
			assertInitialContractGraph(parsed.payload.contract.requirements);
			state = contractState(parsed.payload);
		} else if (parsed.kind === "work_contract_revised") {
			if (!state)
				throw new Error("typed contract revision precedes typed work_created");
			assertContractRevision(
				parsed.payload,
				state.revision,
				state.contract_hash,
			);
			if (parsed.payload.contract_hash === state.contract_hash) {
				throw new Error("no-op Work contract revision is forbidden");
			}
			assertContractLineage(
				state.requirements,
				parsed.payload.contract.requirements,
			);
			state = contractState(parsed.payload);
		} else if (
			parsed.kind === "work_requirement_transitioned" ||
			parsed.kind === "work_lifecycle_changed"
		) {
			if (!state)
				throw new Error("typed Work mutation precedes typed work_created");
			if (
				parsed.payload.work_id !== state.work_id ||
				parsed.payload.basis_contract_hash !== state.contract_hash
			) {
				throw new Error("invalid typed Work mutation basis");
			}
			if (parsed.kind === "work_requirement_transitioned") {
				if (state.terminal_history)
					throw new Error(
						"typed Work semantic/progress mutation is forbidden after terminal lifecycle history",
					);
				if (!state.requirement_ids.has(parsed.payload.requirement_id))
					throw new Error("unknown typed Work requirement");
				if (
					parsed.payload.status === "verified" &&
					parsed.payload.evidence_refs.length === 0
				)
					throw new Error(
						"verified Work requirement transition requires evidence",
					);
				if (parsed.payload.status === "waived" && !parsed.payload.waiver)
					throw new Error(
						"waived Work requirement transition requires reason, authority, source, and evidence",
					);
				if (parsed.payload.status !== "waived" && parsed.payload.waiver)
					throw new Error(
						"Work requirement waiver metadata is only valid for waived transitions",
					);
			} else {
				if (parsed.payload.lifecycle !== "open")
					throw new Error(
						"typed Work terminal lifecycle transitions are not supported",
					);
				throw new Error(
					"typed Work lifecycle no-op/reopen transitions are not supported",
				);
			}
		} else {
			if (!state)
				throw new Error("typed Work evidence precedes typed work_created");
			if (
				parsed.payload.work_id !== state.work_id ||
				!("basis_contract_hash" in parsed.payload) ||
				parsed.payload.basis_contract_hash !== state.contract_hash ||
				!("basis_contract_revision" in parsed.payload) ||
				parsed.payload.basis_contract_revision !== state.revision ||
				!("policy_hash" in parsed.payload) ||
				parsed.payload.policy_hash !== state.policy_snapshot.policy_hash
			) {
				throw new Error("invalid typed Work evidence basis");
			}
			assertExecutionEvidenceEvent(records.slice(0, index), parsed, state);
		}
	}
	return state;
}

function contractState(payload: WorkContractPayload) {
	return {
		work_id: payload.work_id,
		revision: payload.contract_revision,
		contract_hash: payload.contract_hash,
		requirement_ids: new Set(
			payload.contract.requirements.map((item) => item.id),
		),
		requirements: payload.contract.requirements.map((item) => ({
			...item,
			source_event_ids: [...item.source_event_ids],
			...(item.supersedes ? { supersedes: [...item.supersedes] } : {}),
		})),
		policy_snapshot: payload.contract.policy_snapshot,
		terminal_history: false,
	};
}

function assertExecutionEvidenceEvent(
	records: readonly WorkLedgerRecord[],
	event: TypedWorkEvent,
	state: NonNullable<ReturnType<typeof typedState>>,
): void {
	switch (event.kind) {
		case "work_review_requested":
			assertReviewRequestMatchesPolicy(event.payload, state.policy_snapshot);
			break;
		case "work_review_attempt_recorded":
			assertReviewAttemptMatchesRequest(
				records,
				event.payload,
				state.policy_snapshot,
			);
			break;
		case "work_parallelism_assessed":
			assertParallelismAssessment(event.payload, state, records);
			break;
		case "work_delegation_outcome_recorded":
			assertDelegationOutcome(records, event.payload, state);
			break;
		case "work_delegation_waived":
			assertDelegationWaiver(records, event.payload, state);
			break;
	}
}

function assertReviewRequestMatchesPolicy(
	payload: WorkReviewRequestedPayload,
	policySnapshot: WorkPolicySnapshot,
): void {
	const gate = policySnapshot.policy.review.gates.find(
		(candidate) => candidate.gate === payload.gate,
	);
	if (!gate) throw new Error(`unknown Work review gate: ${payload.gate}`);
	if (
		canonicalJson(payload.provider_order) !==
			canonicalJson(gate.provider_order) ||
		payload.role_hint !== gate.role_hint ||
		payload.minimum_reviewers !== gate.minimum_reviewers
	) {
		throw new Error(
			"Work review request does not match the frozen gate policy",
		);
	}
}

function typedRecords(records: readonly WorkLedgerRecord[]): TypedWorkEvent[] {
	return records
		.filter((record) => isTypedPayload(record.payload))
		.map((record) => parseTypedWorkEvent(record));
}

function assertReviewAttemptMatchesRequest(
	records: readonly WorkLedgerRecord[],
	payload: WorkReviewAttemptPayload,
	policySnapshot: WorkPolicySnapshot,
): void {
	const events = typedRecords(records);
	let requestIndex = -1;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index]!;
		if (
			event.kind === "work_review_requested" &&
			event.payload.gate === payload.gate
		) {
			requestIndex = index;
			break;
		}
	}
	const request = requestIndex >= 0 ? events[requestIndex] : null;
	if (
		!request ||
		request.kind !== "work_review_requested" ||
		request.payload.activity_id !== payload.activity_id ||
		request.payload.review_input_hash !== payload.review_input_hash
	) {
		throw new Error(
			"Work review attempt targets an unknown or superseded activity",
		);
	}
	const priorAttempts = events
		.slice(requestIndex + 1)
		.filter(
			(
				event,
			): event is Extract<
				TypedWorkEvent,
				{ kind: "work_review_attempt_recorded" }
			> =>
				event.kind === "work_review_attempt_recorded" &&
				event.payload.gate === payload.gate &&
				event.payload.activity_id === payload.activity_id &&
				event.payload.review_input_hash === payload.review_input_hash,
		);
	let providerIndex = 0;
	for (const attempt of priorAttempts) {
		if (
			!["authorization_error", "unsupported_authority", "unavailable"].includes(
				attempt.payload.outcome,
			)
		)
			continue;
		const canFallback = policySnapshot.policy.review.fallback_on.includes(
			attempt.payload.outcome as
				| "authorization_error"
				| "unsupported_authority"
				| "unavailable",
		);
		if (
			!canFallback ||
			request.payload.provider_order[providerIndex + 1] === undefined
		) {
			throw new Error(
				"Work review activity is terminal after provider unavailability; request a new review activity",
			);
		}
		providerIndex += 1;
	}
	const currentProvider = request.payload.provider_order[providerIndex] ?? null;
	if (
		currentProvider !== payload.provider ||
		request.payload.role_hint !== payload.role
	) {
		throw new Error(
			"Work review attempt does not match the requested provider/role",
		);
	}
	if (
		"artifact_refs" in payload &&
		canonicalJson(payload.artifact_refs) !==
			canonicalJson(request.payload.artifact_refs)
	) {
		throw new Error(
			"Work review attempt artifact refs do not match the request",
		);
	}
}

function assertParallelismAssessment(
	payload: WorkParallelismAssessmentPayload,
	state: NonNullable<ReturnType<typeof typedState>>,
	records: readonly WorkLedgerRecord[],
): void {
	const priorAssessments = typedRecords(records).filter(
		(
			event,
		): event is Extract<
			TypedWorkEvent,
			{ kind: "work_parallelism_assessed" }
		> => event.kind === "work_parallelism_assessed",
	);
	if (
		priorAssessments.some(
			(event) =>
				event.payload.assessment_input_hash === payload.assessment_input_hash,
		)
	) {
		throw new Error(
			"Work parallelism reassessment requires a changed canonical input hash",
		);
	}
	const reusedAssessment = typedRecords(records).find(
		(
			event,
		): event is Extract<
			TypedWorkEvent,
			{ kind: "work_parallelism_assessed" }
		> =>
			event.kind === "work_parallelism_assessed" &&
			event.payload.assessment_id === payload.assessment_id,
	);
	if (
		reusedAssessment &&
		reusedAssessment.payload.assessment_input_hash !==
			payload.assessment_input_hash
	) {
		throw new Error(
			"Work assessment_id cannot be reused with changed input hash",
		);
	}
	const policy = state.policy_snapshot.policy.delegation;
	if (
		payload.lanes.length >
		Math.min(policy.max_agents, WORK_EXECUTION_LIMITS.maxChildContracts)
	) {
		throw new Error(
			"Work parallelism assessment exceeds the frozen max_agents policy",
		);
	}
	for (const lane of payload.lanes) {
		for (const requirementId of lane.requirement_ids) {
			if (!state.requirement_ids.has(requirementId)) {
				throw new Error(`unknown Work requirement in lane: ${requirementId}`);
			}
		}
	}
	assertLaneGraph(payload.lanes);
	if (payload.decision === "parallel") {
		if (payload.lanes.length < 2 || payload.selected_provider === null) {
			throw new Error(
				"parallel assessment requires at least two lanes and a provider",
			);
		}
		if (!delegationCandidates(policy).includes(payload.selected_provider)) {
			throw new Error(
				"parallel assessment selected a provider outside frozen policy",
			);
		}
	} else if (payload.selected_provider !== null) {
		throw new Error(
			"solo/not_parallelizable assessment cannot select a provider",
		);
	}
	if (policy.parallelism === "required" && payload.decision === "solo") {
		throw new Error("required parallelism cannot be assessed as plain solo");
	}
	if (
		policy.parallelism === "required" &&
		payload.decision === "not_parallelizable" &&
		!payload.rationale_codes.some((code) =>
			["indivisible", "dependency", "conflict"].some(
				(prefix) => code === prefix || code.startsWith(`${prefix}_`),
			),
		)
	) {
		throw new Error(
			"required not_parallelizable assessment requires an allowed indivisibility rationale",
		);
	}
	if (
		policy.parallelism === "prefer" &&
		payload.decision === "solo" &&
		!payload.rationale_codes.some((code) =>
			["indivisible", "dependency", "conflict", "provider_unavailable"].some(
				(prefix) => code === prefix || code.startsWith(`${prefix}_`),
			),
		)
	) {
		throw new Error(
			"preferred parallelism solo decision requires an allowed rationale",
		);
	}
}

function assertDelegationOutcome(
	records: readonly WorkLedgerRecord[],
	payload: WorkDelegationOutcomePayload,
	state: NonNullable<ReturnType<typeof typedState>>,
): void {
	const assessment = typedRecords(records)
		.reverse()
		.find(
			(
				event,
			): event is Extract<
				TypedWorkEvent,
				{ kind: "work_parallelism_assessed" }
			> => event.kind === "work_parallelism_assessed",
		);
	if (
		!assessment ||
		assessment.payload.assessment_id !== payload.assessment_id ||
		assessment.payload.assessment_input_hash !== payload.assessment_input_hash
	) {
		throw new Error(
			"Work delegation outcome targets an unknown or stale assessment",
		);
	}
	const policy = state.policy_snapshot.policy.delegation;
	const candidates = delegationCandidates(policy);
	const priorOutcomes = typedRecords(records).filter(
		(
			event,
		): event is Extract<
			TypedWorkEvent,
			{ kind: "work_delegation_outcome_recorded" }
		> =>
			event.kind === "work_delegation_outcome_recorded" &&
			event.payload.assessment_id === payload.assessment_id &&
			event.payload.assessment_input_hash === payload.assessment_input_hash,
	);
	if (
		typedRecords(records).some(
			(event) =>
				event.kind === "work_delegation_waived" &&
				event.payload.assessment_id === payload.assessment_id &&
				event.payload.assessment_input_hash === payload.assessment_input_hash,
		)
	) {
		throw new Error("Work delegation assessment is terminal after a waiver");
	}
	if (
		priorOutcomes.some(
			(event) =>
				event.payload.outcome === "results_recorded" ||
				(event.payload.outcome === "delegated" &&
					payload.outcome !== "results_recorded"),
		)
	) {
		throw new Error(
			"Work delegation assessment already has a terminal recorded outcome",
		);
	}
	if (
		"failure_fingerprint" in payload &&
		priorOutcomes.some(
			(event) =>
				"failure_fingerprint" in event.payload &&
				event.payload.failure_fingerprint === payload.failure_fingerprint,
		)
	) {
		throw new Error("duplicate Work delegation failure fingerprint");
	}
	let currentProvider = assessment.payload.selected_provider;
	for (const outcome of priorOutcomes) {
		if (
			![
				"authorization_error",
				"unsupported_authority",
				"unavailable",
				"runtime_incompatible",
			].includes(outcome.payload.outcome)
		)
			continue;
		if (policy.unavailable !== "fallback") {
			throw new Error(
				"Work delegation assessment is terminal after provider unavailability",
			);
		}
		const currentIndex = candidates.indexOf(currentProvider!);
		currentProvider =
			currentIndex < 0 ? null : (candidates[currentIndex + 1] ?? null);
		if (currentProvider === null) {
			throw new Error(
				"Work delegation assessment is terminal after provider exhaustion",
			);
		}
	}
	if (currentProvider !== payload.provider) {
		throw new Error(
			"Work delegation outcome provider is outside frozen policy",
		);
	}
	if (
		payload.outcome === "delegated" &&
		payload.delegation_contract_hash !==
			calculateWorkDelegationContractHash(payload)
	) {
		throw new Error("Work delegation contract hash mismatch");
	}
	if (
		[
			"authorization_error",
			"unsupported_authority",
			"unavailable",
			"runtime_incompatible",
		].includes(payload.outcome) &&
		"failure_fingerprint" in payload &&
		payload.failure_fingerprint !==
			calculateWorkDelegationFailureFingerprint(
				payload,
				assessment.payload.lanes,
			)
	) {
		throw new Error("Work delegation failure fingerprint mismatch");
	}
	if (payload.outcome === "delegated") {
		if (assessment.payload.decision !== "parallel") {
			throw new Error("delegated outcome requires a parallel assessment");
		}
		if (
			payload.child_contracts.length >
			state.policy_snapshot.policy.delegation.max_agents
		) {
			throw new Error("delegated child contracts exceed frozen max_agents");
		}
		const lanes = new Map(
			assessment.payload.lanes.map((lane) => [lane.lane_id, lane]),
		);
		if (payload.child_contracts.length !== lanes.size) {
			throw new Error(
				"delegated child contracts must cover every assessed lane",
			);
		}
		for (const child of payload.child_contracts) {
			const lane = lanes.get(child.lane_id);
			if (!lane)
				throw new Error(
					`delegated child contract has unknown lane: ${child.lane_id}`,
				);
			if (
				child.work_id !== state.work_id ||
				child.basis_contract_revision !== state.revision
			) {
				throw new Error(
					"delegated child contract targets a different Work basis",
				);
			}
			if (
				canonicalJson(child.requirement_ids) !==
					canonicalJson(lane.requirement_ids) ||
				canonicalJson(child.repository_scopes) !==
					canonicalJson(lane.repository_scopes) ||
				canonicalJson(child.external_effects) !==
					canonicalJson(lane.external_effects)
			) {
				throw new Error(
					"delegated child contract expands or changes its assessed lane",
				);
			}
		}
	}
	if (payload.outcome === "results_recorded") {
		const delegated = typedRecords(records)
			.reverse()
			.find(
				(
					event,
				): event is Extract<
					TypedWorkEvent,
					{ kind: "work_delegation_outcome_recorded" }
				> =>
					event.kind === "work_delegation_outcome_recorded" &&
					event.payload.outcome === "delegated" &&
					event.payload.assessment_id === payload.assessment_id &&
					event.payload.assessment_input_hash ===
						payload.assessment_input_hash &&
					event.payload.provider === payload.provider,
			);
		if (
			!delegated ||
			delegated.payload.outcome !== "delegated" ||
			delegated.payload.delegation_contract_hash !==
				payload.delegation_contract_hash
		) {
			throw new Error(
				"delegation results require the exact prior contract hash",
			);
		}
	}
}

function assertDelegationWaiver(
	records: readonly WorkLedgerRecord[],
	payload: WorkDelegationWaiverPayload,
	state: NonNullable<ReturnType<typeof typedState>>,
): void {
	const latestAssessment = typedRecords(records)
		.reverse()
		.find(
			(
				event,
			): event is Extract<
				TypedWorkEvent,
				{ kind: "work_parallelism_assessed" }
			> => event.kind === "work_parallelism_assessed",
		);
	if (
		!latestAssessment ||
		latestAssessment.payload.assessment_id !== payload.assessment_id ||
		latestAssessment.payload.assessment_input_hash !==
			payload.assessment_input_hash
	) {
		throw new Error("Work delegation waiver requires the current assessment");
	}
	const outcomes = typedRecords(records).filter(
		(
			event,
		): event is Extract<
			TypedWorkEvent,
			{ kind: "work_delegation_outcome_recorded" }
		> =>
			event.kind === "work_delegation_outcome_recorded" &&
			event.payload.assessment_id === payload.assessment_id &&
			event.payload.assessment_input_hash === payload.assessment_input_hash,
	);
	if (
		outcomes.some(
			(event) =>
				event.payload.outcome === "delegated" ||
				event.payload.outcome === "results_recorded",
		)
	) {
		throw new Error(
			"Work delegation waiver cannot overwrite delegated or completed evidence",
		);
	}
	const policy = state.policy_snapshot.policy.delegation;
	const candidates = delegationCandidates(policy);
	let provider = latestAssessment.payload.selected_provider;
	for (const outcome of outcomes) {
		if (
			![
				"authorization_error",
				"unsupported_authority",
				"unavailable",
				"runtime_incompatible",
			].includes(outcome.payload.outcome)
		)
			continue;
		if (policy.unavailable !== "fallback") {
			throw new Error(
				"Work delegation waiver cannot overwrite a terminal unavailable outcome",
			);
		}
		const index = candidates.indexOf(provider!);
		provider = index < 0 ? null : (candidates[index + 1] ?? null);
		if (provider === null) {
			throw new Error(
				"Work delegation waiver cannot overwrite provider exhaustion",
			);
		}
	}
}

function assertLaneGraph(lanes: readonly WorkParallelLane[]): void {
	const byId = new Map(lanes.map((lane) => [lane.lane_id, lane]));
	for (const lane of lanes) {
		for (const dependency of lane.depends_on) {
			if (dependency === lane.lane_id || !byId.has(dependency)) {
				throw new Error(`invalid Work lane dependency: ${dependency}`);
			}
		}
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string) => {
		if (visiting.has(id)) throw new Error("Work lane dependency cycle");
		if (visited.has(id)) return;
		visiting.add(id);
		for (const dependency of byId.get(id)!.depends_on) visit(dependency);
		visiting.delete(id);
		visited.add(id);
	};
	for (const lane of lanes) visit(lane.lane_id);
	const ordered = (left: string, right: string): boolean => {
		const pending = [...(byId.get(left)?.depends_on ?? [])];
		const seen = new Set<string>();
		while (pending.length > 0) {
			const current = pending.pop()!;
			if (current === right) return true;
			if (seen.has(current)) continue;
			seen.add(current);
			pending.push(...(byId.get(current)?.depends_on ?? []));
		}
		return false;
	};
	for (let leftIndex = 0; leftIndex < lanes.length; leftIndex += 1) {
		for (
			let rightIndex = leftIndex + 1;
			rightIndex < lanes.length;
			rightIndex += 1
		) {
			const left = lanes[leftIndex]!;
			const right = lanes[rightIndex]!;
			if (
				ordered(left.lane_id, right.lane_id) ||
				ordered(right.lane_id, left.lane_id)
			)
				continue;
			if (lanesConflict(left, right)) {
				throw new Error(
					`unsafe unordered Work lanes: ${left.lane_id}, ${right.lane_id}`,
				);
			}
		}
	}
}

function lanesConflict(
	left: WorkParallelLane,
	right: WorkParallelLane,
): boolean {
	for (const leftScope of left.repository_scopes) {
		for (const rightScope of right.repository_scopes) {
			if (
				(leftScope.access === "write" || rightScope.access === "write") &&
				repositoryScopesOverlap(leftScope, rightScope)
			)
				return true;
		}
	}
	for (const leftEffect of left.external_effects) {
		for (const rightEffect of right.external_effects) {
			if (
				leftEffect.resource_kind === rightEffect.resource_kind &&
				leftEffect.resource_ref === rightEffect.resource_ref &&
				(leftEffect.access === "write" ||
					rightEffect.access === "write" ||
					leftEffect.irreversible ||
					rightEffect.irreversible)
			)
				return true;
		}
	}
	return false;
}

export function repositoryScopesOverlap(
	left: RepositoryScope,
	right: RepositoryScope,
): boolean {
	if (left.kind === "repo" || right.kind === "repo") return true;
	const leftParts = left.path.split("/");
	const rightParts = right.path.split("/");
	const prefix = (parent: readonly string[], child: readonly string[]) =>
		parent.length <= child.length &&
		parent.every((part, index) => part === child[index]);
	if (left.kind === "file" && right.kind === "file")
		return left.path === right.path;
	if (left.kind === "tree" && right.kind === "tree")
		return prefix(leftParts, rightParts) || prefix(rightParts, leftParts);
	return left.kind === "tree"
		? prefix(leftParts, rightParts)
		: prefix(rightParts, leftParts);
}

function delegationCandidates(
	policy: NormalizedDelegationPolicy,
): WorkDelegationProvider[] {
	const required =
		policy.native_agents === "required"
			? "native_agents"
			: policy.tmux_team === "required"
				? "tmux_team"
				: null;
	if (required) return [required];
	return policy.fallback_order.filter(
		(provider) =>
			(provider === "native_agents"
				? policy.native_agents
				: policy.tmux_team) !== "never",
	);
}

export function calculateWorkChildContractHash(child: ChildContract): string {
	return sha256(canonicalJson(childContractSchema.parse(child)));
}

export function calculateWorkDelegationContractHash(
	payload: Pick<
		Extract<WorkDelegationOutcomePayload, { outcome: "delegated" }>,
		| "work_id"
		| "basis_contract_revision"
		| "basis_contract_hash"
		| "policy_hash"
		| "assessment_id"
		| "assessment_input_hash"
		| "provider"
		| "child_contracts"
	>,
): string {
	return sha256(
		canonicalJson({
			work_id: payload.work_id,
			basis_contract_revision: payload.basis_contract_revision,
			basis_contract_hash: payload.basis_contract_hash,
			policy_hash: payload.policy_hash,
			assessment_id: payload.assessment_id,
			assessment_input_hash: payload.assessment_input_hash,
			provider: payload.provider,
			child_contract_hashes: payload.child_contracts
				.map(calculateWorkChildContractHash)
				.sort(compareCodeUnits),
		}),
	);
}

export function calculateWorkDelegationFailureFingerprint(
	payload: Pick<
		Extract<
			WorkDelegationOutcomePayload,
			{
				outcome:
					| "authorization_error"
					| "unsupported_authority"
					| "unavailable"
					| "runtime_incompatible";
			}
		>,
		| "work_id"
		| "basis_contract_revision"
		| "basis_contract_hash"
		| "policy_hash"
		| "assessment_id"
		| "assessment_input_hash"
		| "provider"
		| "outcome"
		| "failure_input"
		| "failure_refs"
	>,
	lanes: readonly WorkParallelLane[],
): string {
	return sha256(
		canonicalJson({
			work_id: payload.work_id,
			basis_contract_revision: payload.basis_contract_revision,
			basis_contract_hash: payload.basis_contract_hash,
			policy_hash: payload.policy_hash,
			assessment_id: payload.assessment_id,
			assessment_input_hash: payload.assessment_input_hash,
			selected_provider: payload.provider,
			outcome: payload.outcome,
			failure_input: payload.failure_input,
			failure_refs: [...payload.failure_refs].sort(compareCodeUnits),
			candidate_lane_hashes: lanes
				.map((lane) =>
					sha256(canonicalJson(workParallelLaneSchema.parse(lane))),
				)
				.sort(compareCodeUnits),
		}),
	);
}

function assertContractLineage(
	previous: readonly WorkRequirementDefinition[],
	next: readonly WorkRequirementDefinition[],
): void {
	const previousById = new Map(previous.map((item) => [item.id, item]));
	const nextById = new Map(next.map((item) => [item.id, item]));
	const previouslySuperseded = new Set(
		previous.flatMap((item) => item.supersedes ?? []),
	);
	const supersedingOwner = new Map<string, string>();
	for (const [id, before] of previousById) {
		const after = nextById.get(id);
		if (!after)
			throw new Error(`Work contract revision removed requirement ${id}`);
		if (
			before.summary !== after.summary ||
			before.weight !== after.weight ||
			before.superseded_by !== after.superseded_by ||
			canonicalJson(before.supersedes ?? []) !==
				canonicalJson(after.supersedes ?? [])
		) {
			throw new Error(
				`Work requirement ${id} semantic definition is immutable`,
			);
		}
		const sources = new Set(after.source_event_ids);
		if (!before.source_event_ids.every((source) => sources.has(source)))
			throw new Error(
				`Work requirement ${id} source_event_ids are append-only`,
			);
	}
	for (const requirement of next) {
		for (const target of requirement.supersedes ?? []) {
			if (target === requirement.id)
				throw new Error("Work requirement cannot supersede itself");
			if (!previousById.has(target))
				throw new Error(
					`Work requirement supersedes unknown prior requirement ${target}`,
				);
			const existingOwner = supersedingOwner.get(target);
			if (existingOwner && existingOwner !== requirement.id)
				throw new Error(
					`Work requirement ${target} has multiple superseding requirements`,
				);
			supersedingOwner.set(target, requirement.id);
			if (!previousById.has(requirement.id) && previouslySuperseded.has(target))
				throw new Error(`Work requirement ${target} is already superseded`);
		}
	}
	for (const requirement of next) {
		const seen = new Set<string>();
		let cursor: WorkRequirementDefinition | undefined = requirement;
		while (cursor?.superseded_by) {
			if (seen.has(cursor.id))
				throw new Error("Work requirement supersession cycle");
			seen.add(cursor.id);
			cursor = nextById.get(cursor.superseded_by);
			if (!cursor)
				throw new Error(`Work requirement superseded_by target is unknown`);
		}
	}
}

function compareCodeUnits(left: string, right: string): number {
	const limit = Math.min(left.length, right.length);
	for (let index = 0; index < limit; index += 1) {
		const difference = left.charCodeAt(index) - right.charCodeAt(index);
		if (difference !== 0) return difference;
	}
	return left.length - right.length;
}

function sortedStrings(values: readonly string[]): string[] {
	return [...values].sort(compareCodeUnits);
}

function ledgerMode(
	records: readonly WorkLedgerRecord[],
): "empty" | "legacy" | "typed" {
	const created = records.find((record) => record.kind === "work_created");
	if (!created) return records.length === 0 ? "empty" : "legacy";
	return isTypedPayload(created.payload) ? "typed" : "legacy";
}

function isTypedPayload(payload: Record<string, unknown>): boolean {
	return Object.values(WORK_TYPED_EVENT_KIND_SCHEMA_PAIRS).includes(
		payload.schema_version as never,
	);
}

function addRepoPathIssue(
	value: string,
	context: z.RefinementCtx,
	path: Array<string | number> = [],
): void {
	const invalid =
		value.startsWith("/") ||
		value.endsWith("/") ||
		value.includes("\\") ||
		value.includes("//") ||
		/[\u0000*?[\]{}]/u.test(value) ||
		value.split("/").some((segment) => segment === "." || segment === "..");
	if (invalid) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message:
				"path must be a normalized repo-relative POSIX path without globs",
			path,
		});
	}
}

function assertUniqueIds(values: readonly string[], label: string): void {
	if (new Set(values).size !== values.length) {
		throw new Error(`duplicate Work contract ${label} ID`);
	}
}

function canonicalJson(value: unknown): string {
	if (typeof value === "number" && !Number.isFinite(value))
		throw new Error("non-finite JSON number");
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
		.join(",")}}`;
}
