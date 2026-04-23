import { describe, it, expect } from "vitest";
import { sha256, isHash, HASH_PREFIX } from "./hash.js";

describe("sha256", () => {
  it("hashes a string with sha256: prefix", () => {
    const h = sha256("hello");
    expect(h.startsWith(HASH_PREFIX)).toBe(true);
    expect(h).toBe(
      "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("is deterministic", () => {
    expect(sha256("x")).toBe(sha256("x"));
  });

  it("produces different hashes for different content", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });

  it("handles Buffer input", () => {
    const b = Buffer.from("hello", "utf8");
    expect(sha256(b)).toBe(sha256("hello"));
  });
});

describe("isHash", () => {
  it("accepts valid sha256 format", () => {
    expect(isHash(sha256("x"))).toBe(true);
  });

  it("rejects plain hex without prefix", () => {
    expect(isHash("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")).toBe(false);
  });

  it("rejects wrong length", () => {
    expect(isHash("sha256:abc")).toBe(false);
  });

  it("rejects non-hex chars", () => {
    expect(isHash("sha256:ZZ" + "a".repeat(62))).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isHash(null)).toBe(false);
    expect(isHash(42)).toBe(false);
    expect(isHash(undefined)).toBe(false);
  });
});
