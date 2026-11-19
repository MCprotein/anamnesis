import { z } from "zod";
import {
	KeywordMergeMode,
	USER_PAIN_SIGNALS,
	type UserPainKeywords,
	UserPainSignal,
} from "./user_pain_vocabulary.js";
import {
	describeSchemaIssues,
	parseYamlSafely,
	UserPainInputError,
} from "./user_pain_yaml.js";

const keywordEntrySchema = z
	.object({
		mode: z.enum(KeywordMergeMode).default(KeywordMergeMode.append),
		terms: z.array(z.string().trim().min(1)).min(1),
	})
	.strict();
const keywordFileSchema = z
	.object({
		[UserPainSignal.statusQuestion]: keywordEntrySchema.optional(),
		[UserPainSignal.repeatedCorrection]: keywordEntrySchema.optional(),
		[UserPainSignal.strongComplaint]: keywordEntrySchema.optional(),
	})
	.strict();

const LABEL = "keywords file";

export function applyKeywordFile(
	source: string,
	base: UserPainKeywords,
): UserPainKeywords {
	const parsed = keywordFileSchema.safeParse(parseYamlSafely(source, LABEL) ?? {});
	if (!parsed.success) {
		throw new UserPainInputError(describeSchemaIssues(parsed.error, LABEL));
	}
	const overrides = parsed.data;
	return Object.fromEntries(
		USER_PAIN_SIGNALS.map((signal) => {
			const entry = overrides[signal];
			if (!entry) return [signal, base[signal]];
			const terms =
				entry.mode === KeywordMergeMode.replace
					? entry.terms
					: [...base[signal], ...entry.terms];
			return [signal, [...new Set(terms)]];
		}),
	) as Record<UserPainSignal, readonly string[]>;
}
