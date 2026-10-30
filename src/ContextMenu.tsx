import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";

export interface MenuAction {
  label: string;
  run: () => void;
  disabled?: boolean;
  separator?: boolean;
}

interface MenuPosition {
  x: number;
  y: number;
  trigger: HTMLElement;
}

export function useContextMenu<T>() {
  const [menu, setMenu] = useState<(MenuPosition & { target: T }) | null>(null);
  const close = useCallback(() => setMenu(null), []);
  function bind(target: T) {
    function open(element: HTMLElement, x: number, y: number) {
      const focused = document.activeElement;
      const trigger =
        focused instanceof HTMLElement && element.contains(focused)
          ? focused
          : element;
      trigger.focus({ preventScroll: true });
      setMenu({ target, trigger, x, y });
    }
    return {
      onContextMenu(event: MouseEvent<HTMLElement>) {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        open(
          event.currentTarget,
          event.clientX || rect.left,
          event.clientY || rect.bottom,
        );
      },
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (
          event.key !== "ContextMenu" &&
          !(event.shiftKey && event.key === "F10")
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        open(event.currentTarget, rect.left, rect.bottom);
      },
    };
  }
  return { menu, bind, close };
}

export function ContextMenu({
  position,
  label,
  actions,
  onClose,
}: {
  position: MenuPosition;
  label: string;
  actions: MenuAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))}px`;
    (
      element.querySelector<HTMLElement>("button:not(:disabled)") ?? element
    ).focus();
    const outside = (event: Event) => {
      if (!element.contains(event.target as Node)) onClose();
    };
    const scrollPositions = new Map<Element, [number, number]>();
    for (
      let ancestor: Element | null = position.trigger;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      scrollPositions.set(ancestor, [ancestor.scrollLeft, ancestor.scrollTop]);
    }
    const onScroll = (event: Event) => {
      const target =
        event.target === document ? document.scrollingElement : event.target;
      if (!(target instanceof Element) || element.contains(target)) return;
      const previous = scrollPositions.get(target);
      // A right-click can deliver a queued scroll event after opening the menu.
      // Only dismiss if the scroll position actually changed since it opened.
      if (
        !previous ||
        target.scrollLeft !== previous[0] ||
        target.scrollTop !== previous[1]
      )
        onClose();
    };
    const dismiss = () => onClose();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [position, onClose]);

  function restoreFocus() {
    position.trigger.focus({ preventScroll: true });
    onClose();
  }
  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          restoreFocus();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const buttons = Array.from(
          ref.current!.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        );
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      <div className="context-menu-title">{label}</div>
      {actions.map((action) => (
        <div key={action.label} role="none">
          {action.separator && (
            <div role="separator" className="context-menu-separator" />
          )}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={action.disabled}
            onClick={() => {
              restoreFocus();
              action.run();
            }}
          >
            {action.label}
          </button>
        </div>
      ))}
    </div>,
    position.trigger.closest("dialog") ?? document.body,
  );
}
