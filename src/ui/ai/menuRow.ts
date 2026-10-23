import type { FocusEvent, PointerEvent } from "react";

/*
 * Rows of the chat's own shape (a label over a hint, a checkbox row) inside the shared <Menu>
 * (src/ui/menu.tsx). Its ↑ ↓ Home End and type-ahead move focus between `[data-menu-item]`
 * elements, and the focused row carries data-highlighted, so pointer and keyboard share one
 * highlight like MenuItem's.
 */
export function menuRow(label?: string) {
  return {
    "data-menu-item": "",
    "data-label": label,
    tabIndex: -1,
    onFocus: (e: FocusEvent<HTMLElement>) => void (e.currentTarget.dataset.highlighted = ""),
    onBlur: (e: FocusEvent<HTMLElement>) => void delete e.currentTarget.dataset.highlighted,
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "touch" && document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
    },
  } as const;
}

/**
 * After a pointer pick the shared Menu leaves focus where it fell, so the canvas keeps its keys. In
 * the chat that would hand the next keystroke to the canvas: put focus back in the chat instead,
 * unless the pick already moved it somewhere (a rename field, the trigger after a keyboard pick).
 */
export function refocusAfterMenu(target: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => {
    const a = document.activeElement;
    if (!a || a === document.body || a.closest("[data-menu-content]")) target()?.focus({ preventScroll: true });
  });
}
