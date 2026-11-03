import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { connect } from "../support/ui";

const heightOf = async (locator: Locator) =>
  (await locator.boundingBox())!.height;
const widthOf = async (locator: Locator) =>
  (await locator.boundingBox())!.width;

async function dragBy(page: Page, handle: Locator, x: number, y: number) {
  const box = (await handle.boundingBox())!;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + x, startY + y, { steps: 5 });
  await page.mouse.up();
}
const savedLayout = (page: Page) =>
  page.evaluate(async () => {
    const response = await fetch("/api/workspace/settings", {
      headers: { "X-Exql-Client": "1" },
    });
    return (await response.json()).value;
  });

test("dragging the sidebar reveals long names, and the width survives a reload", async ({
  page,
  request,
}) => {
  const name = "A very long saved query name that the default width cuts off";
  const saved = await request.post("/api/workspace/library", {
    data: {
      folders: [],
      queries: [{ id: "long", name, sql: "SELECT 1;", folderId: "" }],
    },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto("/");
  const sidebar = page.getByRole("complementary");
  const splitter = page.getByRole("separator", { name: "Resize sidebar" });
  await page.getByRole("button", { name: "SQL scripts", exact: true }).click();
  const label = sidebar.getByText(name, { exact: true });
  const truncated = () =>
    label.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(await truncated()).toBe(true);
  expect(await widthOf(sidebar)).toBe(250);

  await dragBy(page, splitter, 300, 0);
  expect(await widthOf(sidebar)).toBe(550);
  expect(await truncated()).toBe(false);
  await expect
    .poll(() => savedLayout(page))
    .toMatchObject({
      sidebarWidth: 550,
    });

  await page.reload();
  await expect(page.getByRole("complementary")).toBeVisible();
  expect(await widthOf(page.getByRole("complementary"))).toBe(550);

  // Limits come from the CSS minimums of the sidebar and the main area.
  await dragBy(page, splitter, -2000, 0);
  expect(await widthOf(sidebar)).toBe(210);
  await dragBy(page, splitter, 3000, 0);
  expect(await widthOf(page.getByRole("main"))).toBe(420);

  // A saved width that no longer fits gives way, so main keeps its minimum.
  await page.setViewportSize({ width: 900, height: 700 });
  expect(await widthOf(page.getByRole("main"))).toBe(420);
  expect(await widthOf(sidebar)).toBe(480);
  await page.setViewportSize({ width: 1440, height: 960 });

  await splitter.dblclick();
  expect(await widthOf(sidebar)).toBe(250);
  await expect
    .poll(() => savedLayout(page))
    .toMatchObject({
      sidebarWidth: null,
    });
});

test("the sidebar splitter works from the keyboard", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.getByRole("complementary");
  const splitter = page.getByRole("separator", { name: "Resize sidebar" });
  await splitter.focus();
  await expect(splitter).toHaveAttribute("aria-valuenow", "250");
  await expect(splitter).toHaveAttribute("aria-valuemin", "210");

  await page.keyboard.press("ArrowRight");
  expect(await widthOf(sidebar)).toBe(266);
  await expect(splitter).toHaveAttribute("aria-valuenow", "266");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  expect(await widthOf(sidebar)).toBe(234);
  await page.keyboard.press("Home");
  expect(await widthOf(sidebar)).toBe(210);
  await page.keyboard.press("End");
  expect(await widthOf(page.getByRole("main"))).toBe(420);
});

test("the editor fills the pane until a run produces results, then shares it", async ({
  page,
}) => {
  await page.goto("/");
  await connect(page);
  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  const editor = page.locator(".cm-editor");
  const heading = page.getByText("RESULTS", { exact: true });
  const splitter = page.getByRole("separator", {
    name: "Resize SQL editor and results",
  });
  await expect(editor).toBeVisible();

  // Nothing about results exists before the first run.
  await expect(heading).toHaveCount(0);
  await expect(splitter).toHaveCount(0);
  await expect(page.getByRole("grid")).toHaveCount(0);
  const fullHeight = await heightOf(editor);
  expect(fullHeight).toBeGreaterThan(600);

  // A long script scrolls inside the editor rather than growing the page.
  await page
    .locator(".cm-content")
    .fill(
      Array.from({ length: 200 }, (_, i) => `-- line ${i}`).join("\n") +
        "\nSELECT TOP (3) Id FROM dbo.WorkItems ORDER BY Id;",
    );
  expect(await heightOf(editor)).toBe(fullHeight);
  const scroller = await page.locator(".cm-scroller").evaluate((element) => ({
    visible: element.clientHeight,
    content: element.scrollHeight,
    lineHeight: element.querySelector(".cm-line")!.getBoundingClientRect()
      .height,
  }));
  expect(scroller.content).toBeGreaterThan(scroller.visible);
  expect(scroller.visible).toBeGreaterThan(30 * scroller.lineHeight);

  await page.getByRole("button", { name: "Run SQL", exact: false }).click();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await expect(heading).toBeVisible();
  await expect(splitter).toBeVisible();
  expect(await heightOf(editor)).toBe(225);

  // Focus stays in the editor through a drag, so typing can continue.
  await page.locator(".cm-content").click();
  await dragBy(page, splitter, 0, 200);
  expect(await heightOf(editor)).toBe(425);
  await page.keyboard.type("/*typed after drag*/");
  await expect(page.locator(".cm-content")).toContainText(
    "/*typed after drag*/",
  );
  await expect
    .poll(() => savedLayout(page))
    .toMatchObject({
      editorHeight: 425,
    });

  // The results pane keeps its minimum height, and the grid stays usable.
  await dragBy(page, splitter, 0, 2000);
  expect(await heightOf(page.locator(".results-pane"))).toBe(188);
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await dragBy(page, splitter, 0, -2000);
  expect(await heightOf(editor)).toBe(100);

  // A run without rows leaves no grid, so the editor takes the height back.
  await page.locator(".cm-content").fill("DECLARE @unused int;");
  await page.getByRole("button", { name: "Run SQL", exact: false }).click();
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(splitter).toHaveCount(0);
  await expect.poll(() => heightOf(editor)).toBeGreaterThan(600);

  // So does a failure, which reports its error in the banner.
  await page.locator(".cm-content").fill("SELECT * FROM dbo.DoesNotExist;");
  await page.getByRole("button", { name: "Run SQL", exact: false }).click();
  await expect(page.getByRole("alert")).toContainText("DoesNotExist");
  await expect(splitter).toHaveCount(0);

  // Opening another query clears the results of the previous one.
  await page.locator(".cm-content").fill("SELECT 1 AS One;");
  await page.getByRole("button", { name: "Run SQL", exact: false }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await expect(heading).toHaveCount(0);
  await expect(splitter).toHaveCount(0);
  await expect(editor).toBeVisible();
  expect(await heightOf(editor)).toBeGreaterThan(600);
});

test("an offline query tab keeps the editor large and its connect button visible", async ({
  page,
  request,
}) => {
  const saved = await request.post("/api/workspace/scratch", {
    data: [{ id: "draft", name: "Draft", sql: "SELECT 1;" }],
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto("/");
  await expect(
    page.getByText("Connect to a database to run your SQL."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect to database" }),
  ).toBeVisible();
  await expect(page.getByText("RESULTS", { exact: true })).toHaveCount(0);
  expect(await heightOf(page.locator(".cm-editor"))).toBeGreaterThan(500);
});

const clippedButtons = (page: Page) =>
  page.getByRole("main").evaluate((main) => {
    const edge = main.getBoundingClientRect().right;
    return [...main.querySelectorAll("button, select")]
      .filter((control) => {
        const { width, right } = control.getBoundingClientRect();
        // The grid scrolls its own columns into view.
        const scrolls = control.closest(".grid-scroll");
        return width > 0 && right > edge + 1 && !scrolls;
      })
      .map((control) => control.textContent);
  });

test("every action stays reachable when the sidebar leaves main its minimum width", async ({
  page,
}) => {
  await page.goto("/");
  await connect(page);
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "WorkItems", exact: true })
    .click();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.getByRole("separator", { name: "Resize sidebar" }).focus();
  await page.keyboard.press("End");
  expect(await widthOf(page.getByRole("main"))).toBe(420);
  expect(await clippedButtons(page)).toEqual([]);

  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await page
    .locator(".cm-content")
    .fill("SELECT TOP (3) Id FROM dbo.WorkItems;");
  await page.getByRole("button", { name: "Run SQL", exact: false }).click();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  expect(await clippedButtons(page)).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Next page" }),
  ).toBeInViewport();
});

test("dragging away and back leaves the pane on its responsive default", async ({
  page,
}) => {
  await page.goto("/");
  const sidebar = page.getByRole("complementary");
  const splitter = page.getByRole("separator", { name: "Resize sidebar" });
  const box = (await splitter.boundingBox())!;
  const y = box.y + 100;
  await page.mouse.move(box.x + 3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 103, y, { steps: 3 });
  await page.mouse.move(box.x + 3, y, { steps: 3 });
  await page.mouse.up();
  expect(await widthOf(sidebar)).toBe(250);
  await page.setViewportSize({ width: 1000, height: 800 });
  expect(await widthOf(sidebar)).toBe(218);
});

test("a banner appearing during a drag does not separate the divider from the pointer", async ({
  page,
}) => {
  await page.goto("/");
  await connect(page);
  await page
    .getByRole("button", { name: "New query SQL", exact: true })
    .click();
  await page
    .locator(".cm-content")
    .fill("SELECT TOP (3) Id FROM dbo.WorkItems;");
  await page.getByRole("button", { name: "Run SQL", exact: false }).click();
  await expect(page.locator("tbody tr")).toHaveCount(3);

  // A failed re-run keeps the old results and adds an error banner above them.
  await page.locator(".cm-content").fill("SELECT * FROM dbo.DoesNotExist;");
  const splitter = page.getByRole("separator", {
    name: "Resize SQL editor and results",
  });
  const start = (await splitter.boundingBox())!;
  const x = start.x + 400;
  await page.mouse.move(x, start.y + 3);
  await page.mouse.down();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByRole("tabpanel").getByRole("alert")).toBeVisible();

  const target = start.y + 3 + 150;
  await page.mouse.move(x, target, { steps: 3 });
  const moved = (await splitter.boundingBox())!;
  await page.mouse.up();
  expect(Math.abs(moved.y + moved.height / 2 - target)).toBeLessThanOrEqual(1);
});
