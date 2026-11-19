import type { HookSummaryResult } from "../commands/hooks.js";
import {
	codexHookTrustApprovalOutcome,
	type CodexHookTrustInspection,
	type TrustCodexHooksResult,
} from "../core/codex_hook_trust.js";
import { createTui } from "../core/tui.js";
import {
	countTone,
	type HumanReportOptions,
	printLines,
	printWrapped,
	reportAppendEvidence,
} from "./common.js";

export function reportHookSummary(
	result: HookSummaryResult,
	opts: HumanReportOptions = {},
): void {
	const ui = createTui();
	printLines([
		...ui.title("anamnesis hooks summary", result.projectName),
		...ui.verdict({
			label:
				result.invalid > 0
					? "Invalid hook records found"
					: "Hook history ready",
			summary: `${result.total} valid record(s)`,
			tone: result.invalid > 0 ? "warning" : "ready",
		}),
		...ui.statusRows([
			...(opts.verbose ? [{ label: "source", value: result.sourcePath }] : []),
			{
				label: "records",
				value: `${result.total} valid, ${result.invalid} invalid`,
				tone: countTone(result.invalid),
			},
		]),
	]);
  if (result.latest) {
    console.log(
      `  latest: ${result.latest.event} ${result.latest.status} at ${result.latest.generated_at}`,
    );
  } else {
    console.log("  latest: none");
  }
  if (result.byStatus.length > 0) {
    console.log(
      `  status: ${result.byStatus.map((s) => `${s.status}=${s.total}`).join(", ")}`,
    );
  }
  for (const event of opts.verbose ? result.byEvent : []) {
    const statuses = Object.entries(event.byStatus)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `${status}=${count}`)
      .join(", ");
		printWrapped(ui, `${event.event}: ${event.total} (${statuses})`, {
			indent: 4,
		});
  }
  if (opts.verbose) reportAppendEvidence(result.appendedPath, result.evidencePath);
}

export function reportCodexHookTrustInspection(
  inspection: CodexHookTrustInspection,
	opts: HumanReportOptions = {},
): void {
	const ui = createTui();
  const s = inspection.summary;
	printWrapped(
		ui,
		`Codex hooks: ${s.registered} registered, ${s.trusted} trusted, ${s.untrusted} untrusted, ${s.modified} modified, ${s.managed} managed, ${s.unknown} unknown`,
	);
	for (const hook of inspection.hooks.filter(
		(item) =>
			opts.verbose ||
			item.status === "untrusted" ||
			item.status === "modified" ||
			item.status === "unknown",
	)) {
    const marker = hook.status === "modified" ? "MODIFIED" : hook.status;
		printWrapped(
			ui,
			`${marker.padEnd(9)} ${hook.event}${opts.verbose ? ` ${hook.command}` : ""}`,
			{ indent: 4 },
		);
		if (opts.verbose && hook.key)
			printWrapped(ui, `key: ${hook.key}`, { indent: 6 });
		if (opts.verbose && hook.currentHash)
			printWrapped(ui, `current hash: ${hook.currentHash}`, { indent: 6 });
  }
  for (const alternate of inspection.alternateProjectSources) {
		printWrapped(ui, `runtime source instead: ${alternate.sourcePath}`, {
			indent: 4,
		});
  }
  for (const warning of inspection.warnings) {
		printWrapped(ui, `warning: ${warning}`, { indent: 4, tone: "warning" });
  }
  if (!inspection.available && inspection.error) {
		printWrapped(ui, `unavailable: ${inspection.error}`, {
			indent: 4,
			tone: "warning",
		});
  }
}

export function reportCodexHookTrust(result: TrustCodexHooksResult): void {
	const ui = createTui();
	const outcome = codexHookTrustApprovalOutcome(result);
	const noApprovalNeeded = outcome === "not-needed";
	const applyComplete = outcome === "complete";
	const label =
		outcome === "review"
			? "Approval review"
			: outcome === "unavailable"
				? "Approval unavailable"
				: noApprovalNeeded
					? "No approval needed"
					: applyComplete
						? "Approval applied"
						: "Approval incomplete";
	printLines([
		...ui.title("anamnesis hooks codex trust", result.mode),
		...ui.verdict({
			label,
			summary: `${result.targets.length} candidate(s)`,
			tone:
				result.mode === "dry-run"
					? "warning"
					: applyComplete || noApprovalNeeded
						? "ready"
						: "warning",
		}),
	]);
	reportCodexHookTrustInspection(result.inspection, { verbose: true });
  console.log(`  approval candidates: ${result.targets.length}`);
  if (result.mode === "dry-run" && result.targets.length > 0) {
    console.log(
      "  preview only; review every definition, then re-run with --apply to approve",
    );
  } else if (result.mode === "apply") {
    console.log(`  approved: ${result.written.length}`);
		if (!result.inspection.available) {
			console.log(ui.note("no trust state was written", "warning"));
		} else if (outcome === "incomplete" && result.targets.length === 0) {
			printWrapped(
				ui,
				"no eligible runtime trust target was discovered; review unknown hooks manually",
				{ tone: "warning" },
			);
		}
  }
}
