// Fragment params: declaration schema, value validation, and deterministic
// substitution into fragment text sources.
//
// Contract (specs/agentfile.md §5.2, docs/FRAGMENT-AUTHORING.md "Params"):
//   * A fragment opts in by declaring `params:` in fragment.yaml.
//   * Agentfile `fragments[].params` supplies values. Keys the fragment does
//     not declare are reported as warnings and ignored.
//   * Missing required params and invalid values are errors; renderers never
//     see unvalidated input.
//   * Substitution runs only for fragments that declare params. A fragment
//     without declarations renders its sources byte-for-byte unchanged.
//   * The template language is intentionally tiny: scalar insertion and one
//     non-nested list loop. No conditionals, expressions, or partials.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Declaration schema (fragment.yaml `params:`)
// ---------------------------------------------------------------------------

export const PARAM_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
export const DEFAULT_PARAM_MAX_LENGTH = 2000;
export const DEFAULT_PARAM_MAX_ITEMS = 100;

const paramNameSchema = z
  .string()
  .regex(PARAM_NAME_PATTERN, "param names must match ^[a-z][a-z0-9_]*$");

const scalarTypeSchema = z.enum(["string", "integer", "boolean"]);

export interface ParamObjectField {
  type: "string" | "integer" | "boolean";
  required: boolean;
  max_length?: number;
  description?: string;
}

export interface ParamDeclaration {
  type: "string" | "integer" | "boolean" | "string[]" | "object[]";
  required: boolean;
  default?: unknown;
  description?: string;
  max_length?: number;
  max_items?: number;
  fields?: Record<string, ParamObjectField>;
}

const objectFieldSchema: z.ZodType<ParamObjectField, unknown> = z
  .object({
    type: scalarTypeSchema,
    required: z.boolean().default(false),
    max_length: z.number().int().positive().optional(),
    description: z.string().optional(),
  })
  .strict()
  .refine((field) => field.max_length === undefined || field.type === "string", {
    message: "max_length applies only to string fields",
  });

const paramDeclarationSchema: z.ZodType<ParamDeclaration, unknown> = z
  .object({
    type: z.enum(["string", "integer", "boolean", "string[]", "object[]"]),
    required: z.boolean().default(false),
    default: z.unknown().optional(),
    description: z.string().optional(),
    max_length: z.number().int().positive().optional(),
    max_items: z.number().int().positive().optional(),
    fields: z.record(paramNameSchema, objectFieldSchema).optional(),
  })
  .strict()
  .superRefine((decl, ctx) => {
    if (decl.type === "object[]") {
      if (!decl.fields || Object.keys(decl.fields).length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "object[] params must declare at least one field",
        });
      }
    } else if (decl.fields !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "only object[] params may declare fields",
      });
    }
    if (decl.required && decl.default !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "a required param must not declare a default",
      });
    }
    if (
      decl.max_items !== undefined &&
      decl.type !== "string[]" &&
      decl.type !== "object[]"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "max_items applies only to list params",
      });
    }
    if (decl.max_length !== undefined && decl.type !== "string" && decl.type !== "string[]") {
      ctx.addIssue({
        code: "custom",
        message: "max_length applies only to string and string[] params",
      });
    }
    if (decl.default !== undefined) {
      const problem = validateParamValue(decl, decl.default);
      if (problem) {
        ctx.addIssue({
          code: "custom",
          message: `default value is invalid: ${problem}`,
        });
      }
    }
  });

export const paramDeclarationsSchema: z.ZodType<ParamDeclarations, unknown> = z.record(
  paramNameSchema,
  paramDeclarationSchema,
);

export type ParamDeclarations = Record<string, ParamDeclaration>;

export type ParamScalar = string | number | boolean;
export type ParamValue =
  | ParamScalar
  | string[]
  | Array<Record<string, ParamScalar>>;
export type ResolvedParams = Record<string, ParamValue>;

// ---------------------------------------------------------------------------
// Errors and problems
// ---------------------------------------------------------------------------

export class ParamTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParamTemplateError";
  }
}

