import type { Page } from "@playwright/test";
import {
  connection,
  databaseName,
  DisposableDatabase,
} from "../support/database";
import { connect } from "../support/ui";
import { test, expect } from "../support/fixtures";

const tabNames = (page: Page) =>
  page.locator(".connection-tab-name").allTextContents();
const profileNames = (page: Page) =>
  page.locator(".profile-select strong").allTextContents();
const settled = (page: Page) =>
  expect.poll(() => page.evaluate(() => window.exqlPendingWrites)).toBe(0);

test("dragging tabs reorders them, keeps each workspace, and survives a restart", async ({
  page,
}) => {
  const others = [
    await new DisposableDatabase().create(),
    await new DisposableDatabase().create(),
  ];
  const [a, b, c] = [databaseName, others[0].name, others[1].name];
  try {
    await page.goto("/");
    await connect(page, a);
    const panel = page.getByRole("tabpanel");
    await panel
      .getByRole("button", { name: "New query SQL", exact: true })
      .click();
    await panel.locator(".cm-content").fill("SELECT 'kept';");
    await connect(page, b);
    await connect(page, c);
    await page.getByRole("tab", { name: a, exact: true }).click();
    expect(await tabNames(page)).toEqual([a, b, c]);

    const tab = (name: string) =>
      page.locator(".connection-tab", {
        has: page.getByRole("tab", { name, exact: true }),
      });
    // The right half of the target means after it.
    await tab(a).dragTo(tab(c), {
      targetPosition: { x: 200, y: 10 },
    });
    await expect.poll(() => tabNames(page)).toEqual([b, c, a]);
    // A drag does not change which tab is open.
    await expect(page.getByRole("tab", { selected: true })).toHaveText(a);
    await expect(panel.locator(".cm-content")).toHaveText("SELECT 'kept';");
    await tab(c).dragTo(tab(b), { targetPosition: { x: 5, y: 10 } });
    await expect.poll(() => tabNames(page)).toEqual([c, b, a]);

    const active = page.getByRole("tab", { selected: true });
    await active.focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await expect.poll(() => tabNames(page)).toEqual([c, a, b]);
    await expect(active).toBeFocused();
    await page.keyboard.press("Shift+Home");
    await expect.poll(() => tabNames(page)).toEqual([a, c, b]);
    await page.keyboard.press("Shift+ArrowLeft");
    await expect.poll(() => tabNames(page)).toEqual([a, c, b]);
    await page.keyboard.press("Shift+End");
    await expect.poll(() => tabNames(page)).toEqual([c, b, a]);

    await settled(page);
    await page.reload();
    await expect.poll(() => tabNames(page)).toEqual([c, b, a]);
  } finally {
    for (const database of others) await database.dispose();
  }
});

test("dragging saved connections reorders them within their folder", async ({
  page,
  request,
}) => {
  for (const [name, folder] of [
    ["Alpha", ""],
    ["Bravo", ""],
    ["Charlie", ""],
    ["Delta", "Other"],
  ]) {
    const response = await request.post("/api/profiles", {
      data: { name, folder, connection },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  const savedOrder = async () =>
    (await (await request.get("/api/profiles")).json()).map(
      (profile: { name: string }) => profile.name,
    );
  const row = (name: string) =>
    page.locator(".profile-row", {
      has: page.getByRole("button", {
        name: `Connect to ${name}`,
        exact: true,
      }),
    });

  await page.goto("/");
  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await expect.poll(() => profileNames(page)).toContain("Delta");

  await row("Charlie").dragTo(row("Alpha"), {
    targetPosition: { x: 40, y: 2 },
  });
  await expect
    .poll(() => profileNames(page))
    .toEqual(["Charlie", "Alpha", "Bravo", "Delta"]);
  await expect.poll(savedOrder).toEqual(["Charlie", "Alpha", "Bravo", "Delta"]);

  // Moving between folders would silently edit the connection's folder.
  await row("Alpha").dragTo(row("Delta"));
  await expect
    .poll(() => profileNames(page))
    .toEqual(["Charlie", "Alpha", "Bravo", "Delta"]);

  await row("Alpha").focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(savedOrder).toEqual(["Charlie", "Bravo", "Alpha", "Delta"]);
  // The last in its folder stays there, even with another folder after it.
  await page.keyboard.press("Shift+ArrowDown");
  await expect
    .poll(() => profileNames(page))
    .toEqual(["Charlie", "Bravo", "Alpha", "Delta"]);

  // Saving an edit used to send a connection to the end of the list.
  await page
    .getByRole("button", { name: "Connect to Charlie", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/profiles") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save only", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  // The form stays disabled until the save has fully finished.
  await expect(
    page.getByRole("button", { name: "Save only", exact: true }),
  ).toBeEnabled();
  expect(await profileNames(page)).toEqual([
    "Charlie",
    "Bravo",
    "Alpha",
    "Delta",
  ]);
  expect(await savedOrder()).toEqual(["Charlie", "Bravo", "Alpha", "Delta"]);

  await page.route("**/api/profiles/order", (route) =>
    route.fulfill({ status: 500, json: { error: "Disk is full" } }),
  );
  await row("Bravo").focus();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(page.getByRole("alert")).toContainText(
    "Could not save the new order: Disk is full",
  );
  expect(await profileNames(page)).toEqual([
    "Charlie",
    "Bravo",
    "Alpha",
    "Delta",
  ]);
});

test("the top bar and active tab take the open connection's color", async ({
  page,
  request,
}) => {
  const colors = { Light: "#8ed6ae", Dark: "#bd4545" };
  for (const [name, color] of Object.entries(colors)) {
    const response = await request.post("/api/profiles", {
      data: { name, folder: "", color, connection },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await page.goto("/");
  for (const name of Object.keys(colors)) {
    await page
      .getByRole("button", { name: "Add connection", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Connect to ${name}`, exact: true })
      .click();
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
  }
  const css = (selector: string, property: string) =>
    page
      .locator(selector)
      .evaluate(
        (element, property) =>
          getComputedStyle(element).getPropertyValue(property),
        property,
      );
  const toolbar = () => css(".app-toolbar", "border-bottom-color");
  const activeBorder = () => css(".connection-tab.active", "border-left-color");

  await expect.poll(toolbar).toBe("rgb(189, 69, 69)");
  expect(await activeBorder()).toBe("rgb(189, 69, 69)");

  await page.getByRole("tab", { name: "Light", exact: true }).click();
  await expect.poll(toolbar).toBe("rgb(142, 214, 174)");
  expect(await activeBorder()).toBe("rgb(142, 214, 174)");
});
