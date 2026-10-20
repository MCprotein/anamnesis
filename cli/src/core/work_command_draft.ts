import { TextDecoder } from "node:util";
import YAML from "yaml";
import { z } from "zod";

const nonEmpty = z
	.string()
	.min(1)
	.refine((value) => value.trim().length > 0);
const uniqueNonEmpty = z.array(nonEmpty).superRefine((values, context) => {
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

const requirementDraftSchema = z
	.object({
		id: nonEmpty,
		summary: nonEmpty,
		source_event_ids: uniqueNonEmpty.min(1),
		weight: z
			.number()
			.finite()
			.positive()
			.max(Number.MAX_SAFE_INTEGER)
			.optional(),
		supersedes: uniqueNonEmpty.optional(),
	})
	.strict();

const constraintDraftSchema = z
	.object({
		id: nonEmpty,
		kind: z.enum(["must", "never"]),
		text: nonEmpty,
		source_event_ids: uniqueNonEmpty.min(1),
		expires: nonEmpty.optional(),
		promote_candidate: z.boolean().optional(),
		supersedes: uniqueNonEmpty.optional(),
	})
	.strict();

export const workContractDraftSchema = z
	.object({
		work: z
			.object({
				title: nonEmpty,
				completion_contract: nonEmpty,
			})
			.strict(),
		boundary: z
			.object({
				state: z.enum(["provisional", "needs_user", "accepted"]),
				classification: z.enum(["same_unit", "new_unit", "interruption"]),
				reason_codes: uniqueNonEmpty,
				confidence: z.enum(["low", "medium", "high"]),
			})
			.strict(),
		requirements: z.array(requirementDraftSchema),
		open_conflicts: z.array(
			z
				.object({
					id: nonEmpty,
					summary: nonEmpty,
					requirement_ids: uniqueNonEmpty.min(1),
					source_event_ids: uniqueNonEmpty.min(1),
				})
				.strict(),
		),
		/** Optional must/never Work constraints; omitted or empty means none. */
		constraints: z.array(constraintDraftSchema).optional(),
	})
	.strict();

export const workTransitionDraftSchema = z
	.object({
		requirement_id: nonEmpty,
		status: z.enum([
			"pending",
			"in_progress",
			"implemented_unverified",
			"verified",
			"blocked",
			"waived",
		]),
		evidence_refs: uniqueNonEmpty,
		waiver: z
			.object({
				reason: nonEmpty,
				authority_ref: nonEmpty,
				source_event_id: nonEmpty,
				evidence_refs: uniqueNonEmpty.min(1),
			})
			.strict()
			.optional(),
	})
	.strict();

export const WORK_TRANSITION_BATCH_SCHEMA_VERSION =
	"anamnesis.work-transition-batch.v1" as const;

/**
 * Several evidence-only transitions for one Work. Waivers are excluded
 * because each waiver needs its own user source event.
 */
export const workTransitionBatchDraftObjectSchema = z
	.object({
		schema_version: z.literal(WORK_TRANSITION_BATCH_SCHEMA_VERSION),
		work_id: nonEmpty.optional(),
		transitions: z
			.array(
				z
					.object({
						event_id: nonEmpty,
						requirement_id: nonEmpty,
						status: z.enum([
							"pending",
							"in_progress",
							"implemented_unverified",
							"verified",
							"blocked",
						]),
						evidence_refs: uniqueNonEmpty,
					})
					.strict(),
			)
			.min(1)
			.max(256),
	})
	.strict();

/** Reject repeated event IDs and a requirement that appears twice. */
export function refineWorkTransitionBatch(
	value: Pick<
		z.infer<typeof workTransitionBatchDraftObjectSchema>,
		"transitions"
	>,
	context: z.RefinementCtx,
): void {
	const eventIds = new Set<string>();
	const requirementIds = new Set<string>();
	for (const [index, item] of value.transitions.entries()) {
		if (eventIds.has(item.event_id))
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `duplicate event_id: ${item.event_id}`,
				path: ["transitions", index, "event_id"],
			});
		if (requirementIds.has(item.requirement_id))
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `requirement appears twice in one batch: ${item.requirement_id}`,
				path: ["transitions", index, "requirement_id"],
			});
		eventIds.add(item.event_id);
		requirementIds.add(item.requirement_id);
	}
}

