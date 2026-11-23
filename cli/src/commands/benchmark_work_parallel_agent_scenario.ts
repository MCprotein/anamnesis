import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";
import { WorkDurability } from "../core/work_durability.js";
import { createScopedWorkStateRootResolver } from "../core/work_state_root_resolver.js";
import { briefWork, createWork, transitionWork } from "./work.js";
import { renderWorkExecutionPacket } from "./work_hook.js";
import type {
	ParallelRequirement,
	ParallelScenarioFamily,
	ParallelStage,
} from "./benchmark_work_parallel_agent_types.js";
import { digest } from "./benchmark_work_parallel_agent_util.js";

const PLAN_SCHEMA = strictObject(["child_a", "child_b"], {
	child_a: { type: "array", items: { type: "string" } },
	child_b: { type: "array", items: { type: "string" } },
});
const REQUIREMENTS_ARRAY_SCHEMA = {
	type: "array",
	items: strictObject(["id", "status", "summary"], {
		id: { type: "string" },
		status: { type: "string", enum: ["verified", "pending"] },
		summary: { type: "string" },
	}),
};
const REQUIREMENTS_SCHEMA = strictObject(["requirements"], {
	requirements: REQUIREMENTS_ARRAY_SCHEMA,
});
export const REVIEW_SCHEMA = strictObject(["requirements"], {
	requirements: REQUIREMENTS_ARRAY_SCHEMA,
});
const REVIEW_AUDIT_SCHEMA = strictObject(
	[
		"verdict",
		"missing_ids",
		"duplicate_ids",
		"unexpected_ids",
		"misassigned_ids",
		"status_mismatch_ids",
		"summary_mismatch_ids",
		"malformed_rows",
		"order_ok",
	],
	{
		verdict: { type: "string", enum: ["accept", "repair"] },
		missing_ids: { type: "array", items: { type: "string" } },
		duplicate_ids: { type: "array", items: { type: "string" } },
		unexpected_ids: { type: "array", items: { type: "string" } },
		misassigned_ids: { type: "array", items: { type: "string" } },
		status_mismatch_ids: { type: "array", items: { type: "string" } },
		summary_mismatch_ids: { type: "array", items: { type: "string" } },
		malformed_rows: { type: "integer" },
		order_ok: { type: "boolean" },
	},
);

export function materializeWorkContext(
	projectRoot: string,
	requirements: ParallelRequirement[],
): { context: string; factHash: string; childPackets: string[] } {
	fs.writeFileSync(
		path.join(projectRoot, "Agentfile"),
		YAML.stringify({
			version: 2,
			project: { name: "sanitized-parallel-benchmark" },
			tools: ["codex"],
			fragments: [],
			settings: {
				work_policy: {
					reconciliation: { preset: "adaptive" },
					review: { preset: "advisory" },
					delegation: { parallelism: "auto" },
				},
			},
		}),
	);
	const stateRootResolver = createScopedWorkStateRootResolver();
	let mutation = createWork({
		project_root: projectRoot,
		durability: WorkDurability.ephemeral,
		state_root_resolver: stateRootResolver,
		work_id: "wu_parallel_sanitized",
		event_id: "evt_parallel_create",
		occurred_at: "2026-08-20T00:00:00.000Z",
		expected_head: null,
		draft: Buffer.from(
			YAML.stringify({
				work: {
					title: "Sanitized parallel benchmark",
					completion_contract:
						"Recover every authoritative requirement exactly.",
				},
				boundary: {
					state: "accepted",
					classification: "new_unit",
					reason_codes: ["same_deliverable"],
					confidence: "high",
				},
				requirements: requirements.map((requirement) => ({
					id: requirement.id,
					summary: requirement.summary,
					source_event_ids: ["src_parallel"],
				})),
				open_conflicts: [],
			}),
		),
		source_stdin: {
			event_id: "src_parallel",
			captured_at: "2026-08-20T00:00:00.000Z",
			client: "codex",
			content_type: "text/plain; charset=utf-8",
			fidelity: "native_exact",
			allocation_status: "allocated",
			body: Buffer.from("sanitized parallel benchmark requirements"),
		},
	});
	for (const [index, requirement] of requirements.entries()) {
		if (requirement.status !== "verified") continue;
		mutation = transitionWork({
			project_root: projectRoot,
			durability: WorkDurability.ephemeral,
			state_root_resolver: stateRootResolver,
			work_id: "wu_parallel_sanitized",
			event_id: `evt_parallel_verify_${index}`,
			occurred_at: new Date(
				Date.parse("2026-08-20T00:00:00.000Z") + (index + 1) * 1_000,
			).toISOString(),
			expected_head: mutation.projection.ledger_head,
			draft: Buffer.from(
				YAML.stringify({
					requirement_id: requirement.id,
					status: "verified",
					evidence_refs: [`benchmark:${requirement.id}`],
				}),
			),
		});
	}
	const brief = briefWork({
		project_root: projectRoot,
		durability: WorkDurability.ephemeral,
		state_root_resolver: stateRootResolver,
		work_id: "wu_parallel_sanitized",
		cursor_id: "parallel-benchmark",
		client_session_ref: "sanitized-session",
		occurred_at: "2026-08-20T01:00:00.000Z",
	});
	const briefingFacts = brief.briefing.requirements.map((requirement) => ({
		id: requirement.id,
		status: requirement.status,
		summary: requirement.summary,
	}));
	return {
		context: `# Anamnesis Work context\n\n${renderWorkExecutionPacket(
			brief.briefing,
			{ max_bytes: 50_000 },
		)}\n`,
		childPackets: [
			renderWorkExecutionPacket(brief.briefing, {
				requirement_ids: requirements
					.slice(0, Math.ceil(requirements.length / 2))
					.map((requirement) => requirement.id),
				max_bytes: 50_000,
			}),
			renderWorkExecutionPacket(brief.briefing, {
				requirement_ids: requirements
					.slice(Math.ceil(requirements.length / 2))
					.map((requirement) => requirement.id),
				max_bytes: 50_000,
			}),
		],
		factHash: digest(briefingFacts),
	};
}

