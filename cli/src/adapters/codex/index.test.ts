import { describe, it, expect } from "vitest";
import {
  codexRenderers,
  CODEX_UNSUPPORTED,
} from "./index.js";

describe("registerCodex", () => {



  it("exposes the adapter renderer set length 6 (full coverage)", () => {
    expect(codexRenderers).toHaveLength(6);
    for (const r of codexRenderers) {
      expect(r.adapter).toBe("codex");
    }
  });

  it("CODEX_UNSUPPORTED is empty (v1.7 full coverage)", () => {
    expect(CODEX_UNSUPPORTED).toEqual([]);
  });
});
