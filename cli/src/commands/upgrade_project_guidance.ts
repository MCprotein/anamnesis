import * as path from "node:path";
import { findAgentfile } from "../core/agentfile.js";
import type { UpgradeResult } from "./upgrade.js";

export type UpgradeProjectGuidance =
  | {
      kind: "managed";
      projectRoot: string;
      agentfilePath: string;
    }
  | {
      kind: "unmanaged";
      projectRoot: string;
    }
  | {
      kind: "unknown";
      projectRoot: string;
      error: string;
    };

export function detectUpgradeProjectGuidance(
  projectRoot: string,
): UpgradeProjectGuidance {
  try {
    const agentfilePath = findAgentfile(projectRoot);
    if (!agentfilePath) {
      return { kind: "unmanaged", projectRoot };
    }

    return {
      kind: "managed",
      projectRoot,
      agentfilePath: relativeProjectPath(projectRoot, agentfilePath),
    };
  } catch (e) {
    return {
      kind: "unknown",
      projectRoot,
      error: (e as Error).message,
    };
  }
}

export function formatUpgradeProjectGuidance(
  result: Pick<UpgradeResult, "applied" | "updateAvailable" | "status">,
  guidance: UpgradeProjectGuidance,
): string[] {
  const lines: string[] = ["  project update:"];

  if (guidance.kind === "managed") {
    lines.push(`    managed project: yes (${guidance.agentfilePath})`);
    lines.push(`    package/project boundary: ${packageBoundaryMessage(result)}`);
    lines.push("    next commands:");
    lines.push("      preview: anamnesis update --dry-run --allow-exec-adapters");
    lines.push("      apply:   anamnesis update --apply --allow-exec-adapters");
    lines.push("      verify:  anamnesis doctor");
    lines.push("    choices:");
    lines.push(
      "      omit --allow-exec-adapters to keep hooks/commands/skills unchanged",
    );
    lines.push(
      "      add --bump-pinned only when intentionally updating pinned fragments",
    );
    lines.push(
      "      user-modified managed files are preserved; merge manually if needed",
    );
    return lines;
  }

  if (guidance.kind === "unmanaged") {
    lines.push("    managed project: no Agentfile found in the current directory");
    lines.push(`    package/project boundary: ${packageBoundaryMessage(result)}`);
    lines.push("    next commands:");
    lines.push("      cd into an anamnesis-managed project");
    lines.push("      preview: anamnesis update --dry-run --allow-exec-adapters");
    lines.push("      or initialize here: anamnesis init --dry-run");
    return lines;
  }

  lines.push("    managed project: could not inspect current directory");
  lines.push(`    reason: ${guidance.error}`);
  lines.push(`    package/project boundary: ${packageBoundaryMessage(result)}`);
  lines.push("    next commands:");
  lines.push("      fix the Agentfile discovery problem, then run anamnesis update --dry-run");
  lines.push("      verify: anamnesis doctor");
  return lines;
}

function packageBoundaryMessage(
  result: Pick<UpgradeResult, "applied" | "updateAvailable" | "status">,
): string {
  if (result.applied) {
    return "CLI package changed; project-managed files are unchanged until update runs";
  }
  if (result.updateAvailable) {
    return "CLI update is available; project-managed files remain unchanged";
  }
  if (result.status === "local-ahead") {
    return "local CLI is ahead of registry; project-managed files still update separately";
  }
  if (result.status === "up-to-date") {
    return "CLI is current; project-managed files still update separately";
  }
  return "version comparison is unknown; project-managed files still update separately";
}

function relativeProjectPath(projectRoot: string, targetPath: string): string {
  const relative = path.relative(projectRoot, targetPath);
  return relative === "" ? path.basename(targetPath) : relative;
}
