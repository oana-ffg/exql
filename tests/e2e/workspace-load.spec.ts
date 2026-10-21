import { test, expect } from "@playwright/test";

const library = {
  folders: [],
  queries: [
    {
      id: "saved-query",
      name: "Saved before restart",
      sql: "SELECT 42;",
      folderId: "",
    },
  ],
};

test("waits for both workspace documents before enabling edits", async ({
  page,
}) => {
  const pending: (() => void)[] = [];
  const writes: string[] = [];
  await page.route("**/api/profiles", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/workspace/*", async (route) => {
    if (route.request().method() !== "GET") {
      writes.push(route.request().postData() ?? "");
      await route.fulfill({ status: 204 });
      return;
    }
    await new Promise<void>((resolve) => pending.push(resolve));
    await route.fulfill({
      json: {
        value: route.request().url().endsWith("scratch")
          ? "SELECT 7;"
          : library,
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Loading saved workspace…");
  await expect.poll(() => pending.length).toBe(2);
  expect(await page.evaluate(() => window.exqlWorkspaceReady)).toBe(false);
  await expect(page.locator(".cm-content")).toHaveCount(0);
  expect(writes).toEqual([]);

  pending.shift()!();
  await expect(page.getByRole("status")).toBeVisible();
  pending.shift()!();
  await expect(
    page.getByText("Saved before restart", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.exqlWorkspaceReady)).toBe(true);
  expect(writes).toEqual([]);
  await page.getByText("Saved before restart", { exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveText("SELECT 42;");
});

test("a failed load keeps edits blocked until a successful retry", async ({
  page,
}) => {
  let fail = true;
  let writes = 0;
  await page.route("**/api/profiles", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/workspace/*", (route) => {
    if (route.request().method() !== "GET") {
      writes++;
      return route.fulfill({ status: 204 });
    }
    return fail && route.request().url().endsWith("library")
      ? route.fulfill({ status: 500, json: { error: "Read failed" } })
      : route.fulfill({
          json: {
            value: route.request().url().endsWith("scratch")
              ? "SELECT 7;"
              : library,
          },
        });
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Read failed");
  await expect(page.locator(".cm-content")).toHaveCount(0);
  expect(await page.evaluate(() => window.exqlWorkspaceReady)).toBe(false);
  expect(writes).toBe(0);

  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("Saved before restart", { exact: true }),
  ).toBeVisible();
  expect(writes).toBe(0);
  await page.getByText("Saved before restart", { exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveText("SELECT 42;");
});
