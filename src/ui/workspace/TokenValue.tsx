import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { HexColorPicker } from "react-colorful";
import { Check, Hexagon, Minus, Plus, Search, Unlink2 } from "lucide-react";
import { normalizeHex, px, type Token, type TokenSet } from "@/design-system/resolve";
import { aliasTargets, tierOf, type Tier } from "@/design-system/edit";
import { tokenSetFor, useSystems } from "@/design-system/registry";
import { STYLE_BY_PATH } from "@/design-system/styles";
import type { Tree } from "@/design-system/resolve";
import { Button, Checkbox, NumberField, Segmented, Select, Swatch } from "../controls";
import { cssShadow } from "../css";
import { r } from "../recipes";

/**
 * Value cells of the token table: one editor per DTCG type, plus the reference picker every type
 * shares (Figma's "variable" chip). Editors report a new $value through `onSet`, which returns
 * false when the value was refused (the cell then shows the stored value again).
 */

type OnSet = (value: unknown) => boolean;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ALIAS = /^\{([^}]+)\}$/;
const aliasOf = (v: unknown) => (typeof v === "string" ? (v.match(ALIAS)?.[1] ?? null) : null);

/** Editor popovers: the popover recipe with roomier padding (they hold fields, not a list). */
const popoverBox = clsx(r.popover, "p-[12px]");
/** A value cell that opens an editor: flat until hovered, pressed while its popover is open. */
const cellBtn = "q-item flex h-[28px] min-w-0 items-center gap-[8px] rounded-md px-[6px] text-left hover:bg-hover data-[state=open]:bg-active";
/** Captions above popover fields ("Weight", "Size"). */
const caption = "text-micro text-fg-subtle";
/** Icon props for every lucide glyph here: 1.25px lines at any size. */
const ico = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
/** Small square icon buttons inside popovers and rows (remove a layer, a stop). */
const rowIconBtn = r.iconButtonSm;

// ---------------------------------------------------------------------------
// Small previews

export function TokenPreview({ ts, t, size = 16 }: { ts: TokenSet; t: Token; size?: number }) {
  switch (t.type) {
    case "color":
    case "gradient": {
      const p = ts.paint(t.path);
      return p ? <Swatch color={p.color} gradient={p.gradient} size={size} /> : null;
    }
    case "typography": {
      const s = ts.typography(t.path);
      return (
        <span
          className="grid shrink-0 place-items-center rounded-sm bg-active text-fg"
          style={{ width: size + 6, height: size, fontFamily: s?.fontFamily, fontWeight: s?.fontWeight, fontSize: Math.min(size - 3, 13) }}
        >
          Ag
        </span>
      );
    }
    case "shadow":
      // A content preview: drawn on the light stage, where a shadow can be seen in either theme.
      return <span className="shrink-0 rounded-sm bg-stage" style={{ width: size, height: size, boxShadow: cssShadow(ts.shadowLayers(t.path)) || "inset 0 0 0 1px var(--color-line-strong)" }} />;
    case "fontFamily":
      return (
        <span className="grid shrink-0 place-items-center rounded-sm bg-active text-caption text-fg" style={{ width: size + 6, height: size, fontFamily: String(t.value) }}>
          Aa
        </span>
      );
    case "dimension":
      return (
        <span className="grid shrink-0 place-items-center rounded-sm bg-active" style={{ width: size, height: size }}>
          <span className="rounded-full bg-fg-subtle" style={{ width: Math.max(2, Math.min(size - 4, px(t.value) / 3)), height: 2 }} />
        </span>
      );
    default:
      return null;
  }
}

/** One-line summary of a resolved value. */
export function valueText(ts: TokenSet, t: Token): string {
  switch (t.type) {
    case "color":
      return String(t.value);
    case "dimension":
      return `${px(t.value)}px`;
    case "fontFamily":
      return String(t.value);
    case "typography": {
      const s = ts.typography(t.path);
      return s ? `${s.fontFamily} · ${s.fontWeight} · ${s.fontSize}/${s.lineHeight}` : "";
    }
    case "shadow": {
      const l = ts.shadowLayers(t.path) ?? [];
      return l.length ? l.map((x) => `${x.kind === "inner" ? "inset " : ""}${x.x} ${x.y} ${x.blur} ${x.spread}`).join(", ") : "None";
    }
    case "gradient": {
      const g = ts.gradient(t.path);
      return g ? `${g.kind}${g.kind === "linear" ? ` ${g.angle}°` : ""} · ${g.stops.length} stops` : "";
    }
    case "string":
      return String(t.value);
    default:
      return JSON.stringify(t.value);
  }
}

