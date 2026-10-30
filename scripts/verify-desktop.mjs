import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { DisposableDatabase, rows } from "../tests/support/database.ts";
import {
  fillConnection,
  openTable,
  editCell,
  runSql,
} from "../tests/support/ui.ts";
import {
  launchDesktop,
  closeDesktop,
  deleteDesktopProfiles,
} from "./desktop-harness.mjs";

const root = resolve(process.argv[2]);
const database = await new DisposableDatabase().create();
const errors = [];
let attached;
let tracing = false;
try {
  attached = await launchDesktop(root, 9223);
  let { page, context } = attached;
  page.on("pageerror", (error) => errors.push(error.stack));
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  tracing = true;
  const blocked = await fetch(new URL("/api/profiles", page.url()), {
    headers: { "X-Exql-Client": "1" },
  });
  assert.equal(
    blocked.status,
    403,
    "Desktop API requires its native launch token",
  );
  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await page
    .getByLabel("Connection name", { exact: true })
    .fill("Portable journey");
  await fillConnection(page, database.name);
  await page
    .getByRole("button", { name: "Save & connect", exact: true })
    .click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await openTable(page);
  await editCell(page, 0, "Title", "Portable committed edit æøå 日本語");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toHaveCount(0);
  assert.deepEqual(
    await rows(database.name, "SELECT Title FROM dbo.WorkItems WHERE Id=1"),
    [{ Title: "Portable committed edit æøå 日本語" }],
  );
  const sql =
    "INSERT dbo.CommandLog VALUES(1,N'Portable SQL'); SELECT Id,Title,Status,Priority FROM dbo.WorkItems ORDER BY Id;";
  const response = await runSql(page, sql);
  assert.equal(response.status(), 200, await response.text());
  assert.deepEqual(await rows(database.name, "SELECT * FROM dbo.CommandLog"), [
    { Id: 1, Message: "Portable SQL" },
  ]);
  await page
    .locator(".cm-content")
    .fill("SELECT Id,Title,Status,Priority FROM dbo.WorkItems ORDER BY Id;");
  await page.getByRole("button", { name: "Save query", exact: true }).click();
  await page.getByLabel("Query name").fill("Portable saved query");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  await page.waitForFunction(
    () => !window.exqlPendingWrites && !window.exqlDirty,
  );
  await context.tracing.stop({ path: join(root, "before-restart-trace.zip") });
  tracing = false;
  closeDesktop(root);
  await expect.poll(() => page.isClosed()).toBe(true);

  attached = await launchDesktop(root, 9223);
  ({ page, context } = attached);
  page.on("pageerror", (error) => errors.push(error.stack));
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  tracing = true;
  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect to Portable journey", exact: true })
    .click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "SQL scripts", exact: true }).click();
  await page
    .getByRole("button", { name: "Portable saved query", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toHaveText(
    "SELECT Id,Title,Status,Priority FROM dbo.WorkItems ORDER BY Id;",
  );
  await page.getByRole("button", { name: /Run SQL/ }).click();
  await expect(page.locator("tbody tr")).toHaveCount(200);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(45);
  const downloads = join(root, "downloads");
  await mkdir(downloads);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
    eventsEnabled: true,
  });
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Native download timed out")),
      30_000,
    );
    cdp.on("Browser.downloadProgress", (event) => {
      if (event.state === "completed") {
        clearTimeout(timeout);
        resolve();
      }
      if (event.state === "canceled") {
        clearTimeout(timeout);
        reject(new Error("Native download cancelled"));
      }
    });
  });
  await page
    .getByRole("button", { name: "Export result", exact: true })
    .click();
  await page.getByLabel("Format", { exact: true }).selectOption("json");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await completed;
  assert.deepEqual(
    JSON.parse(await readFile(join(downloads, "query-result.json"), "utf8")),
    await rows(
      database.name,
      "SELECT Id,Title,Status,Priority FROM dbo.WorkItems ORDER BY Id",
    ),
  );
  await page.screenshot({ path: join(root, "desktop-complete.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: portable native API isolation, connect, committed grid edit, SQL mutation, saved query, restart, profile reconnect, pagination and native download; independent DB assertions.",
  );
} catch (error) {
  await writeFile(join(root, "failure.txt"), error.stack ?? String(error));
  if (attached?.page && !attached.page.isClosed())
    await attached.page.screenshot({ path: join(root, "failure.png") });
  throw error;
} finally {
  try {
    if (tracing)
      await attached.context.tracing.stop({
        path: join(root, "desktop-trace.zip"),
      });
    if (attached?.page && !attached.page.isClosed())
      await deleteDesktopProfiles(attached.page);
  } finally {
    closeDesktop(root);
    await database.dispose();
  }
}
process.exit(0);
