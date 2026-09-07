import { describe, it, expect } from "vitest";
import { cursorRenderers } from "./index.js";

describe("registerCursor", () => {


  it("exposes 6 renderers all with adapter cursor", () => {
    expect(cursorRenderers).toHaveLength(6);
    for (const r of cursorRenderers) {
      expect(r.adapter).toBe("cursor");
    }
  });
});
