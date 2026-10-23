import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronRight } from "lucide-react";
import { runCommand, useCommand } from "@/commands/registry";
import { r } from "./recipes";

/*
 * Figma-style menus on Radix Popover (DropdownMenu isn't installed): the main menu with its
 * submenus, the zoom and export menus, and the toolbar flyouts. One highlight serves pointer and
 * keyboard (the focused item carries data-highlighted, so hover snaps in and fades out like q-item);
 * ↑ ↓ Home End and a typed letter move it, → / ↵ open a submenu, ← / Esc close it. Commands render
 * from the registry: label, plain-glyph keys, checked state, and a disabled row that says why when
 * clicked. Commands Qalam can't do (`unavailable`) are left out: menus never offer dead items.
 */

interface MenuCtx {
  /** Close the whole menu (root and submenus). `keyboard` returns focus to the trigger. */
  close: (keyboard?: boolean) => void;
  /** The open submenu of this level. */
  openSub: string | null;
  setOpenSub: (id: string | null, delay?: number) => void;
  /** Reserve the check column (menus that hold toggles). */
  checks: boolean;
}

const Ctx = createContext<MenuCtx | null>(null);
const useMenu = () => useContext(Ctx);

const ITEM = "[data-menu-item]";

/** Items that belong to this content element (submenus are portaled, so they never match). */
function itemsOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ITEM)].filter((el) => el.closest("[data-menu-content]") === root);
}

function focusItem(el: HTMLElement | undefined) {
  el?.focus({ preventScroll: true });
  el?.scrollIntoView({ block: "nearest" });
}

/** ↑ ↓ Home End and type-ahead within one menu level. */
function navigate(e: ReactKeyboardEvent<HTMLElement>) {
  const root = e.currentTarget;
  const items = itemsOf(root);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const go = (n: number) => {
    e.preventDefault();
    e.stopPropagation();
    focusItem(items[(n + items.length) % items.length]);
  };
  if (e.key === "ArrowDown") return go(i + 1);
  if (e.key === "ArrowUp") return go(i < 0 ? items.length - 1 : i - 1);
  if (e.key === "Home") return go(0);
  if (e.key === "End") return go(items.length - 1);
  if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const k = e.key.toLowerCase();
    const order = [...items.slice(i + 1), ...items.slice(0, i + 1)];
    const hit = order.find((el) => (el.dataset.label ?? el.textContent ?? "").trim().toLowerCase().startsWith(k));
    if (hit) return go(items.indexOf(hit));
  }
  // Keys typed into an open menu never reach the canvas shortcuts (V, ⌘Z…); Esc is handled by Radix
  // in the capture phase, and Tab keeps moving focus.
  if (e.key !== "Tab") e.stopPropagation();
}

