import { z } from "zod";
import {
	CorrectionRuleEnforcement,
	CorrectionRuleKind,
	CorrectionRuleScope,
} from "./user_pain_vocabulary.js";
import {
	describeSchemaIssues,
	parseYamlSafely,
	UserPainInputError,
} from "./user_pain_yaml.js";

export interface BannedTermRule {
	id: string;
	pattern: string;
	allow: readonly string[];
}

export interface CorrectionRuleSet {
	bannedTerms: BannedTermRule[];
	skippedRuleIds: string[];
}

const nonEmpty = z.string().trim().min(1);
const commonRuleFields = {
	id: nonEmpty,
	scope: z.array(z.enum(CorrectionRuleScope)).optional(),
	enforcement: z.enum(CorrectionRuleEnforcement).optional(),
	reminder: z.string().optional(),
	source: z.string().optional(),
};
const correctionRuleSchema = z.discriminatedUnion("kind", [
	z
		.object({
			...commonRuleFields,
			kind: z.literal(CorrectionRuleKind.bannedTerm),
			pattern: nonEmpty,
			allow: z.array(nonEmpty).optional(),
		})
		.strict(),
	z
		.object({
			...commonRuleFields,
			kind: z.literal(CorrectionRuleKind.uiRule),
		})
		.strict(),
	z
		.object({
			...commonRuleFields,
			kind: z.literal(CorrectionRuleKind.processRule),
		})
		.strict(),
]);
const correctionRulesSchema = z.array(correctionRuleSchema);

const LABEL = "rules file";

export function parseCorrectionRules(source: string): CorrectionRuleSet {
	const parsed = correctionRulesSchema.safeParse(
		parseYamlSafely(source, LABEL) ?? [],
	);
	if (!parsed.success) {
		throw new UserPainInputError(describeSchemaIssues(parsed.error, LABEL));
	}
	const result: CorrectionRuleSet = { bannedTerms: [], skippedRuleIds: [] };
	const seen = new Set<string>();
	for (const [index, entry] of parsed.data.entries()) {
		if (seen.has(entry.id)) {
			throw new UserPainInputError(`${LABEL}: duplicate rule id at entry ${index}`);
		}
		seen.add(entry.id);
		if (entry.kind !== CorrectionRuleKind.bannedTerm) {
			result.skippedRuleIds.push(entry.id);
			continue;
		}
		result.bannedTerms.push({
			id: entry.id,
			pattern: entry.pattern,
			allow: entry.allow ?? [],
		});
	}
	return result;
}
