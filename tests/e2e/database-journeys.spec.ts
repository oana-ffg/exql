import { csvForRows, exactJson, normalizeCsv } from "../support/exports";
import { editedTypeValues } from "../support/type-values";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import {
  connectionFor,
  databaseName,
  DisposableDatabase,
  execute,
  rows,
  settings,
  tableRows,
} from "../support/database";
import {
  connect,
  editCell,
  fillConnection,
  openTable,
  runSql,
} from "../support/ui";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await connect(page);
});

async function save(page: Page) {
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toHaveCount(0);
}

test("Save commits multi-row multi-cell edits; NULL, empty text and Discard remain distinct", async ({
  page,
}) => {
  await openTable(page);
  await editCell(page, 0, "Title", "Committed æøå 日本語");
  await editCell(page, 0, "Priority", "9");
  await editCell(page, 1, "Notes", "");
  await editCell(page, 1, "Active", "false");
  await page.locator('[data-cell="0:6"]').click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Set cell to NULL", exact: true })
    .click();
  await save(page);
  expect(
    await rows(
      databaseName,
      "SELECT Id,Title,Priority,Notes,Active FROM dbo.WorkItems WHERE Id<=2 ORDER BY Id",
    ),
  ).toEqual([
    {
      Id: 1,
      Title: "Committed æøå 日本語",
      Priority: 9,
      Notes: null,
      Active: true,
    },
    {
      Id: 2,
      Title: "Query result export",
      Priority: 2,
      Notes: "",
      Active: false,
    },
  ]);
  const before = await tableRows(databaseName, "WorkItems");
  await editCell(page, 0, "Title", "Discard me");
  await editCell(page, 1, "Priority", "8");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  expect(await tableRows(databaseName, "WorkItems")).toEqual(before);
  await expect(page.locator('[data-cell="0:1"]')).toHaveText(
    "Committed æøå 日本語",
  );
});

test("a concurrent external writer makes Save reject and roll back the entire UI batch", async ({
  page,
}) => {
  await openTable(page);
  await editCell(page, 0, "Title", "Must roll back");
  await editCell(page, 1, "Priority", "9");
  await execute(
    databaseName,
    "UPDATE dbo.WorkItems SET Notes=N'external update' WHERE Id=2;",
  );
  const expected = await tableRows(databaseName, "WorkItems");
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/edit"),
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect((await saved).status()).toBe(409);
  await expect(page.getByRole("alert")).toContainText(/changed|conflict/i);
  expect(await tableRows(databaseName, "WorkItems")).toEqual(expected);
});

test("grid edits round-trip every editable type without numeric, binary or date loss", async ({
  page,
}) => {
  await openTable(page, "TypeSamples");
  const values = editedTypeValues;
  for (const [column, value] of Object.entries(values))
    await editCell(page, 0, column, value);
  await save(page);
  const [actual] = await tableRows(databaseName, "TypeSamples");
  expect(actual).toMatchObject(values);
  expect(actual.Derived).toBe("3");
  for (const [column, value] of Object.entries(values)) {
    const index = await page
      .getByRole("columnheader")
      .evaluateAll(
        (headers, name) =>
          headers.findIndex((header) => header.textContent?.includes(name)) - 1,
        column,
      );
    await expect(page.locator(`[data-cell="0:${index}"]`)).toHaveText(value);
  }
});

