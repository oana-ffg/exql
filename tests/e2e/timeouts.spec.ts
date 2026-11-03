import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { connect } from "../support/ui";

const timeoutSelect = (page: Page) =>
  page.getByRole("combobox", { name: "Timeout for this script" });

async function runAndCaptureTimeout(page: Page, sql: string) {
  await page.locator(".cm-content").fill(sql);
  const request = page.waitForRequest((item) => item.url().endsWith("/query"));
  await page.getByRole("button", { name: "Run SQL", exact: false }).click();
  const sent = (await request).postDataJSON().timeoutSeconds;
  await expect(page.locator(".cancel-button:visible")).toHaveCount(0);
  return sent;
}

test("the default timeout is a saved setting that a script can override", async ({
  page,
}) => {
  await page.goto("/");
  await connect(page);
  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await expect(timeoutSelect(page)).toHaveValue("default");
  await expect(timeoutSelect(page).locator("option:checked")).toHaveText(
    "Default (2 min)",
  );
  expect(await runAndCaptureTimeout(page, "SELECT 1 AS One;")).toBe(120);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Default script timeout" })
    .selectOption({ label: "15 min" });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(timeoutSelect(page).locator("option:checked")).toHaveText(
    "Default (15 min)",
  );
  expect(await runAndCaptureTimeout(page, "SELECT 2 AS Two;")).toBe(900);

  await timeoutSelect(page).selectOption({ label: "1 hour" });
  expect(await runAndCaptureTimeout(page, "SELECT 3 AS Three;")).toBe(3600);
  await timeoutSelect(page).selectOption({ label: "No limit" });
  expect(await runAndCaptureTimeout(page, "SELECT 4 AS Four;")).toBe(0);

  // A custom value in minutes joins the list; bad input keeps the old value.
  page.once("dialog", (dialog) => dialog.accept("45"));
  await timeoutSelect(page).selectOption({ label: "Custom…" });
  await expect(timeoutSelect(page).locator("option:checked")).toHaveText(
    "45 min",
  );
  expect(await runAndCaptureTimeout(page, "SELECT 5 AS Five;")).toBe(2700);
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.type());
    void (dialog.type() === "prompt" ? dialog.accept("soon") : dialog.accept());
  });
  await timeoutSelect(page).selectOption({ label: "Custom…" });
  await expect.poll(() => dialogs).toEqual(["prompt", "alert"]);
  await expect(timeoutSelect(page).locator("option:checked")).toHaveText(
    "45 min",
  );

  await timeoutSelect(page).selectOption("default");
  expect(await runAndCaptureTimeout(page, "SELECT 6 AS Six;")).toBe(900);

  // The default survives a restart; an override belongs to the open tab only.
  await timeoutSelect(page).selectOption({ label: "1 hour" });
  await expect
    .poll(() => page.evaluate(() => window.exqlPendingWrites ?? 0))
    .toBe(0);
  await page.reload();
  await expect(timeoutSelect(page).locator("option:checked")).toHaveText(
    "Default (15 min)",
  );
});

test("a real timeout explains itself and keeps finished batches", async ({
  page,
}) => {
  await page.goto("/");
  await connect(page);
  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  // The shortest choice in the UI is a minute, so the request asks for less.
  await page.route("**/query", (route) =>
    route.continue({
      postData: JSON.stringify({
        ...route.request().postDataJSON(),
        timeoutSeconds: 1,
      }),
    }),
  );
  await runAndCaptureTimeout(page, "WAITFOR DELAY '00:00:20';");
  const alert = page.getByRole("tabpanel").getByRole("alert");
  await expect(alert).toContainText("timed out after 1 sec");
  await expect(alert).toContainText("Timeout next to Run SQL");
  await expect(alert).toContainText("committed");

  await runAndCaptureTimeout(
    page,
    "SELECT 7 AS Finished;\nGO\nWAITFOR DELAY '00:00:20';",
  );
  await expect(alert).toContainText("Stopped at batch 2 of 2");
  await expect(alert).toContainText("starting on script line 3");
  await expect(alert).toContainText("timed out after 1 sec");
  await expect(
    page.getByRole("gridcell", { name: "7", exact: true }),
  ).toBeVisible();
});

test("the server rejects a timeout outside its limits and runs with no limit", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const connected = page.waitForResponse((response) =>
    response.url().endsWith("/api/connect"),
  );
  await connect(page);
  const { id } = await (await connected).json();
  const run = (timeoutSeconds: number) =>
    request.post(`/api/sessions/${id}/query`, {
      data: { sql: "SELECT 1 AS One;", timeoutSeconds },
    });

  for (const invalid of [-1, 86_401]) {
    const response = await run(invalid);
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain("24 hours");
  }
  for (const valid of [0, 86_400]) {
    const response = await run(valid);
    expect(response.ok(), await response.text()).toBe(true);
  }
});
