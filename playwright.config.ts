import { defineConfig, devices } from "@playwright/test";

// End-to-end tests for the editor dialog. They serve the built UI (dist/ui)
// through the real editor server, so run `npm run test:e2e`, which builds first.
export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 960, height: 640 },
    launchOptions: {
      // Preview starts audio without a real user gesture.
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
  },
});
