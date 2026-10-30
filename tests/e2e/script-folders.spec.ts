import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const headers = { "X-Exql-Client": "1" };

test("linked scripts read current disk content, protect edits, run and unlink without changing files", async ({
  page,
  request,
}) => {
  const directory = resolve(
    "artifacts",
    `script-folder-${Date.now()}`,
    "Scripts",
  );
  await mkdir(resolve(directory, "Nested"), { recursive: true });
  await writeFile(resolve(directory, "top.sql"), "SELECT 1 AS answer;");
  await writeFile(
    resolve(directory, "Nested", "inner.sql"),
    "SELECT 2\r\nAS inner_answer;",
  );
  await writeFile(resolve(directory, "notes.txt"), "Ignored");
  const documents: Record<string, unknown> = {
    scratch: "",
    library: {
      folders: [],
      queries: [
        {
          id: "existing",
          name: "Existing query",
          folderId: "",
          sql: "SELECT 9;",
        },
      ],
    },
  };
  await page.route("**/api/workspace/*", (route) => {
    const key = route.request().url().split("/").at(-1)!;
    if (route.request().method() === "GET")
      return route.fulfill({ json: { value: documents[key] } });
    documents[key] = route.request().postDataJSON();
    return route.fulfill({ status: 204 });
  });
  let sessionId: string | undefined;
  let folderId: string | undefined;
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Add connection", exact: true })
      .click();
    await page.getByLabel("Save this connection").uncheck();
    await page
      .getByRole("textbox", { name: "Database", exact: true })
      .fill("ExqlDemo");
    await page
      .getByLabel("Trust server certificate (local development)")
      .check();
    const connected = page.waitForResponse(
      (response) => response.url().endsWith("/api/connect") && response.ok(),
    );
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    sessionId = (await (await connected).json()).id;
    const panel = page.getByRole("tabpanel");
    await panel
      .getByRole("button", { name: "SQL scripts", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Add script folder", exact: true })
      .click();
    await page.getByLabel("Folder path").fill("relative-path");
    await page.getByRole("button", { name: "Add folder", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "fully qualified",
    );
    await page.getByLabel("Folder path").fill(`"${directory}"`);
    const added = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/script-folders") &&
        response.request().method() === "POST" &&
        response.ok(),
    );
    await page.getByRole("button", { name: "Add folder", exact: true }).click();
    folderId = (await (await added).json()).id;
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const folder = panel.locator(".linked-folder").filter({
      has: page.locator(`summary[title=${JSON.stringify(directory)}]`),
    });
    await expect(
      folder.getByRole("button", { name: /^top\.sql/ }),
    ).toBeVisible();
    await expect(
      folder.getByRole("button", { name: /^inner\.sql/ }),
    ).toBeVisible();
    await expect(folder.getByText("notes.txt")).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Existing query", exact: true }),
    ).toBeVisible();
    await folder.getByRole("button", { name: /^inner\.sql/ }).click();
    const editor = panel.locator(".cm-content");
    const lines = panel.locator(".cm-line");
    await expect(lines).toHaveText(["SELECT 2", "AS inner_answer;"]);
    await expect(panel.locator(".query-toolbar strong")).toHaveAttribute(
      "title",
      resolve(directory, "Nested", "inner.sql"),
    );
    await writeFile(
      resolve(directory, "Nested", "inner.sql"),
      "SELECT 3\r\nAS fresh_answer;",
    );
    // Unchanged CRLF files must still count as unmodified editor text.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(lines).toHaveText(["SELECT 3", "AS fresh_answer;"]);
    await expect(panel.getByRole("status")).toContainText(
      "Reloaded inner.sql from disk.",
    );

    await editor.fill("SELECT 4 AS editor_draft;");
    await writeFile(
      resolve(directory, "Nested", "inner.sql"),
      "SELECT 5 AS disk_answer;",
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(panel.getByRole("status")).toContainText(
      "inner.sql changed on disk. Reload from disk to see it.",
    );
    await expect(editor).toHaveText("SELECT 4 AS editor_draft;");
    page.once("dialog", (dialog) => dialog.dismiss());
    await panel
      .getByRole("button", { name: "Reload from disk", exact: true })
      .click();
    await expect(editor).toHaveText("SELECT 4 AS editor_draft;");
    page.once("dialog", (dialog) => dialog.accept());
    await panel
      .getByRole("button", { name: "Reload from disk", exact: true })
      .click();
    await expect(editor).toHaveText("SELECT 5 AS disk_answer;");

    // Play must read disk again and ignore any selection in the previous editor.
    await editor.press("Control+a");
    await writeFile(
      resolve(directory, "top.sql"),
      "SELECT 1 AS answer; -- latest disk version",
    );
    await folder
      .getByRole("button", { name: "Run top.sql", exact: true })
      .click();
    await expect(editor).toHaveText(
      "SELECT 1 AS answer; -- latest disk version",
    );
    await expect(
      panel.getByRole("columnheader", { name: /answer/ }),
    ).toBeVisible();
    await expect(
      panel.getByRole("gridcell", { name: "1", exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole("button", { name: /Run SQL/ })).toBeEnabled();

    // A new file appears on focus, without touching Refresh.
    await writeFile(resolve(directory, "new.sql"), "SELECT 6;");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      folder.getByRole("button", { name: /^new\.sql/ }),
    ).toBeVisible();
    await folder.locator("summary").first().click({ button: "right" });
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("menuitem", { name: "Remove from ExQL…", exact: true })
      .click();
    await expect(folder).toHaveCount(0);
    expect(await readFile(resolve(directory, "top.sql"), "utf8")).toBe(
      "SELECT 1 AS answer; -- latest disk version",
    );
    expect(
      await readFile(resolve(directory, "Nested", "inner.sql"), "utf8"),
    ).toBe("SELECT 5 AS disk_answer;");
  } finally {
    if (sessionId)
      await request.delete(`/api/sessions/${sessionId}`, { headers });
    if (folderId)
      await request.delete(`/api/script-folders/${folderId}`, { headers });
  }
});

test("script API rejects traversal and absolute paths", async ({ request }) => {
  const directory = resolve("artifacts", `script-folder-api-${Date.now()}`);
  await mkdir(directory, { recursive: true });
  const added = await request.post("/api/script-folders", {
    headers,
    data: { path: directory },
  });
  expect(added.ok(), await added.text()).toBeTruthy();
  const { id } = await added.json();
  try {
    for (const path of [
      "..\\x.sql",
      "sub/../../x.sql",
      resolve(directory, "x.sql"),
      "notes.txt",
    ]) {
      const response = await request.get(`/api/script-folders/${id}/script`, {
        headers,
        params: { path },
      });
      expect(response.status(), await response.text()).toBe(400);
    }
  } finally {
    await request.delete(`/api/script-folders/${id}`, { headers });
  }
});