test("views, tables without keys and identity/computed/rowversion cells are read-only in the grid", async ({
  page,
}) => {
  for (const table of ["OpenWorkItems", "NoPrimaryKey"]) {
    await openTable(page, table);
    await page.locator('[data-cell="0:0"]').dblclick();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator('[data-cell="0:0"]').click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "Edit cell…", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
  }
  for (const [table, column] of [
    ["WorkItems", "Id"],
    ["WorkItems", "Version"],
    ["TypeSamples", "Derived"],
  ]) {
    await openTable(page, table);
    const index = await page
      .getByRole("columnheader")
      .evaluateAll(
        (headers, name) =>
          headers.findIndex((header) => header.textContent?.includes(name)) - 1,
        column,
      );
    await page.locator(`[data-cell="0:${index}"]`).dblclick();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("SQL editor commits mutations and Ctrl+Enter executes only its selection", async ({
  page,
}) => {
  const response = await runSql(
    page,
    "INSERT dbo.CommandLog VALUES(1,N'inserted'),(2,N'delete'); UPDATE dbo.CommandLog SET Message=N'updated' WHERE Id=1; DELETE dbo.CommandLog WHERE Id=2;",
  );
  expect(response.ok(), await response.text()).toBe(true);
  expect(
    await rows(databaseName, "SELECT * FROM dbo.CommandLog ORDER BY Id"),
  ).toEqual([{ Id: 1, Message: "updated" }]);
  const editor = page.locator(".cm-content");
  await editor.fill(
    "INSERT dbo.CommandLog VALUES(3,N'selected');\nINSERT dbo.CommandLog VALUES(4,N'not selected');",
  );
  await editor.press("Control+Home");
  await editor.press("Shift+End");
  const selected = page.waitForResponse((response) =>
    response.url().endsWith("/query"),
  );
  await editor.press("Control+Enter");
  expect((await selected).ok()).toBe(true);
  expect(
    await rows(databaseName, "SELECT * FROM dbo.CommandLog ORDER BY Id"),
  ).toEqual([
    { Id: 1, Message: "updated" },
    { Id: 3, Message: "selected" },
  ]);
  const sets = await runSql(
    page,
    "SELECT 17 AS FirstValue; SELECT N'第二' AS SecondValue;",
  );
  expect(sets.ok()).toBe(true);
  await expect(page.locator(".result-tab")).toHaveCount(2);
  await expect(
    page.getByRole("gridcell", { name: "17", exact: true }),
  ).toBeVisible();
  await page.locator(".result-tab").nth(1).click();
  await expect(
    page.getByRole("gridcell", { name: "第二", exact: true }),
  ).toBeVisible();
});

test("an error after a committed statement reports failure and preserves the earlier commit", async ({
  page,
}) => {
  const response = await runSql(
    page,
    "INSERT dbo.CommandLog VALUES(1,N'before error'); THROW 50000, 'Expected journey failure', 1; INSERT dbo.CommandLog VALUES(2,N'after error');",
  );
  expect(response.status()).toBe(400);
  await expect(page.getByRole("alert")).toContainText(
    "Expected journey failure",
  );
  expect(await rows(databaseName, "SELECT * FROM dbo.CommandLog")).toEqual([
    { Id: 1, Message: "before error" },
  ]);
});

test("Cancel preserves the first commit, prevents the second and closes the running SQL connection", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await page
    .locator(".cm-content")
    .fill(
      "INSERT dbo.CommandLog VALUES(1,N'before cancel'); WAITFOR DELAY '00:01:00'; INSERT dbo.CommandLog VALUES(2,N'after cancel');",
    );
  await page.getByRole("button", { name: /Run SQL/ }).click();
  await expect
    .poll(() => rows(databaseName, "SELECT * FROM dbo.CommandLog"))
    .toEqual([{ Id: 1, Message: "before cancel" }]);
  const sessions =
    "SELECT session_id FROM sys.dm_exec_sessions WHERE database_id=DB_ID() AND program_name=N'ExQL' AND session_id<>@@SPID";
  expect((await rows(databaseName, sessions)).length).toBe(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Operation cancelled");
  await expect.poll(() => rows(databaseName, sessions)).toEqual([]);
  expect(await rows(databaseName, "SELECT * FROM dbo.CommandLog")).toEqual([
    { Id: 1, Message: "before cancel" },
  ]);
});

async function download(
  page: Page,
  format: string,
  query = false,
  filtered = false,
) {
  await page
    .getByRole("button", {
      name: query ? "Export result" : "Export",
      exact: true,
    })
    .click();
  await page.getByLabel("Format", { exact: true }).selectOption(format);
  if (!query)
    await page
      .getByRole("combobox", { name: "Rows", exact: true })
      .selectOption(filtered ? "filtered" : "all");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = await event;
  expect(await file.failure()).toBeNull();
  return readFile((await file.path())!, "utf8");
}

test("filter, sort, pagination and table/query exports equal independent SQL across every page", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openTable(page);
  await page.getByRole("button", { name: "Add filter", exact: true }).click();
  await page.getByLabel("Filter 1 column").selectOption("Priority");
  await page.getByLabel("Filter 1 operator").selectOption(">=");
  await page.getByLabel("Filter 1 value").fill("3");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await page
    .getByTitle("Sort by Id", { exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Sort descending", exact: true })
    .click();
  const expected = await tableRows(
    databaseName,
    "WorkItems",
    "WHERE Priority>=3 ORDER BY Id DESC",
  );
  const visible = () =>
    page
      .locator("tbody tr")
      .evaluateAll((elements) =>
        elements.map((row) =>
          Array.from(row.querySelectorAll('[role="gridcell"]')).map(
            (cell) => cell.textContent,
          ),
        ),
      );
  const grid = expected.map((row) =>
    Object.values(row).map((value) => value ?? "NULL"),
  );
  await expect.poll(visible).toEqual(grid.slice(0, 200));
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect.poll(visible).toEqual(grid.slice(200));
  await editCell(page, 0, "Title", "Unsaved edits must not appear in exports");
  for (const filtered of [false, true]) {
    const wire = await tableRows(
      databaseName,
      "WorkItems",
      `${filtered ? "WHERE Priority>=3" : ""} ORDER BY Id DESC`,
    );
    const json = exactJson(await download(page, "json", false, filtered));
    const numeric = ["Id", "Priority", "Estimate"];
    const typed = wire.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          value === null
            ? null
            : numeric.includes(key)
              ? { number: value }
              : key === "Active"
                ? value === "true"
                : value,
        ]),
      ),
    );
    expect(json).toEqual(typed);
    const csv = await download(page, "csv", false, filtered);
    expect(normalizeCsv(csv)).toBe(csvForRows(wire));
  }
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  const response = await runSql(
    page,
    "UPDATE dbo.WorkItems SET Priority=Priority+1 WHERE Id=1; SELECT Id,Title,Priority,Notes FROM dbo.WorkItems ORDER BY Id;",
  );
  expect(response.ok()).toBe(true);
  const snapshot = await rows(
    databaseName,
    "SELECT Id,Title,Priority,Notes FROM dbo.WorkItems ORDER BY Id",
  );
  await execute(
    databaseName,
    "UPDATE dbo.WorkItems SET Notes=N'changed after snapshot' WHERE Id=1;",
  );
  expect(JSON.parse(await download(page, "json", true))).toEqual(snapshot);
  const queryCsv = await download(page, "csv", true);
  expect(normalizeCsv(queryCsv)).toBe(csvForRows(snapshot));
  expect(
    await rows(databaseName, "SELECT Priority FROM dbo.WorkItems WHERE Id=1"),
  ).toEqual([{ Priority: 2 }]);
});

