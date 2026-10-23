import { useState, type ReactNode } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDown, ArrowRight, Check, ChevronDown, Hexagon, Minus, MoveHorizontal, MoveVertical, Plus, Unlink2, WrapText } from "lucide-react";
import type { AutoLayout, FrameNode, LogicalEdge, SceneNode, Sizing } from "@/doc/schema";
import { useStudio } from "@/doc/store";
import { hasAutoLayout, inFlow, shownSizing, type Axis } from "@/doc/autolayout";
import { setAbsolute, setSizing, sizingOptions, updateLayout } from "@/doc/autolayout-ops";
import { px, type TokenSet } from "@/design-system/resolve";
import { runCommand } from "@/commands";
import { Field, IconBtn, NumberField, Row, Segmented, TokenChip, fieldBox } from "./controls";
import { r } from "./recipes";
import { commit, edit, shared, useNodeTokens } from "./useSelection";

/*
 * Figma UI3 auto layout controls: flow direction and gap on one row, then the 3×3 alignment box
 * beside the padding fields, all on the Design panel's `1fr 1fr 24px` grid. Per-axis sizing
 * (fixed / hug / fill) sits inside the W and H fields. Menus use the shared menu recipe.
 */

/** A menu row that closes its popover (Popover-based menus; Radix menus aren't installed). */
function MenuRow({ children, checked, disabled, onSelect, meta }: { children: ReactNode; checked?: boolean; disabled?: boolean; onSelect: () => void; meta?: ReactNode }) {
  return (
    <Popover.Close asChild>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={!!checked}
        disabled={disabled}
        data-disabled={disabled || undefined}
        onClick={onSelect}
        className={clsx(r.menuItem, "w-full text-left hover:bg-active focus-visible:bg-active focus-visible:outline-none")}
      >
        <span className={r.menuCheckSlot}>{checked && <Check size={12} />}</span>
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {meta !== undefined && <span className="shrink-0 pl-[12px] text-caption text-fg-subtle tnum">{meta}</span>}
      </button>
    </Popover.Close>
  );
}

