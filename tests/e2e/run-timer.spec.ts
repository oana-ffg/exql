import { test, expect } from "../support/fixtures";
import { connect } from "../support/ui";

const seconds = (clock: string | null) => {
  const [minutes, rest] = clock!.split(":").map(Number);
  return minutes * 60 + rest;
};

test("the status bar counts up during a run and reports the total afterwards", async ({
  page,
}) => {
  await page.goto("/");
  await connect(page);
  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  // The run stays open until the checks finish, so a slow machine cannot end it early.
  let finishRun = () => {};
  const held = new Promise<void>((resolve) => (finishRun = resolve));
  await page.route("**/query", async (route) => {
    await held;
    await route.continue();
  });
  await page.locator(".cm-content").fill("SELECT 1 AS Done;");
  await page.getByRole("button", { name: "Run SQL", exact: false }).click();

  const status = page.getByRole("tabpanel").locator(".status-bar");
  const timer = status.locator(".run-timer");
  await expect(status).toContainText("Running SQL");
  await expect(timer).toHaveText(/^\d+:\d\d$/);
  const first = seconds(await timer.textContent());
  await expect
    .poll(async () => seconds(await timer.textContent()))
    .toBeGreaterThan(first);

  finishRun();
  await expect(
    page.getByRole("gridcell", { name: "1", exact: true }),
  ).toBeVisible();
  await expect(timer).toHaveCount(0);
  await expect(status).toContainText(/· (\d+\.\d\ds|\d+:\d\d)/);
});
