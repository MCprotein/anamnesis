// Codex adapter — executable_hook fallback.
//
// Codex has no SessionStart / PostToolUse / etc. hook system. The fallback
// always emits an AGENTS.md region documenting the hook so the agent can
// manually follow the intent when relevant. In Git repositories, it also
// installs a best-effort pre-commit bridge: fragment hook scripts are copied
// under `.anamnesis/codex-hooks/`, and `.git/hooks/pre-commit` invokes them
// for each staged file.

import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityRenderer, RenderAction } from "../../core/render.js";
import { RenderError } from "../../core/render.js";

const PRE_COMMIT_PATH = ".git/hooks/pre-commit";

const PRE_COMMIT_CONTENT = `#!/usr/bin/env bash
# anamnesis Codex pre-commit bridge.
# Auto-managed by anamnesis. Runs executable_hook fallbacks installed under
# .anamnesis/codex-hooks/ for each staged file.

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOOK_DIR="$PROJECT_ROOT/.anamnesis/codex-hooks"

[[ -d "$HOOK_DIR" ]] || exit 0

STAGED_FILES="$(git diff --cached --name-only --diff-filter=ACMR)"

status=0
shopt -s nullglob

for hook in "$HOOK_DIR"/*.sh; do
  if [[ -z "$STAGED_FILES" ]]; then
    CLAUDE_PROJECT_DIR="$PROJECT_ROOT" CODEX_PROJECT_DIR="$PROJECT_ROOT" "$hook" || status=$?
    continue
  fi

  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    CLAUDE_PROJECT_DIR="$PROJECT_ROOT" \\
    CODEX_PROJECT_DIR="$PROJECT_ROOT" \\
    CLAUDE_TOOL_FILE_PATH="$file" \\
    CODEX_TOOL_FILE_PATH="$file" \\
      "$hook" || status=$?
  done <<< "$STAGED_FILES"
done

exit "$status"
`;

export const executableHookRenderer: CapabilityRenderer = {
  type: "executable_hook",
  adapter: "codex",
  plan(capability, ctx): RenderAction[] {
    if (capability.type !== "executable_hook") {
      throw new RenderError(
        `executable_hook (codex) given wrong capability type: ${capability.type}`,
      );
    }
    const sourcePath = path.join(ctx.fragmentDir, capability.source);
    if (!fs.existsSync(sourcePath)) {
      throw new RenderError(
        `fragment '${ctx.fragment.id}' hook source not found: ${sourcePath}`,
      );
    }
    const basename = path.basename(capability.source);
    const scriptContent = fs.readFileSync(sourcePath, "utf8");

    // Region id: deterministic per fragment+hook so updates align.
    const regionId = `codex-hook-${basename.replace(/\.[^.]+$/, "")}`;
    const gitPreCommitEnabled = hasGitHooksDir(ctx.projectRoot);

    const content = formatHookRegion({
      fragmentId: ctx.fragment.id,
      basename,
      event: capability.event,
      script: scriptContent,
      gitPreCommitEnabled,
    });

    const scopePath = ctx.scopePath ?? ".";
    const targetFile =
      scopePath === "." || scopePath === ""
        ? ctx.settings.agents_md_path
        : path.posix.join(scopePath, ctx.settings.agents_md_path);

    const actions: RenderAction[] = [
      {
        kind: "region",
        file: targetFile,
        regionId,
        fragmentId: ctx.fragment.id,
        fragmentVersion: ctx.fragment.version,
        content,
      },
    ];

    if (gitPreCommitEnabled) {
      actions.push(
        {
          kind: "file",
          path: path.posix.join(
            ".anamnesis/codex-hooks",
            codexHookFilename(ctx.fragment.id, capability.event, basename),
          ),
          fragmentId: ctx.fragment.id,
          fragmentVersion: ctx.fragment.version,
          content: scriptContent,
          mode: 0o755,
        },
        {
          kind: "file",
          path: PRE_COMMIT_PATH,
          fragmentId: ctx.fragment.id,
          fragmentVersion: ctx.fragment.version,
          content: PRE_COMMIT_CONTENT,
          mode: 0o755,
        },
      );
    }

    return actions;
  },
};

function hasGitHooksDir(projectRoot: string): boolean {
  try {
    return fs.statSync(path.join(projectRoot, ".git", "hooks")).isDirectory();
  } catch {
    return false;
  }
}

function codexHookFilename(
  fragmentId: string,
  event: string,
  basename: string,
): string {
  return `${fragmentId}-${event}-${basename}`.replace(/[^A-Za-z0-9._-]/g, "-");
}

function formatHookRegion(params: {
  fragmentId: string;
  basename: string;
  event: string;
  script: string;
  gitPreCommitEnabled: boolean;
}): string {
  return [
    `### ${params.fragmentId} hook: \`${params.basename}\``,
    "",
    `**When:** \`${params.event}\` (Claude Code event; Codex has no native hook system).`,
    "",
    params.gitPreCommitEnabled
      ? "**Codex fallback:** eligible for best-effort Git `pre-commit` installation under `.anamnesis/codex-hooks/` when executable adapter writes are allowed and no user-owned hook blocks it."
      : "**Codex fallback:** documented here only; no `.git/hooks/` directory was present during rendering.",
    "",
    `**Intent:** the script below documents what should happen at this trigger point. Codex agents should manually invoke or replicate the behavior when the corresponding situation arises (e.g., after editing a file matching the event).`,
    "",
    "```bash",
    params.script.trimEnd(),
    "```",
  ].join("\n");
}