export type FragmentParamProblemCode =
  | "fragment-param-unknown"
  | "fragment-param-missing"
  | "fragment-param-invalid"
  | "fragment-param-scope-conflict";

export interface FragmentParamProblem {
  code: FragmentParamProblemCode;
  severity: "error" | "warning";
  fragmentId: string;
  key: string;
  message: string;
}

export interface FragmentParamResolution {
  /** Validated values with declared defaults applied. */
  values: ResolvedParams;
  problems: FragmentParamProblem[];
  /** True when at least one problem is an error; values must not render. */
  blocking: boolean;
}

// ---------------------------------------------------------------------------
// Value validation
// ---------------------------------------------------------------------------

// Region anchors delimit managed content. A value that contains one would let
// Agentfile input close or forge a managed region.
const REGION_ANCHOR_PATTERN = /<!--\s*\/?\s*anamnesis:region/i;
// Control characters other than tab and newline make output unstable across
// tools and are never meaningful in agent instructions.
// Unicode format characters (bidi overrides, zero-width marks) and the
// U+2028/U+2029 separators can hide text from a reviewer of the Agentfile.
// ZWJ/ZWNJ stay allowed: emoji sequences and several scripts need them.
const CONTROL_CHAR_PATTERN =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]|(?![\u200c\u200d])\p{Cf}/u;
const GLOBAL_REGION_ANCHOR_PATTERN = /<!--\s*\/?\s*anamnesis:region/gi;

function countRegionAnchors(text: string): number {
  return text.match(GLOBAL_REGION_ANCHOR_PATTERN)?.length ?? 0;
}

function validateString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return "expected a string";
  if (value.length > maxLength) {
    return `string is longer than ${maxLength} characters`;
  }
  if (REGION_ANCHOR_PATTERN.test(value)) {
    return "string must not contain an anamnesis region anchor";
  }
  if (CONTROL_CHAR_PATTERN.test(value)) {
    return "string must not contain control, format, or line-separator characters other than tab and newline";
  }
  return null;
}

