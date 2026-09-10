import { test, expect } from "@playwright/test";

test("paste, save, rename, and reconnect with a vaulted connection string", async ({
  page,
  request,
}) => {
  const name = `Connection string test ${Date.now()}`;
  let id: string | undefined;
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Connect to database", exact: true })
      .click();
    await page.getByLabel("Connection name", { exact: true }).fill(name);
    await page.getByLabel("Connection method").selectOption("connectionString");
    const input = page.getByLabel("Connection string", { exact: true });
    await expect(input).toHaveAttribute("type", "password");
    await input.fill(
      "Server=localhost;Database=ExqlDemo;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;Connect Timeout=25;",
    );
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/profiles") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Save & connect", exact: true })
      .click();
    const profile = await (await saved).json();
    id = profile.id;
    expect(profile.connection.connectionString).toBeNull();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "WorkItems", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(200);
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.getByRole("button", { name: /No connection/ }).click();
    await page
      .getByRole("button", {
        name: `${name} localhost / ExqlDemo`,
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Keep the saved connection string"),
    ).toBeChecked();
    await expect(
      page.getByLabel("Connection string", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel("Connection name", { exact: true })
      .fill(name + " renamed");
    const renamed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/profiles") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save only", exact: true }).click();
    expect(
      (await (await renamed).json()).connection.connectionString,
    ).toBeNull();
    await page
      .getByRole("button", { name: `Connect to ${name} renamed`, exact: true })
      .click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "TypeSamples", exact: true })
      .click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  } finally {
    if (id)
      expect(
        (
          await request.delete(`/api/profiles/${id}`, {
            headers: { "X-Exql-Client": "1" },
          })
        ).ok(),
      ).toBe(true);
  }
});