/** A structure option (styles.ts): its listed values as a segmented control, or a menu when there are many. */
export function OptionEditor({ path, value, onSet, className }: { path: string; value: string; onSet: OnSet; className?: string }) {
  const axis = STYLE_BY_PATH.get(path);
  if (!axis) return null;
  const options = axis.values.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1), title: axis.valueHelp[v] }));
  return options.length <= 3 ? (
    <Segmented label={axis.label} className={clsx("min-w-0 flex-1", className)} value={value} options={options} onChange={(v) => void onSet(v)} />
  ) : (
    <Select className={clsx("min-w-0 flex-1", className)} ariaLabel={axis.label} value={value} options={options} onChange={(v) => void onSet(v)} />
  );
}

// ---------------------------------------------------------------------------
// Inputs

/**
 * How an in-place input looks at rest. `cell`: flat text in a table cell until hovered (hairline) or
 * focused (field fill, saffron edge and halo, like every field). `field`: always a filled field
 * (inside popovers). `bare`: no chrome; the caller's wrapper draws it.
 */
const INLINE = {
  cell: "bg-transparent hover:shadow-[inset_0_0_0_1px_var(--color-line)] hover:duration-0 focus:bg-field focus:shadow-focus-field focus:duration-0",
  field: "bg-field hover:shadow-[inset_0_0_0_1px_var(--color-line)] hover:duration-0 focus:bg-panel focus:shadow-focus-field focus:duration-0",
  bare: "bg-transparent",
} as const;

/** Text that edits in place: commits on Enter or blur, Escape puts the stored value back. */
export function InlineInput({
  value,
  onCommit,
  placeholder,
  className,
  ariaLabel,
  autoFocus,
  onDone,
  style,
  look = "cell",
  text = "text-body text-fg",
  quiet,
}: {
  value: string;
  onCommit: (v: string) => boolean | void;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
  autoFocus?: boolean;
  onDone?: () => void;
  style?: React.CSSProperties;
  look?: keyof typeof INLINE;
  /** Type size and colour (replaces the default rather than fighting it). */
  text?: string;
  /** Placeholder shows only on row hover or focus (descriptions in the token table). */
  quiet?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const skip = useRef(false);
  return (
    <input
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      value={draft ?? value}
      placeholder={placeholder}
      style={style}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!skip.current && draft !== null && draft !== value) onCommit(draft);
        skip.current = false;
        setDraft(null);
        onDone?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          e.preventDefault();
          skip.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={clsx(
        "h-[28px] min-w-0 rounded-md px-[6px] outline-none transition-[box-shadow,background-color] duration-fast focus-visible:outline-none",
        text,
        quiet ? "placeholder:text-transparent group-hover/row:placeholder:text-fg-faint focus:placeholder:text-fg-faint" : "placeholder:text-fg-faint",
        INLINE[look],
        className,
      )}
    />
  );
}

/** A number field that only reports once the edit is done (typing, scrubbing or arrow keys). */
function CommitNumber({
  label,
  value,
  onCommit,
  min,
  max,
  step,
  suffix,
  className,
}: {
  label: ReactNode;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
    setDraft(value);
  }, [value]);
  return (
    <NumberField
      label={label}
      value={draft}
      min={min}
      max={max}
      step={step}
      suffix={suffix}
      className={className}
      onChange={(v) => {
        ref.current = v;
        setDraft(v);
      }}
      onCommit={() => {
        if (ref.current !== value) onCommit(ref.current);
      }}
    />
  );
}

/** The system's current tokens, for popovers: the row that opened them may have rendered before other edits. */
function useLive(dsId: string): { ts: TokenSet; tree: Tree } {
  const ds = useSystems((s) => s.systems.find((x) => x.id === dsId));
  return useMemo(() => ({ ts: tokenSetFor(dsId), tree: ds?.tree ?? {} }), [ds, dsId]);
}


