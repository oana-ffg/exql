import type { Locator } from "@playwright/test";
import { connect, editCell, gridCell, openTable } from "../support/ui";
import { test, expect } from "../support/fixtures";

const arrow = (cell: Locator) => cell.locator(".key-link");

test("foreign key arrows open the referenced row and Back returns", async ({
  page,
}) => {
  await page.goto("/");
  await connect(page);
  await openTable(page, "Assignments");
  const panel = page.getByRole("tabpanel");

  // No arrow on columns without a key, or where the key's value is NULL.
  await expect(arrow(await gridCell(page, 0, "Id"))).toHaveCount(0);
  await expect(arrow(await gridCell(page, 1, "WorkItemId"))).toHaveCount(0);
  await expect(arrow(await gridCell(page, 2, "Country"))).toHaveCount(0);

  // Remember a sort, to prove Back restores the view rather than just the table.
  const sortById = panel.locator(".column-header button").first();
  await sortById.click();
  await expect(await gridCell(page, 0, "Id")).toHaveText("1");
  await sortById.click();
  await expect(await gridCell(page, 0, "Id")).toHaveText("3");
  await expect(await gridCell(page, 2, "WorkItemId")).toHaveText("2");

  const before = await gridCell(page, 2, "WorkItemId");
  await arrow(before).click();
  await expect(
    page.getByRole("heading", { name: "WorkItems", exact: true }),
  ).toBeVisible();
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  await expect(await gridCell(page, 0, "Id")).toHaveText("2");
  await expect(await gridCell(page, 0, "Title")).toHaveText(
    "Query result export",
  );
  // The filter is an ordinary one that can be seen and removed.
  await expect(panel.getByLabel("Filter 1 value")).toHaveValue("2");

  await panel
    .getByRole("button", { name: "Back to Assignments", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Assignments", exact: true }),
  ).toBeVisible();
  await expect(await gridCell(page, 0, "Id")).toHaveText("3");
  await expect(panel.getByRole("button", { name: /^Back to/ })).toHaveCount(0);
});

test("composite keys filter on every column, and a column in two keys offers both", async ({
  page,
}) => {
  await page.goto("/");
  await connect(page);
  await openTable(page, "Assignments");
  const panel = page.getByRole("tabpanel");

  await arrow(await gridCell(page, 0, "RegionCode")).click();
  await expect(
    page.getByRole("heading", { name: "Regions", exact: true }),
  ).toBeVisible();
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  await expect(await gridCell(page, 0, "Name")).toHaveText("Jutland");
  await expect(panel.getByLabel("Filter 2 value")).toHaveValue("2");
  await panel.getByRole("button", { name: "Back to Assignments" }).click();
  await expect(
    page.getByRole("heading", { name: "Assignments", exact: true }),
  ).toBeVisible();

  // Row 2 has a Country but no RegionCode: only the single-column key applies.
  await arrow(await gridCell(page, 1, "Country")).click();
  await expect(
    page.getByRole("heading", { name: "Countries", exact: true }),
  ).toBeVisible();
  await expect(await gridCell(page, 0, "Name")).toHaveText("Sweden");
  await panel.getByRole("button", { name: "Back to Assignments" }).click();
  await expect(
    page.getByRole("heading", { name: "Assignments", exact: true }),
  ).toBeVisible();

  // Row 1 has both, so the arrow asks which one.
  await arrow(await gridCell(page, 0, "Country")).click();
  const menu = page.getByRole("menu", { name: "Referenced tables" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Go to dbo.Regions (Country, RegionCode)",
    "Go to ref.Countries (Country)",
  ]);
  await menu
    .getByRole("menuitem", { name: "Go to ref.Countries (Country)" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Countries", exact: true }),
  ).toBeVisible();
  await expect(await gridCell(page, 0, "Name")).toHaveText("Denmark");
  await expect(page.locator(".tree-item.active")).toHaveText("Countries");

  await panel.getByRole("button", { name: "Back to Assignments" }).click();
  await expect(
    page.getByRole("heading", { name: "Assignments", exact: true }),
  ).toBeVisible();

  // The right-click menu offers the same, so the keyboard can get there too.
  await (await gridCell(page, 0, "WorkItemId")).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Go to dbo.WorkItems (WorkItemId)" })
    .click();
  await expect(
    page.getByRole("heading", { name: "WorkItems", exact: true }),
  ).toBeVisible();

  // Opening a table from the explorer starts a new trail.
  await openTable(page, "Regions");
  await expect(panel.getByRole("button", { name: /^Back to/ })).toHaveCount(0);
});

test("following a key with staged edits asks first, and query results have no arrows", async ({
  page,
}) => {
  await page.goto("/");
  await connect(page);
  await openTable(page, "Assignments");
  const panel = page.getByRole("tabpanel");

  await editCell(page, 0, "WorkItemId", "3");
  let question = "";
  page.once("dialog", (dialog) => {
    question = dialog.message();
    return dialog.dismiss();
  });
  await arrow(await gridCell(page, 0, "WorkItemId")).click();
  await expect
    .poll(() => question)
    .toContain("Discard your unsaved cell edits");
  await expect(
    page.getByRole("heading", { name: "Assignments", exact: true }),
  ).toBeVisible();
  await expect(await gridCell(page, 0, "WorkItemId")).toHaveText("3");

  // The arrow goes where the cell now points.
  page.once("dialog", (dialog) => dialog.accept());
  await arrow(await gridCell(page, 0, "WorkItemId")).click();
  await expect(
    page.getByRole("heading", { name: "WorkItems", exact: true }),
  ).toBeVisible();
  await expect(await gridCell(page, 0, "Id")).toHaveText("3");
  await panel.getByRole("button", { name: "Back to Assignments" }).click();
  await expect(
    page.getByRole("heading", { name: "Assignments", exact: true }),
  ).toBeVisible();
  await expect(await gridCell(page, 0, "WorkItemId")).toHaveText("2");

  await panel
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await panel.locator(".cm-content").fill("SELECT * FROM dbo.Assignments;");
  await panel.getByRole("button", { name: /Run SQL/ }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(3);
  await expect(panel.locator(".key-link")).toHaveCount(0);
});
