import type { InitResult } from "../commands/init.js";
import type { OntologyLifecycleRecommendation } from "../core/ontology-gaps.js";
import { createTui, type TuiTone } from "../core/tui.js";
import {
	detectWorkspaceProfile,
	formatWorkspaceProfileLines,
} from "../core/workspace_profile.js";

export function printLines(lines: string[]): void {
  for (const line of lines) console.log(line);
}

export function countTone(count: number): TuiTone {
  return count > 0 ? "warning" : "success";
}

export function verdictTone(ok: boolean): TuiTone {
  return ok ? "success" : "warning";
}

export interface HumanReportOptions {
	verbose?: boolean;
}

export function printWrapped(
	ui: ReturnType<typeof createTui>,
	message: string,
	opts: { indent?: number; tone?: TuiTone } = {},
): void {
	const indent = opts.indent ?? 2;
	const value = opts.tone ? ui.style(message, opts.tone) : message;
	printLines(
		ui.wrap(value, ui.width - indent).map((line) => `${" ".repeat(indent)}${line}`),
	);
}

export function reportChangeDetails(
	ui: ReturnType<typeof createTui>,
	changes: InitResult["changes"],
): void {
	printLines(ui.section("Changes", changes.length));
	for (const change of changes) {
		const target =
			change.target === "region"
				? `${change.file} [region:${change.regionId}]`
				: change.path;
		const message = `${change.status.padEnd(13)} ${target}${change.reason ? ` — ${change.reason}` : ""}`;
		printWrapped(
			ui,
			message,
			change.status === "blocked"
				? { indent: 4, tone: "warning" }
				: { indent: 4 },
		);
	}
}

export function changeSummaryLine(s: {
  create: number;
  update: number;
  noop: number;
  blocked: number;
  userModified: number;
}): string {
  return `create=${s.create} update=${s.update} noop=${s.noop} blocked=${s.blocked} user-modified=${s.userModified}`;
}

export function reportWorkspaceProfile(projectRoot: string): void {
  const ui = createTui();
  const profile = detectWorkspaceProfile(projectRoot);
  printLines(ui.section("Workspace Profile"));
  for (const line of formatWorkspaceProfileLines(profile)) {
    console.log(line);
  }
}

export function printOntologyRecommendation(
  ui: ReturnType<typeof createTui>,
  recommendation: OntologyLifecycleRecommendation | undefined,
  opts: { label: string; includeOk?: boolean },
): void {
  if (!recommendation) return;
  if (recommendation.action === "none") {
    if (opts.includeOk === true) {
      console.log(`  ${opts.label}: ok - ${recommendation.reason}`);
    }
    return;
  }

  const command = recommendation.command
    ? `${ui.command(recommendation.command)} - `
    : "";
  console.log(`  ${opts.label}: ${command}${recommendation.reason}`);
  for (const target of recommendation.targets.slice(0, 3)) {
    console.log(`    ${target}`);
  }
  if (recommendation.targets.length > 3) {
    console.log(
      `    ... ${recommendation.targets.length - 3} more ontology target(s)`,
    );
  }
}

export function formatAge(ms: number): string {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ms < minute) return `${Math.floor(ms / 1000)}s`;
  if (ms < hour) return `${Math.floor(ms / minute)}m`;
  if (ms < day) return `${Math.floor(ms / hour)}h`;
  return `${Math.floor(ms / day)}d`;
}

export function reportAppendEvidence(
  appendedPath: string | undefined,
  evidencePath: string | undefined,
): void {
  if (appendedPath) {
    console.log(`  appended: ${appendedPath}`);
  }
  if (evidencePath) {
    console.log(`  evidence: ${evidencePath}`);
  }
}

export function formatFragmentLine(f: {
	id: string;
	installedVersion: number;
	libraryVersion: number | null;
	pinned: boolean;
	status: string;
}): string {
  let tag: string;
  switch (f.status) {
    case "in-sync":
      tag = "in-sync";
      break;
    case "update-available":
      tag = `update available → ${f.libraryVersion}`;
      break;
    case "pinned":
      tag = `pinned (lib has ${f.libraryVersion})`;
      break;
    case "library-missing":
      tag = "library-missing";
      break;
    default:
      tag = f.status;
  }
  return `${f.id}@${f.installedVersion}  [${tag}]`;
}