test("copied table INSERTs and query SELECTs execute independently and reproduce exact values", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await execute(
    databaseName,
    "INSERT dbo.TypeSamples(Id,LargeInteger,ExactDecimal,EventTime,Payload,NullableText,EmptyText) SELECT Id+1,-LargeInteger,-ExactDecimal,EventTime,NULL,N'日本語 æøå ''quoted''',N'nonempty' FROM dbo.TypeSamples;",
  );
  await openTable(page, "TypeSamples");
  await page.getByLabel("Select all rows on page").check();
  await page.getByLabel("Copy format").selectOption("sql");
  await page.getByRole("button", { name: "Copy 2 rows", exact: true }).click();
  const inserts = await page.evaluate(() => navigator.clipboard.readText());
  const expected = await tableRows(databaseName, "TypeSamples");
  expect(inserts).not.toContain("[Derived]");
  await execute(
    databaseName,
    "SELECT * INTO dbo.TypeSamplesCopy FROM dbo.TypeSamples WHERE 1=0; ALTER TABLE dbo.TypeSamplesCopy DROP COLUMN Derived; ALTER TABLE dbo.TypeSamplesCopy ADD Derived AS (Id+1);",
  );
  await execute(
    databaseName,
    inserts.replaceAll("[dbo].[TypeSamples]", "[dbo].[TypeSamplesCopy]"),
  );
  const actual = await tableRows(databaseName, "TypeSamplesCopy");
  expect(actual).toEqual(expected);
  await execute(
    databaseName,
    "SELECT Id,LargeInteger,ExactDecimal,EventTime,Payload,NullableText,EmptyText,CAST(CASE WHEN Id=1 THEN 1 ELSE 0 END AS bit) AS BitFlag INTO dbo.QueryCopySource FROM dbo.TypeSamples;",
  );
  const expectedQuery = await tableRows(databaseName, "QueryCopySource");
  const response = await runSql(
    page,
    "SELECT * FROM dbo.QueryCopySource ORDER BY Id;",
  );
  expect(response.ok()).toBe(true);
  await page.getByLabel("Select all rows on page").check();
  await page.getByLabel("Copy format").selectOption("sql");
  await page.getByRole("button", { name: "Copy 2 rows", exact: true }).click();
  const select = await page.evaluate(() => navigator.clipboard.readText());
  await execute(
    databaseName,
    `SELECT * INTO dbo.CopiedQuery FROM (${select.replace(/;\s*$/, "")}) AS copied;`,
  );
  const copied = await tableRows(databaseName, "CopiedQuery");
  expect(copied).toEqual(expectedQuery);
});

