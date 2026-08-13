import { z } from "zod";

import { sha256 } from "../util/hash.js";

const nonEmptyString = z
	.string()
	.min(1)
	.refine(
		(value) => value.trim().length > 0,
		"must contain non-whitespace text",
	);
const positiveSafeInteger = z
	.number()
	.int()
	.positive()
	.max(Number.MAX_SAFE_INTEGER);
const supportedIsoDuration = z
	.string()
	.regex(/^PT(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?$/);
const uniqueArray = <T extends z.ZodTypeAny>(item: T) =>
	z.array(item).superRefine((values, ctx) => {
		const seen = new Set<unknown>();
		values.forEach((value, index) => {
			if (seen.has(value)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `duplicate value: ${String(value)}`,
					path: [index],
				});
			}
			seen.add(value);
		});
	});

const reconciliationTriggerSchema = z.enum([
	"work_resume",
	"contract_revision",
	"compaction_resume",
	"meaningful_milestone",
	"before_work_close",
]);

const reconciliationSchema = z
	.object({
		preset: z.enum(["off", "adaptive", "frequent", "custom"]),
		due_after: z
			.object({
				max_silence: supportedIsoDuration,
				meaningful_actions: positiveSafeInteger,
			})
			.strict()
			.partial()
			.optional(),
		triggers: uniqueArray(reconciliationTriggerSchema).optional(),
		detail: z.enum(["compact", "full"]).optional(),
		compact_target_tokens: positiveSafeInteger.optional(),
		full_chunk_target_tokens: positiveSafeInteger.optional(),
		after_briefing: z.literal("continue").optional(),
	})
	.strict();

const reviewGateNameSchema = z.enum(["planning", "completion"]);
const reviewProviderSchema = z.enum([
	"omx",
	"codex_native",
	"separate_process",
]);
const reviewerSchema = z
	.object({
		capability: z.literal("independent_agent"),
		role_hint: nonEmptyString.optional(),
		minimum_reviewers: positiveSafeInteger.optional(),
	})
	.strict();
const reviewGateSchema = z
	.object({
		gate: reviewGateNameSchema,
		enforcement: z.enum(["off", "advisory", "required"]),
		reviewer: reviewerSchema.optional(),
		invalidation_inputs: uniqueArray(nonEmptyString).optional(),
		provider_order: uniqueArray(reviewProviderSchema).optional(),
		unavailable: z
			.enum(["continue", "fallback", "ask", "fail_closed"])
			.optional(),
	})
	.strict();

const reviewSchema = z
	.object({
		preset: z.enum(["off", "advisory", "strict", "custom"]),
		gates: z
			.array(reviewGateSchema)
			.superRefine((gates, ctx) => {
				const seen = new Set<ReviewGateName>();
				gates.forEach((gate, index) => {
					if (seen.has(gate.gate)) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							message: `duplicate review gate: ${gate.gate}`,
							path: [index, "gate"],
						});
					}
					seen.add(gate.gate);
				});
			})
			.optional(),
		provider_order: uniqueArray(reviewProviderSchema).optional(),
		fallback_on: uniqueArray(
			z.enum(["authorization_error", "unsupported_authority", "unavailable"]),
		).optional(),
		unavailable: z
			.enum(["continue", "fallback", "ask", "fail_closed"])
			.optional(),
	})
	.strict();

const runtimePreferenceSchema = z.enum(["never", "auto", "prefer", "required"]);
const delegationProviderSchema = z.enum(["native_agents", "tmux_team"]);
const delegationSchema = z
	.object({
		parallelism: z.enum(["off", "auto", "prefer", "required"]),
		max_agents: positiveSafeInteger.optional(),
		native_agents: runtimePreferenceSchema.optional(),
		tmux_team: runtimePreferenceSchema.optional(),
		fallback_order: uniqueArray(delegationProviderSchema).optional(),
		unavailable: z.enum(["fallback", "ask", "fail_closed"]).optional(),
		reassess_on: uniqueArray(
			z.enum([
				"contract_revision",
				"material_scope_change",
				"provider_unavailable",
			]),
		).optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.native_agents === "required" && value.tmux_team === "required") {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "native_agents and tmux_team cannot both be required",
			});
		}
		const requiredProvider =
			value.native_agents === "required"
				? "native_agents"
				: value.tmux_team === "required"
					? "tmux_team"
					: undefined;
		if (
			requiredProvider &&
			value.fallback_order &&
			!value.fallback_order.includes(requiredProvider)
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `fallback_order must include required provider: ${requiredProvider}`,
				path: ["fallback_order"],
			});
		}
	});