function Menu({ trigger, children, width = 220 }: { trigger: ReactNode; children: ReactNode; width?: number }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        {/* Drops below its field, right-aligned with it, like Figma's field menus. */}
        <Popover.Content side="bottom" align="end" sideOffset={4} collisionPadding={8} className={r.menu} style={{ width }} role="menu">
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const MenuCaption = ({ children }: { children: ReactNode }) => <div className={r.menuLabel}>{children}</div>;
const MenuDivider = () => <div role="separator" className={r.menuSeparator} />;

const spaceTokens = (ts: TokenSet) =>
  ts
    .ofType("dimension", "space.")
    .map((t) => ({ path: t.path, value: px(t.value) }))
    .sort((a, b) => a.value - b.value);

// ---------------------------------------------------------------------------
// Sizing on the W / H fields

const SIZING_LABEL: Record<Sizing, string> = { fixed: "Fixed", hug: "Hug", fill: "Fill" };

/** The sizing menu inside a W or H field ("Fixed ⌄"): fixed, hug contents, fill container, min / max. */
export function SizingMenu({ nodes, ids, axis }: { nodes: SceneNode[]; ids: string[]; axis: Axis }) {
  const doc = useStudio((s) => s.doc);
  const opts = nodes.map((n) => sizingOptions(doc, n));
  const canHug = opts.every((o) => o.hug);
  const canFill = opts.every((o) => o.fill);
  if (!canHug && !canFill) return null;
  const current = shared(nodes, (n) => shownSizing(doc, n, axis));
  const dim = axis === "h" ? "width" : "height";
  const minKey = axis === "h" ? "minW" : "minH";
  const maxKey = axis === "h" ? "maxW" : "maxH";
  const hasMin = nodes.every((n) => n[minKey] !== undefined);
  const hasMax = nodes.every((n) => n[maxKey] !== undefined);
  const toggleLimit = (key: "minW" | "minH" | "maxW" | "maxH", on: boolean) => {
    edit(ids, (n) => {
      if (on) n[key] = Math.round(axis === "h" ? n.w : n.h);
      else delete n[key];
    });
    commit();
  };
  return (
    <Menu
      trigger={
        <button
          type="button"
          aria-label={`${dim === "width" ? "Width" : "Height"} sizing`}
          className={clsx(
            "q-item inline-flex h-[20px] shrink-0 items-center gap-[2px] rounded-sm pr-[2px] pl-[4px] text-micro hover:bg-hover hover:text-fg data-[state=open]:bg-active data-[state=open]:text-fg",
            current && current !== "fixed" ? "text-fg-muted" : "text-fg-subtle",
          )}
        >
          {current ? SIZING_LABEL[current] : "Mixed"}
          <ChevronDown size={10} />
        </button>
      }
    >
      <MenuRow checked={current === "fixed"} onSelect={() => setSizing(ids, axis, "fixed")}>
        Fixed {dim}
      </MenuRow>
      <MenuRow checked={current === "hug"} disabled={!canHug} onSelect={() => setSizing(ids, axis, "hug")}>
        Hug contents
      </MenuRow>
      <MenuRow checked={current === "fill"} disabled={!canFill} onSelect={() => setSizing(ids, axis, "fill")}>
        Fill container
      </MenuRow>
      <MenuDivider />
      <MenuRow checked={hasMin} onSelect={() => toggleLimit(minKey, !hasMin)}>
        {hasMin ? "Remove" : "Add"} min {dim}
      </MenuRow>
      <MenuRow checked={hasMax} onSelect={() => toggleLimit(maxKey, !hasMax)}>
        {hasMax ? "Remove" : "Add"} max {dim}
      </MenuRow>
    </Menu>
  );
}

/** Min / max fields, shown once a limit has been added from the sizing menu. */
export function LimitFields({ nodes, ids }: { nodes: SceneNode[]; ids: string[] }) {
  const groups = [
    { label: "Width limits", keys: ["minW", "maxW"] as const },
    { label: "Height limits", keys: ["minH", "maxH"] as const },
  ]
    .map((g) => ({ ...g, keys: g.keys.filter((k) => nodes.some((n) => n[k] !== undefined)) }))
    .filter((g) => g.keys.length);
  return groups.map((g) => (
    <Field key={g.label} label={g.label}>
      <Row>
        {g.keys.map((k) => (
          <NumberField
            key={k}
            label={k.startsWith("min") ? "Min" : "Max"}
            className="[&>span:first-child]:w-[34px]"
            title={`${k.startsWith("min") ? "Minimum" : "Maximum"} ${k.endsWith("W") ? "width" : "height"}`}
            value={shared(nodes, (n) => n[k] ?? null)}
            min={0}
            onChange={(v) => edit(ids, (n) => void (n[k] = v))}
            onCommit={commit}
          />
        ))}
      </Row>
    </Field>
  ));
}

// ---------------------------------------------------------------------------
// Children of auto-layout frames

/** Figma's "absolute position" toggle for children of auto-layout frames (beside the Position caption). */
export function AbsolutePositionButton({ nodes, ids }: { nodes: SceneNode[]; ids: string[] }) {
  const doc = useStudio((s) => s.doc);
  const inAutoLayout = nodes.length > 0 && nodes.every((n) => n.parentId && hasAutoLayout(doc.nodes[n.parentId]));
  if (!inAutoLayout) return null;
  const absolute = nodes.every((n) => n.absolute);
  return (
    <IconBtn size="sm" className="-my-[4px] mr-[8px]" label={absolute ? "Remove absolute position" : "Absolute position (ignore auto layout)"} active={absolute} onClick={() => setAbsolute(ids, !absolute)}>
      <AbsoluteIcon />
    </IconBtn>
  );
}

function AbsoluteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 4.5v-3h3M9.5 1.5h3v3M12.5 9.5v3h-3M4.5 12.5h-3v-3" />
      <rect x="4.75" y="4.75" width="4.5" height="4.5" rx="0.75" />
    </svg>
  );
}

/** In-flow layers are placed by their parent: X / Y and alignment don't apply. */
export function usePlacedByLayout(nodes: SceneNode[]): boolean {
  return useStudio((s) => nodes.length > 0 && nodes.every((n) => s.doc.nodes[n.id] && inFlow(s.doc, s.doc.nodes[n.id])));
}

// ---------------------------------------------------------------------------
// The auto layout block itself (frames)

/** Layout section action: add auto layout (⇧A, wraps a non-frame selection) or remove it (⌥⇧A). */
export function AutoLayoutToggle({ nodes }: { nodes: SceneNode[]; ids: string[] }) {
  const all = nodes.length > 0 && nodes.every((n) => n.type === "frame" && n.layout);
  return all ? (
    <IconBtn size="sm" label="Remove auto layout" command="autolayout.remove" onClick={() => runCommand("autolayout.remove", "toolbar")}>
      <Minus size={14} />
    </IconBtn>
  ) : (
    <IconBtn size="sm" label="Add auto layout" command="autolayout.add" onClick={() => runCommand("autolayout.add", "toolbar")}>
      <Plus size={14} />
    </IconBtn>
  );
}

