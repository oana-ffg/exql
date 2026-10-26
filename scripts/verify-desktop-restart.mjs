import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

// Run after verify-desktop.mjs and restarting the EXE with --automation-port 9223.
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const context = browser.contexts()[0];
const page =
  context
    .pages()
    .find((page) =>
      process.argv[2] ? page.url() === process.argv[2] : false,
    ) ??
  context
    .pages()
    .filter((page) => page.url().startsWith("http://127.0.0.1:"))
    .at(-1);
assert(page);
await page.getByRole("button", { name: "SQL scripts", exact: true }).click();
await page
  .getByRole("complementary")
  .getByRole("button", { name: "Browse work items", exact: true })
  .waitFor();
await page.getByRole("button", { name: /No connection/ }).click();
await page
  .getByRole("button", { name: "Connect to Local development", exact: true })
  .click();
await page.getByText("Connected", { exact: true }).waitFor();
await page
  .getByRole("complementary")
  .getByRole("button", { name: "Browse work items", exact: true })
  .click();
assert.match(
  await page.locator(".cm-content").innerText(),
  /SELECT TOP \(20\)/,
);
await page.getByRole("button", { name: /Run SQL/ }).click();
await page.waitForFunction(
  () => document.querySelectorAll("tbody tr").length === 20,
);
const directory = resolve("artifacts/desktop-downloads");
await mkdir(directory, { recursive: true });
const cdp = await context.newCDPSession(page);
await cdp.send("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath: directory,
  eventsEnabled: true,
});
await page.getByRole("button", { name: "Export result", exact: true }).click();
await page.getByLabel("Format", { exact: true }).selectOption("json");
const completed = new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("Desktop download did not complete")),
    20_000,
  );
  cdp.on("Browser.downloadProgress", (event) => {
    if (event.state === "completed") {
      clearTimeout(timeout);
      resolve();
    }
    if (event.state === "canceled") {
      clearTimeout(timeout);
      reject(new Error("Desktop download was cancelled"));
    }
  });
});
await page.getByRole("button", { name: "Download", exact: true }).click();
await completed;
const exported = JSON.parse(
  await readFile(resolve(directory, "query-result.json"), "utf8"),
);
assert.equal(exported.length, 20);
assert.equal(exported[3].Title, "Unicode round trip — æøå 日本語");
await page.screenshot({ path: "artifacts/desktop-verified.png" });
console.log(
  "Standalone EXE verified: persisted connection and SQL after restart, real query execution, native download, and Unicode round trip.",
);
await cdp.detach();
// End the test connection without sending Browser.close to the native WebView2 process.
process.exit(0);
