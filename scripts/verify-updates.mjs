import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium, expect } from "@playwright/test";

// The PowerShell runner supplies a fresh app folder and two real Velopack releases.
const root = resolve(process.argv[2] ?? "artifacts/update-test");
const app = join(root, "app", "ExQL.exe");
const data = join(root, "state");
const feed = join(root, "live-feed");
const packages = resolve(process.argv[3] ?? join(root, "feed"));
const endpoint = "http://127.0.0.1:9224";
// Never connect this test to another app that is already using the debug port.
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", () =>
    reject(
      new Error(
        "Port 9224 is already in use. Close the previous test instance first.",
      ),
    ),
  );
  probe.listen(9224, "127.0.0.1", () => probe.close(resolve));
});
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

async function attach(version) {
  let attached;
  await expect
    .poll(
      async () => {
        try {
          if (
            !(
              await fetch(`${endpoint}/json/version`, {
                signal: AbortSignal.timeout(1500),
              })
            ).ok
          )
            return false;
          const browser = await chromium.connectOverCDP(endpoint, {
            timeout: 2000,
          });
          const page =
            browser
              .contexts()[0]
              .pages()
              .find((item) => item.url().startsWith("http://127.0.0.1:")) ??
            browser.contexts()[0].pages()[0];
          if (!page) return false;
          await expect(page.locator(".update-version")).toHaveText(
            `ExQL ${version}`,
            { timeout: 5000 },
          );
          attached = { browser, page };
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 45_000 },
    )
    .toBe(true);
  return attached;
}

let page;
const errors = [];
try {
  spawn(
    app,
    [
      "--automation-port",
      "9224",
      "--data-directory",
      data,
      "--automation-update-directory",
      feed,
    ],
    { cwd: root, windowsHide: true, stdio: "ignore" },
  ).unref();
  ({ page } = await attach("0.0.1"));
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
  await page
    .getByRole("textbox", { name: "Database", exact: true })
    .fill("ExqlDemo");
  await page.getByLabel("Trust server certificate (local development)").check();
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

  await page.getByRole("button", { name: "Restart to update" }).click();
  await expect.poll(() => page.isClosed(), { timeout: 30_000 }).toBe(true);
  ({ page } = await attach("0.0.2"));
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
    await page
      .screenshot({ path: join(root, "update-failure.png") })
      .catch(() => {});
  throw error;
} finally {
  // Close only the test executable, never the user's other ExQL windows.
  const executable = join(root, "app", "current", "ExQL.exe").replaceAll(
    "'",
    "''",
  );
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Get-Process ExQL -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${executable}' } | ForEach-Object { [void]$_.CloseMainWindow(); if (!$_.WaitForExit(3000)) { $_.Kill() } }; exit 0`,
    ],
    { windowsHide: true },
  );
}
process.exit(0);