export function renderCompactReviewPacket(
	childA: unknown,
	childB: unknown,
): string {
	const encode = (value: unknown): unknown[] => {
		if (!Array.isArray(value)) return [["$malformed"]];
		return value.map((row) => {
			if (!row || typeof row !== "object" || Array.isArray(row)) {
				return ["$malformed"];
			}
			const record = row as Record<string, unknown>;
			return [record.id ?? null, record.status ?? null, record.summary ?? null];
		});
	};
	return JSON.stringify({ child_a: encode(childA), child_b: encode(childB) });
}

export function measureInputBytes(
	prompt: string,
	inputPaths: string[],
): { bytes: number; complete: boolean } {
	let bytes = Buffer.byteLength(prompt, "utf8");
	for (const file of inputPaths) {
		try {
			bytes += fs.statSync(file).size;
		} catch {
			return { bytes, complete: false };
		}
	}
	return { bytes, complete: true };
}

export function readInlineInput(file: string): {
	content: string;
	complete: boolean;
} {
	try {
		return { content: fs.readFileSync(file, "utf8"), complete: true };
	} catch {
		return { content: "", complete: false };
	}
}

export function renderInlinePayload(content: string): string {
	return `<authoritative-payload bytes="${Buffer.byteLength(content, "utf8")}">\n${content}\n</authoritative-payload>`;
}

export function parseInlinePayload(prompt: string): string | undefined {
	const opening = prompt.match(/<authoritative-payload bytes="([0-9]+)">\n/u);
	if (!opening || opening.index === undefined) return undefined;
	const contentStart = opening.index + opening[0].length;
	const closing = "\n</authoritative-payload>";
	const contentEnd = prompt.indexOf(closing, contentStart);
	if (
		contentEnd < 0 ||
		prompt.indexOf(closing, contentEnd + closing.length) >= 0
	) {
		return undefined;
	}
	const content = prompt.slice(contentStart, contentEnd);
	const declaredBytes = Number(opening[1]);
	return Number.isSafeInteger(declaredBytes) &&
		Buffer.byteLength(content, "utf8") === declaredBytes
		? content
		: undefined;
}

export function renderNamedInlinePayload(
	name: string,
	content: string,
): string {
	return `<${name} bytes="${Buffer.byteLength(content, "utf8")}">\n${content}\n</${name}>`;
}

