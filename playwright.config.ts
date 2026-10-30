import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.EXQL_TEST_DATABASE ??= `ExqlTest_${randomUUID().replaceAll("-", "")}`;
process.env.EXQL_TEST_DATA_DIRECTORY ??= mkdtempSync(
  join(tmpdir(), "exql-host-"),
);
mkdirSync("artifacts", { recursive: true });
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  globalTeardown: "./tests/support/cleanup.ts",
  metadata: { dataDirectory: process.env.EXQL_TEST_DATA_DIRECTORY },
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5274",
    channel: "msedge",
    extraHTTPHeaders: { "X-Exql-Client": "1" },
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/ci/start-host.mjs",
    url: "http://127.0.0.1:5274",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