export const workTransitionBatchDraftSchema =
	workTransitionBatchDraftObjectSchema.superRefine(refineWorkTransitionBatch);

export type WorkTransitionBatchDraft = z.infer<
	typeof workTransitionBatchDraftSchema
>;

/** Strict, user-authorized draft for closing a Work lifecycle. */
export const workCloseDraftSchema = z
	.object({
		lifecycle: z.literal("completed"),
		authority: z
			.object({
				kind: z.enum([
					"explicit_user_acceptance",
					"delegated_objective_completion",
				]),
				source_event_id: nonEmpty,
				authority_ref: nonEmpty,
			})
			.strict(),
		evidence_refs: uniqueNonEmpty.min(1),
	})
	.strict();

export const workPromptRetainDraftSchema = z
	.object({
		boundary: z
			.object({
				state: z.enum(["provisional", "needs_user"]),
				classification: z.enum(["same_unit", "new_unit"]),
				reason_codes: uniqueNonEmpty.min(1),
				confidence: z.enum(["low", "medium"]),
			})
			.strict(),
		question: nonEmpty,
	})
	.strict();

export type WorkContractDraft = z.infer<typeof workContractDraftSchema>;
export type WorkTransitionDraft = z.infer<typeof workTransitionDraftSchema>;
export type WorkCloseDraft = z.infer<typeof workCloseDraftSchema>;
export type WorkPromptRetainDraft = z.infer<typeof workPromptRetainDraftSchema>;

export const STAGED_WORK_SOURCE_PLACEHOLDER = "@staged";

/** Parse one strict UTF-8 YAML document. Drafts intentionally omit computed authority fields. */
export function parseSingleWorkDraft<T>(
	bytes: Buffer,
	schema: z.ZodType<T>,
): T {
	let source: string;
	try {
		source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch (error) {
		throw new Error("Work draft must be valid UTF-8", { cause: error });
	}
	const documents = YAML.parseAllDocuments(source, { strict: true });
	if (documents.length !== 1) {
		throw new Error("Work draft must contain exactly one YAML document");
	}
	const document = documents[0]!;
	if (document.errors.length > 0) {
		throw new Error(`invalid Work draft YAML: ${document.errors[0]!.message}`);
	}
	return schema.parse(document.toJS());
}

export function parseWorkContractDraft(bytes: Buffer): WorkContractDraft {
	return parseSingleWorkDraft(bytes, workContractDraftSchema);
}

export function parseWorkTransitionDraft(bytes: Buffer): WorkTransitionDraft {
	return parseSingleWorkDraft(bytes, workTransitionDraftSchema);
}

export function parseWorkCloseDraft(bytes: Buffer): WorkCloseDraft {
	return parseSingleWorkDraft(bytes, workCloseDraftSchema);
}

/**
 * Replace the staged-source placeholder only after strict draft parsing. This
 * keeps the derived source ID out of hook context while preserving exact
 * requirement/source ownership in the canonical contract.
 */
export function parseStagedWorkContractDraft(
	bytes: Buffer,
	sourceEventId: string,
): WorkContractDraft {
	const draft = parseWorkContractDraft(bytes);
	let replacements = 0;
	const replace = (values: readonly string[]): string[] =>
		values.map((value) => {
			if (value !== STAGED_WORK_SOURCE_PLACEHOLDER) return value;
			replacements += 1;
			return sourceEventId;
		});
	const resolved = workContractDraftSchema.parse({
		...draft,
		requirements: draft.requirements.map((requirement) => ({
			...requirement,
			source_event_ids: replace(requirement.source_event_ids),
		})),
		open_conflicts: draft.open_conflicts.map((conflict) => ({
			...conflict,
			source_event_ids: replace(conflict.source_event_ids),
		})),
		...(draft.constraints === undefined
			? {}
			: {
					constraints: draft.constraints.map((constraint) => ({
						...constraint,
						source_event_ids: replace(constraint.source_event_ids),
					})),
				}),
	});
	if (replacements === 0) {
		throw new Error(
			`staged Work draft must reference ${STAGED_WORK_SOURCE_PLACEHOLDER}`,
		);
	}
	return resolved;
}

export function parseWorkPromptRetainDraft(
	bytes: Buffer,
): WorkPromptRetainDraft {
	return parseSingleWorkDraft(bytes, workPromptRetainDraftSchema);
}
