import { databaseName } from "../support/database";
import { fillConnection } from "../support/ui";
import { test, expect } from "../support/fixtures";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function connect(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect to database", exact: true })
    .click();
  await page.getByLabel("Save this connection").uncheck();
  await page
    .getByRole("textbox", { name: "Database", exact: true })
    .fill(databaseName);
  await fillConnection(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "WorkItems", exact: true })
    .click();
  await expect(
    page.getByRole("gridcell").filter({ hasText: "Build the data grid" }),
  ).toBeVisible();
}

test("right-click preserves ranges and rows, copies the target, and stages reversible edits", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connect(page);
  const cell = (position: string) => page.locator(`[data-cell="${position}"]`);
  const item = (name: string) =>
    page.getByRole("menuitem", { name, exact: true });
  const clipboard = async () =>
    (await page.evaluate(() => navigator.clipboard.readText())).replaceAll(
      "\r\n",
      "\n",
    );

  await cell("0:1").click();
  await cell("1:2").click({ modifiers: ["Shift"] });
  const expectedRange = await page.locator("tbody tr").evaluateAll((rows) =>
    rows
      .slice(0, 2)
      .map((row) =>
        Array.from(row.querySelectorAll('[role="gridcell"]'))
          .slice(1, 3)
          .map((cell) => cell.textContent)
          .join("\t"),
      )
      .join("\n"),
  );
  await cell("0:2").click({ button: "right" });
  await item("Copy selection").click();
  await expect.poll(clipboard).toBe(expectedRange);
  await cell("2:1").click({ button: "right" });
  const targetText = await cell("2:1").textContent();
  await item("Copy cell").click();
  await expect.poll(clipboard).toBe(targetText);
  await expect(cell("2:1")).toBeFocused();

  for (const row of [0, 1]) {
    await page.locator("tbody tr").nth(row).locator(".row-number").hover();
    await page.getByLabel(`Select row ${row + 1}`, { exact: true }).check();
  }
  await cell("1:1").click({ button: "right" });
  await item("Copy 2 rows as JSON").click();
  expect(JSON.parse(await clipboard())).toHaveLength(2);
  await page
    .locator("tbody tr")
    .nth(3)
    .locator(".row-number")
    .click({ button: "right" });
  await item("Copy row as CSV").click();
  expect(await clipboard()).toContain(await cell("3:1").textContent());

  await cell("0:6").click({ button: "right" });
  await item("Set cell to NULL").click();
  await expect(cell("0:6")).toHaveText("NULL");
  await expect(page.getByText("1 unsaved cell", { exact: true })).toBeVisible();
  await cell("0:6").click({ button: "right" });
  await item("Copy cell").click();
  await expect.poll(clipboard).toBe("NULL");
  await cell("0:6").click({ button: "right" });
  await item("Revert cell edit").click();
  await expect(cell("0:6")).toHaveText(
    "Test keyboard navigation and selection.",
  );
  await expect(page.getByText("1 unsaved cell", { exact: true })).toHaveCount(
    0,
  );
  await cell("0:1").click({ button: "right" });
  await item("Edit cell…").click();
  await expect(page.getByLabel("Cell value")).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await cell("0:0").click({ button: "right" });
  await expect(item("Edit cell…")).toBeDisabled();
  await expect(item("Set cell to NULL")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 850, height: 600 });
  const cornerCell = cell("199:8");
  await cornerCell.scrollIntoViewIfNeeded();
  await cornerCell.click({ button: "right" });
  const bounds = await page.getByRole("menu").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(850);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
  await page.screenshot({ path: "artifacts/context-menu-grid.png" });
  await page.keyboard.press("Escape");
});

