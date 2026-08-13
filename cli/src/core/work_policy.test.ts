import { describe, expect, it } from "vitest";
import { sha256 } from "../util/hash.js";

import {
	compareWorkPolicySnapshots,
	createWorkPolicySnapshot,
	normalizeWorkPolicyConfig,
	resolveWorkPolicy,
	type WorkPolicyLayer,
	workPolicyConfigSchema,
	validateWorkPolicySnapshot,
} from "./work_policy.js";

const source = (name: string) => ({ source: name, ref: `${name}#policy` });

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === "boolean" || typeof value === "string")
		return JSON.stringify(value);
	if (typeof value === "number") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => {
			const limit = Math.min(left.length, right.length);
			for (let index = 0; index < limit; index += 1) {
				const difference = left.charCodeAt(index) - right.charCodeAt(index);
				if (difference !== 0) return difference;
			}
			return left.length - right.length;
		})
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
		.join(",")}}`;
}

function rehash<T extends { policy: unknown; policy_hash: string }>(
	snapshot: T,
): T {
	snapshot.policy_hash = sha256(canonicalJson(snapshot.policy));
	return snapshot;
}

describe("work policy schema and normalization", () => {
	it("defaults every behavior off and expands frequent/advisory presets deterministically", () => {
		const defaults = normalizeWorkPolicyConfig();
		expect(defaults.reconciliation.preset).toBe("off");
		expect(defaults.review.gates.map((gate) => gate.enforcement)).toEqual([
			"off",
			"off",
		]);
		expect(defaults.delegation.parallelism).toBe("off");

		const expanded = normalizeWorkPolicyConfig({
			reconciliation: { preset: "frequent" },
			review: { preset: "advisory" },
		});
		expect(expanded.reconciliation.due_after).toEqual({
			max_silence: "PT5M",
			meaningful_actions: 5,
		});
		expect(expanded.reconciliation.triggers).toEqual([
			"work_resume",
			"contract_revision",
			"compaction_resume",
			"meaningful_milestone",
			"before_work_close",
		]);
		expect(expanded.review.gates).toMatchObject([
			{
				gate: "planning",
				enforcement: "advisory",
				capability: "independent_agent",
				role_hint: "critic",
			},
			{
				gate: "completion",
				enforcement: "advisory",
				capability: "independent_agent",
				role_hint: "code-reviewer",
			},
		]);
	});

	it("rejects unknown keys, duplicate semantic entries, unsafe counts, and invalid provider contracts", () => {
		expect(() =>
			workPolicyConfigSchema.parse({ review: { preset: "off", extra: true } }),
		).toThrow();
		expect(() =>
			workPolicyConfigSchema.parse({
				review: {
					preset: "custom",
					gates: [
						{ gate: "planning", enforcement: "advisory" },
						{ gate: "planning", enforcement: "required" },
					],
				},
			}),
		).toThrow(/duplicate review gate/);
		expect(() =>
			workPolicyConfigSchema.parse({
				review: { preset: "strict", provider_order: ["omx", "omx"] },
			}),
		).toThrow(/duplicate value/);
		expect(() =>
			workPolicyConfigSchema.parse({
				reconciliation: {
					preset: "custom",
					compact_target_tokens: Number.MAX_SAFE_INTEGER + 1,
				},
			}),
		).toThrow();
		expect(() =>
			workPolicyConfigSchema.parse({
				delegation: {
					parallelism: "required",
					native_agents: "required",
					tmux_team: "required",
				},
			}),
		).toThrow(/cannot both be required/);
		expect(() =>
			workPolicyConfigSchema.parse({
				review: { preset: "strict", provider_order: ["claude_native"] },
			}),
		).toThrow();
	});

	it("normalizes every required review gate to fail closed", () => {
		const strict = normalizeWorkPolicyConfig({
			review: { preset: "strict", unavailable: "continue" },
		});
		expect(strict.review.unavailable).toBe("fail_closed");
		expect(strict.review.gates.map((gate) => gate.unavailable)).toEqual([
			"fail_closed",
			"fail_closed",
		]);

		const custom = normalizeWorkPolicyConfig({
			review: {
				preset: "custom",
				unavailable: "continue",
				gates: [
					{
						gate: "planning",
						enforcement: "required",
						unavailable: "continue",
					},
					{
						gate: "completion",
						enforcement: "advisory",
						unavailable: "continue",
					},
				],
			},
		});
		expect(custom.review.unavailable).toBe("fail_closed");
		expect(custom.review.gates).toMatchObject([
			{
				gate: "planning",
				enforcement: "required",
				unavailable: "fail_closed",
			},
			{
				gate: "completion",
				enforcement: "advisory",
				unavailable: "continue",
			},
		]);
	});
});

describe("work policy resolution", () => {
	it("uses fixed six-layer precedence independently for configured sections", () => {
		const resolved = resolveWorkPolicy([
			{
				kind: "project",
				config: {
					reconciliation: { preset: "frequent" },
					delegation: { parallelism: "auto" },
				},
				source_refs: [source("project")],
			},
			{
				kind: "per_work",
				config: { delegation: { parallelism: "prefer", max_agents: 2 } },
				source_refs: [source("work")],
			},
			{
				kind: "user",
				config: { review: { preset: "advisory" } },
				source_refs: [source("user")],
			},
		]);

		expect(resolved.reconciliation.preset).toBe("frequent");
		expect(resolved.delegation).toMatchObject({
			parallelism: "prefer",
			max_agents: 2,
		});
		expect(resolved.review.preset).toBe("advisory");
		expect(resolved.source_refs).toEqual([
			source("work"),
			source("project"),
			source("user"),
		]);
		expect(resolved.contributing_layers).toEqual([
			"per_work",
			"project",
			"user",
		]);
	});

	it("keeps required gates monotonic unless a current evidenced gate-scoped waiver lowers one", () => {
		const project: WorkPolicyLayer = {
			kind: "project",
			config: { review: { preset: "strict" } },
			source_refs: [source("project")],
		};
		const withoutWaiver = resolveWorkPolicy([
			{
				kind: "per_work",
				config: { review: { preset: "off" } },
				source_refs: [source("work")],
			},
			project,
		]);
		expect(withoutWaiver.review.gates.map((gate) => gate.enforcement)).toEqual([
			"required",
			"required",
		]);

		const withWaiver = resolveWorkPolicy([
			{
				kind: "current_instruction",
				config: {
					review: {
						preset: "custom",
						gates: [{ gate: "planning", enforcement: "off" }],
					},
				},
				source_refs: [source("instruction")],
				waivers: [
					{
						gate: "planning",
						enforcement: "off",
						source: "user_event",
						ref: "evt_01#bytes=0-20",
						reason: "user explicitly waived planning review for revision 7",
						revision: 7,
					},
				],
			},
			project,
		]);
		expect(withWaiver.review.gates).toMatchObject([
			{ gate: "planning", enforcement: "off", waived_by: { revision: 7 } },
			{ gate: "completion", enforcement: "required", waived_by: null },
		]);
	});

	it("applies a waiver-only current instruction to its named gate", () => {
		const resolved = resolveWorkPolicy([
			{
				kind: "current_instruction",
				source_refs: [source("instruction")],
				waivers: [
					{
						gate: "planning",
						source: "user_event",
						ref: "evt_02#bytes=0-12",
						reason: "explicit planning-only waiver",
						revision: 8,
					},
				],
			},
			{
				kind: "project",
				config: { review: { preset: "strict" } },
				source_refs: [source("project")],
			},
		]);

		expect(resolved.review.gates).toMatchObject([
			{ gate: "planning", enforcement: "off", waived_by: { revision: 8 } },
			{ gate: "completion", enforcement: "required", waived_by: null },
		]);
	});

	it("strictly rejects bogus waiver gates and required waiver targets at runtime", () => {
		const baseLayer = {
			kind: "current_instruction",
			source_refs: [source("instruction")],
		};
		expect(() =>
			resolveWorkPolicy([
				{
					...baseLayer,
					waivers: [
						{
							gate: "deployment",
							source: "user_event",
							ref: "evt_bad",
							reason: "invalid target",
							revision: 1,
						},
					],
				} as never,
			]),
		).toThrow();
		expect(() =>
			resolveWorkPolicy([
				{
					...baseLayer,
					waivers: [
						{
							gate: "planning",
							enforcement: "required",
							source: "user_event",
							ref: "evt_bad",
							reason: "contradictory waiver",
							revision: 1,
						},
					],
				} as never,
			]),
		).toThrow();
	});

	it("rejects whitespace-only provenance and waiver reasons", () => {
		expect(() =>
			resolveWorkPolicy([
				{
					kind: "project",
					config: { review: { preset: "advisory" } },
					source_refs: [{ source: " \t", ref: "project#policy" }],
				},
			]),
		).toThrow(/non-whitespace/);
		expect(() =>
			resolveWorkPolicy([
				{
					kind: "project",
					config: { review: { preset: "advisory" } },
					source_refs: [{ source: "Agentfile", ref: "\n " }],
				},
			]),
		).toThrow(/non-whitespace/);
		expect(() =>
			resolveWorkPolicy([
				{
					kind: "current_instruction",
					source_refs: [source("instruction")],
					waivers: [
						{
							gate: "planning",
							source: "user_event",
							ref: "evt_04",
							reason: "   ",
							revision: 1,
						},
					],
				},
			]),
		).toThrow(/non-whitespace/);
	});

	it("fails closed after required delegation provider exhaustion", () => {
		const normalized = normalizeWorkPolicyConfig({
			delegation: {
				parallelism: "required",
				native_agents: "required",
				tmux_team: "prefer",
				fallback_order: ["tmux_team", "native_agents"],
				unavailable: "fallback",
			},
		});
		expect(normalized.delegation.provider_exhaustion).toBe(
			"blocked_unavailable",
		);
		expect(normalized.delegation.fallback_order).toEqual([
			"native_agents",
			"tmux_team",
		]);
	});
});

describe("work policy snapshots", () => {
	it("rejects hash-valid snapshots that violate normalized runtime invariants", () => {
		const baseline = createWorkPolicySnapshot(1, resolveWorkPolicy([]));
		const malformed = (mutate: (snapshot: typeof baseline) => void) => {
			const snapshot = structuredClone(baseline);
			mutate(snapshot);
			return rehash(snapshot);
		};

		const invalidSnapshots = [
			malformed((snapshot) => {
				snapshot.policy.review.gates = [];
			}),
			malformed((snapshot) => {
				snapshot.policy.review.gates.push(
					structuredClone(snapshot.policy.review.gates[0]!),
				);
			}),
			malformed((snapshot) => {
				snapshot.policy.review.preset = "strict";
			}),
			malformed((snapshot) => {
				snapshot.policy.reconciliation.due_after.max_silence = "nonsense";
			}),
			malformed((snapshot) => {
				snapshot.policy.delegation.parallelism = "required";
				snapshot.policy.delegation.provider_exhaustion = "continue_solo";
			}),
			malformed((snapshot) => {
				snapshot.policy.delegation.native_agents = "required";
				snapshot.policy.delegation.tmux_team = "required";
				snapshot.policy.delegation.provider_exhaustion = "blocked_unavailable";
			}),
			malformed((snapshot) => {
				snapshot.policy.delegation.native_agents = "required";
				snapshot.policy.delegation.provider_exhaustion = "blocked_unavailable";
				snapshot.policy.delegation.fallback_order = [
					"tmux_team",
					"native_agents",
				];
			}),
		];

		for (const snapshot of invalidSnapshots) {
			expect(() => validateWorkPolicySnapshot(snapshot)).toThrow();
		}
	});

	it("accepts normalized monotonic review gates and evidenced strict waivers", () => {
		const monotonic = createWorkPolicySnapshot(
			1,
			resolveWorkPolicy([
				{
					kind: "per_work",
					config: { review: { preset: "advisory" } },
					source_refs: [source("work")],
				},
				{
					kind: "project",
					config: { review: { preset: "strict" } },
					source_refs: [source("project")],
				},
			]),
		);
		expect(validateWorkPolicySnapshot(monotonic)).toEqual(monotonic);

		const waived = createWorkPolicySnapshot(
			1,
			resolveWorkPolicy([
				{
					kind: "current_instruction",
					source_refs: [source("instruction")],
					waivers: [
						{
							gate: "planning",
							source: "user_event",
							ref: "evt_waiver",
							reason: "explicit waiver",
							revision: 1,
						},
					],
				},
				{
					kind: "project",
					config: { review: { preset: "strict" } },
					source_refs: [source("project")],
				},
			]),
		);
		expect(validateWorkPolicySnapshot(waived)).toEqual(waived);
	});

	it("rejects a waiver attached to a different gate and non-fail-closed required gate", () => {
		const baseline = createWorkPolicySnapshot(1, resolveWorkPolicy([]));
		const mismatched = structuredClone(baseline);
		mismatched.policy.review.gates[0]!.waived_by = {
			gate: "completion", source: "user_event", ref: "evt", reason: "x", revision: 1,
		};
		expect(() => validateWorkPolicySnapshot(rehash(mismatched))).toThrow(/identity/);
		const required = structuredClone(baseline);
		required.policy.review.gates[0]!.enforcement = "required";
		required.policy.review.gates[0]!.unavailable = "fallback";
		expect(() => validateWorkPolicySnapshot(rehash(required))).toThrow(/fail closed/);
	});

	it("hashes policy plus ordered provenance with fixed canonicalization and freezes the revision", () => {
		const firstPolicy = resolveWorkPolicy([
			{
				kind: "project",
				config: { delegation: { parallelism: "auto" } },
				source_refs: [source("a"), source("b")],
			},
		]);
		const first = createWorkPolicySnapshot(3, firstPolicy);
		const same = createWorkPolicySnapshot({ revision: 3, policy: firstPolicy });
		expect(first.policy_hash).toBe(same.policy_hash);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.policy.source_refs)).toBe(true);

		const reordered = createWorkPolicySnapshot(
			3,
			resolveWorkPolicy([
				{
					kind: "project",
					config: { delegation: { parallelism: "auto" } },
					source_refs: [source("b"), source("a")],
				},
			]),
		);
		expect(reordered.policy_hash).not.toBe(first.policy_hash);
		expect(compareWorkPolicySnapshots(first, reordered)).toMatchObject({
			drifted: true,
			policy_changed: false,
			provenance_changed: true,
			revision_changed: false,
		});
	});

	it("does not report policy drift for a revision-only change", () => {
		const policy = resolveWorkPolicy([]);
		const revisionOne = createWorkPolicySnapshot(1, policy);
		const revisionTwo = createWorkPolicySnapshot(2, policy);
		expect(revisionOne.policy_hash).toBe(revisionTwo.policy_hash);
		expect(compareWorkPolicySnapshots(revisionOne, revisionTwo)).toEqual({
			drifted: false,
			policy_changed: false,
			provenance_changed: false,
			revision_changed: true,
			from_revision: 1,
			to_revision: 2,
		});
	});

	it("rejects a stale applied waiver when freezing a later revision", () => {
		const policy = resolveWorkPolicy([
			{
				kind: "current_instruction",
				source_refs: [source("instruction")],
				waivers: [
					{
						gate: "planning",
						source: "user_event",
						ref: "evt_03",
						reason: "revision one waiver",
						revision: 1,
					},
				],
			},
			{
				kind: "project",
				config: { review: { preset: "strict" } },
				source_refs: [source("project")],
			},
		]);

		expect(() => createWorkPolicySnapshot(2, policy)).toThrow(
			/waiver revision 1 does not match snapshot revision 2/,
		);
		expect(createWorkPolicySnapshot(1, policy).revision).toBe(1);
	});
});
