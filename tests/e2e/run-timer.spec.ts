import { test, expect } from "../support/fixtures";
import { connect } from "../support/ui";

test("the status bar counts up during a run and reports the total afterwards", async ({
  page,
}) => {
  await page.goto("/");
  await connect(page);
  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await page
    .locator(".cm-content")
    .fill("WAITFOR DELAY '00:00:03'; SELECT 1 AS Done;");
  await page.getByRole("button", { name: "Run SQL", exact: false }).click();

  const status = page.getByRole("tabpanel").locator(".status-bar");
  const timer = status.locator(".run-timer");
  await expect(status).toContainText("Running SQL");
  await expect(timer).toHaveText(/^0:0[0-1]$/);
  await expect(timer).toHaveText("0:02", { timeout: 2_500 });

  await expect(
    page.getByRole("gridcell", { name: "1", exact: true }),
  ).toBeVisible();
  await expect(timer).toHaveCount(0);
  await expect(status).toContainText(/· 3\.\d\ds/);
});
