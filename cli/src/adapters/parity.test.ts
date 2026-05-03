import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { registerClaudeCode } from "./claude-code/index.js";
import { registerCodex } from "./codex/index.js";
import { registerCursor } from "./cursor/index.js";
import {
  ADAPTER_ORDER,
  ADAPTER_PARITY_MATRIX,
  ADAPTER_PARITY_ORDER,
  formatAdapterParityMarkdown,
} from "./parity.js";
import { RendererRegistry } from "../core/render.js";

function registeredRegistry(): RendererRegistry {
  const registry = new RendererRegistry();
  registerClaudeCode(registry);
  registerCodex(registry);
  registerCursor(registry);
  return registry;
}

describe("adapter parity matrix", () => {
  it("covers every current capability and has a renderer for every adapter", () => {
    const registry = registeredRegistry();
    expect(ADAPTER_PARITY_MATRIX.map((row) => row.capability)).toEqual(
      ADAPTER_PARITY_ORDER,
    );

    for (const row of ADAPTER_PARITY_MATRIX) {
      for (const adapter of ADAPTER_ORDER) {
        expect(row.adapters[adapter], `${adapter}:${row.capability}`).toBeDefined();
        expect(
          registry.get(adapter, row.capability),
          `${adapter}:${row.capability} renderer`,
        ).toBeDefined();
      }
    }
  });

  it("keeps the published docs table synced with the canonical fixture", () => {
    const docs = fs.readFileSync(
      path.join(process.cwd(), "docs", "ADAPTER-PARITY.md"),
      "utf8",
    );
    const expected = [
      "<!-- adapter-parity:matrix:start -->",
      formatAdapterParityMarkdown(),
      "<!-- adapter-parity:matrix:end -->",
    ].join("\n");

    expect(docs).toContain(expected);
  });
});