export const workPolicyConfigSchema = z
	.object({
		reconciliation: reconciliationSchema.optional(),
		review: reviewSchema.optional(),
		delegation: delegationSchema.optional(),
	})
	.strict();

export type WorkPolicyConfig = z.infer<typeof workPolicyConfigSchema>;

export const WORK_POLICY_LAYER_PRECEDENCE = [
	"current_instruction",
	"per_work",
	"matched_harness",
	"project",
	"user",
	"product",
] as const;

export type WorkPolicyLayerKind = (typeof WORK_POLICY_LAYER_PRECEDENCE)[number];
export type ReviewGateName = z.infer<typeof reviewGateNameSchema>;
export type ReviewEnforcement = "off" | "advisory" | "required";

export interface WorkPolicySourceRef {
	source: string;
	ref: string;
}

export interface WorkPolicyGateWaiver extends WorkPolicySourceRef {
	gate: ReviewGateName;
	reason: string;
	revision: number;
	enforcement?: Exclude<ReviewEnforcement, "required">;
}

export interface WorkPolicyLayer {
	kind: WorkPolicyLayerKind;
	config?: WorkPolicyConfig;
	source_refs: readonly WorkPolicySourceRef[];
	waivers?: readonly WorkPolicyGateWaiver[];
}

export interface NormalizedReconciliationPolicy {
	preset: "off" | "adaptive" | "frequent" | "custom";
	due_after: {
		max_silence: string | null;
		meaningful_actions: number | null;
	};
	triggers: Array<z.infer<typeof reconciliationTriggerSchema>>;
	detail: "compact" | "full";
	compact_target_tokens: number;
	full_chunk_target_tokens: number;
	after_briefing: "continue";
}

export interface NormalizedReviewGate {
	gate: ReviewGateName;
	enforcement: ReviewEnforcement;
	capability: "independent_agent";
	role_hint: string;
	minimum_reviewers: number;
	invalidation_inputs: string[];
	provider_order: Array<z.infer<typeof reviewProviderSchema>>;
	unavailable: "continue" | "fallback" | "ask" | "fail_closed";
	waived_by: WorkPolicyGateWaiver | null;
}

export interface NormalizedReviewPolicy {
	preset: "off" | "advisory" | "strict" | "custom";
	gates: NormalizedReviewGate[];
	provider_order: Array<z.infer<typeof reviewProviderSchema>>;
	fallback_on: Array<
		"authorization_error" | "unsupported_authority" | "unavailable"
	>;
	unavailable: "continue" | "fallback" | "ask" | "fail_closed";
}

export interface NormalizedDelegationPolicy {
	parallelism: "off" | "auto" | "prefer" | "required";
	max_agents: number;
	native_agents: "never" | "auto" | "prefer" | "required";
	tmux_team: "never" | "auto" | "prefer" | "required";
	fallback_order: Array<z.infer<typeof delegationProviderSchema>>;
	unavailable: "fallback" | "ask" | "fail_closed";
	reassess_on: Array<
		"contract_revision" | "material_scope_change" | "provider_unavailable"
	>;
	provider_exhaustion: "continue_solo" | "ask" | "blocked_unavailable";
}

export interface NormalizedWorkPolicy {
	reconciliation: NormalizedReconciliationPolicy;
	review: NormalizedReviewPolicy;
	delegation: NormalizedDelegationPolicy;
}

export interface ResolvedWorkPolicy extends NormalizedWorkPolicy {
	source_refs: WorkPolicySourceRef[];
	contributing_layers: WorkPolicyLayerKind[];
}

export interface WorkPolicySnapshot {
	schema_version: "anamnesis.work-policy-snapshot.v1";
	revision: number;
	policy: ResolvedWorkPolicy;
	policy_hash: string;
}

export interface WorkPolicySnapshotComparison {
	drifted: boolean;
	policy_changed: boolean;
	provenance_changed: boolean;
	revision_changed: boolean;
	from_revision: number;
	to_revision: number;
}

