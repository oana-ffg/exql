import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { expect } from "@playwright/test";
import { DisposableDatabase } from "../tests/support/database.ts";
import { fillConnection } from "../tests/support/ui.ts";
import {
  assertFreePort,
  attachDesktop,
  launchDesktop,
  closeDesktop,
  deleteDesktopProfiles,
} from "./desktop-harness.mjs";

// The PowerShell runner supplies a fresh app folder and two real Velopack releases.
const root = resolve(process.argv[2] ?? "artifacts/update-test");
const data = join(root, "state");
const feed = join(root, "live-feed");
const packages = resolve(process.argv[3] ?? join(root, "feed"));
await assertFreePort(9224);
const manifest = JSON.parse(
  await readFile(join(packages, "releases.win-x64.json"), "utf8"),
);
const target = manifest.Assets.find(
  (asset) => asset.Version === "0.0.2" && asset.Type === "Full",
);
assert(target, "Build test versions 0.0.1 and 0.0.2 first.");
await mkdir(feed, { recursive: true });
await writeFile(
  join(feed, "releases.win-x64.json"),
  JSON.stringify({
    Assets: manifest.Assets.filter(
      (asset) => asset.Version === "0.0.1" && asset.Type === "Full",
    ),
  }),
);
await mkdir(data, { recursive: true });

let page;
let database;
let context;
let tracing = false;
const errors = [];
try {
  database = await new DisposableDatabase().create();
  ({ page, context } = await launchDesktop(root, 9224, [
    "--automation-update-directory",
    feed,
  ]));
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  tracing = true;
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".update-version")).toHaveText("ExQL 0.0.1");
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(page.locator(".update-message")).toHaveText(
    "You’re up to date.",
  );
  await page.getByRole("button", { name: "Dismiss update notice" }).click();
  await expect(page.locator(".update-notice")).toHaveCount(0);

  // A corrupt full package must never become a restartable update.
  await writeFile(join(feed, target.FileName), "corrupt package");
  await writeFile(
    join(feed, "releases.win-x64.json"),
    JSON.stringify({ Assets: [target] }),
  );
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Retry update" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("button", { name: "Restart to update" }),
  ).toHaveCount(0);
  await copyFile(join(packages, target.FileName), join(feed, target.FileName));
  await page.getByRole("button", { name: "Retry update" }).click();
  await expect(
    page.getByRole("button", { name: "Restart to update" }),
  ).toBeVisible({ timeout: 30_000 });
  console.log(
    "Verified corrupt-package rejection and successful retry with a real package.",
  );

  // Save SQL through the real editor and API, then simulate a failed disk save.
  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  const sql = "SELECT N'Update verification — æøå 日本語' AS Message;";
  await page.locator(".cm-content").fill(sql);
  await page.waitForFunction(() => !window.exqlPendingWrites);
  await page.route("**/api/workspace/scratch", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Test save failure" }),
      });
    else await route.continue();
  });
  await page.locator(".cm-content").fill(sql + "\n-- save failure test");
  await page.waitForFunction(() => window.exqlStorageFailed === true);
  await page.getByRole("button", { name: "Restart to update" }).click();
  await expect(page.locator(".update-message")).toContainText(
    "Resolve any workspace save errors",
  );
  await page.unroute("**/api/workspace/scratch");

  let releaseSave;
  const saveGate = new Promise((resolve) => {
    releaseSave = resolve;
  });
  await page.route("**/api/workspace/scratch", async (route) => {
    if (route.request().method() === "POST") await saveGate;
    await route.continue();
  });
  await page.locator(".cm-content").fill(sql);
  await page.waitForFunction(() => window.exqlPendingWrites > 0);
  await page.getByRole("button", { name: "Restart to update" }).click();
  await expect(page.locator(".update-version")).toHaveText("ExQL 0.0.1");
  releaseSave();
  await page.waitForFunction(
    () => !window.exqlPendingWrites && !window.exqlStorageFailed,
  );
  await page.unroute("**/api/workspace/scratch");
  console.log(
    "Verified that failed and pending workspace saves block update restarts.",
  );

  // Exercise the normal connection UI and a real, read-only SQL operation.
  await page.getByRole("button", { name: /No connection/ }).click();
  await page
    .getByLabel("Connection name", { exact: true })
    .fill("Updater test database");
  await fillConnection(page, database.name);
  await page
    .getByRole("button", { name: "Save & connect", exact: true })
    .click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await page
    .locator(".cm-content")
    .fill("WAITFOR DELAY '00:00:04'; SELECT 42 AS Answer;");
  await page.getByRole("button", { name: /Run SQL/ }).click();
  await page.waitForFunction(() => window.exqlDirty === true);
  await page.getByRole("button", { name: "Restart to update" }).click();
  await expect(page.locator(".update-message")).toContainText(
    "Finish running operations",
  );
  await expect(
    page.getByRole("gridcell", { name: "42", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("complementary")
    .getByRole("button", { name: "WorkItems", exact: true })
    .click();
  const cell = page.locator('[data-cell="0:1"]');
  await cell.dblclick();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("Uncommitted update-test edit");
  await page
    .getByRole("button", { name: "Apply to grid", exact: true })
    .click();
  await page.getByRole("button", { name: "Restart to update" }).click();
  await expect(page.locator(".update-message")).toContainText(
    "save or discard edits",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await page.locator(".cm-content").fill(sql);
  await page.getByRole("button", { name: "Save query", exact: true }).click();
  await page.getByLabel("Query name").fill("Update verification");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  await page.waitForFunction(
    () => !window.exqlPendingWrites && !window.exqlDirty,
  );
  console.log(
    "Verified that a running SQL query and staged cell edits block restart; no test table edits were committed.",
  );
  await page.screenshot({ path: join(root, "update-ready.png") });
  const persisted = await Promise.all(
    [
      "workspace/scratch.json",
      "workspace/library.json",
      "connections.json",
    ].map(async (file) => [file, await readFile(join(data, file), "utf8")]),
  );

  await context.tracing.stop({ path: join(root, "before-update-trace.zip") });
  tracing = false;
  await page.getByRole("button", { name: "Restart to update" }).click();
  await expect.poll(() => page.isClosed(), { timeout: 30_000 }).toBe(true);
  ({ page, context } = await attachDesktop(9224, "0.0.2"));
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  tracing = true;
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".update-version")).toHaveText("ExQL 0.0.2", {
    timeout: 30_000,
  });
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(page.locator(".update-message")).toHaveText(
    "You’re up to date.",
  );
  await page.getByRole("button", { name: "Dismiss update notice" }).click();
  await expect(page.locator(".update-notice")).toHaveCount(0);
  for (const [file, before] of persisted)
    assert.equal(
      await readFile(join(data, file), "utf8"),
      before,
      `${file} survives update unchanged`,
    );
  await page.getByRole("button", { name: "SQL scripts", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Update verification", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Update verification", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toHaveText(sql);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(root, "update-complete.png") });
  console.log(
    "PASS: real portable 0.0.1 → 0.0.2 replacement and relaunch; connection profiles, saved query, and Unicode scratch SQL preserved; no browser errors.",
  );
} catch (error) {
  console.error(error);
  if (page && !page.isClosed())
    await page.screenshot({ path: join(root, "update-failure.png") });
  throw error;
} finally {
  try {
    if (tracing)
      await context.tracing.stop({ path: join(root, "update-trace.zip") });
    if (page && !page.isClosed()) await deleteDesktopProfiles(page);
  } finally {
    closeDesktop(root);
    await database?.dispose();
  }
}
process.exit(0);
