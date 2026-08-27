import { describe, expect, it } from "vitest";

import {
	parseStagedWorkContractDraft,
	parseWorkCloseDraft,
	parseWorkContractDraft,
	parseWorkPromptRetainDraft,
	parseWorkTransitionDraft,
} from "./work_command_draft.js";

describe("Work command drafts", () => {
	it("rejects multiple documents, malformed YAML, and computed fields", () => {
		expect(() =>
			parseWorkContractDraft(Buffer.from("work: {}\n---\nwork: {}\n")),
		).toThrow("exactly one YAML document");
		expect(() => parseWorkContractDraft(Buffer.from("work: [\n"))).toThrow(
			"invalid Work draft YAML",
		);
		expect(() =>
			parseWorkTransitionDraft(
				Buffer.from(
					"requirement_id: req_a\nstatus: pending\nevidence_refs: []\nbasis_contract_hash: forged\n",
				),
			),
		).toThrow();
	});

	it("rejects invalid UTF-8 instead of replacement decoding", () => {
		expect(() => parseWorkContractDraft(Buffer.from([0xff]))).toThrow(
			"valid UTF-8",
		);
	});

	it("parses a strict completed Work close draft", () => {
		expect(
			parseWorkCloseDraft(
				Buffer.from(`
lifecycle: completed
authority:
  kind: explicit_user_acceptance
  source_event_id: src_user_acceptance
  authority_ref: user-message:close-work
evidence_refs: [test:all-pass, git:abc123]
`),
			),
		).toEqual({
			lifecycle: "completed",
			authority: {
				kind: "explicit_user_acceptance",
				source_event_id: "src_user_acceptance",
				authority_ref: "user-message:close-work",
			},
			evidence_refs: ["test:all-pass", "git:abc123"],
		});
	});

	it("rejects incomplete, duplicate, computed, and unsupported close fields", () => {
		const valid = `
lifecycle: completed
authority:
  kind: delegated_objective_completion
  source_event_id: src_completion
  authority_ref: objective:release
evidence_refs: [test:all-pass]
`;
		expect(() =>
			parseWorkCloseDraft(Buffer.from(valid.replace("completed", "open"))),
		).toThrow();
		expect(() =>
			parseWorkCloseDraft(Buffer.from(valid.replace("[test:all-pass]", "[]"))),
		).toThrow();
		expect(() =>
			parseWorkCloseDraft(
				Buffer.from(
					valid.replace("[test:all-pass]", "[test:all-pass, test:all-pass]"),
				),
			),
		).toThrow();
		expect(() =>
			parseWorkCloseDraft(Buffer.from(`${valid}execution_inputs: {}`)),
		).toThrow();
		expect(() =>
			parseWorkCloseDraft(Buffer.from(`${valid}computed_status: completed`)),
		).toThrow();
	});

	it("resolves only explicit staged source placeholders", () => {
		const source = Buffer.from(`
work:
  title: Continue the Work
  completion_contract: Preserve the new request
boundary:
  state: accepted
  classification: same_unit
  reason_codes: [same_completion_contract]
  confidence: high
requirements:
  - id: req_existing
    summary: Existing requirement
    source_event_ids: [src_existing]
  - id: req_new
    summary: New exact request
    source_event_ids: ["@staged"]
open_conflicts: []
`);
		const resolved = parseStagedWorkContractDraft(source, "src_derived");
		expect(resolved.requirements[1]!.source_event_ids).toEqual(["src_derived"]);
		expect(() =>
			parseStagedWorkContractDraft(
				Buffer.from(source.toString("utf8").replace('"@staged"', "src_other")),
				"src_derived",
			),
		).toThrow(/must reference @staged/);
	});

	it("parses a bounded provisional retain decision", () => {
		expect(
			parseWorkPromptRetainDraft(
				Buffer.from(`
boundary:
  state: needs_user
  classification: same_unit
  reason_codes: [same_or_new_unclear]
  confidence: low
question: Should this extend the current Work or become a separate Work?
`),
			),
		).toMatchObject({
			boundary: { state: "needs_user", classification: "same_unit" },
		});
		expect(() =>
			parseWorkPromptRetainDraft(
				Buffer.from(`
boundary:
  state: accepted
  classification: same_unit
  reason_codes: [not_ambiguous]
  confidence: high
question: forged
`),
			),
		).toThrow();
	});
});