export function parseNamedInlinePayload(
	prompt: string,
	name: string,
): string | undefined {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const opening = new RegExp(`<${escapedName} bytes="([0-9]+)">\\n`, "u").exec(
		prompt,
	);
	if (!opening) return undefined;
	if (opening.index === undefined) return undefined;
	const contentStart = opening.index + opening[0].length;
	const declaredBytes = Number(opening[1]);
	if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0)
		return undefined;
	const remainder = Buffer.from(prompt.slice(contentStart), "utf8");
	if (declaredBytes > remainder.length) return undefined;
	const content = remainder.subarray(0, declaredBytes).toString("utf8");
	if (Buffer.byteLength(content, "utf8") !== declaredBytes) return undefined;
	const closing = Buffer.from(`\n</${name}>`, "utf8");
	const suffix = remainder.subarray(
		declaredBytes,
		declaredBytes + closing.length,
	);
	return suffix.equals(closing) ? content : undefined;
}

function renderLegacyContext(requirements: ParallelRequirement[]): string {
	return `# Legacy parallel handoff\n\nAuthoritative completeness: all current requirements follow.\n${requirements
		.map(
			(requirement) =>
				`Requirement ${requirement.id}: ${requirement.summary}. Current status: ${requirement.status}.`,
		)
		.join("\n")}\n`;
}

export function defaultRequirements(): ParallelRequirement[] {
	return Array.from({ length: 24 }, (_, index) => ({
		id: `REQ-${String(index + 1).padStart(3, "0")}`,
		status: index < 18 ? ("verified" as const) : ("pending" as const),
		summary: `sanitized parallel acceptance condition ${String(index + 1).padStart(3, "0")}`,
	}));
}

interface ParallelScenarioFixture {
	requirements: ParallelRequirement[];
	legacyContext: string;
}

export function buildScenarioFixture(
	base: ParallelRequirement[],
	family: ParallelScenarioFamily,
	iteration = 1,
): ParallelScenarioFixture {
	const variant = iteration > 0 ? ` (fixture variant ${iteration})` : "";
	if (family === "clean-partition") {
		const requirements = base.map((requirement, index) => ({
			...requirement,
			summary: `${requirement.summary}${variant}${iteration > 0 ? ` (lane ${index % 3})` : ""}`,
		}));
		return { requirements, legacyContext: renderLegacyContext(requirements) };
	}
	const count = family === "stale-cross-session-conflict" ? 32 : 48;
	const requirements = Array.from({ length: count }, (_, index) => ({
		id: `REQ-${String(index + 1).padStart(3, "0")}`,
		status:
			(index + iteration) % 5 === 0
				? ("pending" as const)
				: ("verified" as const),
		summary:
			family === "stale-cross-session-conflict"
				? `current cross-session requirement ${index + 1}${variant}${iteration > 0 ? ` (delta ${index % 4})` : ""}`
				: `review recovery ${index % 4 === 0 ? "blocked dependency" : "required gate"} ${index + 1}${variant}${iteration > 0 ? ` (gate ${index % 5})` : ""}`,
	}));
	if (family === "review-gate-recovery") {
		return { requirements, legacyContext: renderLegacyContext(requirements) };
	}
	const removed = ["REQ-REMOVED-01", "REQ-REMOVED-02"];
	const firstSession = requirements
		.map(
			(requirement, index) =>
				`Requirement ${requirement.id}: ${index < 4 ? `superseded draft ${index + 1}` : requirement.summary}. Current status: ${index < 8 ? "pending" : requirement.status}.`,
		)
		.concat(
			removed.map(
				(id) =>
					`Requirement ${id}: obsolete requirement. Current status: pending.`,
			),
		);
	const secondSession = requirements
		.slice(0, 8)
		.map(
			(requirement, index) =>
				`Update ${requirement.id}: status ${requirement.status}; summary ${index < 4 ? JSON.stringify(requirement.summary) : "unchanged"}.`,
		);
	const legacyContext = `# Legacy chronological handoffs\n\nSession 1 (older):\n${firstSession.join("\n")}\n\nSession 2 (newer updates):\n${secondSession.join("\n")}\nRemoved after session 2: ${removed.join(", ")}\n\nReconstruct the current projection from the chronological deltas above; no final projection is provided.`;
	return { requirements, legacyContext };
}

export function writeSchemas(tempRoot: string): Record<ParallelStage, string> {
	const schemaByStage: Record<ParallelStage, unknown> = {
		"leader-plan": PLAN_SCHEMA,
		"child-a": REQUIREMENTS_SCHEMA,
		"child-b": REQUIREMENTS_SCHEMA,
		reviewer: REVIEW_SCHEMA,
		"review-audit": REVIEW_AUDIT_SCHEMA,
		"leader-integrate": REQUIREMENTS_SCHEMA,
	};
	return Object.fromEntries(
		Object.entries(schemaByStage).map(([stage, schema]) => {
			const schemaPath = path.join(tempRoot, `${stage}.schema.json`);
			fs.writeFileSync(schemaPath, `${JSON.stringify(schema)}\n`);
			return [stage, schemaPath];
		}),
	) as Record<ParallelStage, string>;
}

