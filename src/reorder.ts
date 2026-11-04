import { useState, type DragEvent } from "react";

export type DropSide = "before" | "after";

export function moveById<T extends { id: string }>(
  items: readonly T[],
  id: string,
  targetId: string,
  side: DropSide,
): T[] {
  const moving = items.find((item) => item.id === id);
  if (!moving || id === targetId) return [...items];
  const rest = items.filter((item) => item !== moving);
  const target = rest.findIndex((item) => item.id === targetId);
  if (target < 0) return [...items];
  rest.splice(side === "before" ? target : target + 1, 0, moving);
  return rest;
}

// A private type, so a dragged row cannot be dropped as text into the SQL editor.
const dragType = "application/x-exql-reorder";

/** Native drag and drop, because it scrolls an overflowing list while dragging. */
export function useDragReorder({
  axis,
  canDrop = () => true,
  onMove,
}: {
  axis: "x" | "y";
  canDrop?: (id: string, targetId: string) => boolean;
  onMove: (id: string, targetId: string, side: DropSide) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; side: DropSide } | null>(null);
  function end() {
    setDragging(null);
    setDrop(null);
  }
  function bind(id: string, enabled = true) {
    return {
      draggable: enabled,
      "data-dragging": dragging === id || undefined,
      "data-drop": drop?.id === id ? drop.side : undefined,
      onDragStart(event: DragEvent<HTMLElement>) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(dragType, id);
        setDragging(id);
      },
      onDragOver(event: DragEvent<HTMLElement>) {
        // Anything else being dragged over the list, like a file, is not ours.
        if (!dragging || dragging === id || !canDrop(dragging, id)) {
          setDrop(null);
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const beforeMiddle =
          axis === "x"
            ? event.clientX < rect.left + rect.width / 2
            : event.clientY < rect.top + rect.height / 2;
        const side: DropSide = beforeMiddle ? "before" : "after";
        if (drop?.id !== id || drop.side !== side) setDrop({ id, side });
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDrop((current) => (current?.id === id ? null : current));
      },
      onDrop(event: DragEvent<HTMLElement>) {
        event.preventDefault();
        if (dragging && drop?.id === id) onMove(dragging, id, drop.side);
        end();
      },
      onDragEnd: end,
    };
  }
  return { bind };
}
