import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// Launch dist/ExQL.exe --automation-port 9223 before running this optional Windows smoke test.
const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser
  .contexts()[0]
  .pages()
  .filter((page) => page.url().startsWith("http://127.0.0.1:"))
  .at(-1);
assert(page, "ExQL desktop page is available");
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const origin = new URL(page.url()).origin;
const blocked = await fetch(origin + "/api/profiles", {
  headers: { "X-Exql-Client": "1" },
});
assert.equal(
  blocked.status,
  403,
  "Native API token is required outside the desktop WebView",
);

await page.getByRole("button", { name: /No connection/ }).click();
const saved = page.getByRole("button", {
  name: "Connect to Local development",
  exact: true,
});
if (await saved.count()) await saved.click();
else {
  await page
    .getByLabel("Connection name", { exact: true })
    .fill("Local development");
  await page.getByLabel("Folder (optional)", { exact: true }).fill("Local");
  await page
    .getByRole("textbox", { name: "Database", exact: true })
    .fill("ExqlDemo");
  await page.getByLabel("Trust server certificate (local development)").check();
  await page
    .getByRole("button", { name: "Save & connect", exact: true })
    .click();
}
await page.getByText("Connected", { exact: true }).waitFor();
await page.getByRole("button", { name: "WorkItems", exact: true }).click();
await page.locator('[data-cell="0:1"]').waitFor();
assert.equal(await page.locator("tbody tr").count(), 200);
await page.locator('[data-cell="0:1"]').click();
await page.keyboard.press("Control+c");
assert.equal(
  await page.evaluate(() => navigator.clipboard.readText()),
  "Build the data grid",
);
await page.getByRole("button", { name: "Next page", exact: true }).click();
await page.waitForFunction(
  () => document.querySelectorAll("tbody tr").length === 45,
);
await page.getByRole("button", { name: "Previous page", exact: true }).click();
await page.waitForFunction(
  () => document.querySelectorAll("tbody tr").length === 200,
);
await page.screenshot({ path: "artifacts/desktop-grid.png" });

await page.getByRole("button", { name: "New query SQL", exact: true }).click();
await page
  .locator(".cm-content")
  .fill(
    "SELECT TOP (20) Id, Title, Status, Priority, Estimate\nFROM dbo.WorkItems\nORDER BY Id;",
  );
await page.getByRole("button", { name: /Run SQL/ }).click();
await page.waitForFunction(
  () => document.querySelectorAll("tbody tr").length === 20,
);
await page.getByRole("button", { name: "Save query", exact: true }).click();
await page.getByLabel("Query name", { exact: true }).fill("Browse work items");
await page
  .getByRole("dialog")
  .getByRole("button", { name: "Save query", exact: true })
  .click();
await page.waitForFunction(() => !window.exqlPendingWrites);
await page.screenshot({ path: "artifacts/desktop-query.png" });
assert.deepEqual(errors, []);
console.log(
  "Desktop smoke test passed: native API isolation, saved Windows connection, SQL Server grid, pagination, clipboard, query execution, and saved SQL.",
);
// Disconnect the test client without sending Browser.close to the native WebView2 process.
process.exit(0);
