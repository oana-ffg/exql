import { test, expect, type Page } from "@playwright/test";

async function isolatedWorkspace(page: Page) {
  const documents: Record<string, unknown> = {
    scratch: "",
    library: { folders: [], queries: [] },
  };
  await page.route("**/api/workspace/*", async (route) => {
    const key = route.request().url().split("/").at(-1)!;
    if (route.request().method() === "GET")
      return route.fulfill({ json: { value: documents[key] } });
    documents[key] = route.request().postDataJSON();
    return route.fulfill({ status: 204 });
  });
  return documents;
}
async function connect(page: Page, database: string) {
  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await page.getByLabel("Save this connection").uncheck();
  await page
    .getByRole("textbox", { name: "Database", exact: true })
    .fill(database);
  await page.getByLabel("Trust server certificate (local development)").check();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("tabpanel").getByText("Connected", { exact: true }),
  ).toBeVisible();
}

test("independent database workspaces preserve edits, run concurrently, and restore drafts", async ({
  page,
  request,
}) => {
  await isolatedWorkspace(page);
  const sessions: string[] = [];
  const deleted: string[] = [];
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/connect") && response.ok())
      sessions.push((await response.json()).id);
  });
  page.on("request", (request) => {
    if (request.method() === "DELETE") deleted.push(request.url());
  });
  const panel = page.getByRole("tabpanel");
  const editor = panel.locator(".cm-content");
  try {
    await page.goto("/");
    await connect(page, "ExqlDemo");
    await panel.getByRole("button", { name: "WorkItems", exact: true }).click();
    await panel.getByRole("button", { name: "Add filter" }).click();
    await panel.getByLabel("Filter 1 value").fill("kept draft");
    await panel.locator('[data-cell="0:6"]').dblclick();
    await page.getByLabel("Cell value").fill("staged only, never committed");
    await page.getByRole("button", { name: "Apply to grid" }).click();

    await connect(page, "master");
    await expect(page.getByRole("tab")).toHaveCount(2);
    expect(deleted).toEqual([]);
    await panel
      .getByRole("button", { name: "New query SQL", exact: true })
      .click();
    await editor.fill("SELECT DB_NAME() AS DatabaseName;");
    await panel.getByRole("button", { name: /Run SQL/ }).click();
    await expect(
      panel.getByRole("gridcell", { name: "master", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: "artifacts/multiple-databases.png" });

    await page.getByRole("tab", { name: /ExqlDemo/ }).click();
    await expect(panel.getByLabel("Filter 1 value")).toHaveValue("kept draft");
    await expect(panel.locator('[data-cell="0:6"]')).toHaveText(
      "staged only, never committed",
    );
    expect(await page.evaluate(() => window.exqlDirty)).toBe(true);
    page.once("dialog", (dialog) => dialog.accept());
    await panel
      .getByRole("button", { name: "New query SQL", exact: true })
      .click();
    await editor.fill(
      "WAITFOR DELAY '00:00:04'; SELECT DB_NAME() AS DatabaseName;",
    );
    await panel.getByRole("button", { name: /Run SQL/ }).click();
    await expect(
      panel.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /master/ }).click();
    await expect(editor).toHaveText("SELECT DB_NAME() AS DatabaseName;");
    expect(await page.evaluate(() => window.exqlDirty)).toBe(true);
    await panel.getByRole("button", { name: /Run SQL/ }).click();
    await expect(
      panel.getByRole("gridcell", { name: "master", exact: true }),
    ).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.exqlDirty)).toBe(false);
    await page.getByRole("tab", { name: /ExqlDemo/ }).click();
    await expect(
      panel.getByRole("gridcell", { name: "ExqlDemo", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /master/ }).click();
    await panel
      .getByRole("button", { name: "Disconnect", exact: true })
      .click();
    await expect(panel.getByText("Offline", { exact: true })).toBeVisible();
    expect(deleted).toHaveLength(1);
    await page.getByRole("tab", { name: /ExqlDemo/ }).click();
    await expect(panel.getByText("Connected", { exact: true })).toBeVisible();
    await expect(
      panel.getByRole("gridcell", { name: "ExqlDemo", exact: true }),
    ).toBeVisible();

    await page.route("**/api/connect", (route) =>
      route.fulfill({
        status: 400,
        json: { error: "Test connection rejected" },
      }),
    );
    await page
      .getByRole("button", { name: "Add connection", exact: true })
      .click();
    await page.getByLabel("Save this connection").uncheck();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
      "Test connection rejected",
    );
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    expect(deleted).toHaveLength(1);
    await expect(panel.getByText("Connected", { exact: true })).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => window.exqlPendingWrites))
      .toBe(0);
    await page.reload();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(editor).toContainText("WAITFOR DELAY");
    await page.getByRole("tab", { name: /master/ }).click();
    await expect(editor).toHaveText("SELECT DB_NAME() AS DatabaseName;");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: /Close workspace master/ }).click();
    await expect(page.getByRole("tab")).toHaveCount(2);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /Close workspace master/ }).click();
    await expect(page.getByRole("tab")).toHaveCount(1);
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: /Close workspace ExqlDemo/ })
      .click();
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(
      page.getByRole("tab", { name: "Workspace", exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole("grid")).toHaveCount(0);
    await expect(panel.locator(".cm-content")).toHaveCount(0);
  } finally {
    for (const id of sessions)
      await request.delete(`/api/sessions/${id}`, {
        headers: { "X-Exql-Client": "1" },
      });
  }
});

test("automatic update checks stay quiet and update notices can be dismissed", async ({
  page,
}) => {
  await isolatedWorkspace(page);
  await page.addInitScript(() => {
    const listeners = new Set<(event: unknown) => void>();
    let status = "current";
    const send = () => {
      for (const receive of listeners)
        receive({
          data: {
            type: "updates",
            state: {
              status,
              currentVersion: "0.1.1",
              availableVersion: status === "ready" ? "0.1.2" : null,
              progress: 0,
              message: null,
            },
          },
        });
    };
    Object.assign((window.chrome ??= {}), {
      webview: {
        addEventListener: (_type: string, receive: (event: unknown) => void) =>
          listeners.add(receive),
        removeEventListener: (
          _type: string,
          receive: (event: unknown) => void,
        ) => listeners.delete(receive),
        postMessage: (message: string) => {
          if (message === "updates.status" || message === "updates.check")
            send();
        },
      },
    });
    window.addEventListener("test-update-ready", () => {
      status = "ready";
      send();
    });
  });
  await page.goto("/");
  await expect(page.locator(".update-version")).toHaveText("ExQL 0.1.1");
  await expect(page.locator(".update-notice")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(page.locator(".update-message")).toHaveText(
    "You’re up to date.",
  );
  await page.getByRole("button", { name: "Dismiss update notice" }).click();
  await expect(page.locator(".update-notice")).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("test-update-ready")),
  );
  await expect(page.locator(".update-message")).toContainText("0.1.2");
  await page.getByRole("button", { name: "Dismiss update notice" }).click();
  await expect(page.locator(".update-notice")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Restart to update" }),
  ).toBeVisible();
});