/** The open-submenu state of one menu level, with hover delays (no pointer-grace polygon: a short close delay lets the pointer travel). */
function useSubState() {
  const [openSub, setOpen] = useState<string | null>(null);
  const timer = useRef(0);
  const setOpenSub = useCallback((id: string | null, delay = 0) => {
    clearTimeout(timer.current);
    if (delay) timer.current = window.setTimeout(() => setOpen(id), delay);
    else setOpen(id);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { openSub, setOpenSub, cancel: () => clearTimeout(timer.current) };
}

// ── Root ─────────────────────────────────────────────────────────────────────

export function Menu({
  trigger,
  children,
  open: openProp,
  onOpenChange,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  alignOffset,
  className,
  checks = false,
  flyout = false,
  label,
  anchor,
  restoreFocus,
}: {
  /** The trigger element (a button); it gets data-state and aria-expanded. */
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  alignOffset?: number;
  className?: string;
  checks?: boolean;
  /** Toolbar flyout: grows up out of the toolbar (q-flyout) instead of the menu fade. */
  flyout?: boolean;
  label?: string;
  /** Position against a larger element around the trigger (a toolbar slot): wraps the trigger. */
  anchor?: (trigger: ReactNode) => ReactNode;
  /** Where Esc or ↵ hands focus back when the trigger can't take it (the context menu's hidden anchor); null leaves it on the page. */
  restoreFocus?: () => HTMLElement | null;
}) {
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const setOpen = useCallback((o: boolean) => (onOpenChange ? onOpenChange(o) : setOwn(o)), [onOpenChange]);
  const sub = useSubState();
  // Keyboard opens focus the first item; pointer opens focus the menu itself (no highlight yet).
  const viaKeyboard = useRef(false);
  const returnFocus = useRef(false);

  const ctx = useMemo<MenuCtx>(
    () => ({
      close: (keyboard = false) => {
        returnFocus.current = keyboard;
        sub.setOpenSub(null);
        setOpen(false);
      },
      openSub: sub.openSub,
      setOpenSub: sub.setOpenSub,
      checks,
    }),
    [checks, setOpen, sub.openSub, sub.setOpenSub],
  );

  const triggerEl = (
    <Popover.Trigger
      asChild
      // Radix announces a popover trigger as "dialog"; the content here is role=menu.
      aria-haspopup="menu"
      onPointerDown={() => (viaKeyboard.current = false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") viaKeyboard.current = true;
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
          e.preventDefault();
          setOpen(true);
        }
      }}
    >
      {trigger}
    </Popover.Trigger>
  );

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) sub.setOpenSub(null);
        setOpen(o);
      }}
    >
      {anchor ? <Popover.Anchor asChild>{anchor(triggerEl)}</Popover.Anchor> : triggerEl}
      <Popover.Portal>
        <Ctx.Provider value={ctx}>
          <Popover.Content
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            collisionPadding={8}
            role="menu"
            aria-label={label}
            data-menu-content=""
            tabIndex={-1}
            className={clsx(flyout ? r.flyout : r.menu, "max-h-(--radix-popover-content-available-height) overflow-y-auto outline-none", className)}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              const el = e.currentTarget as HTMLElement;
              const items = itemsOf(el);
              if (viaKeyboard.current) focusItem(items.find((i) => i.getAttribute("aria-checked") === "true") ?? items[0]);
              else el.focus({ preventScroll: true });
              returnFocus.current = viaKeyboard.current;
            }}
            onCloseAutoFocus={(e) => {
              // After a pointer pick the canvas keeps the keys; Esc or ↵ returns focus to the trigger.
              const back = returnFocus.current;
              returnFocus.current = false;
              if (back && !restoreFocus) return;
              e.preventDefault();
              if (back) restoreFocus?.()?.focus({ preventScroll: true });
            }}
            onEscapeKeyDown={() => (returnFocus.current = true)}
            onKeyDown={navigate}
            onPointerLeave={(e) => {
              const root = e.currentTarget;
              if (root.contains(document.activeElement) && document.activeElement !== root && !sub.openSub) root.focus({ preventScroll: true });
            }}
          >
            {children}
          </Popover.Content>
        </Ctx.Provider>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Items ────────────────────────────────────────────────────────────────────

// r.menuItem sets text-fg and the neutral highlight; a destructive row must win over both.
const DANGER = clsx(r.menuItemDanger, "text-danger! data-[highlighted]:bg-danger-subtle! [&_.ic]:text-danger!");

const itemClass = clsx(
  r.menuItem,
  "w-full text-left focus:outline-none focus-visible:outline-none aria-disabled:text-fg-faint aria-disabled:[&_.ic]:text-fg-faint aria-disabled:data-[highlighted]:bg-hover",
);

/** Highlight = focus: hovering focuses the item (and closes a sibling submenu after a beat). */
function itemHandlers(menu: MenuCtx | null, sub?: string) {
  return {
    onFocus: (e: React.FocusEvent<HTMLElement>) => void (e.currentTarget.dataset.highlighted = ""),
    onBlur: (e: React.FocusEvent<HTMLElement>) => void delete e.currentTarget.dataset.highlighted,
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "touch") return;
      if (document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
      if (!menu) return;
      if (sub) {
        if (menu.openSub !== sub) menu.setOpenSub(sub, 90);
        else menu.setOpenSub(sub);
      } else if (menu.openSub) menu.setOpenSub(null, 160);
    },
  };
}

export function MenuItem({
  children,
  onSelect,
  icon,
  shortcut,
  checked,
  danger,
  disabled,
  title,
  className,
}: {
  children: ReactNode;
  onSelect: () => void;
  icon?: ReactNode;
  /** Plain-glyph keys ("⌥⌘G"); use CommandItem to read them from the registry. */
  shortcut?: string[];
  checked?: boolean;
  danger?: boolean;
  /** Greyed; still focusable so the reason can be read (title) and announced. */
  disabled?: boolean | string;
  title?: string;
  className?: string;
}) {
  const menu = useMenu();
  const reason = typeof disabled === "string" ? disabled : undefined;
  const pick = (keyboard: boolean) => {
    if (disabled) return;
    menu?.close(keyboard);
    onSelect();
  };
  return (
    <button
      type="button"
      data-menu-item=""
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      aria-disabled={disabled ? true : undefined}
      title={reason ?? title}
      tabIndex={-1}
      className={clsx(itemClass, danger && DANGER, className)}
      {...itemHandlers(menu)}
      onClick={(e) => pick(e.detail === 0)}
    >
      {(menu?.checks || checked !== undefined) && <span className={r.menuCheckSlot}>{checked && <Check size={12} absoluteStrokeWidth strokeWidth={1.5} />}</span>}
      {icon && <span className="ic grid shrink-0 place-items-center [&_svg]:size-[14px]">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut?.length ? <span className={r.shortcutText}>{shortcut.join("")}</span> : null}
    </button>
  );
}

