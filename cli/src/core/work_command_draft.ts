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

export type WorkContractDraft = z.infer<typeof workContractDraftSchema>;
export type WorkTransitionDraft = z.infer<typeof workTransitionDraftSchema>;

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
