import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Concurrent runs from different checkouts must not fight over one port.
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

process.env.EXQL_TEST_PORT ??= String(await freePort());
const hostUrl = `http://127.0.0.1:${process.env.EXQL_TEST_PORT}`;
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
    baseURL: hostUrl,
    channel: "msedge",
    extraHTTPHeaders: { "X-Exql-Client": "1" },
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/ci/start-host.mjs",
    url: hostUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
