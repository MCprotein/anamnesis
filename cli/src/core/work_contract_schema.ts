import { z } from "zod";
import { isHash } from "../util/hash.js";
import type {
	AppendWorkLedgerOptions,
	WorkLedgerEvent,
} from "./work_ledger.js";
import type { WorkPolicySnapshot } from "./work_policy.js";
import { canonicalJson } from "./work_contract_canonical.js";

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

export const contractDefinitionSchema = z
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

export const contractPayloadSchema = z
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

export const progressPayloadSchema = z
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

export const lifecyclePayloadSchema = z
	.object({
		schema_version: z.literal(WORK_LIFECYCLE_EVENT_SCHEMA_VERSION),
		work_id: nonEmpty,
		basis_contract_revision: positiveInteger,
		basis_contract_hash: hash,
		basis_projection_hash: hash,
		policy_hash: hash,
		lifecycle: z.enum(["open", "completed", "abandoned", "superseded"]),
		authority_kind: z.enum([
			"explicit_user_acceptance",
			"delegated_objective_completion",
		]),
		authority_ref: boundedRef,
		evidence_refs: boundedList(
			boundedRef,
			WORK_EXECUTION_LIMITS.maxEvidenceRefs,
			String,
		).min(1),
		completion_review_input_hash: hash.nullable(),
		source_event_id: nonEmpty,
		source_envelope_hash: hash.optional(),
		source_object_hash: hash.optional(),
		source_object_path: nonEmpty.optional(),
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