test("script folder Play executes the latest disk contents in the current database", async ({
  page,
}) => {
  const directory = resolve("artifacts", `sql-play-${databaseName}`);
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, "mutation.sql");
  await writeFile(file, "INSERT dbo.CommandLog VALUES(1,N'old disk content');");
  await page.getByRole("button", { name: "SQL scripts", exact: true }).click();
  await page
    .getByRole("button", { name: "Add script folder", exact: true })
    .click();
  await page.getByLabel("Folder path").fill(directory);
  await page.getByRole("button", { name: "Add folder", exact: true }).click();
  await page.getByRole("button", { name: /^mutation\.sql/ }).click();
  await expect(page.locator(".cm-content")).toHaveText(
    "INSERT dbo.CommandLog VALUES(1,N'old disk content');",
  );
  await writeFile(
    file,
    "INSERT dbo.CommandLog VALUES(2,N'latest disk content');",
  );
  const run = page.waitForResponse((response) =>
    response.url().endsWith("/query"),
  );
  await page
    .getByRole("button", { name: "Run mutation.sql", exact: true })
    .click();
  expect((await run).ok()).toBe(true);
  expect(await rows(databaseName, "SELECT * FROM dbo.CommandLog")).toEqual([
    { Id: 2, Message: "latest disk content" },
  ]);
});

test("two workspaces route grid edits and SQL mutations to their own databases", async ({
  page,
}) => {
  const other = await new DisposableDatabase().create();
  try {
    await openTable(page);
    await editCell(page, 0, "Title", "First database");
    await connect(page, other.name);
    await openTable(page);
    await editCell(page, 0, "Title", "Second database");
    await save(page);
    const second = await runSql(
      page,
      "INSERT dbo.CommandLog VALUES(2,N'second workspace');",
    );
    expect(second.ok()).toBe(true);
    await page.getByRole("tab", { name: new RegExp(databaseName) }).click();
    await save(page);
    const first = await runSql(
      page,
      "INSERT dbo.CommandLog VALUES(1,N'first workspace');",
    );
    expect(first.ok()).toBe(true);
    expect(
      await rows(databaseName, "SELECT Title FROM dbo.WorkItems WHERE Id=1"),
    ).toEqual([{ Title: "First database" }]);
    expect(
      await rows(other.name, "SELECT Title FROM dbo.WorkItems WHERE Id=1"),
    ).toEqual([{ Title: "Second database" }]);
    expect(await rows(databaseName, "SELECT * FROM dbo.CommandLog")).toEqual([
      { Id: 1, Message: "first workspace" },
    ]);
    expect(await rows(other.name, "SELECT * FROM dbo.CommandLog")).toEqual([
      { Id: 2, Message: "second workspace" },
    ]);
  } finally {
    await other.dispose();
  }
});

for (const mode of ["sql", "connectionString"] as const) {
  test(`saved ${mode} profile reconnects with its stored SQL credential`, async ({
    page,
  }) => {
    test.skip(
      !process.env.EXQL_TEST_SQL_USER,
      "Provide EXQL_TEST_SQL_USER/PASSWORD to exercise a real SQL login; CI always provides both.",
    );
    await page
      .getByRole("button", { name: "Add connection", exact: true })
      .click();
    const name = `Stored ${mode}`;
    await page.getByLabel("Connection name", { exact: true }).fill(name);
    const sqlConnection = {
      ...connectionFor(databaseName),
      authentication: "sql",
      username: process.env.EXQL_TEST_SQL_USER!,
      password: process.env.EXQL_TEST_SQL_PASSWORD!,
    };
    if (mode === "sql") {
      await fillConnection(page);
      await page
        .getByRole("combobox", { name: "Authentication", exact: true })
        .selectOption("sql");
      await page
        .getByLabel("Username", { exact: true })
        .fill(sqlConnection.username);
      await page
        .getByLabel("Password", { exact: true })
        .fill(sqlConnection.password);
    } else {
      await page
        .getByLabel("Connection method")
        .selectOption("connectionString");
      const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
      await page
        .getByLabel("Connection string", { exact: true })
        .fill(
          `Server=${quote(settings.server)};Database=${quote(databaseName)};User ID=${quote(sqlConnection.username)};Password=${quote(sqlConnection.password)};Encrypt=True;TrustServerCertificate=True;`,
        );
    }
    await page
      .getByRole("button", { name: "Save & connect", exact: true })
      .click();
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
    await page
      .getByRole("tabpanel")
      .getByRole("button", { name: "Disconnect", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add connection", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Connect to ${name}`, exact: true })
      .click();
    const response = await runSql(
      page,
      "INSERT dbo.CommandLog VALUES(1,N'stored credential');",
    );
    expect(response.ok()).toBe(true);
    expect(await rows(databaseName, "SELECT * FROM dbo.CommandLog")).toEqual([
      { Id: 1, Message: "stored credential" },
    ]);
  });
}
