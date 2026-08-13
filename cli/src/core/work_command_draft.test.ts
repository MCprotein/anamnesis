import { describe, expect, it } from "vitest";

import {
	parseWorkContractDraft,
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
});
