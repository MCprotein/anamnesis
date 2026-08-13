import { describe, expect, it } from "vitest";

import {
	parseStagedWorkContractDraft,
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
