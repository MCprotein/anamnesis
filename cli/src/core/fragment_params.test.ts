import { describe, it, expect } from "vitest";
import {
  paramDeclarationsSchema,
  renderParamTemplate,
  resolveFragmentParams,
  ParamTemplateError,
  type ParamDeclarations,
} from "./fragment_params.js";

function decls(raw: unknown): ParamDeclarations {
  return paramDeclarationsSchema.parse(raw);
}

const RULES_DECLS = decls({
  title: { type: "string", default: "Team rules" },
  max_rereview: { type: "integer", default: 2 },
  strict: { type: "boolean" },
  docs: { type: "string[]" },
  rules: {
    type: "object[]",
    fields: {
      text: { type: "string", required: true },
      source: { type: "string" },
    },
  },
});

function render(source: string, values: Record<string, unknown> = {}): string {
  const resolution = resolveFragmentParams({
    fragmentId: "team",
    declarations: RULES_DECLS,
    values,
  });
  expect(resolution.blocking).toBe(false);
  return renderParamTemplate({
    source,
    declarations: RULES_DECLS,
    values: resolution.values,
    sourceLabel: "test.md",
  });
}

describe("paramDeclarationsSchema", () => {
  it("applies required=false by default", () => {
    expect(RULES_DECLS.title!.required).toBe(false);
  });

  it.each([
    ["bad name", { "Bad-Name": { type: "string" } }],
    ["unknown type", { x: { type: "map" } }],
    ["unknown key", { x: { type: "string", pattern: "x" } }],
    ["object[] without fields", { x: { type: "object[]" } }],
    ["fields on a scalar", { x: { type: "string", fields: { a: { type: "string" } } } }],
    ["required with default", { x: { type: "string", required: true, default: "a" } }],
    ["invalid default", { x: { type: "integer", default: "two" } }],
    ["max_items on scalar", { x: { type: "string", max_items: 3 } }],
    ["max_length on integer", { x: { type: "integer", max_length: 3 } }],
    [
      "max_length on an integer field",
      { x: { type: "object[]", fields: { n: { type: "integer", max_length: 3 } } } },
    ],
  ])("rejects %s", (_label, raw) => {
    expect(paramDeclarationsSchema.safeParse(raw).success).toBe(false);
  });
});

describe("resolveFragmentParams", () => {
  it("applies defaults and keeps supplied values", () => {
    const r = resolveFragmentParams({
      fragmentId: "team",
      declarations: RULES_DECLS,
      values: { strict: true },
    });
    expect(r.problems).toEqual([]);
    expect(r.values).toEqual({ title: "Team rules", max_rereview: 2, strict: true });
  });

  it("warns about undeclared keys without blocking", () => {
    const r = resolveFragmentParams({
      fragmentId: "prisma",
      declarations: undefined,
      values: { schema_path: "prisma/schema.prisma" },
    });
    expect(r.blocking).toBe(false);
    expect(r.values).toEqual({});
    expect(r.problems).toEqual([
      expect.objectContaining({
        code: "fragment-param-unknown",
        severity: "warning",
        key: "schema_path",
      }),
    ]);
  });

  it("blocks on a missing required param", () => {
    const r = resolveFragmentParams({
      fragmentId: "team",
      declarations: decls({ owner: { type: "string", required: true } }),
      values: {},
    });
    expect(r.blocking).toBe(true);
    expect(r.problems[0]).toMatchObject({ code: "fragment-param-missing", key: "owner" });
  });

  it.each([
    ["wrong scalar type", { max_rereview: "2" }],
    ["non-integer", { max_rereview: 1.5 }],
    ["string list item type", { docs: ["a", 3] }],
    ["object item missing required field", { rules: [{ source: "x" }] }],
    ["object item with undeclared field", { rules: [{ text: "a", owner: "b" }] }],
    ["region anchor in a value", { title: "x <!-- /anamnesis:region --> y" }],
    ["region anchor in a nested field", { rules: [{ text: "<!-- anamnesis:region id=x -->" }] }],
    ["control character", { title: "a\u0007b" }],
    ["bidi override", { title: "a\u202eb" }],
    ["zero-width space", { title: "a\u200bb" }],
    ["line separator", { title: "a\u2028b" }],
    ["string longer than max_length", { title: "x".repeat(2001) }],
    ["list longer than max_items", { docs: Array.from({ length: 101 }, () => "d") }],
  ])("rejects %s", (_label, values) => {
    const r = resolveFragmentParams({
      fragmentId: "team",
      declarations: RULES_DECLS,
      values,
    });
    expect(r.blocking).toBe(true);
    expect(r.problems.map((p) => p.code)).toContain("fragment-param-invalid");
  });

  it("allows tabs and newlines in strings", () => {
    const r = resolveFragmentParams({
      fragmentId: "team",
      declarations: RULES_DECLS,
      values: { title: "a\tb\nc" },
    });
    expect(r.blocking).toBe(false);
  });

  it("orders problems deterministically", () => {
    const r = resolveFragmentParams({
      fragmentId: "team",
      declarations: RULES_DECLS,
      values: { zeta: 1, alpha: 2 },
    });
    expect(r.problems.map((p) => p.key)).toEqual(["alpha", "zeta"]);
  });
});

