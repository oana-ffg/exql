import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { clampPaneSize, paneAxes, setPaneSize, type Pane } from "./paneLayout";

const keyboardStep = 16;

interface Range {
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
  const minimumOf = (element: Element) => {
    const { minWidth, minHeight } = getComputedStyle(element);
    return parseFloat(horizontal ? minWidth : minHeight) || 0;
  };
  const resized = splitter.previousElementSibling!;
  const neighbour = splitter.nextElementSibling!;
  const now = sizeOf(resized);
  return {
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
  const drag = useRef<{ origin: number; start: Range; size: number } | null>(
    null,
  );
  const position = (event: PointerEvent) =>
    axis === "x" ? event.clientX : event.clientY;

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = measure(event.currentTarget, pane);
    drag.current = { origin: position(event), start, size: start.now };
  }
  function pointerMove(event: PointerEvent) {
    if (!drag.current) return;
    const { origin, start } = drag.current;
    const size = clampPaneSize(
      start.now + position(event) - origin,
      start.min,
      start.max,
    );
    drag.current.size = size;
    // Writing the CSS variable directly keeps a drag from re-rendering every
    // workspace and data grid; the saved layout changes when it ends.
    setPaneSize(pane, size);
  }
  function pointerUp() {
    if (!drag.current) return;
    const { size, start } = drag.current;
    drag.current = null;
    if (size !== start.now) onResize(pane, size);
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