const workPolicySourceRefSchema = z
	.object({
		source: nonEmptyString,
		ref: nonEmptyString,
	})
	.strict();

const workPolicyGateWaiverSchema = workPolicySourceRefSchema
	.extend({
		gate: reviewGateNameSchema,
		reason: nonEmptyString,
		revision: positiveSafeInteger,
		enforcement: z.enum(["off", "advisory"]).optional(),
	})
	.strict();

const normalizedReconciliationPolicySchema = z
	.object({
		preset: z.enum(["off", "adaptive", "frequent", "custom"]),
		due_after: z
			.object({
				max_silence: supportedIsoDuration.nullable(),
				meaningful_actions: positiveSafeInteger.nullable(),
			})
			.strict(),
		triggers: uniqueArray(reconciliationTriggerSchema),
		detail: z.enum(["compact", "full"]),
		compact_target_tokens: positiveSafeInteger,
		full_chunk_target_tokens: positiveSafeInteger,
		after_briefing: z.literal("continue"),
	})
	.strict();

/** Runtime-strict validation for a resolved reconciliation policy fragment. */
export function validateNormalizedReconciliationPolicy(
	value: unknown,
): NormalizedReconciliationPolicy {
	return clone(
		normalizedReconciliationPolicySchema.parse(value),
	) as NormalizedReconciliationPolicy;
}

const normalizedReviewGateSchema = z
	.object({
		gate: reviewGateNameSchema,
		enforcement: z.enum(["off", "advisory", "required"]),
		capability: z.literal("independent_agent"),
		role_hint: nonEmptyString,
		minimum_reviewers: positiveSafeInteger,
		invalidation_inputs: uniqueArray(nonEmptyString),
		provider_order: uniqueArray(reviewProviderSchema),
		unavailable: z.enum(["continue", "fallback", "ask", "fail_closed"]),
		waived_by: workPolicyGateWaiverSchema.nullable(),
	})
	.strict();

const resolvedWorkPolicySchema = z
	.object({
		reconciliation: normalizedReconciliationPolicySchema,
		review: z
			.object({
				preset: z.enum(["off", "advisory", "strict", "custom"]),
				gates: z.array(normalizedReviewGateSchema),
				provider_order: uniqueArray(reviewProviderSchema),
				fallback_on: uniqueArray(
					z.enum([
						"authorization_error",
						"unsupported_authority",
						"unavailable",
					]),
				),
				unavailable: z.enum(["continue", "fallback", "ask", "fail_closed"]),
			})
			.strict(),
		delegation: z
			.object({
				parallelism: z.enum(["off", "auto", "prefer", "required"]),
				max_agents: positiveSafeInteger,
				native_agents: runtimePreferenceSchema,
				tmux_team: runtimePreferenceSchema,
				fallback_order: uniqueArray(delegationProviderSchema),
				unavailable: z.enum(["fallback", "ask", "fail_closed"]),
				reassess_on: uniqueArray(
					z.enum([
						"contract_revision",
						"material_scope_change",
						"provider_unavailable",
					]),
				),
				provider_exhaustion: z.enum([
					"continue_solo",
					"ask",
					"blocked_unavailable",
				]),
			})
			.strict(),
		source_refs: z.array(workPolicySourceRefSchema),
		contributing_layers: uniqueArray(z.enum(WORK_POLICY_LAYER_PRECEDENCE)),
	})
	.strict();

const workPolicySnapshotSchema = z
	.object({
		schema_version: z.literal("anamnesis.work-policy-snapshot.v1"),
		revision: positiveSafeInteger,
		policy: resolvedWorkPolicySchema,
		policy_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	})
	.strict();

const workPolicyLayerSchema = z
	.object({
		kind: z.enum(WORK_POLICY_LAYER_PRECEDENCE),
		config: workPolicyConfigSchema.optional(),
		source_refs: z.array(workPolicySourceRefSchema),
		waivers: z.array(workPolicyGateWaiverSchema).optional(),
	})
	.strict();

const DEFAULT_RECONCILIATION_TRIGGERS: NormalizedReconciliationPolicy["triggers"] =
	[
		"work_resume",
		"contract_revision",
		"compaction_resume",
		"meaningful_milestone",
		"before_work_close",
	];
