import { z } from "zod";

const MAX_PROMPT_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_PROMPT_ENTRIES = 1_024;
const MAX_PROMPT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const positiveSafeInteger = z
	.number()
	.int()
	.positive()
	.max(Number.MAX_SAFE_INTEGER);

const supportedIsoDuration = z
	.string()
	.regex(/^PT(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?$/)
	.refine(
		(value) => parsePromptCaptureDuration(value) <= MAX_PROMPT_TTL_MS,
		"prompt capture ttl exceeds 30 days",
	);

const offPromptCaptureSchema = z.object({ preset: z.literal("off") }).strict();

const boundedPromptCaptureSchema = z
	.object({
		preset: z.literal("bounded"),
		ttl: supportedIsoDuration.optional(),
		max_entry_bytes: positiveSafeInteger.max(MAX_PROMPT_ENTRY_BYTES).optional(),
		max_total_bytes: positiveSafeInteger.max(MAX_PROMPT_TOTAL_BYTES).optional(),
		max_entries: positiveSafeInteger.max(MAX_PROMPT_ENTRIES).optional(),
	})
	.strict()
	.superRefine((value, context) => {
		const entry =
			value.max_entry_bytes ?? WORK_PROMPT_CAPTURE_DEFAULTS.max_entry_bytes;
		const total =
			value.max_total_bytes ?? WORK_PROMPT_CAPTURE_DEFAULTS.max_total_bytes;
		if (total < entry) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "max_total_bytes must be at least max_entry_bytes",
				path: ["max_total_bytes"],
			});
		}
	});

export const workPromptCaptureConfigSchema = z.discriminatedUnion("preset", [
	offPromptCaptureSchema,
	boundedPromptCaptureSchema,
]);

export type WorkPromptCaptureConfig = z.infer<
	typeof workPromptCaptureConfigSchema
>;

export interface NormalizedWorkPromptCapturePolicy {
	preset: "off" | "bounded";
	enabled: boolean;
	ttl_ms: number;
	max_entry_bytes: number;
	max_total_bytes: number;
	max_entries: number;
}

export const WORK_PROMPT_CAPTURE_DEFAULTS = {
	ttl: "PT24H",
	ttl_ms: 24 * 60 * 60 * 1_000,
	max_entry_bytes: 256 * 1024,
	max_total_bytes: 2 * 1024 * 1024,
	max_entries: 64,
} as const;

export function normalizeWorkPromptCapturePolicy(
	config?: WorkPromptCaptureConfig,
): NormalizedWorkPromptCapturePolicy {
	const parsed = config
		? workPromptCaptureConfigSchema.parse(config)
		: ({ preset: "off" } as const);
	if (parsed.preset === "off") {
		return {
			preset: "off",
			enabled: false,
			ttl_ms: WORK_PROMPT_CAPTURE_DEFAULTS.ttl_ms,
			max_entry_bytes: WORK_PROMPT_CAPTURE_DEFAULTS.max_entry_bytes,
			max_total_bytes: WORK_PROMPT_CAPTURE_DEFAULTS.max_total_bytes,
			max_entries: WORK_PROMPT_CAPTURE_DEFAULTS.max_entries,
		};
	}
	return {
		preset: "bounded",
		enabled: true,
		ttl_ms: parsePromptCaptureDuration(
			parsed.ttl ?? WORK_PROMPT_CAPTURE_DEFAULTS.ttl,
		),
		max_entry_bytes:
			parsed.max_entry_bytes ?? WORK_PROMPT_CAPTURE_DEFAULTS.max_entry_bytes,
		max_total_bytes:
			parsed.max_total_bytes ?? WORK_PROMPT_CAPTURE_DEFAULTS.max_total_bytes,
		max_entries: parsed.max_entries ?? WORK_PROMPT_CAPTURE_DEFAULTS.max_entries,
	};
}

function parsePromptCaptureDuration(value: string): number {
	const match = /^PT(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
	if (!match) throw new Error(`unsupported prompt capture duration: ${value}`);
	const hours = Number(match[1] ?? 0);
	const minutes = Number(match[2] ?? 0);
	const seconds = Number(match[3] ?? 0);
	const milliseconds = ((hours * 60 + minutes) * 60 + seconds) * 1_000;
	if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
		throw new Error(`invalid prompt capture duration: ${value}`);
	}
	return milliseconds;
}
