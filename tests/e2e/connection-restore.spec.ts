import type { Page } from "@playwright/test";
import { databaseName, DisposableDatabase, rows } from "../support/database";
import { readFile } from "node:fs/promises";
import {
  connect,
  editCell,
  fillConnection,
  openTable,
  runSql,
} from "../support/ui";
import { test, expect } from "../support/fixtures";

const profileConnect = "**/api/profiles/*/connect";

async function saveAndConnect(page: Page, name: string, database: string) {
  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await page.getByLabel("Connection name", { exact: true }).fill(name);
  await fillConnection(page, database);
  await page
    .getByRole("button", { name: "Save & connect", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("tab", { selected: true })).toContainText(name);
}

async function restart(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.exqlPendingWrites))
    .toBe(0);
  await page.reload();
}

async function expectStatus(page: Page, tab: string, status: string) {
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await expect(
    page.getByRole("tabpanel").getByText(status, { exact: true }),
  ).toBeVisible();
}

test("saved connection tabs reconnect after a restart without holding a SQL connection", async ({
  page,
}) => {
  const other = await new DisposableDatabase().create();
  try {
    await page.goto("/");
    await saveAndConnect(page, "Restore A", databaseName);
    await saveAndConnect(page, "Restore B", other.name);
    const panel = page.getByRole("tabpanel");
    await panel
      .getByRole("button", { name: "New query SQL", exact: true })
      .click();
    await panel.locator(".cm-content").fill("SELECT DB_NAME() AS CurrentDb;");

    await restart(page);

    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectStatus(page, "Restore A", "Connected");
    await expectStatus(page, "Restore B", "Connected");
    await expect(panel.locator(".cm-content")).toHaveText(
      "SELECT DB_NAME() AS CurrentDb;",
    );
    expect((await runSql(page, "SELECT DB_NAME() AS CurrentDb;")).ok()).toBe(
      true,
    );
    await expect(
      panel.getByRole("gridcell", { name: other.name, exact: true }),
    ).toBeVisible();

    // "Connected" means ExQL can connect, not that a SQL session stays open.
    for (const database of [databaseName, other.name])
      expect(
        await rows(
          database,
          "SELECT session_id FROM sys.dm_exec_sessions WHERE program_name=N'ExQL' AND database_id=DB_ID() AND session_id<>@@SPID",
        ),
      ).toEqual([]);
  } finally {
    await other.dispose();
  }
});