const DEFAULT_REVIEW_PROVIDERS: NormalizedReviewPolicy["provider_order"] = [
	"omx",
	"codex_native",
	"separate_process",
];
const DEFAULT_REVIEW_FALLBACK: NormalizedReviewPolicy["fallback_on"] = [
	"authorization_error",
	"unsupported_authority",
	"unavailable",
];
const DEFAULT_DELEGATION_PROVIDERS: NormalizedDelegationPolicy["fallback_order"] =
	["native_agents", "tmux_team"];
const DEFAULT_REASSESS: NormalizedDelegationPolicy["reassess_on"] = [
	"contract_revision",
	"material_scope_change",
	"provider_unavailable",
];

/** Expand preset shorthand into a complete, deterministic, side-effect-free policy. */
export function normalizeWorkPolicyConfig(
	input: WorkPolicyConfig | undefined = undefined,
): NormalizedWorkPolicy {
	const config = workPolicyConfigSchema.parse(input ?? {});
	return {
		reconciliation: normalizeReconciliation(config.reconciliation),
		review: normalizeReview(config.review),
		delegation: normalizeDelegation(config.delegation),
	};
}

/** Resolve six policy layers. Input order is irrelevant; duplicate layer kinds fail closed. */
export function resolveWorkPolicy(
	input:
		| readonly WorkPolicyLayer[]
		| Partial<Record<WorkPolicyLayerKind, Omit<WorkPolicyLayer, "kind">>>,
): ResolvedWorkPolicy {
	const layers = Array.isArray(input)
		? [...input]
		: WORK_POLICY_LAYER_PRECEDENCE.flatMap((kind) => {
				const layer = (
					input as Partial<
						Record<WorkPolicyLayerKind, Omit<WorkPolicyLayer, "kind">>
					>
				)[kind];
				return layer ? [{ kind, ...layer } as WorkPolicyLayer] : [];
			});
	validateLayers(layers);

	const ordered = [...layers].sort(
		(a, b) =>
			WORK_POLICY_LAYER_PRECEDENCE.indexOf(a.kind) -
			WORK_POLICY_LAYER_PRECEDENCE.indexOf(b.kind),
	);
	let policy = normalizeWorkPolicyConfig();
	for (const layer of [...ordered].reverse()) {
		if (!layer.config) continue;
		policy = mergeNormalized(
			policy,
			normalizeWorkPolicyConfig(layer.config),
			layer.config,
		);
	}
	policy.review = enforceMonotonicReview(ordered, policy.review);

	return {
		...policy,
		source_refs: ordered.flatMap((layer) =>
			layer.source_refs.map(cloneSourceRef),
		),
		contributing_layers: ordered
			.filter(
				(layer) =>
					layer.config !== undefined || (layer.waivers?.length ?? 0) > 0,
			)
			.map((layer) => layer.kind),
	};
}

/** Freeze a policy and its provenance into an immutable contract revision. */
export function createWorkPolicySnapshot(
	revisionOrInput: number | { revision: number; policy: ResolvedWorkPolicy },
	resolvedPolicy?: ResolvedWorkPolicy,
): Readonly<WorkPolicySnapshot> {
	const revision =
		typeof revisionOrInput === "number"
			? revisionOrInput
			: revisionOrInput.revision;
	const policy =
		typeof revisionOrInput === "number"
			? resolvedPolicy
			: revisionOrInput.policy;
	if (!Number.isSafeInteger(revision) || revision <= 0) {
		throw new Error(
			"work policy snapshot revision must be a positive safe integer",
		);
	}
	if (!policy) throw new Error("resolved work policy is required");
	const clonedPolicy = clone(policy);
	for (const gate of clonedPolicy.review.gates) {
		if (gate.waived_by && gate.waived_by.revision !== revision) {
			throw new Error(
				`work policy waiver revision ${gate.waived_by.revision} does not match snapshot revision ${revision}`,
			);
		}
	}
	const unsigned = {
		schema_version: "anamnesis.work-policy-snapshot.v1" as const,
		revision,
		policy: clonedPolicy,
	};
	return deepFreeze({
		...unsigned,
		policy_hash: sha256(canonicalJson(clonedPolicy)),
	});
}