/**
 * A registered command as a menu row. Hidden when Qalam can't do it (`unavailable`); greyed with
 * its reason when it can't run right now (clicking says why, through the HUD).
 */
export function CommandItem({ id, label, icon, danger, source = "menu" }: { id: string; label?: ReactNode; icon?: ReactNode; danger?: boolean; source?: "menu" | "toolbar" | "context" }) {
  const c = useCommand(id);
  const menu = useMenu();
  if (!c || c.unavailable) return null;
  const disabled = c.enabled !== true;
  return (
    <button
      type="button"
      data-menu-item=""
      data-label={typeof label === "string" ? label : c.label}
      role={c.checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={c.checked}
      aria-disabled={disabled || undefined}
      title={disabled ? (c.enabled as string) : undefined}
      tabIndex={-1}
      className={clsx(itemClass, danger && DANGER)}
      {...itemHandlers(menu)}
      onClick={(e) => {
        // A disabled row stays open and says why (runCommand reports the reason).
        if (disabled) return void runCommand(id, source);
        menu?.close(e.detail === 0);
        runCommand(id, source);
      }}
    >
      {(menu?.checks || c.checked !== undefined) && <span className={r.menuCheckSlot}>{c.checked && <Check size={12} absoluteStrokeWidth strokeWidth={1.5} />}</span>}
      {icon && <span className="ic grid shrink-0 place-items-center [&_svg]:size-[14px]">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label ?? c.label}</span>
      {c.keys[0] && <span className={r.shortcutText}>{c.keys[0].join("")}</span>}
    </button>
  );
}

export const MenuSeparator = () => <div role="separator" className={r.menuSeparator} />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <div className={r.menuLabel}>{children}</div>;

// ── Submenu ──────────────────────────────────────────────────────────────────

export function SubMenu({ label, icon, children, checks = false, className }: { label: string; icon?: ReactNode; children: ReactNode; checks?: boolean; className?: string }) {
  const parent = useMenu();
  const id = useId();
  const open = parent?.openSub === id;
  const trigger = useRef<HTMLButtonElement>(null);
  const viaKeyboard = useRef(false);
  const sub = useSubState();

  const ctx = useMemo<MenuCtx>(
    () => ({ close: (k) => parent?.close(k), openSub: sub.openSub, setOpenSub: sub.setOpenSub, checks }),
    [parent, sub.openSub, sub.setOpenSub, checks],
  );

  const openNow = (keyboard: boolean) => {
    viaKeyboard.current = keyboard;
    parent?.setOpenSub(id);
  };
  const closeToTrigger = () => {
    parent?.setOpenSub(null);
    trigger.current?.focus({ preventScroll: true });
  };

  return (
    <Popover.Root open={open} onOpenChange={(o) => !o && parent?.openSub === id && parent.setOpenSub(null)}>
      <Popover.Anchor asChild>
        <button
          ref={trigger}
          type="button"
          data-menu-item=""
          data-label={label}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open}
          data-state={open ? "open" : "closed"}
          tabIndex={-1}
          className={clsx(itemClass, "data-[state=open]:bg-active", className)}
          {...itemHandlers(parent, id)}
          onClick={(e) => openNow(e.detail === 0)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              e.stopPropagation();
              openNow(true);
            }
          }}
        >
          {parent?.checks && <span className={r.menuCheckSlot} />}
          {icon && <span className="ic grid shrink-0 place-items-center [&_svg]:size-[14px]">{icon}</span>}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <ChevronRight size={12} absoluteStrokeWidth strokeWidth={1.25} className="-mr-[2px] shrink-0 text-fg-subtle" />
        </button>
      </Popover.Anchor>
      <Popover.Portal>
        <Ctx.Provider value={ctx}>
          <Popover.Content
            side="right"
            align="start"
            sideOffset={4}
            alignOffset={-4}
            collisionPadding={8}
            role="menu"
            aria-label={label}
            data-menu-content=""
            tabIndex={-1}
            className={clsx(r.menu, "max-h-(--radix-popover-content-available-height) overflow-y-auto outline-none")}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              if (viaKeyboard.current) focusItem(itemsOf(e.currentTarget as HTMLElement)[0]);
            }}
            onCloseAutoFocus={(e) => e.preventDefault()}
            // The parent menu manages focus moving back to it (hovering its rows); only Esc / ← close from here.
            onFocusOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => {
              e.preventDefault();
              closeToTrigger();
            }}
            onPointerEnter={() => parent?.setOpenSub(id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                e.stopPropagation();
                return closeToTrigger();
              }
              navigate(e);
            }}
          >
            {children}
          </Popover.Content>
        </Ctx.Provider>
      </Popover.Portal>
    </Popover.Root>
  );
}
