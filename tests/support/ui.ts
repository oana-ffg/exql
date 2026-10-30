import { expect, type Page } from "@playwright/test";
import { connectionFor, databaseName } from "./database.ts";

export async function fillConnection(page: Page, database = databaseName) {
  const connection = connectionFor(database);
  await page
    .getByRole("textbox", { name: "Server", exact: true })
    .fill(connection.server);
  await page
    .getByRole("textbox", { name: "Database", exact: true })
    .fill(database);
  await page
    .getByRole("combobox", { name: "Authentication", exact: true })
    .selectOption(connection.authentication);
  if (connection.authentication === "sql") {
    await page
      .getByLabel("Username", { exact: true })
      .fill(connection.username);
    await page
      .getByLabel("Password", { exact: true })
      .fill(connection.password);
  }
  await page.getByLabel("Trust server certificate (local development)").check();
}

export async function connect(page: Page, database = databaseName) {
  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await page.getByLabel("Save this connection").uncheck();
  await fillConnection(page, database);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("tab", { selected: true })).toContainText(
    database,
  );
  await expect(
    page.getByRole("tabpanel").getByText("Connected", { exact: true }),
  ).toBeVisible();
}

export async function openTable(page: Page, table = "WorkItems") {
  const loaded = page.waitForResponse(
    (response) =>
      response.url().endsWith("/table") &&
      response.request().postDataJSON()?.table === table,
  );
  await page
    .getByRole("complementary")
    .getByRole("button", {
      name: table === "OpenWorkItems" ? `${table} view` : table,
      exact: true,
    })
    .click();
  const response = await loaded;
  expect(response.ok(), await response.text()).toBe(true);
  await expect(
    page.getByRole("heading", { name: table, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tabpanel").locator("tbody tr").first(),
  ).toBeVisible();
}

/** The visible grid's cell for a column, matched by its exact name. */
export async function gridCell(page: Page, row: number, column: string) {
  const panel = page.getByRole("tabpanel");
  const index = await panel
    .getByRole("columnheader")
    .evaluateAll(
      (headers, name) =>
        headers.findIndex(
          (header) => header.querySelector("strong")?.textContent === name,
        ) - 1,
      column,
    );
  expect(index, `Grid column ${column}`).toBeGreaterThanOrEqual(0);
  return panel.locator(`[data-cell="${row}:${index}"]`);
}

export async function editCell(
  page: Page,
  row: number,
  column: string,
  value: string,
) {
  await (await gridCell(page, row, column)).dblclick();
  const nullChoice = page.getByLabel("Set to NULL", { exact: true });
  if (await nullChoice.count()) await nullChoice.uncheck();
  await page.getByLabel("Cell value").fill(value);
  await page
    .getByRole("button", { name: "Apply to grid", exact: true })
    .click();
}

export async function runSql(page: Page, sql: string) {
  const panel = page.getByRole("tabpanel");
  await panel
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await panel.locator(".cm-content").fill(sql);
  const response = page.waitForResponse(
    (response) =>
      /\/query$/.test(response.url()) && response.request().method() === "POST",
  );
  await panel.getByRole("button", { name: /Run SQL/ }).click();
  return response;
}
