import { connect, editCell, gridCell, openTable } from "../support/ui";
import { test, expect } from "../support/fixtures";

test("Structure shows each column's declared type and extended properties", async ({
  page,
}) => {
  await page.goto("/");
  await connect(page);
  await openTable(page, "WorkItems");
  const panel = page.getByRole("tabpanel");
  const views = panel.getByRole("group", { name: "Table view" });
  const data = views.getByRole("button", { name: "Data", exact: true });
  const structure = views.getByRole("button", {
    name: "Structure",
    exact: true,
  });
  let structureRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/structure")) structureRequests++;
  });

  // Staged edits survive a look at the structure.
  await editCell(page, 0, "Title", "Edited while browsing");
  await expect(panel.getByText("1 unsaved cell")).toBeVisible();

  await expect(data).toHaveAttribute("aria-pressed", "true");
  await structure.click();
  await expect(structure).toHaveAttribute("aria-pressed", "true");
  const properties = panel.getByRole("region", { name: "Table properties" });
  await expect(properties.locator("dt")).toHaveText(["MS_Description"]);
  await expect(properties.locator("dd")).toHaveText([
    "Work tracked by the team.",
  ]);
  await expect(await gridCell(page, 0, "Column")).toHaveText("Id");
  await expect(await gridCell(page, 0, "Identity")).toHaveText("IDENTITY(1,1)");
  await expect(await gridCell(page, 1, "Data type")).toHaveText(
    "nvarchar(200)",
  );
  await expect(await gridCell(page, 1, "MS_Description")).toHaveText(
    "Short summary — shown in lists.",
  );
  await expect(await gridCell(page, 2, "Owner")).toHaveText("Planning");
  await expect(await gridCell(page, 6, "Data type")).toHaveText(
    "nvarchar(max)",
  );
  await expect(await gridCell(page, 0, "MS_Description")).toHaveText("NULL");
  await expect(panel.getByText("9 columns", { exact: true })).toBeVisible();
  // Filters, exports and paging belong to the data.
  await expect(
    panel.getByRole("button", { name: "Apply filters" }),
  ).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Export" })).toHaveCount(0);
  await expect(panel.getByLabel("Next page")).toHaveCount(0);

  await data.click();
  await expect(await gridCell(page, 0, "Title")).toHaveText(
    "Edited while browsing",
  );
  await expect(panel.getByText("1 unsaved cell")).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await panel.getByRole("button", { name: "Discard changes" }).click();
  await expect(panel.getByText("1 unsaved cell")).toHaveCount(0);

  // Shown again from what was read, and Refresh reads it again.
  await structure.click();
  await expect(await gridCell(page, 1, "Column")).toHaveText("Title");
  expect(structureRequests).toBe(1);
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => structureRequests).toBe(2);
  await expect(structure).toHaveAttribute("aria-pressed", "true");

  // Another table opens on its data.
  await openTable(page, "OpenWorkItems");
  await expect(data).toHaveAttribute("aria-pressed", "true");
  await structure.click();
  await expect(
    panel.getByRole("region", { name: "View properties" }),
  ).toContainText("This view has no extended properties.");
  await expect(await gridCell(page, 3, "Column")).toHaveText("Priority");
  await expect(panel.getByText("4 columns", { exact: true })).toBeVisible();
});
