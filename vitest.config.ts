import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["cli/src/**/*.test.ts"],
    reporters: ["default"],
    testTimeout: 30_000,
  },
});