test("a failed reconnect stays on its tab, and Add connection never replaces an offline tab", async ({
  page,
}) => {
  const other = await new DisposableDatabase().create();
  try {
    await page.goto("/");
    await saveAndConnect(page, "Restore A", databaseName);
    await saveAndConnect(page, "Restore B", databaseName);
    await page.route(profileConnect, (route) =>
      route.fulfill({ status: 400, json: { error: "Test login rejected" } }),
    );

    await restart(page);

    const panel = page.getByRole("tabpanel");
    await expectStatus(page, "Restore A", "Offline");
    await expect(panel.getByRole("alert")).toContainText("Test login rejected");
    await page.getByRole("tab", { name: "Restore B", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("Test login rejected");

    await page.getByRole("tab", { name: "Restore A", exact: true }).click();
    await connect(page, other.name);
    await expect(page.getByRole("tab")).toHaveCount(3);
    await expect(
      page.getByRole("tab", { name: "Restore A", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Restore B", exact: true }),
    ).toBeVisible();

    await page.unroute(profileConnect);
    await page.getByRole("tab", { name: "Restore A", exact: true }).click();
    await panel
      .getByRole("button", { name: "Reconnect to Restore A", exact: true })
      .click();
    await expect(panel.getByText("Connected", { exact: true })).toBeVisible();
    await expect(panel.getByRole("alert")).toHaveCount(0);
  } finally {
    await other.dispose();
  }
});

test("a disconnected tab stays offline after a restart until it is reconnected", async ({
  page,
}) => {
  const connects: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/connect")) connects.push(request.url());
  });
  await page.goto("/");
  await saveAndConnect(page, "Restore A", databaseName);
  const panel = page.getByRole("tabpanel");
  await panel.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(panel.getByText("Offline", { exact: true })).toBeVisible();
  connects.length = 0;

  await restart(page);

  await expect(
    panel.getByRole("button", { name: "Reconnect to Restore A", exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("Offline", { exact: true })).toBeVisible();
  expect(connects).toEqual([]);

  await panel
    .getByRole("button", { name: "Reconnect to Restore A", exact: true })
    .click();
  await expect(panel.getByText("Connected", { exact: true })).toBeVisible();

  await restart(page);
  await expect(panel.getByText("Connected", { exact: true })).toBeVisible();
});

test("Entra tabs wait for a click, and a different connection can fill an offline tab", async ({
  page,
}) => {
  const connects: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/connect")) connects.push(request.url());
  });
  await page.goto("/");
  await saveAndConnect(page, "Restore A", databaseName);
  // Entra sign-in opens a browser window, which must never happen at startup.
  await page.route("**/api/profiles", async (route) => {
    const response = await route.fetch();
    const profiles = await response.json();
    await route.fulfill({
      response,
      json: profiles.map((profile: { connection: object }) => ({
        ...profile,
        connection: { ...profile.connection, authentication: "entra" },
      })),
    });
  });
  connects.length = 0;

  await restart(page);

  const panel = page.getByRole("tabpanel");
  const reconnect = panel.getByRole("button", {
    name: "Reconnect to Restore A",
    exact: true,
  });
  await expect(reconnect).toBeVisible();
  expect(connects).toEqual([]);
  await page.unroute("**/api/profiles");

  await panel
    .getByRole("button", { name: "Use a different connection", exact: true })
    .click();
  await page.getByLabel("Save this connection").uncheck();
  await fillConnection(page, databaseName);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(panel.getByText("Connected", { exact: true })).toBeVisible();
});

test("closing a tab keeps its SQL in temp_queries without asking", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto("/");
  await saveAndConnect(page, "Restore A", databaseName);
  await saveAndConnect(page, "Restore B", databaseName);
  const panel = page.getByRole("tabpanel");
  const sql = "SELECT 1 AS Kept;\nGO\nSELECT N'æøå';";
  await panel
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await panel.locator(".cm-content").fill(sql);

  const close = page.getByRole("button", {
    name: "Close workspace Restore B",
    exact: true,
  });
  // A failed save must not lose the text: the tab stays open and says why.
  await page.route("**/api/temp-queries", (route) =>
    route.fulfill({ status: 500, json: { error: "Disk full" } }),
  );
  await close.click();
  await expect(page.getByRole("alert")).toContainText("Disk full");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.unroute("**/api/temp-queries");

  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/api/temp-queries"),
  );
  await close.click();
  const { path } = await (await saved).json();
  await expect(page.getByRole("tab")).toHaveCount(1);
  expect(path).toMatch(
    /temp_queries[\\/]\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_Restore B\.sql$/,
  );
  expect((await readFile(path, "utf8")).replaceAll("\r\n", "\n")).toBe(sql);
  expect(asked).toEqual([]);

  await page.getByRole("button", { name: "SQL scripts", exact: true }).click();
  await expect(
    panel.locator(".linked-folder summary", { hasText: "temp_queries" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /^\d{4}-.*Restore B\.sql/ }),
  ).toBeVisible();
});

test("closing a tab still asks before discarding staged cell edits", async ({
  page,
}) => {
  await page.goto("/");
  await saveAndConnect(page, "Restore A", databaseName);
  await openTable(page);
  await editCell(page, 0, "Title", "staged only");
  const close = page.getByRole("button", {
    name: "Close workspace Restore A",
    exact: true,
  });
  const question = new Promise<string>((resolve) =>
    page.once("dialog", (dialog) => {
      resolve(dialog.message());
      void dialog.dismiss();
    }),
  );
  await close.click();
  expect(await question).toBe(
    "Close Restore A? Its staged cell edits will be discarded.",
  );
  // The tab's name gains a marker while it has staged edits.
  await expect(page.getByRole("tab", { name: /^Restore A/ })).toBeVisible();
});

test("clicking a saved connection connects, and Edit and Delete are only in its menu", async ({
  page,
}) => {
  await page.goto("/");
  await saveAndConnect(page, "Restore A", databaseName);
  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  const row = page.locator(".profile-row");
  await expect(row.getByRole("button")).toHaveCount(1);

  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Connection name", { exact: true })).toHaveValue(
    "Restore A",
  );
  await expect(page.getByRole("tab")).toHaveCount(1);

  await row
    .getByRole("button", { name: "Connect to Restore A", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(2);

  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await row.click({ button: "right" });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete…", exact: true }).click();
  await expect(row).toHaveCount(0);
});
