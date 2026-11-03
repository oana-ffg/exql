// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  applyPaneLayout,
  clampPaneSize,
  setPaneSize,
} from "../../src/paneLayout";

afterEach(() => document.documentElement.removeAttribute("style"));

it("rounds a size and keeps it within the limits", () => {
  expect(clampPaneSize(300.4, 180, 900)).toBe(300);
  expect(clampPaneSize(50, 180, 900)).toBe(180);
  expect(clampPaneSize(2000, 180, 900)).toBe(900);
});

it("prefers the minimum when the window cannot fit both panes", () => {
  expect(clampPaneSize(300, 180, 120)).toBe(180);
});

it("writes saved sizes and returns reset panes to their CSS default", () => {
  const { style } = document.documentElement;
  applyPaneLayout({ sidebarWidth: 400, editorHeight: 500 });
  expect(style.getPropertyValue("--sidebar-width")).toBe("400px");
  expect(style.getPropertyValue("--editor-height")).toBe("500px");

  setPaneSize("sidebarWidth", 420);
  expect(style.getPropertyValue("--sidebar-width")).toBe("420px");

  applyPaneLayout({ sidebarWidth: null, editorHeight: 500 });
  expect(style.getPropertyValue("--sidebar-width")).toBe("");
  expect(style.getPropertyValue("--editor-height")).toBe("500px");
});
