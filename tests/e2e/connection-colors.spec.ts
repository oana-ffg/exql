import { test, expect } from "@playwright/test";
import { connectionColors } from "../../src/connectionColors";

test("connection colors persist and update open workspaces without reconnecting", async ({
  page,
  request,
}) => {
  const headers = { "X-Exql-Client": "1" };
  const name = `Color verification ${Date.now()}`;
  const ids: string[] = [];
  const sessions: string[] = [];
  const documents: Record<string, unknown> = {
    scratch: "",
    library: { folders: [], queries: [] },
  };
  await page.route("**/api/workspace/*", (route) => {
    const key = route.request().url().split("/").at(-1)!;
    if (route.request().method() === "GET")
      return route.fulfill({ json: { value: documents[key] } });
    documents[key] = route.request().postDataJSON();
    return route.fulfill({ status: 204 });
  });
  page.on("response", async (response) => {
    if (
      /\/api\/profiles\/[^/]+\/connect$/.test(response.url()) &&
      response.ok()
    )
      sessions.push((await response.json()).id);
  });
  const colorOf = (selector: string) =>
    page
      .locator(selector)
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--connection-color").trim(),
      );
  try {
    for (const [index, color] of ["#89b4fa", "#ef8d8d"].entries()) {
      const response = await request.post("/api/profiles", {
        headers,
        data: {
          name: `${name} ${index + 1}`,
          folder: "",
          color,
          connection: {
            server: "localhost",
            database: "ExqlDemo",
            authentication: "windows",
            username: "",
            password: "",
            encrypt: true,
            trustServerCertificate: true,
          },
        },
      });
      expect(response.ok()).toBe(true);
      ids.push((await response.json()).id);
    }
    await page.goto("/");
    for (const index of [1, 2]) {
      await page
        .getByRole("button", { name: "Add connection", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: `Connect to ${name} ${index}`,
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("tab", { name: `${name} ${index}`, exact: true }),
      ).toBeVisible();
      if (index === 1) {
        await page
          .getByRole("tabpanel")
          .getByRole("button", { name: "New query SQL", exact: true })
          .click();
        await page.locator(".cm-content").fill("SELECT 7;");
      }
    }
    await expect.poll(() => colorOf(".connection-tab.active")).toBe("#ef8d8d");
    await page.getByRole("tab", { name: `${name} 1`, exact: true }).click();
    await expect.poll(() => colorOf(".connection-tab.active")).toBe("#89b4fa");
    await page.getByRole("tabpanel").locator(".connection-card").click();
    await page
      .getByRole("button", {
        name: `${name} 1 localhost / ExqlDemo`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("radio", { name: "Blue", exact: true }),
    ).toBeChecked();
    await page.getByRole("radio", { name: "Rose", exact: true }).check();
    await page.screenshot({ path: "artifacts/connection-color-picker.png" });
    await page.getByRole("button", { name: "Save only", exact: true }).click();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    const rose = connectionColors.find(
      (option) => option.name === "Rose",
    )!.value;
    await expect.poll(() => colorOf(".connection-tab.active")).toBe(rose);
    await expect
      .poll(() => colorOf(".app-shell:not([hidden]) .connection-card"))
      .toBe(rose);
    await expect(page.getByRole("tabpanel").locator(".cm-content")).toHaveText(
      "SELECT 7;",
    );
    expect(sessions).toHaveLength(2);
    const saved = await request.get("/api/profiles", { headers });
    expect(
      (await saved.json()).find(
        (profile: { id: string }) => profile.id === ids[0],
      ).color,
    ).toBe(rose);
    await page.screenshot({ path: "artifacts/colored-connections.png" });
    await expect
      .poll(() => page.evaluate(() => window.exqlPendingWrites))
      .toBe(0);
    await page.reload();
    await expect(
      page.getByRole("tab", { name: `${name} 1`, exact: true }),
    ).toBeVisible();
    await expect.poll(() => colorOf(".connection-tab.active")).toBe(rose);
    await page
      .getByRole("button", { name: "Add connection", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Connect to ${name} 1`, exact: true })
      .click();
    await expect
      .poll(() => colorOf(".app-shell:not([hidden]) .connection-card"))
      .toBe(rose);
  } finally {
    for (const id of sessions)
      await request.delete(`/api/sessions/${id}`, { headers });
    for (const id of ids)
      await request.delete(`/api/profiles/${id}`, { headers });
  }
});
