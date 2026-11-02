import type { Page } from "@playwright/test";
import {
  connection,
  databaseName,
  DisposableDatabase,
  rows,
} from "../support/database";
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

test("a tab cannot be edited while it closes, and a retried close saves once", async ({
  page,
}) => {
  await page.goto("/");
  await saveAndConnect(page, "Restore A", databaseName);
  await saveAndConnect(page, "Restore B", databaseName);
  const panel = page.getByRole("tabpanel");
  const sql = "SELECT 1 AS Original;";
  await panel
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await panel.locator(".cm-content").fill(sql);

  let releaseSave!: () => void;
  const saveHeld = new Promise<void>((resolve) => (releaseSave = resolve));
  let saves = 0;
  let path = "";
  await page.route("**/api/temp-queries", async (route) => {
    saves++;
    const response = await route.fetch();
    path = (await response.json()).path;
    await saveHeld;
    await route.fulfill({ response });
  });
  // The session delete fails once, after the SQL was already saved.
  let deletes = 0;
  await page.route("**/api/sessions/*", async (route) => {
    if (route.request().method() === "DELETE" && deletes++ === 0)
      return route.fulfill({ status: 500, json: { error: "Delete failed" } });
    return route.continue();
  });
  const close = page.getByRole("button", {
    name: "Close workspace Restore B",
    exact: true,
  });
  await close.click();
  const workspace = page.locator(".app-shell:not([hidden])");
  await expect.poll(() => saves).toBe(1);
  await expect(workspace).toHaveJSProperty("inert", true);
  await panel
    .locator(".cm-content")
    .press("x", { noWaitAfter: true })
    .catch(() => {
      // An inert editor refuses keyboard focus; the assertion below is what matters.
    });
  releaseSave();
  await expect(page.getByRole("alert")).toContainText("Delete failed");
  await expect(workspace).toHaveJSProperty("inert", false);
  await expect(panel.locator(".cm-content")).toHaveText(sql);
  expect((await readFile(path, "utf8")).replaceAll("\r\n", "\n")).toBe(sql);

  await close.click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  expect(saves).toBe(1);
});

test("clicking connect during a reconnect does not start a second attempt", async ({
  page,
}) => {
  await page.goto("/");
  await saveAndConnect(page, "Restore A", databaseName);
  await expect
    .poll(() => page.evaluate(() => window.exqlPendingWrites))
    .toBe(0);
  let attempts = 0;
  let releaseConnect!: () => void;
  const connectHeld = new Promise<void>(
    (resolve) => (releaseConnect = resolve),
  );
  await page.route(profileConnect, async (route) => {
    attempts++;
    await connectHeld;
    await route.continue();
  });
  await page.reload();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("Reconnecting…", { exact: true })).toBeVisible();
  await expect.poll(() => attempts).toBe(1);
  await panel.locator(".connection-card").click();
  await expect(
    panel.getByRole("button", { name: "Use a different connection" }),
  ).toHaveCount(0);
  releaseConnect();
  await expect(panel.getByText("Connected", { exact: true })).toBeVisible();
  expect(attempts).toBe(1);
});

test("repeated reloads retire their sessions instead of reaching the session limit", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await saveAndConnect(page, "Restore A", databaseName);
  const panel = page.getByRole("tabpanel");
  for (let reload = 0; reload < 22; reload++) {
    await restart(page);
    await expect(panel.getByText("Connected", { exact: true })).toBeVisible();
  }
});

test("reloading during a multi-tab restore does not leak sessions", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const headers = { "X-Exql-Client": "1" };
  const created = await request.post("/api/profiles", {
    headers,
    data: { name: "Restore many", folder: "", connection },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const profile = await created.json();
  const tabs = Array.from({ length: 11 }, (_, index) => ({
    id: `restore-${index}`,
    name: `Restore ${index}`,
    profileId: profile.id,
    sql: "",
  }));
  const saved = await request.post("/api/workspace/scratch", {
    headers,
    data: tabs,
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  // How many more sessions the server accepts right now, which exposes any orphans.
  const capacity = async () => {
    const opened: string[] = [];
    for (;;) {
      const response = await request.post(
        `/api/profiles/${profile.id}/connect`,
        { headers, data: {} },
      );
      if (!response.ok()) break;
      opened.push((await response.json()).id);
    }
    for (const id of opened)
      await request.delete(`/api/sessions/${id}`, { headers });
    return opened.length;
  };
  const before = await capacity();

  await page.goto("/");
  // Each reload lands in the middle of the previous page's reconnects.
  for (let reload = 0; reload < 6; reload++) await page.reload();
  const panel = page.getByRole("tabpanel");
  // Reconnecting renames every tab to the profile's name.
  for (let index = 0; index < tabs.length; index++) {
    await page.getByRole("tab").nth(index).click();
    await expect(panel.getByText("Connected", { exact: true })).toBeVisible();
  }
  await expect(panel.getByRole("alert")).toHaveCount(0);

  // Reconnecting also retires anything left by earlier tests, so capacity can only be higher.
  expect(await capacity()).toBeGreaterThanOrEqual(before - tabs.length);
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