/** Runtime-strict validation for snapshots read from a Work ledger. */
export function validateWorkPolicySnapshot(value: unknown): WorkPolicySnapshot {
	const snapshot = workPolicySnapshotSchema.parse(value);
	if (sha256(canonicalJson(snapshot.policy)) !== snapshot.policy_hash) {
		throw new Error("work policy snapshot hash mismatch");
	}
	const gates = new Map(
		snapshot.policy.review.gates.map((gate) => [gate.gate, gate]),
	);
	if (
		snapshot.policy.review.gates.length !== 2 ||
		gates.size !== 2 ||
		!gates.has("planning") ||
		!gates.has("completion")
	) {
		throw new Error(
			"normalized review policy requires exactly planning and completion gates",
		);
	}
	for (const gate of snapshot.policy.review.gates) {
		if (gate.waived_by && gate.waived_by.gate !== gate.gate) {
			throw new Error("work policy waiver gate identity mismatch");
		}
		const expectedEnforcement =
			snapshot.policy.review.preset === "strict"
				? "required"
				: snapshot.policy.review.preset === "advisory"
					? "advisory"
					: snapshot.policy.review.preset === "off"
						? "off"
						: null;
		const validPresetEnforcement =
			expectedEnforcement === null ||
			gate.enforcement === expectedEnforcement ||
			((snapshot.policy.review.preset === "off" ||
				snapshot.policy.review.preset === "advisory") &&
				gate.enforcement === "required") ||
			(snapshot.policy.review.preset === "strict" &&
				gate.waived_by !== null &&
				(gate.enforcement === "off" || gate.enforcement === "advisory"));
		if (!validPresetEnforcement) {
			throw new Error(
				`${snapshot.policy.review.preset} review preset requires ${expectedEnforcement} gates`,
			);
		}
		if (gate.waived_by && gate.waived_by.revision !== snapshot.revision) {
			throw new Error(
				`work policy waiver revision ${gate.waived_by.revision} does not match snapshot revision ${snapshot.revision}`,
			);
		}
		if (gate.enforcement === "required" && gate.unavailable !== "fail_closed") {
			throw new Error("required review gates must fail closed when unavailable");
		}
	}
	const delegation = snapshot.policy.delegation;
	if (
		delegation.native_agents === "required" &&
		delegation.tmux_team === "required"
	) {
		throw new Error("native_agents and tmux_team cannot both be required");
	}
	const requiredProvider =
		delegation.native_agents === "required"
			? "native_agents"
			: delegation.tmux_team === "required"
				? "tmux_team"
				: null;
	if (requiredProvider && delegation.fallback_order[0] !== requiredProvider) {
		throw new Error(
			"required delegation provider must be first in fallback_order",
		);
	}
	if (
		(delegation.parallelism === "required" ||
			delegation.unavailable === "fail_closed" ||
			requiredProvider !== null) &&
		delegation.provider_exhaustion !== "blocked_unavailable"
	) {
		throw new Error("required delegation must block on provider exhaustion");
	}
	return clone(snapshot) as WorkPolicySnapshot;
}

/** Compare frozen revisions without reading current config or mutating either snapshot. */
export function compareWorkPolicySnapshots(
	before: WorkPolicySnapshot,
	after: WorkPolicySnapshot,
): WorkPolicySnapshotComparison {
	const beforeBehavior = policyBehavior(before.policy);
	const afterBehavior = policyBehavior(after.policy);
	const policyChanged =
		canonicalJson(beforeBehavior) !== canonicalJson(afterBehavior);
	const provenanceChanged =
		canonicalJson({
			source_refs: before.policy.source_refs,
			contributing_layers: before.policy.contributing_layers,
		}) !==
		canonicalJson({
			source_refs: after.policy.source_refs,
			contributing_layers: after.policy.contributing_layers,
		});
	const revisionChanged = before.revision !== after.revision;
	return {
		drifted: policyChanged || provenanceChanged,
		policy_changed: policyChanged,
		provenance_changed: provenanceChanged,
		revision_changed: revisionChanged,
		from_revision: before.revision,
		to_revision: after.revision,
	};
}

