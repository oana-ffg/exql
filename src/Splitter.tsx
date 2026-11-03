import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  clampPaneSize,
  paneAxes,
  paneSizeOverride,
  setPaneSize,
  type Pane,
} from "./paneLayout";

const keyboardStep = 16;

interface Range {
  // Where the resized pane begins, which moves when a banner appears above it.
  origin: number;
  now: number;
  min: number;
  max: number;
}

// The pane before the splitter is resized and the pane after it gives up the
// space. Their CSS minimums are the single source of truth for the limits.
function measure(splitter: HTMLElement, pane: Pane): Range {
  const horizontal = paneAxes[pane] === "x";
  const sizeOf = (element: Element) => {
    const { width, height } = element.getBoundingClientRect();
    return horizontal ? width : height;
  };
  const originOf = (element: Element) => {
    const { left, top } = element.getBoundingClientRect();
    return horizontal ? left : top;
  };
  const minimumOf = (element: Element) => {
    const { minWidth, minHeight } = getComputedStyle(element);
    return parseFloat(horizontal ? minWidth : minHeight) || 0;
  };
  const resized = splitter.previousElementSibling!;
  const neighbour = splitter.nextElementSibling!;
  const now = sizeOf(resized);
  return {
    origin: originOf(resized),
    now,
    min: minimumOf(resized),
    max: now + sizeOf(neighbour) - minimumOf(neighbour),
  };
}

export function Splitter({
  pane,
  label,
  onResize,
}: {
  pane: Pane;
  label: string;
  onResize: (pane: Pane, size: number | null) => void;
}) {
  const axis = paneAxes[pane];
  const [range, setRange] = useState<Range | null>(null);
  const drag = useRef<{
    // How far the pointer is from the pane's far edge, so the edge follows it.
    grabOffset: number;
    startSize: number;
    startOverride: number | null;
    size: number;
  } | null>(null);
  const position = (event: PointerEvent) =>
    axis === "x" ? event.clientX : event.clientY;

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = measure(event.currentTarget, pane);
    drag.current = {
      grabOffset: position(event) - start.origin - start.now,
      startSize: start.now,
      startOverride: paneSizeOverride(pane),
      size: start.now,
    };
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    // Measured on every move: a banner can shift the panes during a drag.
    const current = measure(event.currentTarget, pane);
    const size = clampPaneSize(
      position(event) - current.origin - drag.current.grabOffset,
      current.min,
      current.max,
    );
    drag.current.size = size;
    // Writing the CSS variable directly keeps a drag from re-rendering every
    // workspace and data grid; the saved layout changes when it ends.
    setPaneSize(pane, size);
  }
  function pointerUp() {
    if (!drag.current) return;
    const { size, startSize, startOverride } = drag.current;
    drag.current = null;
    if (size !== startSize) onResize(pane, size);
    // No change to save, so a default size must stay free to follow the window.
    else setPaneSize(pane, startOverride);
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = measure(event.currentTarget, pane);
    const steps: Record<string, number> =
      axis === "x"
        ? { ArrowLeft: -keyboardStep, ArrowRight: keyboardStep }
        : { ArrowUp: -keyboardStep, ArrowDown: keyboardStep };
    let size: number;
    if (event.key === "Home") size = current.min;
    else if (event.key === "End") size = current.max;
    else if (event.key in steps) size = current.now + steps[event.key];
    else return;
    event.preventDefault();
    size = clampPaneSize(size, current.min, current.max);
    setRange({ ...current, now: size });
    onResize(pane, size);
  }

  return (
    <div
      className={`splitter splitter-${axis}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={range ? Math.round(range.now) : undefined}
      aria-valuemin={range ? Math.round(range.min) : undefined}
      aria-valuemax={range ? Math.round(range.max) : undefined}
      title="Drag to resize. Double-click to reset."
      // Keeps focus in the SQL editor, so typing can continue after a drag.
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onDoubleClick={() => onResize(pane, null)}
      onFocus={(event) => setRange(measure(event.currentTarget, pane))}
      onKeyDown={keyDown}
    />
  );
}
