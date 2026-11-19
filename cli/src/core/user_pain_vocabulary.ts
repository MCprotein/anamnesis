export const UserPainSpeaker = {
	user: "user",
	lead: "lead",
	teammate: "teammate",
	tool: "tool",
} as const;
export type UserPainSpeaker =
	(typeof UserPainSpeaker)[keyof typeof UserPainSpeaker];
export const USER_PAIN_SPEAKERS: readonly UserPainSpeaker[] =
	Object.values(UserPainSpeaker);

export const UserPainSignal = {
	statusQuestion: "status_question",
	repeatedCorrection: "repeated_correction",
	strongComplaint: "strong_complaint",
} as const;
export type UserPainSignal = (typeof UserPainSignal)[keyof typeof UserPainSignal];
export const USER_PAIN_SIGNALS: readonly UserPainSignal[] =
	Object.values(UserPainSignal);

export const CorrectionRuleKind = {
	bannedTerm: "banned_term",
	uiRule: "ui_rule",
	processRule: "process_rule",
} as const;
export type CorrectionRuleKind =
	(typeof CorrectionRuleKind)[keyof typeof CorrectionRuleKind];

export const CorrectionRuleScope = {
	assistant: "assistant",
	teammate: "teammate",
	subagent: "subagent",
} as const;

export const CorrectionRuleEnforcement = {
	warn: "warn",
	block: "block",
} as const;

export const KeywordMergeMode = {
	append: "append",
	replace: "replace",
} as const;

export type UserPainKeywords = Readonly<
	Record<UserPainSignal, readonly string[]>
>;

export const DEFAULT_USER_PAIN_KEYWORDS: UserPainKeywords = {
	[UserPainSignal.statusQuestion]: [
		"어디까지",
		"진행상황",
		"진행중",
		"남은일",
		"남은작업",
		"언제",
		"브리핑",
		"완료됐",
		"끝났",
		"다됐",
	],
	[UserPainSignal.repeatedCorrection]: [
		"몇번",
		"했잖아",
		"말했잖",
		"아직도",
		"다시말하지만",
		"라고했",
	],
	[UserPainSignal.strongComplaint]: ["시발", "씨발", "개새끼", "젠장"],
};
