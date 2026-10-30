import { test, expect } from "@playwright/test";

test("saved profiles clone from the row menu with a new name and color", async ({
  page,
  request,
}) => {
  const headers = { "X-Exql-Client": "1" };
  const name = `Clone verification ${Date.now()}`;
  const ids: string[] = [];
  let sessionId: string | undefined;
  await page.route("**/api/workspace/*", (route) =>
    route.fulfill(
      route.request().method() === "GET"
        ? { json: { value: null } }
        : { status: 204 },
    ),
  );
  try {
    const created = await request.post("/api/profiles", {
      headers,
      data: {
        name,
        folder: "Clone tests",
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
    expect(created.ok(), await created.text()).toBeTruthy();
    const source = await created.json();
    ids.push(source.id);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Add connection", exact: true })
      .click();
    const row = page.locator(".profile-row").filter({
      has: page.getByRole("button", {
        name: `${name} localhost / ExqlDemo`,
        exact: true,
      }),
    });
    await row.click({ button: "right" });
    await expect(page.getByRole("menuitem")).toHaveText([
      "Connect",
      "Edit",
      "Clone…",
      "Delete…",
    ]);
    await page.getByRole("menuitem", { name: "Clone…", exact: true }).click();
    await expect(
      page.getByLabel("Connection name", { exact: true }),
    ).toHaveValue(`${name} (copy)`);
    await expect(
      page.getByText(`Clone of ${name}`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Folder (optional)")).toHaveValue(
      "Clone tests",
    );
    expect(
      await page.getByLabel("Custom connection color").inputValue(),
    ).not.toBe(source.color);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/profiles") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save only", exact: true }).click();
    const clone = await (await saved).json();
    ids.push(clone.id);
    expect(clone.id).not.toBe(source.id);
    await expect(
      page.getByText(`Clone of ${name}`, { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: `${name} (copy) localhost / ExqlDemo`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(row).toBeVisible();
    // The keyboard menu shares the same actions as right-click.
    await row.locator(".profile-select").focus();
    await page.keyboard.press("Shift+F10");
    await expect(
      page.getByRole("menuitem", { name: "Clone…", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const connected = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/profiles/${clone.id}/connect`) &&
        response.ok(),
    );
    await page
      .getByRole("button", { name: `Connect to ${name} (copy)`, exact: true })
      .click();
    sessionId = (await (await connected).json()).id;
    await expect(
      page.getByRole("tab", { name: `${name} (copy)`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel").getByText("Connected", { exact: true }),
    ).toBeVisible();
  } finally {
    if (sessionId)
      await request.delete(`/api/sessions/${sessionId}`, { headers });
    for (const id of ids)
      await request.delete(`/api/profiles/${id}`, { headers });
  }
});

for (const authentication of ["sql", "connectionString"]) {
  test(`cloned ${authentication} profiles offer keeping or replacing the source credential`, async ({
    page,
    request,
  }) => {
    const headers = { "X-Exql-Client": "1" };
    const name = `Clone credential ${authentication} ${Date.now()}`;
    const ids: string[] = [];
    await page.route("**/api/workspace/*", (route) =>
      route.fulfill(
        route.request().method() === "GET"
          ? { json: { value: null } }
          : { status: 204 },
      ),
    );
    try {
      const created = await request.post("/api/profiles", {
        headers,
        data: {
          name,
          folder: "",
          connection: {
            server: "localhost",
            database: "ExqlDemo",
            authentication,
            username: "clone-test",
            password: "test-only",
            connectionString:
              "Server=localhost;Database=ExqlDemo;Integrated Security=True;TrustServerCertificate=True;",
            encrypt: true,
            trustServerCertificate: true,
          },
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const source = await created.json();
      ids.push(source.id);
      await page.goto("/");
      await page
        .getByRole("button", { name: "Add connection", exact: true })
        .click();
      const row = page.locator(".profile-row").filter({
        has: page.getByRole("button", {
          name: `${name} localhost / ExqlDemo`,
          exact: true,
        }),
      });
      await row.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Clone…", exact: true }).click();
      const credential =
        authentication === "sql" ? "password" : "connection string";
      const keep = page.getByLabel(`Keep the ${credential} from ${name}`, {
        exact: true,
      });
      await expect(keep).toBeChecked();
      await keep.uncheck();
      const input = page.getByLabel(
        authentication === "sql" ? "Password" : "Connection string",
        { exact: true },
      );
      await expect(input).toHaveValue("");
      await input.fill(
        authentication === "sql"
          ? "replacement-test-only"
          : "Server=localhost;Database=ExqlDemo;Integrated Security=True;TrustServerCertificate=True;",
      );
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/profiles") &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Save only", exact: true })
        .click();
      const response = await saved;
      expect(response.ok(), await response.text()).toBeTruthy();
      ids.push((await response.json()).id);
      await expect(
        page.getByLabel(`Keep the saved ${credential}`, { exact: true }),
      ).toBeChecked();
      await expect(
        page.getByText(`Clone of ${name}`, { exact: true }),
      ).toHaveCount(0);
      await row.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Clone…", exact: true }).click();
      await row.locator(".profile-select").click();
      await expect(
        page.getByText(`Clone of ${name}`, { exact: true }),
      ).toHaveCount(0);
      await row.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Clone…", exact: true }).click();
      await page
        .getByRole("button", { name: "New connection", exact: true })
        .click();
      await expect(
        page.getByText(`Clone of ${name}`, { exact: true }),
      ).toHaveCount(0);
    } finally {
      for (const id of ids)
        await request.delete(`/api/profiles/${id}`, { headers });
    }
  });
}
