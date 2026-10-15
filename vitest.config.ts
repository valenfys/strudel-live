import { defineConfig } from "vitest/config";

// Unit tests only; the editor's end-to-end tests run under Playwright.
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
});