describe("renderParamTemplate", () => {
  it("returns the source unchanged when the fragment declares no params", () => {
    const source = "a {{params.x}} {{#each params.y}}{{/each}} {{this}}";
    expect(
      renderParamTemplate({
        source,
        declarations: undefined,
        values: {},
        sourceLabel: "x.md",
      }),
    ).toBe(source);
    expect(
      renderParamTemplate({ source, declarations: {}, values: {}, sourceLabel: "x.md" }),
    ).toBe(source);
  });

  it("substitutes scalars, defaults, and unset optional params", () => {
    expect(
      render("# {{params.title}} ({{ params.max_rereview }}) strict={{params.strict}}."),
    ).toBe("# Team rules (2) strict=.");
    expect(render("strict={{params.strict}}", { strict: false })).toBe("strict=false");
  });

  it("loops over string and object lists in order", () => {
    const out = render(
      "Docs:\n{{#each params.docs}}- {{this}}\n{{/each}}Rules:\n{{#each params.rules}}- {{this.text}} ({{this.source}}) [{{params.title}}]\n{{/each}}",
      {
        docs: ["b.md", "a.md"],
        rules: [
          { text: "rule one", source: "work:x#1" },
          { text: "rule two" },
        ],
      },
    );
    expect(out).toBe(
      "Docs:\n- b.md\n- a.md\nRules:\n- rule one (work:x#1) [Team rules]\n- rule two () [Team rules]\n",
    );
  });

  it("renders an empty list as nothing", () => {
    expect(render("A{{#each params.docs}}- {{this}}\n{{/each}}B")).toBe("AB");
  });

  it("leaves unrelated double-brace text verbatim", () => {
    const source = "run: echo ${{ github.sha }} and {{ matrix.os }} for {{params.title}}";
    expect(render(source)).toBe(
      "run: echo ${{ github.sha }} and {{ matrix.os }} for Team rules",
    );
  });

  it("does not re-scan substituted values", () => {
    expect(render("{{params.title}}", { title: "{{params.strict}}" })).toBe(
      "{{params.strict}}",
    );
  });

  it("is deterministic", () => {
    const values = { docs: ["x", "y"], rules: [{ text: "t", source: "s" }] };
    const source = "{{#each params.docs}}{{this}},{{/each}}{{#each params.rules}}{{this.text}}{{/each}}";
    expect(render(source, values)).toBe(render(source, values));
  });

  it.each([
    ["undeclared param", "{{params.nope}}", /undeclared param 'nope'/],
    ["list as scalar", "{{params.docs}}", /must be rendered with \{\{#each\}\}/],
    ["each over scalar", "{{#each params.title}}{{/each}}", /needs a list param/],
    ["unclosed each", "{{#each params.docs}}{{this}}", /has no \{\{\/each\}\}/],
    ["stray end", "{{/each}}", /without a matching/],
    ["this outside each", "{{this}}", /only valid inside/],
    ["field on string item", "{{#each params.docs}}{{this.x}}{{/each}}", /items are strings/],
    ["bare this on object item", "{{#each params.rules}}{{this}}{{/each}}", /items are objects/],
    ["undeclared field", "{{#each params.rules}}{{this.owner}}{{/each}}", /no declared field 'owner'/],
    ["nested each", "{{#each params.docs}}{{#each params.rules}}{{/each}}{{/each}}", /must not nest/],
    ["malformed params tag", "{{params.Bad-Name}}", /malformed template tag/],
    ["unknown block helper", "{{#if params.strict}}x{{/if}}", /malformed template tag/],
  ])("rejects %s", (_label, source, pattern) => {
    expect(() => render(source)).toThrow(ParamTemplateError);
    expect(() => render(source)).toThrow(pattern);
  });

  it("rejects a region anchor assembled from several list items", () => {
    expect(() =>
      render("{{#each params.docs}}{{this}}\n{{/each}}", {
        docs: ["a <!--", "/anamnesis:region -->", "outside"],
      }),
    ).toThrow(/form an anamnesis region anchor/);
  });

  it("rejects a region anchor assembled from adjacent scalars", () => {
    const declarations = decls({ x: { type: "string" }, y: { type: "string" } });
    const values = resolveFragmentParams({
      fragmentId: "t",
      declarations,
      values: { x: "<!--", y: " /anamnesis:region -->" },
    }).values;
    expect(() =>
      renderParamTemplate({
        source: "{{params.x}}{{params.y}}",
        declarations,
        values,
        sourceLabel: "x.md",
      }),
    ).toThrow(/form an anamnesis region anchor/);
  });

  it("keeps region anchors that the source already has", () => {
    const declarations = decls({ x: { type: "string" } });
    const source = "<!-- anamnesis:region id=a -->{{params.x}}<!-- /anamnesis:region -->";
    expect(
      renderParamTemplate({ source, declarations, values: { x: "v" }, sourceLabel: "x.md" }),
    ).toBe("<!-- anamnesis:region id=a -->v<!-- /anamnesis:region -->");
  });

  it("rejects a broken loop body even when the list is empty", () => {
    expect(() => render("{{#each params.rules}}{{this.owner}}{{/each}}", { rules: [] })).toThrow(
      /no declared field 'owner'/,
    );
  });
});
