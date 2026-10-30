import { createContext, useContext, useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import * as Tooltip from "@radix-ui/react-tooltip";
import { HexColorPicker } from "react-colorful";
import { Check, ChevronDown, CircleAlert, Hexagon, Info, Search, TriangleAlert, Unlink2, X } from "lucide-react";
import { normalizeHex, type Token, type TokenSet } from "@/design-system/resolve";
import { activeTokens } from "@/design-system/registry";
import type { Gradient } from "@/doc/schema";
import { useCommand } from "@/commands/registry";
import { cssGradient } from "./css";
import { r } from "./recipes";
import { useSlidingIndicator } from "./motion";
import { QalamAIGlyph } from "./brand/ai-glyph";

/*
 * Studio controls (design/spec.md §6): 28px rows, 6px radii, captions above field groups, token
 * bindings shown as chips inside fields (like Figma variables). Hover fills snap in and fade out
 * (q-item), buttons press down (q-press), focus rings are keyboard-only. Every colour is a theme
 * token, so these work in dark and light.
 */

export function Section({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={clsx("group/section last:border-b-0", r.section)}>
      <header className={r.sectionHeader}>
        <h3 className={r.sectionTitle}>{title}</h3>
        <div className="flex items-center gap-[2px]">{actions}</div>
      </header>
      {children && <div className="flex flex-col gap-[8px]">{children}</div>}
    </section>
  );
}

/** A captioned group of fields ("Position", "Dimensions", …). */
/** The id of the enclosing Field's caption, so a group control inside it (Segmented) is named by it. */
const FieldCaption = createContext<string | undefined>(undefined);

export function Field({ label, children, aside }: { label: ReactNode; children: ReactNode; aside?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex h-[16px] items-center justify-between">
        <span id={id} className="text-micro text-fg-subtle">{label}</span>
        {aside}
      </div>
      <FieldCaption.Provider value={id}>{children}</FieldCaption.Provider>
    </div>
  );
}

/**
 * Design-panel row: UI3's `1fr 1fr 24px` grid (two field columns plus an icon column), so rows line
 * up whether or not they have a trailing icon. `trailing` is kept for existing call sites.
 */
export function Row({ children, className }: { children: ReactNode; className?: string; trailing?: boolean }) {
  return <div className={clsx("grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24px] items-center gap-[8px] [&>:nth-child(3)]:size-[24px]", className)}>{children}</div>;
}

// ── Keys ─────────────────────────────────────────────────────────────────────

/** One combination as boxed keycaps: <Kbd keys={["⇧", "⌘", "O"]} />. Keys come from the commands registry. */
export function Kbd({ keys, size = "md", onInverse, className }: { keys: string | string[]; size?: "md" | "sm"; onInverse?: boolean; className?: string }) {
  const list = typeof keys === "string" ? [keys] : keys;
  return (
    <span className={clsx(r.kbdGroup, className)}>
      {list.map((k, i) => (
        <kbd key={i} className={clsx(r.kbdBase, size === "sm" ? r.kbdSm : r.kbd, onInverse ? r.kbdOnInverse : r.kbdSkin, "font-sans")}>
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Keycaps of a registered command (its primary binding), or nothing if it has none. */
export function CommandKbd({ command, size, onInverse, className }: { command: string; size?: "md" | "sm"; onInverse?: boolean; className?: string }) {
  const keys = useCommand(command)?.keys[0];
  return keys ? <Kbd keys={keys} size={size} onInverse={onInverse} className={className} /> : null;
}

/** Plain glyph shortcut for menus and flyouts ("⌥⌘G"), right-aligned. */
export function ShortcutText({ keys, command }: { keys?: string[]; command?: string }) {
  return command ? <CommandShortcutText command={command} /> : keys?.length ? <span className={r.shortcutText}>{keys.join("")}</span> : null;
}

function CommandShortcutText({ command }: { command: string }) {
  const keys = useCommand(command)?.keys[0];
  return keys ? <span className={r.shortcutText}>{keys.join("")}</span> : null;
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

/**
 * Tooltip with optional keycaps: <Tip label="Pen" keys={["P"]}> or <Tip label="Pen" command="tool.pen">.
 * Timing comes from the one Tooltip.Provider in Studio (450ms delay, 300ms skip); only the delayed
 * open animates, so sweeping across a toolbar never stacks fades.
 */
export function Tip({
  label,
  children,
  keys,
  command,
  side,
  align,
}: {
  label: ReactNode;
  children: ReactNode;
  /** Keycaps of one combination, e.g. formatKeys(spec). */
  keys?: string[];
  /** A command id: its primary binding is shown as keycaps. */
  command?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} align={align} sideOffset={6} collisionPadding={8} className={clsx(r.tooltip, "h-auto min-h-[26px] max-w-[320px] py-[4px]", !keys?.length && !command && "pr-[8px]")}>
          <span className="min-w-0">{label}</span>
          {command ? <TipCommandKeys command={command} /> : keys?.length ? <Kbd keys={keys} size="sm" /> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function TipCommandKeys({ command }: { command: string }) {
  const keys = useCommand(command)?.keys[0];
  // No binding: keep the right padding even (the tooltip was laid out for keys).
  return keys ? <Kbd keys={keys} size="sm" /> : <span className="w-[4px]" />;
}

// ── Buttons ──────────────────────────────────────────────────────────────────

export function IconBtn({
  children,
  onClick,
  active,
  label,
  className,
  disabled,
  size = "md",
  keys,
  command,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  label: string;
  className?: string;
  disabled?: boolean;
  /** md = 28px, sm = 24px (panel headers, row tails). */
  size?: "md" | "sm";
  /** Keycaps shown in the tooltip. */
  keys?: string[];
  /** Command whose binding the tooltip shows. */
  command?: string;
}) {
  return (
    <Tip label={label} keys={keys} command={command}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={clsx(size === "sm" ? r.iconButtonSm : r.iconButton, className)}
      >
        {children}
      </button>
    </Tip>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  className,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  /** primary = invert (pearl in dark, ink in light): every primary action. brand = saffron: Generate only. */
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "brand";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={clsx(
        size === "sm" ? r.buttonSm : r.button,
        variant === "primary" && r.buttonPrimary,
        variant === "brand" && r.buttonBrand,
        variant === "secondary" && r.buttonSecondary,
        variant === "outline" && "q-item bg-transparent font-medium text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-hover",
        variant === "ghost" && r.buttonGhost,
        variant === "danger" && r.buttonDanger,
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── Segmented ────────────────────────────────────────────────────────────────

/** Where an arrow key moves the focus in a group of `count` options (wraps; Home/End jump); null for other keys. */
export function rovingIndex(count: number, current: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
  if (!step) return null;
  return (((current < 0 ? 0 : current + step) % count) + count) % count;
}

/**
 * Radio group with a thumb that slides to the picked option (instant on first paint). One tab stop
 * (the picked option); arrows pick the next one, like native radios. A text option is named by its
 * text and its `title` is a hint in a Tip; an icon option is named by its `title`. The group is
 * named by `label`, or by the caption of the Field it sits in.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  label,
}: {
  value: T | null;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  className?: string;
  /** Accessible name of the group (defaults to the enclosing Field's caption). */
  label?: string;
}) {
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement, HTMLSpanElement>(value);
  const caption = useContext(FieldCaption);
  const picked = options.findIndex((o) => o.value === value);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = rovingIndex(options.length, picked, e.key);
    if (next === null) return;
    e.preventDefault();
    onChange(options[next].value);
    containerRef.current?.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
  };
  return (
    <div
      ref={containerRef}
      className={clsx(r.segmented, className)}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={label ? undefined : caption}
      onKeyDown={onKeyDown}
    >
      <span ref={indicatorRef} aria-hidden className={clsx(r.segmentedThumb, "data-[hidden]:opacity-0")} />
      {options.map((o, i) => {
        const text = typeof o.label === "string";
        const item = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            aria-label={text ? undefined : o.title}
            tabIndex={i === (picked < 0 ? 0 : picked) ? 0 : -1}
            data-indicator-active={value === o.value || undefined}
            onClick={() => onChange(o.value)}
            className={clsx(r.segmentedItem, "q-press min-w-0 gap-[4px] px-[6px] text-caption font-medium [grid-auto-flow:column]")}
          >
            {o.label}
          </button>
        );
        // Hints that only repeat the visible text add nothing.
        return o.title && o.title !== o.label ? (
          <Tip key={o.value} label={o.title}>
            {item}
          </Tip>
        ) : (
          item
        );
      })}
    </div>
  );
}

// ── Fields ───────────────────────────────────────────────────────────────────

/** The field look in one string (no padding: callers add their own). Focus = inset saffron edge + halo. */
export const fieldBox =
  "flex h-(--field-h) min-w-0 items-center rounded-md bg-field text-caption text-fg transition-[box-shadow,background-color] duration-fast hover:shadow-[inset_0_0_0_1px_var(--color-line)] hover:duration-0 focus-within:bg-panel focus-within:shadow-focus-field focus-within:duration-0";

/**
 * Numeric field with a scrubbable label (drag horizontally to change; ⇧ ×10, ⌥ ×0.1), like Figma.
 * The input is named by `ariaLabel`, else `title` (an icon label or a bare "W" names nothing useful),
 * else the visible label text.
 */
export function NumberField({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
  title,
  ariaLabel,
  className,
  right,
}: {
  label: ReactNode;
  value: number | null;
  onChange: (v: number) => void;
  onCommit?: () => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  title?: string;
  /** Accessible name of the input (defaults to `title`). */
  ariaLabel?: string;
  className?: string;
  /** Extra content at the right edge (token button, indicators). */
  right?: ReactNode;
}) {
  const name = ariaLabel ?? title;
  const [draft, setDraft] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const scrub = useRef<{ x: number; v: number } | null>(null);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const fmt = (v: number | null) => (v === null ? "Mixed" : String(Math.round(v * 100) / 100));

  const endScrub = () => {
    if (scrub.current) onCommit?.();
    scrub.current = null;
    setScrubbing(false);
    delete document.documentElement.dataset.scrubbing;
  };
  // A field unmounted mid-scrub (selection changed) must not leave the global scrub cursor behind.
  useEffect(() => () => void delete document.documentElement.dataset.scrubbing, []);

  const commitDraft = () => {
    if (draft === null) return;
    const expr = draft.trim();
    let v: number | null = null;
    // Simple arithmetic like Figma: "12+4", "*2".
    try {
      if (/^[-+*/0-9.\s()]+$/.test(expr)) {
        const base = value ?? 0;
        const e = /^[*/+]/.test(expr) ? `${base}${expr}` : expr;
        v = Function(`"use strict";return (${e})`)() as number;
      }
    } catch {
      v = null;
    }
    setDraft(null);
    if (v !== null && Number.isFinite(v)) {
      onChange(clamp(v));
      onCommit?.();
    }
  };

  return (
    <label className={clsx(fieldBox, "group/field pr-[4px]", scrubbing && "bg-panel shadow-focus-field", className)} title={title}>
      <span
        className="flex h-full w-[26px] shrink-0 cursor-ew-resize touch-none select-none items-center pl-[8px] text-micro font-medium text-fg-subtle transition-colors duration-fast group-hover/field:text-fg-muted [&_svg]:size-[12px]"
        onPointerDown={(e) => {
          if (value === null || e.button !== 0) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          scrub.current = { x: e.clientX, v: value };
          setScrubbing(true);
          document.documentElement.dataset.scrubbing = "";
        }}
        onPointerMove={(e) => {
          if (!scrub.current) return;
          const dx = e.clientX - scrub.current.x;
          // ⇧ moves 10× faster, ⌥ 10× finer (rounded to a tenth of the step).
          const unit = e.altKey ? step / 10 : step;
          const v = scrub.current.v + dx * unit * (e.shiftKey ? 10 : 1);
          onChange(clamp(Math.round(v / unit) * unit));
        }}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onLostPointerCapture={() => scrub.current && endScrub()}
        aria-hidden={name ? true : undefined}
      >
        {label}
      </span>
      <input
        aria-label={name}
        className="h-full w-full min-w-0 bg-transparent text-caption text-fg tnum outline-none focus-visible:outline-none"
        inputMode="decimal"
        value={draft ?? fmt(value)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
          if ((e.key === "ArrowUp" || e.key === "ArrowDown") && value !== null) {
            e.preventDefault();
            const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            onChange(clamp(value + d));
            onCommit?.();
            setDraft(null);
          }
        }}
      />
      {suffix && <span className="pr-[4px] text-micro text-fg-subtle">{suffix}</span>}
      {right}
    </label>
  );
}

/** Token binding shown inside a field, like a Figma variable chip (the nuqta marks a token). */
export function TokenChip({ path, onClear, className, tone = "brand" }: { path: string; onClear?: () => void; className?: string; tone?: "brand" | "component" }) {
  return (
    <span className={clsx(r.tokenChip, "q-fade max-w-full", tone === "component" && r.tokenChipComponent, className)} title={path}>
      <span className={clsx(r.tokenChipDot, tone === "component" && "bg-component")} aria-hidden />
      <span className="truncate">{path}</span>
      {onClear && (
        <button type="button" aria-label="Detach token" className="-mr-[2px] grid size-[14px] place-items-center rounded-xs text-fg-subtle transition-colors duration-fast hover:bg-hover hover:text-fg hover:duration-0" onClick={onClear}>
          <X size={10} />
        </button>
      )}
    </span>
  );
}

// ── Tags and hints ───────────────────────────────────────────────────────────

/**
 * Small square-cornered label. Warnings and errors always carry an icon and AI tags the Qalam AI
 * glyph (colour is never the only signal), so one is added when `icon` is not given.
 * `warn`/`error` are the old names of `warning`/`danger`.
 */
export function Tag({
  children,
  tone = "neutral",
  icon,
}: {
  children: ReactNode;
  tone?: "neutral" | "ai" | "component" | "warn" | "error" | "success" | "warning" | "danger";
  icon?: ReactNode;
}) {
  const t = tone === "warn" ? "warning" : tone === "error" ? "danger" : tone;
  const auto =
    icon !== undefined ? icon : t === "ai" ? <QalamAIGlyph size={12} /> : t === "warning" ? <TriangleAlert size={12} /> : t === "danger" ? <CircleAlert size={12} /> : null;
  return (
    <span
      className={clsx(
        r.tag,
        "whitespace-nowrap [&_svg]:shrink-0",
        t === "neutral" && r.tagNeutral,
        t === "ai" && r.tagAi,
        t === "component" && r.tagComponent,
        t === "warning" && r.tagWarning,
        t === "danger" && r.tagDanger,
        t === "success" && r.tagSuccess,
      )}
    >
      {auto}
      {children}
    </span>
  );
}

/** Inline hint under a field: off-system values, ambiguous matches, with an optional fix. */
export function Hint({ children, action, onAction, tone = "warn" }: { children: ReactNode; action?: string; onAction?: () => void; tone?: "warn" | "info" }) {
  return (
    <div className={clsx("flex items-start gap-[6px] text-caption", tone === "warn" ? "text-warning" : "text-fg-muted")}>
      {tone === "warn" ? <TriangleAlert size={12} className="mt-[2px] shrink-0" /> : <Info size={12} className="mt-[2px] shrink-0 text-fg-subtle" />}
      <div className="min-w-0 flex-1">
        {children}
        {action && onAction && (
          <>
            {" "}
            <button type="button" onClick={onAction} className={clsx(r.link, "font-medium")}>
              {action}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function OffSystemBadge({ onSnap, suggestion }: { onSnap?: () => void; suggestion?: string }) {
  return (
    <Hint action={suggestion ? `Use ${suggestion}` : undefined} onAction={onSnap}>
      Off-system value.
    </Hint>
  );
}

export function Swatch({ color, gradient, size = 16, className }: { color: string; gradient?: Gradient; size?: number; className?: string }) {
  return (
    <span
      className={clsx("inline-block shrink-0 rounded-sm shadow-swatch", className)}
      style={{
        width: size,
        height: size,
        background: `${gradient ? cssGradient(gradient) : `linear-gradient(${color}, ${color})`}, repeating-conic-gradient(#d9d9d9 0% 25%, #fff 0% 50%) 0 0 / 8px 8px`,
      }}
    />
  );
}

// ── Menus (for Popover-based menus; Radix menus use the same recipes) ────────

export function MenuItem({
  children,
  onSelect,
  icon,
  keys,
  command,
  checked,
  danger,
  disabled,
  className,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  /** Plain-glyph shortcut on the right ("⌥⌘G"). */
  keys?: string[];
  command?: string;
  /** Shows a check slot (toggle items); undefined = no slot. */
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      disabled={disabled}
      data-disabled={disabled || undefined}
      onClick={onSelect}
      className={clsx(r.menuItem, "w-full text-left hover:bg-active focus-visible:bg-active focus-visible:outline-none", danger && r.menuItemDanger, className)}
    >
      {checked !== undefined && <span className={r.menuCheckSlot}>{checked && <Check size={12} />}</span>}
      {icon && <span className="ic grid shrink-0 place-items-center [&_svg]:size-[14px]">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ShortcutText keys={keys} command={command} />
    </button>
  );
}

export const MenuSeparator = () => <div role="separator" className={r.menuSeparator} />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <div className={r.menuLabel}>{children}</div>;

// ── Token pickers ────────────────────────────────────────────────────────────

const popoverBox = r.popover;
const pickRow = "q-item flex h-[28px] w-full items-center gap-[8px] rounded-md px-[6px] text-left text-body text-fg hover:bg-hover focus-visible:bg-active focus-visible:outline-none";

/** List of tokens to bind (radius, type, shadow…). */
export function TokenPicker({
  title,
  items,
  current,
  suggested,
  onPick,
  onDetach,
  children,
}: {
  title: string;
  items: { path: string; meta?: string; preview?: ReactNode }[];
  current?: string;
  suggested?: string;
  onPick: (path: string) => void;
  onDetach?: () => void;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="left" align="start" sideOffset={10} collisionPadding={8} className={clsx(popoverBox, "w-[264px]")}>
          <div className="flex h-[28px] items-center justify-between pl-[6px]">
            <span className="text-caption font-semibold text-fg">{title}</span>
            {onDetach && current && (
              <Popover.Close asChild>
                <button type="button" onClick={onDetach} className={clsx(r.buttonBase, r.buttonGhost, "h-[24px] gap-[4px] rounded-md px-[6px] text-caption")}>
                  <Unlink2 size={12} /> Detach
                </button>
              </Popover.Close>
            )}
          </div>
          <div className="mt-[4px] max-h-[320px] overflow-y-auto">
            {items.map((t) => (
              <Popover.Close asChild key={t.path}>
                <button type="button" onClick={() => onPick(t.path)} className={clsx(pickRow, current === t.path && "bg-selected font-medium")}>
                  {t.preview ?? <span className={clsx(r.tokenChipDot, "ml-[4px] mr-[3px]")} aria-hidden />}
                  <span className="min-w-0 flex-1 truncate">{t.path}</span>
                  {suggested === t.path && <Tag tone="warning">Nearest</Tag>}
                  {t.meta && <span className="text-caption text-fg-subtle tnum">{t.meta}</span>}
                  {current === t.path && <Check size={12} className="text-fg" />}
                </button>
              </Popover.Close>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Hover-revealed "apply token" button placed inside a field (Figma's variable button). */
export function TokenButton({
  label = "Apply token",
  highlight,
  className,
  ...rest
}: { label?: string; highlight?: boolean } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={clsx(
        "q-item grid size-[24px] shrink-0 place-items-center rounded-sm hover:bg-active hover:text-fg focus-visible:opacity-100 data-[state=open]:bg-active data-[state=open]:opacity-100",
        highlight ? "text-warning" : "text-fg-subtle opacity-0 group-hover/field:opacity-100 group-hover/row:opacity-100",
        className,
      )}
    >
      <Hexagon size={12} strokeWidth={1.75} />
    </button>
  );
}

const COLOR_GROUPS = ["bg.", "text.", "icon.", "border.", "feedback.", "color."];

/** Colour popover: tokens first, custom hex second. `gradients` also offers gradient tokens (fills). */
export function ColorPopover({
  value,
  token,
  onChange,
  prefer,
  ts = activeTokens(),
  gradients,
  children,
}: {
  value: string | null;
  token?: string;
  onChange: (color: string, token?: string, gradient?: Gradient) => void;
  prefer?: string[];
  /** Design system of the node being edited. */
  ts?: TokenSet;
  gradients?: boolean;
  children: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"tokens" | "custom">(token || !value ? "tokens" : "custom");
  const [hex, setHex] = useState(value ?? "#000000");
  useEffect(() => setHex(value ?? "#000000"), [value]);
  const groups = [...(prefer ?? []), ...COLOR_GROUPS.filter((g) => !prefer?.includes(g)), ...(gradients ? ["gradient."] : [])];
  const match = (t: Token) => !q || t.path.includes(q.toLowerCase()) || String(t.value).toLowerCase().includes(q.toLowerCase());
  const list = [...ts.ofType("color"), ...(gradients ? ts.ofType("gradient") : [])].filter(match);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="left" align="start" sideOffset={10} collisionPadding={8} className={clsx(popoverBox, "w-[284px]")}>
          <Segmented
            label="Colour source"
            value={tab}
            onChange={setTab}
            options={[
              { value: "tokens", label: "Tokens" },
              { value: "custom", label: "Custom" },
            ]}
          />
          {tab === "tokens" ? (
            <div className="q-fade">
              <div className={clsx(fieldBox, "mt-[8px] gap-[6px] px-[8px]")}>
                <Search size={12} className="shrink-0 text-fg-subtle" />
                <input autoFocus className="w-full bg-transparent text-caption outline-none focus-visible:outline-none" placeholder="Search tokens or hex" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="mt-[8px] max-h-[300px] overflow-y-auto">
                {groups.map((g) => {
                  const items = list.filter((t) => t.path.startsWith(g));
                  if (!items.length) return null;
                  return (
                    <div key={g} className="mb-[8px]">
                      <div className="px-[6px] pt-[2px] pb-[4px] text-micro font-medium text-fg-subtle">{g === "color." ? "Primitives" : g.slice(0, -1)}</div>
                      {items.map((t: Token) => {
                        const p = ts.paint(t.path)!;
                        return (
                          <Popover.Close asChild key={t.path}>
                            <button type="button" onClick={() => onChange(p.color, t.path, p.gradient)} className={clsx(pickRow, token === t.path && "bg-selected font-medium")}>
                              <Swatch color={p.color} gradient={p.gradient} size={14} />
                              <span className="flex-1 truncate">{t.path}</span>
                              <span className="font-mono text-micro text-fg-subtle">{p.gradient ? "gradient" : String(t.value)}</span>
                            </button>
                          </Popover.Close>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="q-fade mt-[8px] flex flex-col gap-[8px]">
              <HexColorPicker color={hex.slice(0, 7)} onChange={(c) => setHex(c.toUpperCase())} style={{ width: "100%", height: 160 }} />
              <div className="flex gap-[8px]">
                <input className="ds-input h-(--field-h) font-mono text-caption" value={hex} onChange={(e) => setHex(e.target.value)} />
                <Popover.Close asChild>
                  <Button
                    size="sm"
                    className="h-(--field-h)"
                    onClick={() => {
                      const n = normalizeHex(hex);
                      if (n) onChange(n, undefined);
                    }}
                  >
                    Apply
                  </Button>
                </Popover.Close>
              </div>
              <p className="text-caption text-fg-subtle">Custom colours are flagged as off-system in audits.</p>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Colour field (swatch + token chip or hex) used outside the Design panel. */
export function ColorField(props: { value: string | null; token?: string; onChange: (color: string, token?: string) => void; prefer?: string[]; label?: string }) {
  return (
    <ColorPopover {...props}>
      <button type="button" className={clsx(fieldBox, "w-full gap-[8px] px-[8px] text-left")} aria-label={`${props.label ?? "Fill"} colour`}>
        {props.value ? <Swatch color={props.value} /> : <span className="size-[16px] rounded-sm shadow-[inset_0_0_0_1px_var(--color-line-strong)]" />}
        {props.token ? <TokenChip path={props.token} /> : <span className="flex-1 truncate font-mono text-caption">{props.value ?? "None"}</span>}
      </button>
    </ColorPopover>
  );
}

/** Native select in a field. Consecutive options with the same `group` are listed under it. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  ariaLabel,
  icon,
}: {
  value: T | "";
  options: { value: T; label: string; group?: string }[];
  onChange: (v: T) => void;
  className?: string;
  ariaLabel?: string;
  icon?: ReactNode;
}) {
  const runs: { group?: string; items: typeof options }[] = [];
  for (const o of options) {
    const last = runs[runs.length - 1];
    if (last && last.group === o.group) last.items.push(o);
    else runs.push({ group: o.group, items: [o] });
  }
  const option = (o: (typeof options)[number]) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  );
  return (
    <div className={clsx(fieldBox, "relative", className)}>
      {icon && <span className="grid h-full w-[26px] shrink-0 place-items-center pl-[2px] text-fg-subtle [&_svg]:size-[12px]">{icon}</span>}
      <select
        aria-label={ariaLabel}
        className={clsx("h-full w-full min-w-0 cursor-pointer appearance-none bg-transparent pr-[24px] text-caption text-fg outline-none focus-visible:outline-none", !icon && "pl-[8px]")}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {value === "" && <option value="">—</option>}
        {runs.map((run, i) =>
          run.group ? (
            <optgroup key={`${i}:${run.group}`} label={run.group}>
              {run.items.map(option)}
            </optgroup>
          ) : (
            run.items.map(option)
          ),
        )}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-[8px] text-fg-subtle" />
    </div>
  );
}

/** Figma-style checkbox: invert fill (never saffron); the tick draws when the user checks it. */
export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; className?: string }) {
  // Only a user toggle draws the tick; a checkbox that mounts checked (selection change) shows it at once.
  const [drawn, setDrawn] = useState(false);
  return (
    <label className={clsx(r.checkRow, "min-h-[24px] cursor-pointer select-none", className)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        data-state={checked ? "checked" : "unchecked"}
        onClick={() => {
          setDrawn(true);
          onChange(!checked);
        }}
        className={clsx(r.checkbox, "q-press q-press-icon hover:shadow-[inset_0_0_0_1px_var(--color-fg-subtle)] data-[state=checked]:hover:shadow-none")}
      >
        {checked && (
          <span className="contents">
            <svg className="q-check" data-on={drawn || undefined} onAnimationEnd={() => setDrawn(false)} width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path pathLength={1} d="M20 6 9 17l-5-5" />
            </svg>
          </span>
        )}
      </button>
      {label}
    </label>
  );
}

/** Kept for existing call sites; renders as a Figma-style checkbox. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <Checkbox checked={checked} onChange={onChange} label={label} />;
}

/** Figma-like corner glyph for radius fields. */
export function CornerIcon({ corner = "tl", size = 12 }: { corner?: "tl" | "tr" | "br" | "bl"; size?: number }) {
  const rot = { tl: 0, tr: 90, br: 180, bl: 270 }[corner];
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden style={{ transform: `rotate(${rot}deg)` }}>
      <path d="M1.5 11 V6 A4.5 4.5 0 0 1 6 1.5 H11" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="ds-spin inline-block rounded-full border-[1.5px] border-current border-t-transparent" style={{ width: size, height: size }} />;
}