/** Physical side → logical edge, for the frame's direction. */
const logical = (side: "left" | "right" | "top" | "bottom", rtl: boolean): LogicalEdge =>
  side === "top" || side === "bottom" ? side : (side === "left") !== rtl ? "start" : "end";

export function AutoLayoutControls({ nodes, ids }: { nodes: SceneNode[]; ids: string[] }) {
  const frames = nodes.filter((n): n is FrameNode => n.type === "frame");
  const ts = useNodeTokens(nodes);
  const [fourSides, setFourSides] = useState(false);
  if (frames.length !== nodes.length || !frames.every((f) => f.layout)) return null;

  const L = (frames[0] as FrameNode & { layout: AutoLayout }).layout;
  const rtl = frames[0].dir === "rtl";
  const same = <T,>(get: (l: AutoLayout) => T) => shared(frames, (f) => get((f as FrameNode).layout!));
  const set = (fn: (l: AutoLayout) => void) => updateLayout(ids, fn);
  const scrub = (fn: (l: AutoLayout) => void) => updateLayout(ids, fn, true);
  const tokens = spaceTokens(ts);
  const tokenValue = (path: string) => tokens.find((t) => t.path === path)?.value ?? 0;
  const flow = same((l) => (l.wrap ? "wrap" : l.direction));
  const horizontal = L.direction === "horizontal";

  const padding = (edges: LogicalEdge[], label: ReactNode, title: string) => {
    const value = same((l) => (edges.every((e) => l.padding[e] === l.padding[edges[0]]) ? l.padding[edges[0]] : null));
    const token = same((l) => {
      const t = l.paddingTokens?.[edges[0]];
      return t && edges.every((e) => l.paddingTokens?.[e] === t) ? t : null;
    });
    return (
      <SpaceField
        key={title}
        label={label}
        title={title}
        value={value}
        token={token ?? undefined}
        tokens={tokens}
        onScrub={(v) =>
          scrub((l) => {
            for (const e of edges) {
              l.padding[e] = v;
              if (l.paddingTokens) delete l.paddingTokens[e];
            }
          })
        }
        onToken={(path) =>
          set((l) => {
            for (const e of edges) {
              if (path) {
                l.padding[e] = tokenValue(path);
                (l.paddingTokens ??= {})[e] = path;
              } else if (l.paddingTokens) delete l.paddingTokens[e];
            }
          })
        }
      />
    );
  };
  const asymmetric = frames.some((f) => f.layout!.padding.start !== f.layout!.padding.end || f.layout!.padding.top !== f.layout!.padding.bottom);
  const independent = fourSides || asymmetric;
  const paddingFields = independent
    ? [
        padding([logical("left", rtl)], <PadIcon side="left" />, "Left padding"),
        padding(["top"], <PadIcon side="top" />, "Top padding"),
        padding([logical("right", rtl)], <PadIcon side="right" />, "Right padding"),
        padding(["bottom"], <PadIcon side="bottom" />, "Bottom padding"),
      ]
    : [padding(["start", "end"], <PadIcon side="x" />, "Horizontal padding"), padding(["top", "bottom"], <PadIcon side="y" />, "Vertical padding")];

  return (
    <div className={r.rows}>
      <Row>
        <Segmented
          label="Direction"
          value={flow}
          onChange={(v) =>
            set((l) => {
              l.direction = v === "vertical" ? "vertical" : "horizontal";
              l.wrap = v === "wrap";
            })
          }
          options={[
            { value: "vertical", label: <ArrowDown size={14} />, title: "Vertical layout" },
            { value: "horizontal", label: <ArrowRight size={14} />, title: "Horizontal layout" },
            { value: "wrap", label: <WrapText size={14} />, title: "Wrap" },
          ]}
        />
        <SpaceField
          label={horizontal ? <MoveHorizontal size={12} /> : <MoveVertical size={12} />}
          suffix="Gap"
          title="Gap between items"
          value={same((l) => l.gap)}
          token={same((l) => l.gapToken ?? null) ?? undefined}
          auto={same((l) => l.justify === "between") ?? false}
          tokens={tokens}
          onScrub={(v) =>
            scrub((l) => {
              l.gap = v;
              delete l.gapToken;
            })
          }
          onToken={(path) =>
            set((l) => {
              if (path) {
                l.gap = tokenValue(path);
                l.gapToken = path;
              } else delete l.gapToken;
              if (l.justify === "between") l.justify = "start";
            })
          }
          onAuto={(on) => set((l) => void (l.justify = on ? "between" : "start"))}
        />
      </Row>
      {L.wrap && (
        <Row>
          <span />
          <SpaceField
            label={<MoveVertical size={12} />}
            suffix="Rows"
            title="Gap between rows"
            value={same((l) => l.crossGap)}
            token={same((l) => l.crossGapToken ?? null) ?? undefined}
            tokens={tokens}
            onScrub={(v) =>
              scrub((l) => {
                l.crossGap = v;
                delete l.crossGapToken;
              })
            }
            onToken={(path) =>
              set((l) => {
                if (path) {
                  l.crossGap = tokenValue(path);
                  l.crossGapToken = path;
                } else delete l.crossGapToken;
              })
            }
          />
        </Row>
      )}
      {/* The alignment box spans two rows beside the padding fields; column 3 toggles per-side padding. */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_24px] items-center gap-[8px]">
        <div className="col-start-1 row-span-2 row-start-1 self-start">
          <AlignGrid layout={L} rtl={rtl} onPick={(justify, align) => set((l) => void Object.assign(l, l.justify === "between" ? { align } : { justify, align }))} />
        </div>
        {paddingFields.map((f, i) => (
          <div key={i} className="col-start-2 min-w-0" style={{ gridRowStart: i + 1 }}>
            {f}
          </div>
        ))}
        <div className="col-start-3 row-start-1">
          <IconBtn
            size="sm"
            label={independent ? "Same padding on opposite sides" : "Padding per side"}
            active={independent}
            onClick={() => {
              if (!independent) return setFourSides(true);
              setFourSides(false);
              if (asymmetric)
                set((l) => {
                  l.padding.end = l.padding.start;
                  l.padding.bottom = l.padding.top;
                  if (l.paddingTokens) {
                    l.paddingTokens.end = l.paddingTokens.start;
                    l.paddingTokens.bottom = l.paddingTokens.top;
                  }
                });
            }}
          >
            <PadIcon side="all" />
          </IconBtn>
        </div>
      </div>
    </div>
  );
}

