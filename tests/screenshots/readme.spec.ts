import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { connectionColors } from "../../src/connectionColors";
import { connectionFor, execute } from "../support/database";
import {
  editCell,
  gridCell,
  openTable,
  runSql,
  stubFolderPicker,
} from "../support/ui";

// Regenerates docs/screenshots from the real UI and a disposable database, with
// `npm run screenshots`. The database name shows in the shots, so it is a plain
// word rather than a random test name. CREATE DATABASE refuses a name that exists,
// and only a database this run created is dropped.
const database = "Bookshop";
const color = (name: string) =>
  connectionColors.find((option) => option.name === name)!.value;
const profiles = [
  { name: "Bookshop Dev", folder: "Development", color: color("Light green") },
  { name: "Bookshop QA", folder: "Testing", color: color("Light amber") },
  { name: "Bookshop Prod", folder: "Production", color: color("Dark red") },
];
const scripts = {
  "daily-sales.sql":
    "SELECT OrderedOn, SUM(Total) AS Sales\nFROM dbo.Orders\nGROUP BY OrderedOn\nORDER BY OrderedOn;\n",
  "low-stock.sql":
    "SELECT Title, InStock\nFROM dbo.Books\nWHERE InStock < 10\nORDER BY InStock;\n",
  "open-orders.sql": "SELECT *\nFROM dbo.OpenOrders\nORDER BY Id;\n",
};

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `docs/screenshots/${name}.png` });

let created = false;
const profileIds: string[] = [];
let scriptRoot = "";
let scriptFolder = "";

test.beforeAll(async ({ request }) => {
  await execute("master", `CREATE DATABASE [${database}];`);
  created = true;
  const fixture = await readFile(
    new URL("./bookshop.sql", import.meta.url),
    "utf8",
  );
  for (const batch of fixture.split(/^\s*GO\s*$/gim))
    if (batch.trim()) await execute(database, batch);
  for (const profile of profiles) {
    const response = await request.post("/api/profiles", {
      data: { ...profile, connection: connectionFor(database) },
    });
    expect(response.ok(), await response.text()).toBe(true);
    profileIds.push((await response.json()).id);
  }
  // The folder's name shows in the sidebar.
  scriptRoot = await mkdtemp(join(tmpdir(), "exql-screenshot-scripts-"));
  scriptFolder = join(scriptRoot, "Reports");
  await mkdir(scriptFolder);
  for (const [name, sql] of Object.entries(scripts))
    await writeFile(join(scriptFolder, name), sql, "utf8");
});

// Each step runs even if an earlier one fails. Deleting a profile through the API
// also removes its Windows credential, which the host's data directory doesn't hold.
test.afterAll(async ({ request }) => {
  try {
    for (const id of profileIds) {
      const response = await request.delete(`/api/profiles/${id}`);
      expect(response.ok(), await response.text()).toBe(true);
    }
  } finally {
    try {
      if (scriptRoot) await rm(scriptRoot, { recursive: true });
    } finally {
      if (created)
        await execute(
          "master",
          `ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}];`,
        );
    }
  }
});

test("README screenshots", async ({ page }) => {
  // Discarding staged edits asks for confirmation.
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  for (const { name } of profiles) {
    await page
      .getByRole("button", { name: "Add connection", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Connect to ${name}`, exact: true })
      .click();
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
    await expect(
      page.getByRole("tabpanel").getByText("Connected", { exact: true }),
    ).toBeVisible();
  }
  const panel = page.getByRole("tabpanel");
  const back = panel.getByRole("button", {
    name: "Back to Orders",
    exact: true,
  });

  await openTable(page, "Orders");
  await (await gridCell(page, 2, "Status")).click();
  await shot(page, "data-grid");

  await (await gridCell(page, 1, "Status")).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await shot(page, "context-menu");
  await page.keyboard.press("Escape");

  await (await gridCell(page, 0, "CustomerId")).locator(".key-link").click();
  await expect(back).toBeVisible();
  await shot(page, "foreign-keys");
  await back.click();

  await panel.getByRole("button", { name: "Add filter" }).click();
  await panel.getByLabel("Filter 1 column").selectOption("Status");
  await panel.getByLabel("Filter 1 value").fill("Pending");
  await panel.getByRole("button", { name: "Apply filters" }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(4);
  await editCell(page, 0, "Status", "Shipped");
  await expect(
    panel.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeVisible();
  await shot(page, "staged-edits");
  await panel.getByRole("button", { name: /^Discard/ }).click();

  const query = await runSql(
    page,
    `SELECT c.Name, c.Country, COUNT(*) AS Orders, SUM(o.Total) AS Spent
FROM dbo.Orders AS o
JOIN dbo.Customers AS c ON c.Id = o.CustomerId
WHERE o.Status <> N'Cancelled'
GROUP BY c.Name, c.Country
ORDER BY Spent DESC;

SELECT Title, InStock
FROM dbo.Books
WHERE InStock < 10
ORDER BY InStock;`,
  );
  expect(query.ok(), await query.text()).toBe(true);
  await expect(
    panel.getByRole("button", { name: /Export result/ }),
  ).toBeVisible();
  await shot(page, "sql-editor");

  await stubFolderPicker(page, { path: scriptFolder });
  await panel.getByRole("button", { name: "SQL scripts", exact: true }).click();
  await panel
    .getByRole("button", { name: "Add script folder", exact: true })
    .click();
  await panel
    .getByRole("button", { name: /daily-sales\.sql/ })
    .first()
    .click();
  await expect(panel.locator(".cm-content")).toContainText("Sales");
  await panel.getByRole("button", { name: /Run SQL/ }).click();
  await expect(
    panel.getByRole("columnheader", { name: /Sales/ }),
  ).toBeVisible();
  await shot(page, "sql-scripts");

  await panel.locator(".connection-card").click();
  await page
    .getByRole("button", {
      name: `Connect to ${profiles[2].name}`,
      exact: true,
    })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Custom connection color")).toBeVisible();
  await shot(page, "connections");
});
