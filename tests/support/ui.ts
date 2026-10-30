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
    .getByLabel("Authentication", { exact: true })
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
  await expect(
    page.getByRole("tabpanel").getByText("Connected", { exact: true }),
  ).toBeVisible();
}

export async function openTable(page: Page, table = "WorkItems") {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: table, exact: true })
    .click();
  await expect(page.locator("tbody tr").first()).toBeVisible();
}

export async function editCell(
  page: Page,
  row: number,
  column: string,
  value: string,
) {
  const index = await page
    .getByRole("columnheader")
    .evaluateAll(
      (headers, name) =>
        headers.findIndex((header) => header.textContent?.includes(name)) - 1,
      column,
    );
  expect(index).toBeGreaterThanOrEqual(0);
  await page
    .getByRole("tabpanel")
    .locator(`[data-cell="${row}:${index}"]`)
    .dblclick();
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