function PadIcon({ side }: { side: "left" | "right" | "top" | "bottom" | "x" | "y" | "all" }) {
  const bars: Record<typeof side, string> = {
    left: "M2 2v8",
    right: "M10 2v8",
    top: "M2 2h8",
    bottom: "M2 10h8",
    x: "M2 2v8M10 2v8",
    y: "M2 2h8M2 10h8",
    all: "M2 2v8M10 2v8M2 2h8M2 10h8",
  };
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="none" stroke="currentColor" strokeLinecap="round">
      <rect x="2" y="2" width="8" height="8" rx="1" strokeWidth="1" strokeDasharray="1.5 1.5" opacity="0.5" />
      <path d={bars[side]} strokeWidth="1.5" />
    </svg>
  );
}

const ITEMS = ["items-start", "items-center", "items-end"] as const;

/**
 * Figma's 3×3 alignment box, laid out physically (RTL mirrors the logical start/end). The picked
 * cell shows the children as bars; hovering any other cell previews where they would go.
 */
function AlignGrid({ layout: L, rtl, onPick }: { layout: AutoLayout; rtl: boolean; onPick: (justify: AutoLayout["justify"], align: AutoLayout["align"]) => void }) {
  const horizontal = L.direction === "horizontal";
  const POS = ["start", "center", "end"] as const;
  // Physical column / row index → logical position on that axis.
  const colPos = (c: number) => POS[rtl ? 2 - c : c];
  const rowPos = (row: number) => POS[row];
  const cells = [];
  for (let row = 0; row < 3; row++)
    for (let c = 0; c < 3; c++) {
      const justify = horizontal ? colPos(c) : rowPos(row);
      const align = horizontal ? rowPos(row) : colPos(c);
      const active = L.align === align && (L.justify === "between" || L.justify === justify);
      // Bars line up on the cross axis the way the children would (tops, centres or ends).
      const bars = (preview: boolean) => (
        <span className={clsx("size-[12px] gap-[2px]", horizontal ? "flex-row justify-center" : "flex-col justify-center", ITEMS[horizontal ? row : c], preview ? "hidden group-hover/cell:flex" : "flex")}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={clsx("shrink-0 rounded-[1px]", preview ? "bg-fg-subtle" : "bg-fg")}
              style={horizontal ? { width: 2, height: [8, 12, 6][i] } : { height: 2, width: [8, 12, 6][i] }}
            />
          ))}
        </span>
      );
      cells.push(
        <button
          key={`${row}${c}`}
          type="button"
          aria-label={`Align ${horizontal ? `${align} vertically, ${justify} horizontally` : `${justify} vertically, ${align} horizontally`}`}
          aria-pressed={active}
          onClick={() => onPick(justify, align)}
          className="group/cell q-item grid min-w-0 place-items-center rounded-sm hover:bg-hover"
        >
          {active ? (
            bars(false)
          ) : (
            <>
              <span className="size-[3px] rounded-full bg-fg-faint group-hover/cell:hidden" />
              {bars(true)}
            </>
          )}
        </button>,
      );
    }
  return <div className="grid h-[64px] grid-cols-3 grid-rows-3 rounded-md bg-field p-[2px]">{cells}</div>;
}