// ---------------------------------------------------------------------------
// References (aliases)

function AliasList({ dsId, t, onPick, current }: { dsId: string; t: Token; onPick: (path: string) => void; current?: string | null }) {
  const { ts, tree } = useLive(dsId);
  const [q, setQ] = useState("");
  const all = useMemo(() => aliasTargets(ts, t.path, t.type, tree), [ts, t.path, t.type, tree]);
  const list = all.filter((x) => !q || x.path.toLowerCase().includes(q.toLowerCase()) || String(x.value).toLowerCase().includes(q.toLowerCase()));
  // Raw colour ramps last: roles are what most tokens should point at.
  const order = (x: Token) => (x.path.startsWith("color.") ? 1 : 0);
  return (
    <div className="flex flex-col gap-[8px]">
      <label className={clsx(r.field, "cursor-text")}>
        <Search size={12} {...ico} className="shrink-0 text-fg-subtle" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tokens" aria-label="Search tokens" className={r.fieldInput} />
      </label>
      <div className="-mx-[4px] max-h-[300px] overflow-y-auto px-[4px]">
        {list.length === 0 && <p className="px-[6px] py-[12px] text-caption text-fg-subtle">No {t.type} tokens to point at.</p>}
        {[...list]
          .sort((a, b) => order(a) - order(b))
          .map((x) => (
            <Popover.Close asChild key={x.path}>
              <button
                type="button"
                onClick={() => onPick(x.path)}
                aria-current={current === x.path || undefined}
                className={clsx(
                  "q-item flex h-[28px] w-full items-center gap-[8px] rounded-md px-[6px] text-left text-body text-fg hover:bg-hover focus-visible:bg-active focus-visible:outline-none",
                  current === x.path && r.selectedRow,
                )}
              >
                <TokenPreview ts={ts} t={x} size={14} />
                <span className="min-w-0 flex-1 truncate">{x.path}</span>
                {current === x.path ? (
                  <Check size={12} {...ico} className="shrink-0 text-fg" />
                ) : (
                  <span className="max-w-[40%] truncate font-mono text-micro text-fg-subtle">{valueText(ts, x)}</span>
                )}
              </button>
            </Popover.Close>
          ))}
      </div>
    </div>
  );
}

