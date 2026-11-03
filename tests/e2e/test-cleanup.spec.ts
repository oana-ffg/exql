import { cancelRunningQueries, expect, test } from "../support/fixtures";

test("cleanup clicks only a visible Cancel button", async ({ page }) => {
  await page.setContent(`
    <output id="clicks"></output>
    <button class="cancel-button" onclick="clicks.textContent += 'visible'">Cancel</button>
    <button class="cancel-button" hidden onclick="clicks.textContent += 'hidden'">Cancel</button>
  `);
  await cancelRunningQueries(page);
  await expect(page.locator("#clicks")).toHaveText("visible");
});

test("cleanup does not wait for a disabled Cancel button", async ({ page }) => {
  await page.setContent(
    `<button class="cancel-button" disabled>Cancel</button>`,
  );
  await cancelRunningQueries(page);
  // The page fixture repeats this during teardown, where waiting would time out.
  await expect(page.locator(".cancel-button")).toBeDisabled();
});