function normalizeReconciliation(
	config: WorkPolicyConfig["reconciliation"],
): NormalizedReconciliationPolicy {
	const preset = config?.preset ?? "off";
	const isEnabled = preset !== "off";
	const presetDue =
		preset === "frequent" ? { max_silence: "PT5M", meaningful_actions: 5 } : {};
	return {
		preset,
		due_after: {
			max_silence:
				config?.due_after?.max_silence ?? presetDue.max_silence ?? null,
			meaningful_actions:
				config?.due_after?.meaningful_actions ??
				presetDue.meaningful_actions ??
				null,
		},
		triggers: [
			...(config?.triggers ??
				(isEnabled && preset !== "custom"
					? DEFAULT_RECONCILIATION_TRIGGERS
					: [])),
		],
		detail: config?.detail ?? "compact",
		compact_target_tokens: config?.compact_target_tokens ?? 220,
		full_chunk_target_tokens: config?.full_chunk_target_tokens ?? 800,
		after_briefing: "continue",
	};
}

function normalizeReview(
	config: WorkPolicyConfig["review"],
): NormalizedReviewPolicy {
	const preset = config?.preset ?? "off";
	const presetEnforcement: ReviewEnforcement =
		preset === "strict"
			? "required"
			: preset === "advisory"
				? "advisory"
				: "off";
	const providerOrder = [
		...(config?.provider_order ?? DEFAULT_REVIEW_PROVIDERS),
	];
	const configured = new Map(
		(config?.gates ?? []).map((gate) => [gate.gate, gate]),
	);
	const hasRequiredGate =
		preset === "strict" ||
		(preset === "custom" &&
			(config?.gates ?? []).some((gate) => gate.enforcement === "required"));
	const configuredUnavailable =
		config?.unavailable ?? (preset === "strict" ? "fail_closed" : "fallback");
	const unavailable =
		hasRequiredGate && configuredUnavailable === "continue"
			? "fail_closed"
			: configuredUnavailable;
	const gates: NormalizedReviewGate[] = (
		["planning", "completion"] as const
	).map((gate) => {
		const override = configured.get(gate);
		const enforcement =
			preset === "custom"
				? (override?.enforcement ?? "off")
				: presetEnforcement;
		return {
			gate,
			enforcement,
			capability: "independent_agent",
			role_hint:
				override?.reviewer?.role_hint ??
				(gate === "planning" ? "critic" : "code-reviewer"),
			minimum_reviewers: override?.reviewer?.minimum_reviewers ?? 1,
			invalidation_inputs: [
				...(override?.invalidation_inputs ??
					(gate === "planning"
						? ["contract", "plan"]
						: ["base", "head", "diff", "verification"])),
			],
			provider_order: [...(override?.provider_order ?? providerOrder)],
			unavailable:
				enforcement === "required"
					? "fail_closed"
					: (override?.unavailable ?? unavailable),
			waived_by: null,
		};
	});
	return {
		preset,
		gates,
		provider_order: providerOrder,
		fallback_on: [...(config?.fallback_on ?? DEFAULT_REVIEW_FALLBACK)],
		unavailable,
	};
}

function normalizeDelegation(
	config: WorkPolicyConfig["delegation"],
): NormalizedDelegationPolicy {
	const parallelism = config?.parallelism ?? "off";
	const nativeAgents = config?.native_agents ?? "auto";
	const tmuxTeam = config?.tmux_team ?? "auto";
	if (nativeAgents === "required" && tmuxTeam === "required") {
		throw new Error("native_agents and tmux_team cannot both be required");
	}
	const unavailable = config?.unavailable ?? "fallback";
	const configuredOrder = [
		...(config?.fallback_order ?? DEFAULT_DELEGATION_PROVIDERS),
	];
	const requiredProvider =
		nativeAgents === "required"
			? "native_agents"
			: tmuxTeam === "required"
				? "tmux_team"
				: undefined;
	const fallbackOrder: NormalizedDelegationPolicy["fallback_order"] =
		requiredProvider === undefined
			? configuredOrder
			: [
					requiredProvider,
					...configuredOrder.filter(
						(provider) => provider !== requiredProvider,
					),
				];
	return {
		parallelism,
		max_agents: config?.max_agents ?? 4,
		native_agents: nativeAgents,
		tmux_team: tmuxTeam,
		fallback_order: fallbackOrder,
		unavailable,
		reassess_on: [...(config?.reassess_on ?? DEFAULT_REASSESS)],
		provider_exhaustion:
			parallelism === "required" ||
			unavailable === "fail_closed" ||
			requiredProvider !== undefined
				? "blocked_unavailable"
				: unavailable === "ask"
					? "ask"
					: "continue_solo",
	};
}

