import type { CapabilitySideEffect } from "./fragments.js";
import type { FileAction, RenderAction } from "./render.js";

export type ExecutableSecuritySeverity = "warning" | "info";

export type ExecutableSecurityIssueCode =
  | "executable-shell-safety-missing"
  | "executable-readonly-write"
  | "executable-network-undeclared"
  | "executable-credential-touch-undeclared"
  | "executable-repo-external-write-undeclared"
  | "executable-external-production-undeclared";

export interface ExecutableSecurityIssue {
  severity: ExecutableSecuritySeverity;
  code: ExecutableSecurityIssueCode;
  fragmentId: string;
  target: string;
  message: string;
  repair: string;
}

export interface ExecutableSecurityStatus {
  ok: boolean;
  issues: ExecutableSecurityIssue[];
  summary: {
    total: number;
    warnings: number;
    info: number;
  };
}

interface ContentSignals {
  writes: boolean;
  network: boolean;
  credentialTouching: boolean;
  repoExternalWrite: boolean;
  externalProduction: boolean;
}

export function analyzeExecutableSecurity(
  actions: readonly RenderAction[],
): ExecutableSecurityStatus {
  const issues: ExecutableSecurityIssue[] = [];

  for (const action of actions) {
    if (!isExecutableAction(action)) continue;

    const sideEffects = new Set(action.sideEffects ?? []);
    const signals = contentSignals(action.content);

    if (isShellScript(action) && !hasShellSafety(action.content)) {
      issues.push({
        severity: "warning",
        code: "executable-shell-safety-missing",
        fragmentId: action.fragmentId,
        target: action.path,
        message: `executable hook '${action.path}' omits shell safety settings`,
        repair:
          "Add `set -euo pipefail` near the top of bash/zsh hooks, or `set -eu` for portable sh hooks, then re-run `anamnesis update --apply --allow-exec-adapters`.",
      });
    }

    if (sideEffects.has("read-only") && signals.writes) {
      issues.push({
        severity: "warning",
        code: "executable-readonly-write",
        fragmentId: action.fragmentId,
        target: action.path,
        message: `executable hook '${action.path}' declares read-only side effects but contains local write operations`,
        repair:
          "Either remove the write operation or declare an appropriate side effect such as `local-write` or `repo-external-write` in fragment.yaml.",
      });
    }

    if (signals.network && !declaresNetwork(sideEffects)) {
      issues.push({
        severity: "warning",
        code: "executable-network-undeclared",
        fragmentId: action.fragmentId,
        target: action.path,
        message: `executable hook '${action.path}' appears to access the network without declaring the network side effect`,
        repair:
          "Declare `network` in fragment.yaml after review, or remove the network call from the managed executable surface.",
      });
    }

    if (
      signals.credentialTouching &&
      !sideEffects.has("credential-touching")
    ) {
      issues.push({
        severity: "warning",
        code: "executable-credential-touch-undeclared",
        fragmentId: action.fragmentId,
        target: action.path,
        message: `executable hook '${action.path}' references likely credential material without declaring credential-touching`,
        repair:
          "Declare `credential-touching` only after reviewing the hook's secret handling path, or remove the credential access.",
      });
    }

    if (
      signals.repoExternalWrite &&
      !sideEffects.has("repo-external-write")
    ) {
      issues.push({
        severity: "warning",
        code: "executable-repo-external-write-undeclared",
        fragmentId: action.fragmentId,
        target: action.path,
        message: `executable hook '${action.path}' appears to write outside the project without declaring repo-external-write`,
        repair:
          "Declare `repo-external-write` after review, or redirect the write into a project-managed path.",
      });
    }

    if (
      signals.externalProduction &&
      !sideEffects.has("external-production")
    ) {
      issues.push({
        severity: "warning",
        code: "executable-external-production-undeclared",
        fragmentId: action.fragmentId,
        target: action.path,
        message: `executable hook '${action.path}' contains a production-impacting command without declaring external-production`,
        repair:
          "Declare `external-production` only for intentionally production-impacting hooks, or remove the command from managed hook execution.",
      });
    }
  }

  const warnings = issues.filter((i) => i.severity === "warning").length;
  const info = issues.filter((i) => i.severity === "info").length;
  return {
    ok: warnings === 0,
    issues,
    summary: {
      total: issues.length,
      warnings,
      info,
    },
  };
}