/** A spacing field: a number, "Auto", or a bound space token chip, with a menu of tokens. */
function SpaceField({
  label,
  suffix,
  title,
  value,
  token,
  auto,
  tokens,
  onScrub,
  onToken,
  onAuto,
}: {
  label: ReactNode;
  suffix?: string;
  title: string;
  value: number | null;
  token?: string;
  auto?: boolean;
  tokens: { path: string; value: number }[];
  onScrub: (v: number) => void;
  onToken: (path: string | undefined) => void;
  onAuto?: (on: boolean) => void;
}) {
  const matches = value !== null && !token ? tokens.find((t) => t.value === value && value > 0) : undefined;
  const menu = (trigger: ReactNode) => (
    <Menu trigger={trigger} width={232}>
      {onAuto && (
        <>
          <MenuRow checked={auto} onSelect={() => onAuto(!auto)} meta="Space between">
            Auto
          </MenuRow>
          <MenuDivider />
        </>
      )}
      <MenuCaption>Spacing tokens</MenuCaption>
      <div className="max-h-[240px] overflow-y-auto">
        {tokens.map((t) => (
          <MenuRow key={t.path} checked={token === t.path} onSelect={() => onToken(t.path)} meta={matches?.path === t.path ? "Matches" : t.value}>
            <span className="font-mono text-caption">{t.path}</span>
          </MenuRow>
        ))}
      </div>
      {token && (
        <>
          <MenuDivider />
          <MenuRow onSelect={() => onToken(undefined)}>
            <span className="inline-flex items-center gap-[6px]">
              <Unlink2 size={12} /> Detach token
            </span>
          </MenuRow>
        </>
      )}
    </Menu>
  );
  if (auto || token)
    return menu(
      <button type="button" className={clsx(fieldBox, "w-full gap-[4px] pr-[6px] text-left data-[state=open]:shadow-focus-field")} aria-label={title} title={title}>
        <span className="grid h-full w-[26px] shrink-0 place-items-center pl-[2px] text-fg-subtle [&_svg]:size-[12px]">{label}</span>
        {auto ? <span className="text-fg">Auto</span> : <TokenChip path={token!.replace("space.", "")} className="min-w-0" />}
        <span className="ml-auto flex shrink-0 items-center gap-[4px] text-micro text-fg-subtle tnum">
          {!auto && value !== null && value}
          <ChevronDown size={10} />
        </span>
      </button>,
    );
  return (
    <NumberField
      label={label}
      title={title}
      value={value}
      min={0}
      suffix={suffix}
      onChange={onScrub}
      onCommit={commit}
      right={menu(
        <button
          type="button"
          aria-label={`${title}: tokens${onAuto ? " and Auto" : ""}`}
          title={matches ? `Matches ${matches.path}` : "Spacing tokens"}
          className={clsx(
            "q-item grid size-[20px] shrink-0 place-items-center rounded-sm hover:bg-active hover:text-fg focus-visible:opacity-100 data-[state=open]:bg-active data-[state=open]:opacity-100",
            matches ? "text-fg-muted" : "text-fg-subtle opacity-0 group-hover/field:opacity-100",
          )}
        >
          <Hexagon size={12} />
        </button>,
      )}
    />
  );
}
