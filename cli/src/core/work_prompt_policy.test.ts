import { describe, expect, it } from "vitest";

import {
	normalizeWorkPromptCapturePolicy,
	workPromptCaptureUserOptIn,
	workPromptCaptureConfigSchema,
} from "./work_prompt_policy.js";

describe("Work prompt capture policy", () => {
	it("defaults off without materializing capture and expands bounded defaults", () => {
		expect(normalizeWorkPromptCapturePolicy()).toEqual({
			preset: "off",
			enabled: false,
			ttl_ms: 86_400_000,
			max_entry_bytes: 262_144,
			max_total_bytes: 2_097_152,
			max_entries: 64,
		});
		expect(normalizeWorkPromptCapturePolicy({ preset: "bounded" })).toEqual({
			preset: "bounded",
			enabled: true,
			ttl_ms: 86_400_000,
			max_entry_bytes: 262_144,
			max_total_bytes: 2_097_152,
			max_entries: 64,
		});
	});

	it("normalizes explicit bounded values", () => {
		expect(
			normalizeWorkPromptCapturePolicy({
				preset: "bounded",
				ttl: "PT1H30M5S",
				max_entry_bytes: 1_024,
				max_total_bytes: 4_096,
				max_entries: 8,
			}),
		).toMatchObject({
			ttl_ms: 5_405_000,
			max_entry_bytes: 1_024,
			max_total_bytes: 4_096,
			max_entries: 8,
		});
	});

	it("requires an exact user-local environment opt-in", () => {
		expect(workPromptCaptureUserOptIn({})).toBe(false);
		expect(
			workPromptCaptureUserOptIn({ ANAMNESIS_WORK_PROMPT_CAPTURE: "true" }),
		).toBe(false);
		expect(
			workPromptCaptureUserOptIn({ ANAMNESIS_WORK_PROMPT_CAPTURE: "1" }),
		).toBe(true);
	});

	it("rejects unknown, unsafe, unbounded, and inconsistent values", () => {
		expect(() =>
			workPromptCaptureConfigSchema.parse({ preset: "off", ttl: "PT1H" }),
		).toThrow(/Unrecognized key/);
		expect(() =>
			workPromptCaptureConfigSchema.parse({
				preset: "bounded",
				ttl: "P1D",
			}),
		).toThrow();
		expect(() =>
			workPromptCaptureConfigSchema.parse({
				preset: "bounded",
				ttl: "PT721H",
			}),
		).toThrow(/30 days/);
		expect(() =>
			workPromptCaptureConfigSchema.parse({
				preset: "bounded",
				max_entry_bytes: 4_096,
				max_total_bytes: 1_024,
			}),
		).toThrow(/at least max_entry_bytes/);
		expect(() =>
			workPromptCaptureConfigSchema.parse({
				preset: "bounded",
				max_entries: 0,
			}),
		).toThrow();
	});
});