function isExecutableAction(action: RenderAction): action is FileAction {
  if (action.kind !== "file") return false;
  if (action.settingsHook || action.codexHook) return true;
  if (action.mode !== undefined && (action.mode & 0o111) !== 0) return true;
  return (
    action.path.startsWith(".claude/hooks/") ||
    action.path.startsWith(".anamnesis/codex-native-hooks/") ||
    action.path.startsWith(".git/hooks/")
  );
}

function isShellScript(action: FileAction): boolean {
  const firstLine = action.content.split(/\r?\n/, 1)[0] ?? "";
  return (
    /\.(?:sh|bash|zsh)$/.test(action.path) ||
    /^#!.*\b(?:bash|sh|zsh)\b/.test(firstLine)
  );
}

function hasShellSafety(content: string): boolean {
  const preamble = content.split(/\r?\n/).slice(0, 40).join("\n");
  if (/^#!.*\b(?:bash|zsh)\b/m.test(preamble)) {
    return /\bset\s+-euo\s+pipefail\b/.test(preamble);
  }
  if (/^#!.*\bsh\b/m.test(preamble)) {
    return /\bset\s+-eu\b/.test(preamble);
  }
  return /\bset\s+-euo\s+pipefail\b/.test(preamble);
}

function declaresNetwork(
  effects: ReadonlySet<CapabilitySideEffect>,
): boolean {
  return effects.has("network") || effects.has("external-production");
}

function contentSignals(content: string): ContentSignals {
  const executableText = stripComments(content);
  const writes = hasAny(executableText, [
    /\b(?:rm|mv|cp|chmod|chown|mkdir|touch)\b/,
    /\btee\s+(?:-a\s+)?[^\s|&;]/,
    /\bgit\s+(?:commit|tag|push|reset|checkout|switch|rebase)\b/,
    /\b(?:npm|pnpm|yarn)\s+(?:publish|add|install|ci)\b/,
    /\bpip\s+install\b/,
    /\buv\s+add\b/,
  ]);
  const network = hasAny(executableText, [
    /\b(?:curl|wget|ssh|scp|rsync)\b/,
    /\bgit\s+(?:push|pull|fetch|clone)\b/,
    /\b(?:npm|pnpm|yarn)\s+(?:install|ci|publish|view|add)\b/,
    /\bpip\s+install\b/,
    /\buv\s+add\b/,
    /\bdocker\s+(?:pull|push)\b/,
  ]);
  const credentialTouching = hasAny(executableText, [
    /(?:^|[/"'=\s])\.env(?:[.\s/"']|$)/,
    /\b(?:AWS|GCP|GOOGLE|AZURE|NPM|GITHUB|SLACK|OPENAI)_[A-Z0-9_]*(?:TOKEN|KEY|SECRET|CREDENTIALS)\b/,
    /\b(?:TOKEN|SECRET|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS)\b/,
    /BEGIN [A-Z ]*PRIVATE KEY/,
  ]);
  const repoExternalWrite = writes && hasAny(executableText, [
    /\$HOME\b|\$\{HOME\}|~/,
    /\$XDG_STATE_HOME\b|\$\{XDG_STATE_HOME\}/,
    /\$TMPDIR\b|\$\{TMPDIR\}/,
    /\/(?:tmp|var|etc|usr|opt|Library|Applications)\b/,
  ]);
  const externalProduction = hasAny(executableText, [
    /\bkubectl\s+(?:apply|delete|rollout|scale|patch|cordon|drain)\b/,
    /\bhelm\s+(?:install|upgrade|uninstall|rollback)\b/,
    /\bterraform\s+(?:apply|destroy)\b/,
    /\baws\s+[^\n;&|]*(?:create|delete|put|update|deploy|run-instances|terminate-instances)\b/,
    /\bdocker\s+push\b/,
    /\b(?:npm|pnpm|yarn)\s+publish\b/,
    /\bgh\s+release\s+(?:create|upload|delete)\b/,
  ]);

  return {
    writes,
    network,
    credentialTouching,
    repoExternalWrite,
    externalProduction,
  };
}

function stripComments(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*#.*$/, "").replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

function hasAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}
