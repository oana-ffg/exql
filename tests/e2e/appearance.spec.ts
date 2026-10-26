import { test, expect } from "@playwright/test";

test("uses saved connection names and contains long metadata at narrow window sizes", async ({
  page,
}) => {
  const database = "ReportingWarehouse_".repeat(18);
  const server = `tcp:${"long-server-name-".repeat(8)}.database.windows.net,1433`;
  const names = [
    "Primary reporting",
    "Secondary reporting",
    "Long saved connection name ".repeat(8),
    "Fourth connection",
  ];
  const profiles = names.map((name, index) => ({
    id: `profile-${index}`,
    name,
    folder: "",
    connection: {
      database,
      server,
      authentication: "windows",
      username: "",
      password: null,
      encrypt: true,
      trustServerCertificate: false,
    },
  }));
  const documents: Record<string, unknown> = {
    scratch: [{ id: "existing", name: `${database} · ${server}`, sql: "" }],
    library: { folders: [], queries: [] },
  };
  await page.route("**/api/workspace/*", (route) => {
    const key = route.request().url().split("/").at(-1)!;
    if (route.request().method() === "GET")
      return route.fulfill({ json: { value: documents[key] } });
    documents[key] = route.request().postDataJSON();
    return route.fulfill({ status: 204 });
  });
  await page.route("**/api/profiles", (route) =>
    route.fulfill({ json: profiles }),
  );
  await page.route("**/api/profiles/*/connect", (route) => {
    const id = route.request().url().split("/").at(-2)!;
    const profile = profiles.find((profile) => profile.id === id)!;
    return route.fulfill({
      json: {
        id,
        name: profile.name,
        database,
        server,
        serverVersion: "16",
        catalog: Array.from({ length: 500 }, (_, index) => ({
          schema: "dbo",
          name: `Table${index}`,
          kind: "table",
        })),
      },
    });
  });
  await page.addInitScript(() => {
    Object.assign((window.chrome ??= {}), {
      webview: {
        addEventListener: (
          _type: string,
          receive: (event: unknown) => void,
        ) => {
          queueMicrotask(() =>
            receive({
              data: {
                type: "updates",
                state: {
                  status: "current",
                  currentVersion: "0.1.3",
                  availableVersion: null,
                  progress: 0,
                  message: null,
                },
              },
            }),
          );
        },
        removeEventListener: () => {},
        postMessage: () => {},
      },
    });
  });
  await page.goto("/");
  for (const name of names) {
    await page
      .getByRole("button", { name: "Add connection", exact: true })
      .click();
    await page
      .getByRole("button", { name: `Connect to ${name}`, exact: true })
      .click();
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
    await expect(
      page.getByRole("tabpanel").locator(".connection-card strong"),
    ).toHaveText(name);
  }
  await page.getByRole("tab", { name: names[2], exact: true }).click();
  for (const width of [1440, 850]) {
    await page.setViewportSize({ width, height: 600 });
    await expect
      .poll(() =>
        page.locator(".connection-tab.active").evaluate((element) => {
          const tab = element.getBoundingClientRect();
          const viewport = element.parentElement!.getBoundingClientRect();
          return (
            tab.left >= viewport.left - 1 && tab.right <= viewport.right + 1
          );
        }),
      )
      .toBe(true);
    const panel = page.getByRole("tabpanel");
    const card = panel.locator(".connection-card");
    await expect(card).toHaveAttribute(
      "title",
      `${names[2]}\n${database}\n${server}`,
    );
    await expect(card.locator("strong")).toHaveCSS("text-overflow", "ellipsis");
    await expect(card.locator("div > span")).toHaveCSS(
      "text-overflow",
      "ellipsis",
    );
    await expect(
      page.getByRole("tab", { name: names[2], exact: true }),
    ).toHaveAttribute("title", `${names[2]}\n${database} · ${server}`);
    const bounds = await panel
      .locator(".connection-card")
      .evaluate((element) => {
        const card = element.getBoundingClientRect();
        return Array.from(element.querySelectorAll("strong, div > span")).every(
          (child) => {
            const box = child.getBoundingClientRect();
            return box.left >= card.left && box.right <= card.right;
          },
        );
      });
    expect(bounds).toBe(true);
    const tabFits = await page
      .locator(".connection-tab.active")
      .evaluate((element) => {
        const tab = element.getBoundingClientRect();
        return Array.from(
          element.querySelectorAll("button, .connection-tab-name"),
        ).every((child) => {
          const box = child.getBoundingClientRect();
          return (
            box.width > 0 && box.left >= tab.left && box.right <= tab.right
          );
        });
      });
    expect(tabFits).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await expect(
      panel.getByRole("button", { name: "Import SQL folder", exact: true }),
    ).toBeInViewport();
    await panel
      .locator(".sidebar-scroll")
      .evaluate((element) => (element.scrollTop = element.scrollHeight));
    await expect(
      panel.getByRole("button", { name: "Import SQL folder", exact: true }),
    ).toBeInViewport();
    await panel
      .getByRole("button", { name: "SQL scripts", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "New query folder", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `artifacts/connection-layout-${width}.png` });
    await panel.getByRole("button", { name: "Database", exact: true }).click();
  }
  await expect
    .poll(() => page.evaluate(() => window.exqlPendingWrites))
    .toBe(0);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: names[0], exact: true }),
  ).toBeVisible();
});