test("context menus support keyboard navigation, dismissal, column sorting and filter drafts", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connect(page);
  const cell = page.locator('[data-cell="0:2"]');
  await cell.click();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "Copy cell", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Copy selection", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Filter 1 column")).toHaveValue("Status");
  await expect(page.getByLabel("Filter 1 value")).toHaveValue("In progress");
  await expect(page.locator("tbody tr")).toHaveCount(200);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove filter 1" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(200);

  await page
    .getByTitle("Sort by Id", { exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Sort descending", exact: true })
    .click();
  await expect(page.locator('[data-cell="0:0"]')).toHaveText("245");
  await page
    .getByTitle("Sort by Id", { exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Sort ascending", exact: true })
    .click();
  await expect(page.locator('[data-cell="0:0"]')).toHaveText("1");

  await cell.click();
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(cell).toBeFocused();
  await cell.click({ button: "right" });
  await page.locator(".workspace-header").click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await cell.click({ button: "right" });
  await page
    .locator(".grid-scroll")
    .evaluate((element) => (element.scrollTop = 150));
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("explorer and SQL editor context menus work with read-only results and clipboard errors", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connect(page);
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "WorkItems", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy qualified name" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("[dbo].[WorkItems]");
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "WorkItems", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Write SELECT query" }).click();
  await expect(page.locator(".cm-content")).toContainText(
    "FROM [dbo].[WorkItems];",
  );
  await page.locator(".cm-content").fill("SELECT 42 AS Answer;");
  await page.locator(".cm-content").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Select all", exact: true }).click();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Copy", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("SELECT 42 AS Answer;");
  await page.keyboard.press("Shift+F10");
  await page
    .getByRole("menuitem", { name: "Run selection", exact: true })
    .click();
  await expect(
    page.getByRole("gridcell", { name: "42", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("gridcell", { name: "42", exact: true })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Edit cell…" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "Add filter for this value" }),
  ).toBeDisabled();
  await page.getByRole("menuitem", { name: "Copy row as SQL" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("SELECT 42 AS [Answer];");

  await page.evaluate(() =>
    navigator.clipboard.writeText("SELECT 7 AS Pasted;"),
  );
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Paste", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveText("SELECT 7 AS Pasted;");
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Undo", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveText("SELECT 42 AS Answer;");
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Redo", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveText("SELECT 7 AS Pasted;");

  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error("Clipboard unavailable");
    };
  });
  await page
    .getByRole("gridcell", { name: "42", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy cell", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Copy failed: Clipboard unavailable",
  );
  await page.locator(".cm-content").fill("SELECT 1 AS Empty WHERE 1 = 0;");
  await page.getByRole("button", { name: /Run SQL/ }).click();
  await expect(page.getByText("No rows match this view.")).toBeVisible();
  await page.getByText("No rows match this view.").click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page
    .getByRole("columnheader", { name: /Empty/ })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Copy column values" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "Sort ascending" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});
test("spreadsheet selection, cell editing, filtering and downloads against SQL Server", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connect(page);
  await page.locator('[data-cell="0:1"]').click();
  await page.keyboard.press("Control+c");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("Build the data grid");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Control+c");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("Build the data grid\tIn progress");
  // Checkbox labels are kept off the cell canvas until row hover.
  await page.locator("tbody tr").nth(0).locator(".row-number").hover();
  await page.getByLabel("Select row 1", { exact: true }).check();
  await page.locator("tbody tr").nth(1).locator(".row-number").hover();
  await page.getByLabel("Select row 2", { exact: true }).check();
  for (const format of ["json", "csv", "sql"]) {
    await page.getByLabel("Copy format").selectOption(format);
    await page
      .getByRole("button", { name: "Copy 2 rows", exact: true })
      .click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    if (format === "json") expect(JSON.parse(copied)).toHaveLength(2);
    if (format === "csv") expect(copied).toContain('"Build the data grid"');
    if (format === "sql") {
      expect(copied.match(/INSERT INTO/g)).toHaveLength(2);
      expect(copied).not.toContain("[Version]");
    }
  }
  await page.locator('[data-cell="0:6"]').dblclick();
  await page.getByLabel("Cell value").fill("UI verification edit");
  await page.getByRole("button", { name: "Apply to grid" }).click();
  await expect(page.getByText("1 unsaved cell", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  await expect(page.locator('[data-cell="0:6"]')).toHaveText(
    "UI verification edit",
  );
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.getByLabel("Filter 1 column").selectOption("Status");
  await page.getByLabel("Filter 1 value").fill("Open");
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.getByLabel("Filter 2 column").selectOption("Priority");
  await page.getByLabel("Filter 2 value").fill("1");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Format", { exact: true }).selectOption("json");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = await download;
  expect(JSON.parse(await readFile((await file.path())!, "utf8"))).toHaveLength(
    245,
  );
  await page.screenshot({ path: "artifacts/grid.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("query editor, result sets, saved folders and query exports", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let folderName = `Verification ${Date.now()}`;
  await connect(page);
  await page.getByRole("button", { name: "SQL scripts", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept(folderName));
  await page
    .getByRole("button", { name: "New query folder", exact: true })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: folderName })
    .click({ button: "right" });
  folderName += " renamed";
  page.once("dialog", (dialog) => dialog.accept(folderName));
  await page.getByRole("menuitem", { name: "Rename folder…" }).click();
  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await page
    .locator(".cm-content")
    .fill(
      "SELECT TOP (3) Id, Title FROM dbo.WorkItems ORDER BY Id; SELECT 42 AS Answer;",
    );
  await page.getByRole("button", { name: "Run SQL", exact: false }).click();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: /Result 2/ }).click();
  await expect(
    page.getByRole("gridcell", { name: "42", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Export result", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  expect(await readFile((await (await download).path())!, "utf8")).toContain(
    '"42"',
  );
  await page.getByRole("button", { name: "Save query", exact: true }).click();
  await page.getByLabel("Query name").fill("Work item sample");
  await page
    .getByLabel("Folder", { exact: true })
    .selectOption({ label: folderName });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save query", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Work item sample", exact: true }).first(),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.exqlPendingWrites ?? 0))
    .toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "SQL scripts", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Work item sample", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Work item sample", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy SQL", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("SELECT TOP (3)");
  await page
    .getByRole("button", { name: "Work item sample", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open query", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("SELECT TOP (3)");
  await page.screenshot({ path: "artifacts/query.png", fullPage: true });
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete query Work item sample", exact: true })
    .locator("..")
    .getByRole("button", { name: "Work item sample", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete saved query…" }).click();
  await page
    .locator("summary")
    .filter({ hasText: folderName })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete empty folder" }).click();
});

test("copies every result set, beyond the loaded page, as one text block", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connect(page);
  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await page
    .locator(".cm-content")
    .fill(
      "SELECT TOP (250) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects; SELECT N'has ``` fence' AS Note, NULL AS Missing; PRINT 'copy check';",
    );
  await page.getByRole("button", { name: /Run SQL/ }).click();
  await expect(page.locator("tbody tr")).toHaveCount(200);
  await page
    .getByRole("button", { name: "Copy all as text", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Copied 2 results as text.",
  );
  const text = (
    await page.evaluate(() => navigator.clipboard.readText())
  ).replaceAll("\r\n", "\n");
  const rows = Array.from({ length: 250 }, (_, i) => `"${i + 1}"`).join("\n");
  expect(text).toBe(
    `Result 1 of 2 · 250 rows\n\`\`\`csv\n"n"\n${rows}\n\`\`\`\n\n` +
      `Result 2 of 2 · 1 row\n\`\`\`\`csv\n"Note","Missing"\n"has \`\`\` fence",\n\`\`\`\`\n\n` +
      "Messages\n```text\ncopy check\n```",
  );
});