function validateScalar(
  type: "string" | "integer" | "boolean",
  value: unknown,
  maxLength: number,
): string | null {
  switch (type) {
    case "string":
      return validateString(value, maxLength);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value)
        ? null
        : "expected an integer";
    case "boolean":
      return typeof value === "boolean" ? null : "expected a boolean";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Return a problem description, or null when `value` satisfies `decl`. */
export function validateParamValue(
  decl: ParamDeclaration,
  value: unknown,
): string | null {
  const maxLength = decl.max_length ?? DEFAULT_PARAM_MAX_LENGTH;
  const maxItems = decl.max_items ?? DEFAULT_PARAM_MAX_ITEMS;
  switch (decl.type) {
    case "string":
    case "integer":
    case "boolean":
      return validateScalar(decl.type, value, maxLength);
    case "string[]": {
      if (!Array.isArray(value)) return "expected a list of strings";
      if (value.length > maxItems) return `list has more than ${maxItems} items`;
      for (const [i, item] of value.entries()) {
        const problem = validateString(item, maxLength);
        if (problem) return `item ${i}: ${problem}`;
      }
      return null;
    }
    case "object[]": {
      if (!Array.isArray(value)) return "expected a list of objects";
      if (value.length > maxItems) return `list has more than ${maxItems} items`;
      const fields = decl.fields ?? {};
      for (const [i, item] of value.entries()) {
        if (!isPlainObject(item)) return `item ${i}: expected an object`;
        for (const key of Object.keys(item)) {
          if (!Object.hasOwn(fields, key)) {
            return `item ${i}: field '${key}' is not declared`;
          }
        }
        for (const [name, field] of Object.entries(fields)) {
          const fieldValue = item[name];
          if (fieldValue === undefined || fieldValue === null) {
            if (field.required) return `item ${i}: field '${name}' is required`;
            continue;
          }
          const problem = validateScalar(
            field.type,
            fieldValue,
            field.max_length ?? DEFAULT_PARAM_MAX_LENGTH,
          );
          if (problem) return `item ${i}: field '${name}': ${problem}`;
        }
      }
      return null;
    }
  }
}

function copyValue(value: unknown): ParamValue {
  if (Array.isArray(value)) {
    return value.map((item) =>
      isPlainObject(item) ? { ...(item as Record<string, ParamScalar>) } : item,
    ) as ParamValue;
  }
  return value as ParamScalar;
}

/**
 * Validate Agentfile params against a fragment's declarations and apply
 * defaults. Unknown keys are warnings (ignored); missing required params and
 * invalid values are errors.
 */
export function resolveFragmentParams(input: {
  fragmentId: string;
  declarations: ParamDeclarations | undefined;
  values: Record<string, unknown> | undefined;
}): FragmentParamResolution {
  const declarations = input.declarations ?? {};
  const supplied = input.values ?? {};
  const problems: FragmentParamProblem[] = [];
  const values: ResolvedParams = {};

  for (const key of Object.keys(supplied).sort()) {
    if (!Object.hasOwn(declarations, key)) {
      problems.push({
        code: "fragment-param-unknown",
        severity: "warning",
        fragmentId: input.fragmentId,
        key,
        message: `fragment '${input.fragmentId}' does not declare param '${key}'; the value is ignored`,
      });
    }
  }

  for (const key of Object.keys(declarations).sort()) {
    const decl = declarations[key]!;
    const raw = Object.hasOwn(supplied, key) ? supplied[key] : undefined;
    if (raw === undefined || raw === null) {
      if (decl.required) {
        problems.push({
          code: "fragment-param-missing",
          severity: "error",
          fragmentId: input.fragmentId,
          key,
          message: `fragment '${input.fragmentId}' requires param '${key}' (${decl.type})`,
        });
        continue;
      }
      if (decl.default !== undefined) values[key] = copyValue(decl.default);
      continue;
    }
    const problem = validateParamValue(decl, raw);
    if (problem) {
      problems.push({
        code: "fragment-param-invalid",
        severity: "error",
        fragmentId: input.fragmentId,
        key,
        message: `fragment '${input.fragmentId}' param '${key}' is invalid: ${problem}`,
      });
      continue;
    }
    values[key] = copyValue(raw);
  }

  return {
    values,
    problems,
    blocking: problems.some((problem) => problem.severity === "error"),
  };
}

// ---------------------------------------------------------------------------
// Template substitution
// ---------------------------------------------------------------------------
//
// Recognized tags (everything else between `{{` and `}}` stays verbatim, so
// text such as GitHub Actions `${{ github.sha }}` is safe):
//
//   {{params.NAME}}                 scalar param (string, integer, boolean)
//   {{#each params.NAME}}...{{/each}}  loop over a string[] or object[] param
//   {{this}}                        current string[] item (inside a loop)
//   {{this.FIELD}}                  current object[] item field (inside a loop)
//
// Unset optional params and fields render as an empty string. Loops do not
// nest. Output is not re-scanned, so values cannot inject tags.

const TAG_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

type Token =
  | { kind: "text"; text: string }
  | { kind: "param"; name: string }
  | { kind: "each"; name: string }
  | { kind: "end" }
  | { kind: "this"; field?: string };

function classifyTag(body: string): Token | null {
  let m = /^params\.([a-z][a-z0-9_]*)$/.exec(body);
  if (m) return { kind: "param", name: m[1]! };
  m = /^#each\s+params\.([a-z][a-z0-9_]*)$/.exec(body);
  if (m) return { kind: "each", name: m[1]! };
  if (body === "/each") return { kind: "end" };
  if (body === "this") return { kind: "this" };
  m = /^this\.([a-z][a-z0-9_]*)$/.exec(body);
  if (m) return { kind: "this", field: m[1]! };
  if (/^(params\b|#|\/|this\b)/.test(body)) {
    throw new ParamTemplateError(`malformed template tag '{{${body}}}'`);
  }
  return null;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of source.matchAll(TAG_PATTERN)) {
    const token = classifyTag(match[1]!);
    if (!token) continue;
    const start = match.index!;
    if (start > last) tokens.push({ kind: "text", text: source.slice(last, start) });
    tokens.push(token);
    last = start + match[0].length;
  }
  if (last < source.length) tokens.push({ kind: "text", text: source.slice(last) });
  return tokens;
}

function scalarText(value: ParamValue | ParamScalar | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new ParamTemplateError("list value used where a scalar is expected");
}

/**
 * Render a fragment text source. When the fragment declares no params the
 * source is returned unchanged, so existing fragments stay byte-identical.
 */
export function renderParamTemplate(input: {
  source: string;
  declarations: ParamDeclarations | undefined;
  values: ResolvedParams;
  sourceLabel: string;
}): string {
  const declarations = input.declarations;
  if (!declarations || Object.keys(declarations).length === 0) {
    return input.source;
  }
  const fail = (message: string): never => {
    throw new ParamTemplateError(`${input.sourceLabel}: ${message}`);
  };

  const assertScalarParam = (name: string): void => {
    const decl = declarations[name];
    if (!decl) fail(`template uses undeclared param '${name}'`);
    if (decl!.type === "string[]" || decl!.type === "object[]") {
      fail(`list param '${name}' must be rendered with {{#each}}`);
    }
  };
  const assertItemAccess = (
    listName: string,
    decl: ParamDeclaration,
    field: string | undefined,
  ): void => {
    if (decl.type === "string[]") {
      if (field !== undefined) fail(`'${listName}' items are strings; use {{this}}`);
      return;
    }
    if (field === undefined) {
      fail(`'${listName}' items are objects; use {{this.FIELD}}`);
    }
    if (!Object.hasOwn(decl.fields ?? {}, field!)) {
      fail(`'${listName}' has no declared field '${field}'`);
    }
  };

  let tokens: Token[];
  try {
    tokens = tokenize(input.source);
  } catch (e) {
    return fail((e as Error).message);
  }

  let out = "";
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    switch (token.kind) {
      case "text":
        out += token.text;
        i++;
        break;
      case "param": {
        assertScalarParam(token.name);
        out += scalarText(input.values[token.name]);
        i++;
        break;
      }
      case "each": {
        const decl = declarations[token.name];
        if (!decl) fail(`template uses undeclared param '${token.name}'`);
        if (decl!.type !== "string[]" && decl!.type !== "object[]") {
          fail(`{{#each}} needs a list param; '${token.name}' is ${decl!.type}`);
        }
        const end = tokens.findIndex((t, j) => j > i && t.kind === "end");
        if (end < 0) fail(`{{#each params.${token.name}}} has no {{/each}}`);
        const body = tokens.slice(i + 1, end);
        if (body.some((t) => t.kind === "each")) fail("{{#each}} blocks must not nest");
        // Validate the loop body once, so an empty list still rejects a
        // broken template.
        for (const part of body) {
          if (part.kind === "param") assertScalarParam(part.name);
          else if (part.kind === "this") assertItemAccess(token.name, decl!, part.field);
        }
        const items = (input.values[token.name] ?? []) as Array<
          string | Record<string, ParamScalar>
        >;
        for (const item of items) {
          for (const part of body) {
            if (part.kind === "text") out += part.text;
            else if (part.kind === "param") out += scalarText(input.values[part.name]);
            else if (part.kind === "this") {
              out +=
                part.field === undefined
                  ? (item as string)
                  : scalarText((item as Record<string, ParamScalar>)[part.field]);
            }
          }
        }
        i = end + 1;
        break;
      }
      case "end":
        fail("{{/each}} without a matching {{#each}}");
        break;
      case "this":
        fail("{{this}} is only valid inside {{#each}}");
        break;
    }
  }
  // Per-value checks cannot see anchors assembled from several values (for
  // example "<!--" in one item and "/anamnesis:region -->" in the next).
  // Rendering must never add a region anchor that the source did not have.
  if (countRegionAnchors(out) > countRegionAnchors(input.source)) {
    fail("rendered params form an anamnesis region anchor");
  }
  return out;
}

/** True when a skill file should receive param substitution. */
export function isParamTemplatedSkillFile(relPath: string): boolean {
  return relPath.toLowerCase().endsWith(".md");
}