function strictObject(
	required: string[],
	properties: Record<string, unknown>,
): Record<string, unknown> {
	return {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		type: "object",
		required,
		properties,
		additionalProperties: false,
	};
}

export function requirementsFromContext(
	cwd: string,
	filename = "CONTEXT.md",
): ParallelRequirement[] {
	let context: string;
	try {
		context = fs.readFileSync(path.join(cwd, filename), "utf8");
	} catch {
		return [];
	}
	return requirementsFromText(context);
}

export function requirementsFromText(context: string): ParallelRequirement[] {
	const jsonStart = context.indexOf("{");
	if (jsonStart >= 0) {
		try {
			const packet = JSON.parse(context.slice(jsonStart)) as {
				requirements?: unknown;
			};
			if (Array.isArray(packet.requirements)) {
				return packet.requirements.flatMap((value) => {
					if (typeof value !== "string") return [];
					const match = value.match(/^([^|]+)\|([^|]+)\|(.*)$/u);
					if (!match) return [];
					return [
						{
							id: match[1]!,
							status: match[2] as ParallelRequirement["status"],
							summary: JSON.parse(match[3]!) as string,
						},
					];
				});
			}
		} catch {
			// Fall through to the legacy parser.
		}
	}
	const marker = "# Legacy parallel handoff";
	const chronologicalMarker = "# Legacy chronological handoffs";
	if (context.includes(chronologicalMarker)) {
		const body = context.slice(context.indexOf(chronologicalMarker));
		const current = [
			...body.matchAll(
				/^Requirement ([^:]+): (.*)\. Current status: (verified|pending)\.$/gmu,
			),
		].map((match) => ({
			id: match[1]!,
			summary: match[2]!,
			status: match[3]! as ParallelRequirement["status"],
		}));
		for (const update of body.matchAll(
			/^Update ([^:]+): status (verified|pending); summary (.*)\.$/gmu,
		)) {
			const target = current.find(
				(requirement) => requirement.id === update[1],
			);
			if (target) {
				target.status = update[2] as ParallelRequirement["status"];
				const summary = update[3]!;
				target.summary = summary.startsWith('"')
					? (JSON.parse(summary) as string)
					: target.summary;
			}
		}
		const removed =
			body.match(/Removed after session 2: (.+)$/mu)?.[1]?.split(", ") ?? [];
		return current.filter((requirement) => !removed.includes(requirement.id));
	}
	const current = context.slice(Math.max(0, context.lastIndexOf(marker)));
	return [
		...current.matchAll(
			/^Requirement ([^:]+): (.*)\. Current status: (verified|pending)\.$/gmu,
		),
	].map((match) => ({
		id: match[1]!,
		summary: match[2]!,
		status: match[3]! as ParallelRequirement["status"],
	}));
}

function readWorkExecutionPacket(
	cwd: string,
	filename: string,
): Record<string, unknown> | undefined {
	let context: string;
	try {
		context = fs.readFileSync(path.join(cwd, filename), "utf8");
	} catch {
		return undefined;
	}
	const jsonStart = context.indexOf("{");
	if (jsonStart < 0) return undefined;
	try {
		const parsed = JSON.parse(context.slice(jsonStart)) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

export function workPacketSubsetExact(
	cwd: string,
	filename: string,
	expected: ParallelRequirement[],
	expectedFull: ParallelRequirement[],
): boolean {
	const full = readWorkExecutionPacket(cwd, "CONTEXT.md");
	const subset = readWorkExecutionPacket(cwd, filename);
	if (!full || !subset) return false;
	const sameMetadata = [
		"schema_version",
		"work_id",
		"contract_revision",
		"contract",
		"blocker_ids",
		"required_gates",
	].every(
		(key) =>
			Object.hasOwn(full, key) &&
			Object.hasOwn(subset, key) &&
			digest(full[key]) === digest(subset[key]),
	);
	return (
		sameMetadata &&
		full.authoritative_completeness === true &&
		digest(requirementsFromContext(cwd, "CONTEXT.md")) ===
			digest(expectedFull) &&
		subset.authoritative_completeness === false &&
		digest(requirementsFromContext(cwd, filename)) === digest(expected)
	);
}
