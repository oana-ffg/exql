import { test } from "@playwright/test";

// GitHub's recommended social preview size. Upload the result under the
// repository's Settings > General > Social preview; GitHub has no API for this.
test("social preview card", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    await page.goto(new URL("./social-card.html", import.meta.url).href);
    await page
      .locator("img")
      .evaluate((image: HTMLImageElement) => image.decode());
    await page.screenshot({ path: "docs/social-preview.png" });
  } finally {
    await context.close();
  }
});
