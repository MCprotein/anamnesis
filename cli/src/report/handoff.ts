import type { HandoffActionResult } from "../commands/handoff_action.js";
import type { HandoffDraftResult } from "../commands/handoff_draft.js";

export function reportHandoffDraft(result: HandoffDraftResult): void {
  console.log(result.draft);
  console.log("");
  console.log(
    `summary: ${result.summary.lines} lines, ${result.summary.chars} chars, ~${result.summary.estimatedTokens} tokens`,
  );
  if (result.writtenPath) {
    console.log(`written: ${result.writtenPath}`);
  }
}

export function reportHandoffAction(result: HandoffActionResult): void {
  console.log(result.preview);
}