/** The reference picker behind the hexagon button (and behind an alias chip). */
function AliasPopover({ dsId, t, onSet, children }: { dsId: string; t: Token; onSet: OnSet; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={8} className={clsx(popoverBox, "w-[340px]")} onKeyDown={(e) => e.stopPropagation()}>
          <div className="mb-[8px] flex h-[24px] items-center justify-between">
            <span className="text-caption font-semibold text-fg">Point at a token</span>
            {t.aliasOf && (
              <Popover.Close asChild>
                <Button size="sm" variant="ghost" className="-mr-[4px]" title="Replace the reference with its current value" onClick={() => onSet(t.value)}>
                  <Unlink2 size={12} {...ico} /> Detach
                </Button>
              </Popover.Close>
            )}
          </div>
          <AliasList dsId={dsId} t={t} current={t.aliasOf} onPick={(p) => onSet(`{${p}}`)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AliasButton({ dsId, t, onSet }: { dsId: string; t: Token; onSet: OnSet }) {
  return (
    <AliasPopover dsId={dsId} t={t} onSet={onSet}>
      <button
        type="button"
        aria-label="Point at another token"
        title="Point at another token"
        className={clsx(rowIconBtn, "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100")}
      >
        <Hexagon size={14} {...ico} />
      </button>
    </AliasPopover>
  );
}

/**
 * Tier identity, shared by the table's tier dots and the alias chips (never status, never saffron):
 * primitives neutral, semantic roles the selection blue, component recipes the component violet.
 */
export const TIER_DOT: Record<Tier, string> = { primitive: "bg-fg-subtle", semantic: "bg-selection-label", component: "bg-component" };
const TIER_CHIP: Record<Tier, string> = { primitive: "", semantic: "bg-selection-subtle text-selection-label", component: r.tokenChipComponent };

/** A reference shown as a chip, like a Figma variable; the tier colours it. */
export function AliasChip({ path, tree }: { path: string; tree: Tree }) {
  const tier = tierOf(tree, path);
  return (
    <span className={clsx(r.tokenChip, "max-w-full", TIER_CHIP[tier])} title={`Points at ${path}`}>
      <span className={clsx(r.tokenChipDot, TIER_DOT[tier])} aria-hidden />
      <span className="truncate">{path}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Per-type editors

function ColorEditor({ t, onSet }: { t: Token; onSet: OnSet }) {
  const stored = String(t.value);
  const [draft, setDraft] = useState(stored);
  useEffect(() => setDraft(stored), [stored]);
  const alpha = draft.length === 9 ? Math.round((parseInt(draft.slice(7), 16) / 255) * 100) : 100;
  const commit = (v = draft) => {
    const n = normalizeHex(v);
    if (n && n !== stored && !onSet(n)) setDraft(stored);
  };
  const withAlpha = (hex: string, a: number) =>
    a >= 100
      ? hex.slice(0, 7)
      : `${hex.slice(0, 7)}${Math.round((a / 100) * 255)
          .toString(16)
          .padStart(2, "0")
          .toUpperCase()}`;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-[2px]">
      <Popover.Root onOpenChange={(open) => !open && commit()}>
        <Popover.Trigger asChild>
          {/* The swatch gets a ring while its picker is open, so you can see which row you are editing. */}
          <button
            type="button"
            aria-label={`Edit colour ${stored}`}
            className="q-item q-press q-press-icon group/sw grid size-[28px] shrink-0 place-items-center rounded-md hover:bg-hover data-[state=open]:bg-active"
          >
            <Swatch color={draft} size={16} className="group-data-[state=open]/sw:shadow-[0_0_0_1px_var(--color-panel),0_0_0_2.5px_var(--color-fg-muted)]" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={8} className={clsx(popoverBox, "w-[248px]")} onKeyDown={(e) => e.stopPropagation()}>
            <HexColorPicker color={draft.slice(0, 7)} onChange={(c) => setDraft(withAlpha(c.toUpperCase(), alpha))} style={{ width: "100%", height: 168 }} />
            <div className="mt-[8px] grid grid-cols-[minmax(0,1fr)_88px] gap-[8px]">
              <input
                className="ds-input h-(--field-h) font-mono text-caption uppercase"
                aria-label="Hex"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  const n = normalizeHex(draft);
                  setDraft(n ?? stored);
                }}
                onKeyDown={(e) => e.key === "Enter" && commit()}
              />
              <NumberField label="A" value={alpha} min={0} max={100} suffix="%" onChange={(a) => setDraft(withAlpha(draft, a))} />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <InlineInput ariaLabel="Hex value" value={stored} text="font-mono text-caption text-fg uppercase tnum" className="w-[112px]" onCommit={(v) => onSet(v)} />
    </div>
  );
}

function DimensionEditor({ t, onSet }: { t: Token; onSet: OnSet }) {
  const v = px(t.value);
  return (
    <label className="flex h-[28px] cursor-text items-center rounded-md pr-[8px] transition-[box-shadow,background-color] duration-fast hover:shadow-[inset_0_0_0_1px_var(--color-line)] hover:duration-0 focus-within:bg-field focus-within:shadow-focus-field focus-within:duration-0">
      <InlineInput look="bare" ariaLabel="Size in px" value={String(v)} text="text-body text-fg tnum" className="w-[48px] pr-[2px]" onCommit={(x) => onSet(x)} />
      <span className="text-caption text-fg-subtle">px</span>
    </label>
  );
}

function FamilyEditor({ t, onSet }: { t: Token; onSet: OnSet }) {
  return <InlineInput ariaLabel="Font family" value={String(t.value)} className="w-[224px]" style={{ fontFamily: String(t.value) }} onCommit={(v) => onSet(v)} />;
}

const WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];

function TypographyEditor({ dsId, ts, t, onSet }: { dsId: string; ts: TokenSet; t: Token; onSet: OnSet }) {
  const a = (isObj(t.authored) ? t.authored : {}) as Record<string, unknown>;
  const s = ts.typography(t.path);
  const set = (patch: Record<string, unknown>) => onSet({ ...a, ...patch });
  const families = useLive(dsId).ts.ofType("fontFamily");
  const famAlias = aliasOf(a.fontFamily);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={clsx(cellBtn, "flex-1")} aria-label="Edit type style">
          <span className="min-w-0 truncate text-fg" style={{ fontFamily: s?.fontFamily, fontWeight: s?.fontWeight, fontSize: Math.min(s?.fontSize ?? 13, 20), lineHeight: "24px" }}>
            Ag Where to?
          </span>
          <span className="shrink-0 font-mono text-micro text-fg-subtle">{valueText(ts, t)}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={8} className={clsx(popoverBox, "flex w-[320px] flex-col gap-[12px]")} onKeyDown={(e) => e.stopPropagation()}>
          <div className="text-caption font-semibold text-fg">Type style</div>
          <div className="flex flex-col gap-[4px]">
            <span className={caption}>Font family</span>
            <Select
              ariaLabel="Font family"
              value={famAlias ? `{${famAlias}}` : "custom"}
              options={[
                ...families.map((f) => ({ value: `{${f.path}}`, label: `${f.path} · ${String(f.value)}` })),
                { value: "custom", label: famAlias ? "Custom…" : `Custom: ${String(a.fontFamily ?? "")}` },
              ]}
              onChange={(v) => v !== "custom" && set({ fontFamily: v })}
            />
            {!famAlias && <InlineInput look="field" ariaLabel="Custom font family" value={String(a.fontFamily ?? "")} onCommit={(v) => set({ fontFamily: v })} />}
          </div>
          <div className="grid grid-cols-2 gap-[8px]">
            <div className="flex flex-col gap-[4px]">
              <span className={caption}>Weight</span>
              <Select ariaLabel="Weight" value={String(s?.fontWeight ?? 400)} options={WEIGHTS.map((w) => ({ value: w, label: w }))} onChange={(w) => set({ fontWeight: Number(w) })} />
            </div>
            <div className="flex flex-col gap-[4px]">
              <span className={caption}>Size</span>
              <CommitNumber label="Sz" value={s?.fontSize ?? 16} min={1} suffix="px" onCommit={(v) => set({ fontSize: v })} />
            </div>
            <div className="flex flex-col gap-[4px]">
              <span className={caption}>Line height</span>
              <CommitNumber label="Lh" value={s?.lineHeight ?? 24} min={1} suffix="px" onCommit={(v) => set({ lineHeight: v })} />
            </div>
            <div className="flex flex-col gap-[4px]">
              <span className={caption}>Letter spacing</span>
              <CommitNumber label="Ls" value={s?.letterSpacing ?? 0} step={0.1} suffix="px" onCommit={(v) => set({ letterSpacing: v })} />
            </div>
          </div>
          {/* A content preview, in the system's own surface and text colours. */}
          <div
            className="rounded-md p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]"
            style={{
              background: ts.color("bg.surface") ?? undefined,
              color: ts.color("text.primary") ?? undefined,
              fontFamily: s?.fontFamily,
              fontWeight: s?.fontWeight,
              fontSize: Math.min(s?.fontSize ?? 16, 32),
              lineHeight: `${Math.min(s?.lineHeight ?? 24, 40)}px`,
              letterSpacing: s?.letterSpacing,
            }}
          >
            Where to next?
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type Layer = { color: string; offsetX: number; offsetY: number; blur: number; spread: number; inset?: boolean };

function ShadowEditor({ ts, t, onSet }: { ts: TokenSet; t: Token; onSet: OnSet }) {
  const raw = Array.isArray(t.authored) ? t.authored : isObj(t.authored) ? [t.authored] : [];
  const layers: Layer[] = raw
    .filter(isObj)
    .map((l) => ({ color: String(l.color ?? "#00000026"), offsetX: px(l.offsetX), offsetY: px(l.offsetY), blur: px(l.blur), spread: px(l.spread), inset: l.inset === true }));
  const save = (next: Layer[]) => onSet(next.map(({ inset, ...l }) => ({ ...l, ...(inset ? { inset: true } : {}) })));
  const patch = (i: number, p: Partial<Layer>) => save(layers.map((l, k) => (k === i ? { ...l, ...p } : l)));
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={clsx(cellBtn, "flex-1")} aria-label="Edit shadow">
          <TokenPreview ts={ts} t={t} size={16} />
          <span className="min-w-0 truncate font-mono text-caption text-fg-muted">{valueText(ts, t)}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={8} className={clsx(popoverBox, "flex w-[360px] flex-col gap-[12px]")} onKeyDown={(e) => e.stopPropagation()}>
          <div className="flex h-[24px] items-center justify-between">
            <span className="text-caption font-semibold text-fg">Shadow layers</span>
            {/* A new layer's colour is token data (a soft black), not chrome. */}
            <Button size="sm" variant="ghost" className="-mr-[4px]" onClick={() => save([...layers, { color: "#0E13421A", offsetX: 0, offsetY: 4, blur: 12, spread: 0 }])}>
              <Plus size={12} {...ico} /> Layer
            </Button>
          </div>
          {layers.length === 0 && <p className="text-caption text-fg-subtle">No shadow. Add a layer to give this elevation depth.</p>}
          {layers.map((l, i) => (
            <div key={i} className="flex flex-col gap-[8px] rounded-lg bg-muted p-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
              <div className="flex items-center gap-[8px]">
                <Swatch color={ts.color(aliasOf(l.color) ?? "") ?? (normalizeHex(l.color) || "#000000")} size={16} />
                <InlineInput look="field" ariaLabel="Layer colour" value={l.color} text="font-mono text-caption text-fg" className="flex-1" onCommit={(v) => patch(i, { color: v.trim() })} />
                <Checkbox checked={!!l.inset} onChange={(v) => patch(i, { inset: v })} label="Inner" />
                <button type="button" aria-label="Remove layer" onClick={() => save(layers.filter((_, k) => k !== i))} className={rowIconBtn}>
                  <Minus size={14} {...ico} />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-[6px]">
                <CommitNumber label="X" value={l.offsetX} onCommit={(v) => patch(i, { offsetX: v })} />
                <CommitNumber label="Y" value={l.offsetY} onCommit={(v) => patch(i, { offsetY: v })} />
                <CommitNumber label="B" value={l.blur} min={0} onCommit={(v) => patch(i, { blur: v })} />
                <CommitNumber label="S" value={l.spread} onCommit={(v) => patch(i, { spread: v })} />
              </div>
            </div>
          ))}
          {/* Preview on the system's own surface, where its shadows are meant to be seen. */}
          <div className="grid h-[64px] place-items-center rounded-lg shadow-[inset_0_0_0_1px_var(--color-line-subtle)]" style={{ background: ts.color("bg.surface") }}>
            <div className="h-[36px] w-[96px] rounded-lg" style={{ background: ts.color("bg.surface-raised"), boxShadow: cssShadow(ts.shadowLayers(t.path)) }} />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type Stop = { color: string; position: number };

function GradientEditor({ ts, t, onSet }: { ts: TokenSet; t: Token; onSet: OnSet }) {
  const a = (isObj(t.authored) ? t.authored : {}) as Record<string, unknown>;
  const kind = a.kind === "radial" ? "radial" : "linear";
  const angle = Number(a.angle ?? 180);
  const stops: Stop[] = (Array.isArray(a.stops) ? a.stops : []).filter(isObj).map((s) => ({ color: String(s.color ?? "#000000"), position: Number(s.position ?? 0) }));
  const save = (p: Partial<{ kind: string; angle: number; stops: Stop[] }>) => onSet({ kind, angle, stops, ...p });
  const g = ts.gradient(t.path);
  const resolved = (c: string) => ts.color(aliasOf(c) ?? "") ?? normalizeHex(c) ?? "#000000";
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={clsx(cellBtn, "flex-1")} aria-label="Edit gradient">
          <TokenPreview ts={ts} t={t} size={16} />
          <span className="min-w-0 truncate font-mono text-caption text-fg-muted">{valueText(ts, t)}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={8} className={clsx(popoverBox, "flex w-[340px] flex-col gap-[12px]")} onKeyDown={(e) => e.stopPropagation()}>
          <div
            className="h-[48px] rounded-lg shadow-swatch"
            style={{
              background: g ? `${g.kind === "radial" ? "radial-gradient(circle" : `linear-gradient(${g.angle}deg`}, ${g.stops.map((s) => `${s.color} ${s.position * 100}%`).join(", ")})` : undefined,
            }}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-[8px]">
            <Segmented
              label="Gradient type"
              value={kind}
              onChange={(k) => save({ kind: k })}
              options={[
                { value: "linear", label: "Linear" },
                { value: "radial", label: "Radial" },
              ]}
            />
            {kind === "linear" && <CommitNumber label="∠" value={angle} suffix="°" onCommit={(v) => save({ angle: v })} />}
          </div>
          <div className="flex h-[24px] items-center justify-between">
            <span className="text-caption font-semibold text-fg">Stops</span>
            <Button size="sm" variant="ghost" className="-mr-[4px]" onClick={() => save({ stops: [...stops, { color: stops[stops.length - 1]?.color ?? "#000000", position: 1 }] })}>
              <Plus size={12} {...ico} /> Stop
            </Button>
          </div>
          {stops.map((s, i) => (
            <div key={i} className="grid grid-cols-[16px_minmax(0,1fr)_84px_24px] items-center gap-[8px]">
              <Swatch color={resolved(s.color)} size={16} />
              <InlineInput look="field" ariaLabel="Stop colour" value={s.color} text="font-mono text-caption text-fg" onCommit={(v) => save({ stops: stops.map((x, k) => (k === i ? { ...x, color: v.trim() } : x)) })} />
              <CommitNumber label="%" value={Math.round(s.position * 100)} min={0} max={100} onCommit={(v) => save({ stops: stops.map((x, k) => (k === i ? { ...x, position: v / 100 } : x)) })} />
              <button type="button" aria-label="Remove stop" disabled={stops.length <= 2} onClick={() => save({ stops: stops.filter((_, k) => k !== i) })} className={rowIconBtn}>
                <Minus size={14} {...ico} />
              </button>
            </div>
          ))}
          <p className="text-micro text-fg-subtle">
            Stop colours take a hex or a reference like <span className="font-mono">{"{color.ink.500}"}</span>.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The Value cell of one token row. */
export function ValueCell({ dsId, ts, tree, t, onSet }: { dsId: string; ts: TokenSet; tree: Tree; t: Token; onSet: OnSet }) {
  if (t.aliasOf) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-[8px]">
        <AliasPopover dsId={dsId} t={t} onSet={onSet}>
          <button type="button" className={clsx(cellBtn, "min-w-0")} aria-label={`${t.path} points at ${t.aliasOf}; change`}>
            <TokenPreview ts={ts} t={t} size={16} />
            <AliasChip path={t.aliasOf} tree={tree} />
          </button>
        </AliasPopover>
        <span className="min-w-0 truncate font-mono text-micro text-fg-subtle" title="Resolved value">
          {valueText(ts, t)}
        </span>
      </div>
    );
  }
  let editor: ReactNode;
  switch (t.type) {
    case "color":
      editor = <ColorEditor t={t} onSet={onSet} />;
      break;
    case "dimension":
      editor = <DimensionEditor t={t} onSet={onSet} />;
      break;
    case "fontFamily":
      editor = <FamilyEditor t={t} onSet={onSet} />;
      break;
    case "typography":
      editor = <TypographyEditor dsId={dsId} ts={ts} t={t} onSet={onSet} />;
      break;
    case "shadow":
      editor = <ShadowEditor ts={ts} t={t} onSet={onSet} />;
      break;
    case "gradient":
      editor = <GradientEditor ts={ts} t={t} onSet={onSet} />;
      break;
    case "string":
      // Structure options take one of their values; they never point at another token.
      if (STYLE_BY_PATH.has(t.path)) return <OptionEditor path={t.path} value={String(t.value)} onSet={onSet} />;
      editor = <span className="truncate px-[6px] font-mono text-caption text-fg-subtle">{String(t.value)}</span>;
      break;
    default:
      editor = <span className="truncate px-[6px] font-mono text-caption text-fg-subtle">{JSON.stringify(t.value)}</span>;
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-[4px]">
      {editor}
      <AliasButton dsId={dsId} t={t} onSet={onSet} />
    </div>
  );
}