function mergeNormalized(
	lower: NormalizedWorkPolicy,
	higher: NormalizedWorkPolicy,
	configured: WorkPolicyConfig,
): NormalizedWorkPolicy {
	// A configured layer is a complete preset expansion. Resolution chooses its
	// section wholesale, preventing hidden inheritance from changing a preset.
	return {
		reconciliation: configured.reconciliation
			? higher.reconciliation
			: lower.reconciliation,
		review: configured.review ? higher.review : lower.review,
		delegation: configured.delegation ? higher.delegation : lower.delegation,
	};
}

function enforceMonotonicReview(
	highToLow: WorkPolicyLayer[],
	initiallyResolved: NormalizedReviewPolicy,
): NormalizedReviewPolicy {
	const result = clone(initiallyResolved);
	for (const gateName of ["planning", "completion"] as const) {
		let requiredByLower = false;
		let selected: NormalizedReviewGate | undefined;
		for (const layer of [...highToLow].reverse()) {
			if (!layer.config?.review) continue;
			const gate = normalizeReview(layer.config.review).gates.find(
				(item) => item.gate === gateName,
			)!;
			if (gate.enforcement === "required") requiredByLower = true;
		}
		for (const layer of highToLow) {
			const waiver =
				layer.kind === "current_instruction"
					? layer.waivers?.find((item) => item.gate === gateName)
					: undefined;
			if (requiredByLower && waiver) {
				validateWaiver(waiver);
				const inherited = result.gates.find((item) => item.gate === gateName)!;
				selected = {
					...inherited,
					enforcement: waiver.enforcement ?? "off",
					waived_by: clone(waiver),
				};
				requiredByLower = false;
				break;
			}
			if (!layer.config?.review) continue;
			const gate = normalizeReview(layer.config.review).gates.find(
				(item) => item.gate === gateName,
			)!;
			selected = gate;
			if (!requiredByLower || gate.enforcement === "required") break;
			selected = undefined;
		}
		const outputGate = result.gates.find((item) => item.gate === gateName)!;
		if (requiredByLower && (!selected || selected.enforcement !== "required")) {
			outputGate.enforcement = "required";
			outputGate.waived_by = null;
		} else if (selected) {
			Object.assign(outputGate, selected);
		}
	}
	return result;
}

function validateLayers(layers: readonly WorkPolicyLayer[]): void {
	const seen = new Set<WorkPolicyLayerKind>();
	for (const layer of layers) {
		workPolicyLayerSchema.parse(layer);
		if (seen.has(layer.kind))
			throw new Error(`duplicate work policy layer: ${layer.kind}`);
		seen.add(layer.kind);
	}
}

function validateWaiver(waiver: WorkPolicyGateWaiver): void {
	workPolicyGateWaiverSchema.parse(waiver);
}

function cloneSourceRef(sourceRef: WorkPolicySourceRef): WorkPolicySourceRef {
	return { source: sourceRef.source, ref: sourceRef.ref };
}

function policyBehavior(policy: ResolvedWorkPolicy): NormalizedWorkPolicy {
	return {
		reconciliation: policy.reconciliation,
		review: policy.review,
		delegation: policy.delegation,
	};
}

function canonicalJson(value: unknown): string {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "string"
	) {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw new Error("cannot canonicalize a non-finite number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => compareCodeUnits(left, right))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
			.join(",")}}`;
	}
	throw new Error(`cannot canonicalize ${typeof value}`);
}

function compareCodeUnits(left: string, right: string): number {
	const limit = Math.min(left.length, right.length);
	for (let index = 0; index < limit; index += 1) {
		const difference = left.charCodeAt(index) - right.charCodeAt(index);
		if (difference !== 0) return difference;
	}
	return left.length - right.length;
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object") {
		Object.freeze(value);
		Object.values(value as Record<string, unknown>).forEach(deepFreeze);
	}
	return value;
}
