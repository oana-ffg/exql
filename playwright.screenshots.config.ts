import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Not a test suite: `npm run screenshots` regenerates docs/screenshots.
export default defineConfig(base, {
  testDir: "./tests/screenshots",
  reporter: "list",
  use: {
    viewport: { width: 1600, height: 840 },
    deviceScaleFactor: 1.5,
  },
});
