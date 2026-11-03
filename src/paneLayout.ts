export interface PaneLayout {
  sidebarWidth: number | null;
  editorHeight: number | null;
}
export type Pane = keyof PaneLayout;

// A null size leaves the pane on its default from styles.css.
export const defaultPaneLayout: PaneLayout = {
  sidebarWidth: null,
  editorHeight: null,
};

export const paneAxes: Record<Pane, "x" | "y"> = {
  sidebarWidth: "x",
  editorHeight: "y",
};
const paneVariables: Record<Pane, string> = {
  sidebarWidth: "--sidebar-width",
  editorHeight: "--editor-height",
};

export function paneSizeOverride(pane: Pane) {
  const value = document.documentElement.style.getPropertyValue(
    paneVariables[pane],
  );
  return value ? parseFloat(value) : null;
}

export function setPaneSize(pane: Pane, size: number | null) {
  const { style } = document.documentElement;
  if (size === null) style.removeProperty(paneVariables[pane]);
  else style.setProperty(paneVariables[pane], `${size}px`);
}

export function applyPaneLayout(layout: PaneLayout) {
  for (const pane of Object.keys(paneVariables) as Pane[])
    setPaneSize(pane, layout[pane] ?? null);
}

// A window too small for both minimums favours the resized pane's minimum.
export function clampPaneSize(size: number, min: number, max: number) {
  return Math.round(Math.max(min, Math.min(size, max)));
}
