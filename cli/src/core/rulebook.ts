// rulebook.md parser and rule evaluation.
//
// Format (see rulebook.md):
//
//   ## <rule-id>
//   - trigger: `<yaml-expression>`
//   - suggest: fragments/<fragment-id>
//   - reason: <human text>
//
// Sections that lack both `trigger` and `suggest` bullets are silently
// skipped (they are prose / intro / format docs).

import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseTriggerYaml,
  evaluateTrigger,
  ProjectContext,
  type TriggerExpr,
} from "./triggers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Rule {
  id: string;
  trigger: TriggerExpr;
  suggest: string; // fragment id
  reason: string;
}

export class RulebookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RulebookParseError";
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface Section {
  id: string;
  bullets: Map<string, string>;
}

const HEADING_RE = /^##\s+(.+?)\s*$/;
const BULLET_RE = /^-\s+(trigger|suggest|reason):\s*(.+)$/;

function stripBackticks(s: string): string {
  return s.trim().replace(/^`+/, "").replace(/`+$/, "").trim();
}

function finalizeSection(section: Section): Rule | null {
  const triggerRaw = section.bullets.get("trigger");
  const suggestRaw = section.bullets.get("suggest");
  const reasonRaw = section.bullets.get("reason");

  // Skip incomplete sections silently — they are prose, not rules.
  if (!triggerRaw || !suggestRaw) return null;

  let trigger: TriggerExpr;
  try {
    trigger = parseTriggerYaml(stripBackticks(triggerRaw));
  } catch (e) {
    throw new RulebookParseError(
      `rule '${section.id}': ${(e as Error).message}`,
    );
  }

  const suggest = suggestRaw
    .replace(/^fragments\//, "")
    .replace(/`/g, "")
    .trim();
  if (!suggest) {
    throw new RulebookParseError(
      `rule '${section.id}': 'suggest' must name a fragment (got empty)`,
    );
  }

  return {
    id: section.id,
    trigger,
    suggest,
    reason: reasonRaw?.trim() ?? "",
  };
}

const FENCE_RE = /^(?:```|~~~)/;

export function parseRulebook(markdown: string): Rule[] {
  const rules: Rule[] = [];
  const seenIds = new Set<string>();
  let current: Section | null = null;
  let inFence = false;

  const flush = (): void => {
    if (!current) return;
    const rule = finalizeSection(current);
    if (rule) {
      if (seenIds.has(rule.id)) {
        throw new RulebookParseError(`duplicate rule id '${rule.id}'`);
      }
      seenIds.add(rule.id);
      rules.push(rule);
    }
    current = null;
  };

  for (const line of markdown.split("\n")) {
    // Skip content inside fenced code blocks — example snippets must not
    // be mistaken for real rule sections.
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = line.match(HEADING_RE);
    if (heading) {
      flush();
      current = { id: heading[1]!.trim(), bullets: new Map() };
      continue;
    }
    const bullet = line.match(BULLET_RE);
    if (bullet && current) {
      current.bullets.set(bullet[1]!, bullet[2]!.trim());
    }
  }
  flush();

  return rules;
}

// ---------------------------------------------------------------------------
// Loading from disk
// ---------------------------------------------------------------------------

export function loadRulebook(libraryRoot: string): Rule[] {
  const fp = path.join(libraryRoot, "rulebook.md");
  if (!fs.existsSync(fp)) return [];
  return parseRulebook(fs.readFileSync(fp, "utf8"));
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface RuleMatch {
  rule: Rule;
  matched: boolean;
}

/**
 * Evaluate every rule against the project. Returns matches in rulebook order.
 * Callers decide what to do with the results (e.g. `init` surfaces matches
 * as suggestions; `update --force-rescan` revisits declined rules).
 */
export function evaluateRules(
  rules: Rule[],
  ctx: ProjectContext,
): RuleMatch[] {
  return rules.map((rule) => ({
    rule,
    matched: evaluateTrigger(rule.trigger, ctx),
  }));
}

export function matchingRules(rules: Rule[], ctx: ProjectContext): Rule[] {
  return evaluateRules(rules, ctx)
    .filter((m) => m.matched)
    .map((m) => m.rule);
}
