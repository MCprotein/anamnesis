import { describe, it, expect } from "vitest";
import {
  parseRegions,
  findRegion,
  upsertRegion,
  removeRegion,
  renderRegion,
  RegionParseError,
} from "./regions.js";

const ANCHOR_OPEN = "<!-- anamnesis:region id=prisma fragment=prisma@1 -->";
const ANCHOR_CLOSE = "<!-- /anamnesis:region -->";

describe("parseRegions", () => {
  it("returns empty array for text with no anchors", () => {
    expect(parseRegions("just some markdown")).toEqual([]);
  });

  it("parses a single region", () => {
    const text = `# Heading\n\n${ANCHOR_OPEN}\ninner body\n${ANCHOR_CLOSE}\n\nmore text`;
    const regions = parseRegions(text);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.id).toBe("prisma");
    expect(regions[0]!.fragmentId).toBe("prisma");
    expect(regions[0]!.fragmentVersion).toBe(1);
    expect(regions[0]!.content).toBe("\ninner body\n");
  });

  it("parses multiple regions", () => {
    const text = [
      ANCHOR_OPEN,
      "first",
      ANCHOR_CLOSE,
      "",
      "<!-- anamnesis:region id=k8s fragment=k8s@2 -->",
      "second",
      ANCHOR_CLOSE,
    ].join("\n");
    const regions = parseRegions(text);
    expect(regions).toHaveLength(2);
    expect(regions.map((r) => r.id)).toEqual(["prisma", "k8s"]);
    expect(regions[1]!.fragmentVersion).toBe(2);
  });

  it("throws on missing close anchor", () => {
    const text = `${ANCHOR_OPEN}\nno close`;
    expect(() => parseRegions(text)).toThrow(RegionParseError);
  });

  it("throws on nested regions", () => {
    const text = [
      ANCHOR_OPEN,
      "outer",
      "<!-- anamnesis:region id=inner fragment=x@1 -->",
      "nested",
      ANCHOR_CLOSE,
      ANCHOR_CLOSE,
    ].join("\n");
    expect(() => parseRegions(text)).toThrow(/nested/);
  });

  it("throws on duplicate region ids", () => {
    const text = [
      ANCHOR_OPEN,
      "one",
      ANCHOR_CLOSE,
      ANCHOR_OPEN,
      "two",
      ANCHOR_CLOSE,
    ].join("\n");
    expect(() => parseRegions(text)).toThrow(/duplicate/);
  });

  it("accepts extra whitespace inside anchor comment", () => {
    const text = `<!--   anamnesis:region   id=x   fragment=f@3   -->\nbody\n<!--   /anamnesis:region   -->`;
    const regions = parseRegions(text);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.id).toBe("x");
  });
});

describe("findRegion", () => {
  it("returns the matching region", () => {
    const text = `${ANCHOR_OPEN}\nx\n${ANCHOR_CLOSE}`;
    expect(findRegion(text, "prisma")?.id).toBe("prisma");
  });

  it("returns undefined for unknown id", () => {
    const text = `${ANCHOR_OPEN}\nx\n${ANCHOR_CLOSE}`;
    expect(findRegion(text, "nope")).toBeUndefined();
  });
});

describe("renderRegion", () => {
  it("wraps content with anchors and ensures newlines", () => {
    const out = renderRegion({
      id: "x",
      fragmentId: "f",
      fragmentVersion: 2,
      content: "body",
    });
    expect(out).toBe(
      `<!-- anamnesis:region id=x fragment=f@2 -->\nbody\n<!-- /anamnesis:region -->`,
    );
  });

  it("preserves explicit leading/trailing newlines", () => {
    const out = renderRegion({
      id: "x",
      fragmentId: "f",
      fragmentVersion: 1,
      content: "\nbody\n",
    });
    expect(out).toContain("\nbody\n");
  });
});

describe("upsertRegion", () => {
  it("appends a new region when absent", () => {
    const next = upsertRegion("# doc\n", {
      id: "prisma",
      fragmentId: "prisma",
      fragmentVersion: 1,
      content: "hello",
    });
    expect(next).toContain(ANCHOR_OPEN);
    expect(next).toContain("hello");
    expect(parseRegions(next)).toHaveLength(1);
  });

  it("replaces existing region in place", () => {
    const initial = upsertRegion("doc\n", {
      id: "prisma",
      fragmentId: "prisma",
      fragmentVersion: 1,
      content: "v1",
    });
    const updated = upsertRegion(initial, {
      id: "prisma",
      fragmentId: "prisma",
      fragmentVersion: 2,
      content: "v2",
    });
    const regions = parseRegions(updated);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.fragmentVersion).toBe(2);
    expect(regions[0]!.content).toContain("v2");
  });

  it("leaves content outside the region untouched", () => {
    const before = "# top\nprose before\n\n";
    const after = "\nprose after\n";
    const initial = before + renderRegion({
      id: "x",
      fragmentId: "f",
      fragmentVersion: 1,
      content: "old",
    }) + after;
    const updated = upsertRegion(initial, {
      id: "x",
      fragmentId: "f",
      fragmentVersion: 1,
      content: "new",
    });
    expect(updated.startsWith(before)).toBe(true);
    expect(updated.endsWith(after)).toBe(true);
    expect(updated).toContain("new");
    expect(updated).not.toContain("old");
  });

  it("creates valid output from empty input", () => {
    const out = upsertRegion("", {
      id: "x",
      fragmentId: "f",
      fragmentVersion: 1,
      content: "c",
    });
    expect(parseRegions(out)).toHaveLength(1);
  });
});

describe("removeRegion", () => {
  it("drops the specified region", () => {
    const text = `# doc\n\n${ANCHOR_OPEN}\nbody\n${ANCHOR_CLOSE}\n\ntail`;
    const next = removeRegion(text, "prisma");
    expect(parseRegions(next)).toHaveLength(0);
    expect(next).toContain("# doc");
    expect(next).toContain("tail");
  });

  it("is a no-op when region is absent", () => {
    const text = "# doc\nno regions here\n";
    expect(removeRegion(text, "anything")).toBe(text);
  });

  it("keeps sibling regions intact", () => {
    const text = [
      ANCHOR_OPEN,
      "keep-me-wrapped-with-prisma-id",
      ANCHOR_CLOSE,
      "",
      "<!-- anamnesis:region id=k8s fragment=k8s@1 -->",
      "sibling-body",
      ANCHOR_CLOSE,
    ].join("\n");
    const next = removeRegion(text, "prisma");
    const remaining = parseRegions(next);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe("k8s");
  });
});

describe("roundtrip: upsert → parse → content stability", () => {
  it("content roundtrips byte-for-byte on replace", () => {
    const body = "multi\nline\ncontent with special chars: <>/?&";
    const text = upsertRegion("", {
      id: "x",
      fragmentId: "f",
      fragmentVersion: 1,
      content: body,
    });
    const r = findRegion(text, "x")!;
    expect(r.content.trim()).toBe(body.trim());
  });
});
