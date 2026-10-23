import { useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ALargeSmall,
  Blend,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Columns3,
  Eye,
  EyeOff,
  Grid3x3,
  Hexagon,
  ImageDown,
  Italic,
  Link2,
  Lock,
  LucideProvider,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Plus,
  RotateCw,
  Rows3,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  TriangleAlert,
  Type,
  Underline,
  Unlink2,
  Unlock,
} from "lucide-react";
import type { CornerKey, FrameNode, Gradient, IconNode, ImageNode, LayoutGrid, PathNode, Radius, SceneNode, TextNode } from "@/doc/schema";
import { CORNERS, uniformRadius } from "@/doc/schema";
import { px, type TokenSet } from "@/design-system/resolve";
import { isDirectional } from "@/design-system/icons";
import { tokensForNode } from "@/design-system/registry";
import { fitText, updateNodes } from "@/doc/ops";
import { alignNodes, canAlign, type AlignKind } from "@/doc/align";
import { isGroup } from "@/doc/group";
import { addLayoutGrid, removeLayoutGrid, setLayoutGrid } from "@/doc/grids";
import { studio, useStudio } from "@/doc/store";
import { pinResized } from "@/doc/autolayout-ops";
import { detectDirection } from "@/engine/text";
import { loadedFamilies } from "@/engine/fonts";
import { auditNode } from "@/lint/rules";
import { ESSENTIAL, runCommand, useCommand } from "@/commands";
import { exportSelectionPNG } from "./exporter";
import {
  Button,
  Checkbox,
  ColorPopover,
  CornerIcon,
  Field,
  Hint,
  IconBtn,
  Kbd,
  NumberField,
  Row,
  Section,
  Segmented,
  Select,
  Swatch,
  Tag,
  Tip,
  TokenButton,
  TokenChip,
  TokenPicker,
  fieldBox,
} from "./controls";
import { r } from "./recipes";
import { cssVar, useTheme } from "./theme";
import { QalamAIGlyph } from "./brand/ai-glyph";
import { IconPicker } from "./IconPicker";
import { commit, edit, editNow, shared, tsFor, useNodeTokens, useSelectedNodes } from "./useSelection";
import { AbsolutePositionButton, AutoLayoutControls, AutoLayoutToggle, LimitFields, SizingMenu, usePlacedByLayout } from "./AutoLayoutSection";
import { cssShadow } from "./css";
import { openExtractTurn, startExtractChat, useExtractionOf } from "./ai/extractChat";
import { InstanceBadge } from "./InstanceBadge";
import { layerKind } from "./layerKind";
import VectorSection from "./VectorSection";

/*
 * The Design panel (Figma UI3, design/spec.md §6): every row sits on the `1fr 1fr 24px` grid
 * (`Row`), so fields line up whether or not a row has a trailing icon. Section titles are 12px
 * semibold with their add/remove/visibility actions on the right. Content swaps instantly when the
 * selection changes (never animated), and every shortcut shown comes from the commands registry.
 */

const radiusTokens = (ts: TokenSet) => ts.ofType("dimension", "radius.");
const radiusScale = (ts: TokenSet) => radiusTokens(ts).map((t) => px(t.value));
const arabicFace = (ts: TokenSet) => String(ts.get("font.family.arabic")?.value ?? "IBM Plex Sans Arabic");

/** A line is drawn on one axis: its height is always 0. */
const isLine = (n: SceneNode) => n.type === "path" && n.shape?.kind === "line";

export default function PropertiesPanel() {
  const nodes = useSelectedNodes();
  return (
    <LucideProvider strokeWidth={1.25} absoluteStrokeWidth>
      <div data-region="design" data-design-panel aria-label="Design panel" className="flex flex-col pb-[24px]">
        {nodes.length ? <SelectionPanel nodes={nodes} /> : <EmptyState />}
      </div>
    </LucideProvider>
  );
}

function SelectionPanel({ nodes }: { nodes: SceneNode[] }) {
  const ids = nodes.map((n) => n.id);
  const one = nodes.length === 1 ? nodes[0] : null;
  const allText = nodes.every((n) => n.type === "text");
  const allIcons = nodes.every((n) => n.type === "icon");
  const allFrames = nodes.every((n) => n.type === "frame");
  // Groups only hold layers: no fill, stroke, clip, radius, effects or auto layout (doc/group.ts).
  const anyGroup = nodes.some((n) => isGroup(n));
  const paintable = !allText && !allIcons && !anyGroup;

  return (
    <>
      <HeaderSection nodes={nodes} ids={ids} />
      <LayoutSection nodes={nodes} ids={ids} frame={allFrames && one && !anyGroup ? (one as FrameNode) : null} group={anyGroup} />
      <AppearanceSection nodes={nodes} ids={ids} group={anyGroup} />
      {allText && <TypographySection nodes={nodes as TextNode[]} ids={ids} />}
      {allIcons && one && <IconSection node={one as IconNode} />}
      {one?.type === "image" && <ImageSystemSection node={one as ImageNode} />}
      {!anyGroup && <FillSection nodes={nodes} ids={ids} />}
      {paintable && <StrokeSection nodes={nodes} ids={ids} />}
      {one?.type === "path" && <VectorSection node={one as PathNode} />}
      {paintable && !nodes.some((n) => n.type === "path") && <EffectsSection nodes={nodes} ids={ids} />}
      {allFrames && one && !anyGroup && <LayoutGridSection frame={one as FrameNode} />}
      {one?.meta.flags?.length ? <IssuesSection node={one} /> : null}
      <ExportSection nodes={nodes} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Nothing selected: the canvas, and the essential shortcuts (from the registry).

function EmptyState() {
  // The swatch shows the canvas the user actually sees, so it follows the theme.
  const theme = useTheme((s) => s.resolved);
  const hex = cssVar("--color-canvas").replace("#", "").toUpperCase();
  const all = useCommand("essential.shortcuts");
  return (
    <>
      <Section title="Canvas">
        <Field label="Background">
          <Row>
            <div className={clsx(fieldBox, "col-span-2 gap-[8px] pl-[6px] pr-[8px]")} aria-label="Canvas background">
              <Swatch color="var(--color-canvas)" />
              <span className="font-mono text-caption text-fg">{hex || "—"}</span>
              <span className="ml-auto text-micro text-fg-subtle">{theme === "dark" ? "Dark theme" : "Light theme"}</span>
            </div>
          </Row>
        </Field>
        <p className="pr-[8px] text-caption text-fg-muted">
          Select a layer to edit it, or use <b className="font-medium text-fg">Generate</b> to compose screens from the component catalog.
        </p>
      </Section>
      <Section
        title="Shortcuts"
        actions={
          all && (
            <Button variant="ghost" size="sm" className="gap-[6px] pr-[4px]" onClick={() => runCommand("essential.shortcuts", "menu")}>
              All shortcuts
              {all.keys[0] && <Kbd keys={all.keys[0]} size="sm" />}
            </Button>
          )
        }
      >
        <div className="-mt-[4px] flex flex-col">
          {ESSENTIAL.map((id) => (
            <ShortcutRow key={id} id={id} />
          ))}
        </div>
      </Section>
    </>
  );
}

function ShortcutRow({ id }: { id: string }) {
  const c = useCommand(id);
  if (!c || c.unavailable || !c.keys.length) return null;
  return (
    <div className="flex h-[28px] items-center justify-between gap-[8px] pr-[8px] text-body">
      <span className="truncate text-fg-muted">{c.label}</span>
      <Kbd keys={c.keys[0]} size="sm" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header + position: what is selected, then where it sits.

function HeaderSection({ nodes, ids }: { nodes: SceneNode[]; ids: string[] }) {
  const one = nodes.length === 1 ? nodes[0] : null;
  const kinds = new Set(nodes.map((n) => layerKind(n).label));
  const kind = one ? layerKind(one) : null;
  const tags = one && (one.meta.component || one.meta.source !== "user");
  return (
    <section className={r.section}>
      <header className="grid h-[32px] grid-cols-[minmax(0,1fr)_auto] items-center gap-[8px]">
        <div className="flex min-w-0 items-center gap-[6px]">
          {kind && <kind.Icon size={14} className={clsx("shrink-0", kind.component ? "text-component" : "text-fg-subtle")} aria-hidden />}
          {one ? (
            <input
              className="-ml-[4px] h-[24px] min-w-0 flex-1 rounded-sm bg-transparent px-[4px] text-caption font-semibold text-fg outline-none transition-[box-shadow,background-color] duration-fast hover:shadow-[inset_0_0_0_1px_var(--color-line)] hover:duration-0 focus:bg-field focus:shadow-focus-field focus:duration-0 focus-visible:outline-none"
              value={one.name}
              onChange={(e) => editNow([one.id], (n) => void (n.name = e.target.value))}
              onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
              aria-label="Layer name"
              dir="auto"
              spellCheck={false}
            />
          ) : (
            <span className={r.sectionTitle}>
              <span className="tnum">{nodes.length}</span> layers
            </span>
          )}
        </div>
        <span className="pr-[8px] text-caption text-fg-subtle">{kinds.size === 1 ? [...kinds][0] : "Mixed"}</span>
      </header>
      {one && tags && (
        <div className="mb-[4px] flex flex-wrap items-center gap-[6px]">
          {one.meta.component && <InstanceBadge node={one} />}
          {one.meta.source === "ai" && <Tag tone="ai">AI generated</Tag>}
          {one.meta.source === "import" && <Tag icon={<ImageDown size={12} />}>Imported</Tag>}
        </div>
      )}
      <PositionFields nodes={nodes} ids={ids} />
    </section>
  );
}

const ALIGN_H: { how: AlignKind; label: string; icon: ReactNode }[] = [
  { how: "left", label: "Align left", icon: <AlignStartVertical size={14} /> },
  { how: "hcenter", label: "Align horizontal centers", icon: <AlignCenterVertical size={14} /> },
  { how: "right", label: "Align right", icon: <AlignEndVertical size={14} /> },
];
const ALIGN_V: { how: AlignKind; label: string; icon: ReactNode }[] = [
  { how: "top", label: "Align top", icon: <AlignStartHorizontal size={14} /> },
  { how: "vcenter", label: "Align vertical centers", icon: <AlignCenterHorizontal size={14} /> },
  { how: "bottom", label: "Align bottom", icon: <AlignEndHorizontal size={14} /> },
];

function AlignGroup({ ids, items, disabled }: { ids: string[]; items: typeof ALIGN_H; disabled?: boolean }) {
  const enabled = !disabled && canAlign(ids);
  return (
    <div className="flex h-(--field-h) min-w-0 rounded-md bg-field p-[2px]" role="group">
      {items.map((it) => (
        <Tip key={it.how} label={it.label} command={`arrange.align-${it.how}`}>
          <button
            type="button"
            aria-label={it.label}
            disabled={!enabled}
            onClick={() => alignNodes(ids, it.how)}
            className="q-item q-press q-press-icon grid min-w-0 flex-1 place-items-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:text-fg-faint"
          >
            {it.icon}
          </button>
        </Tip>
      ))}
    </div>
  );
}

function PositionFields({ nodes, ids }: { nodes: SceneNode[]; ids: string[] }) {
  const set = (k: "x" | "y" | "rotation") => (v: number) => edit(ids, (n) => void (n[k] = v));
  // Layers in an auto-layout flow are placed by their parent.
  const placed = usePlacedByLayout(nodes);
  const locked = nodes.some((n) => n.locked);
  return (
    <Field label={placed ? "Position · set by auto layout" : "Position"} aside={<AbsolutePositionButton nodes={nodes} ids={ids} />}>
      <div className={r.rows}>
        <Row>
          <AlignGroup disabled={placed} ids={ids} items={ALIGN_H} />
          <AlignGroup disabled={placed} ids={ids} items={ALIGN_V} />
        </Row>
        <Row className={clsx(placed && "pointer-events-none opacity-50")}>
          <NumberField label="X" title="X position" value={shared(nodes, (n) => Math.round(n.x * 100) / 100)} onChange={set("x")} onCommit={commit} />
          <NumberField label="Y" title="Y position" value={shared(nodes, (n) => Math.round(n.y * 100) / 100)} onChange={set("y")} onCommit={commit} />
        </Row>
        <Row>
          <NumberField label={<RotateCw size={12} />} value={shared(nodes, (n) => n.rotation)} onChange={set("rotation")} onCommit={commit} suffix="°" title="Rotation" />
          <div className="flex items-center gap-[2px]">
            <IconBtn size="sm" label="Rotate 90°" disabled={locked} onClick={() => editNow(ids, (n) => void (n.rotation = (((n.rotation + 90) % 360) + 360) % 360))}>
              <RotateCw size={14} />
            </IconBtn>
            <FlipButton command="transform.flip-h">
              <FlipIcon axis="h" />
            </FlipButton>
            <FlipButton command="transform.flip-v">
              <FlipIcon axis="v" />
            </FlipButton>
          </div>
        </Row>
      </div>
    </Field>
  );
}

/** Two mirrored triangles about a dashed axis (lucide's flip glyphs blur at 14px). */
function FlipIcon({ axis }: { axis: "h" | "v" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" style={axis === "v" ? { transform: "rotate(90deg)" } : undefined}>
      <path d="M7 1v12" strokeDasharray="1.5 1.5" strokeLinecap="round" />
      <path d="M5 3.5 1.5 10.5H5Z" fill="currentColor" fillOpacity="0.35" />
      <path d="M9 3.5l3.5 7H9Z" />
    </svg>
  );
}

function FlipButton({ command, children }: { command: string; children: ReactNode }) {
  const c = useCommand(command);
  if (!c) return null;
  return (
    <IconBtn size="sm" label={c.label} command={command} disabled={c.enabled !== true} onClick={() => runCommand(command, "toolbar")}>
      {children}
    </IconBtn>
  );
}

// ---------------------------------------------------------------------------
// Layout: dimensions with sizing, limits, auto layout and clipping.

function LayoutSection({ nodes, ids, frame, group }: { nodes: SceneNode[]; ids: string[]; frame: FrameNode | null; group: boolean }) {
  const [lockRatio, setLockRatio] = useState(false);
  const line = nodes.every(isLine);
  const set = (k: "w" | "h") => (v: number) => {
    studio().beginTx();
    updateNodes(ids, (n, d) => {
      const ratio = n.h / Math.max(1, n.w);
      n[k] = Math.max(1, v);
      if (lockRatio) {
        if (k === "w") n.h = Math.max(1, Math.round(n.w * ratio));
        else n.w = Math.max(1, Math.round(n.h / ratio));
      }
      if (n.type === "text") {
        const t = n as TextNode;
        if (k === "w" && t.text.autoSize === "width") t.text.autoSize = "height";
        if (k === "h") t.text.autoSize = "fixed";
        if (t.text.autoSize === "height") fitText(t);
      }
      // Typing a size pins that axis (hug / fill → fixed), like Figma.
      pinResized(d, n, lockRatio ? ["h", "v"] : [k === "w" ? "h" : "v"]);
    });
  };
  return (
    <Section title="Layout" actions={!group && <AutoLayoutToggle nodes={nodes} ids={ids} />}>
      <Field label="Dimensions">
        <Row>
          <NumberField label="W" title="Width" value={shared(nodes, (n) => n.w)} onChange={set("w")} onCommit={commit} min={1} right={<SizingMenu nodes={nodes} ids={ids} axis="h" />} />
          {line ? (
            // Lines have no height: Figma shows 0 and doesn't let you type one.
            <NumberField label="H" ariaLabel="Height" title="Lines have no height" value={0} onChange={() => undefined} className="pointer-events-none opacity-50" />
          ) : (
            <NumberField label="H" title="Height" value={shared(nodes, (n) => n.h)} onChange={set("h")} onCommit={commit} min={1} right={<SizingMenu nodes={nodes} ids={ids} axis="v" />} />
          )}
          <IconBtn size="sm" label={lockRatio ? "Unlock proportions" : "Constrain proportions"} active={lockRatio} disabled={line} onClick={() => setLockRatio(!lockRatio)}>
            {lockRatio ? <Link2 size={14} /> : <Unlink2 size={14} />}
          </IconBtn>
        </Row>
      </Field>
      <LimitFields nodes={nodes} ids={ids} />
      {!group && <AutoLayoutControls nodes={nodes} ids={ids} />}
      {/* Direction (LTR / RTL, mirrored copies) lives in the AI panel's Direction tool. */}
      {frame && <Checkbox label="Clip content" checked={frame.clip} onChange={(v) => editNow([frame.id], (n) => void ((n as FrameNode).clip = v))} />}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Appearance: opacity + corner radius (Figma UI3 layout), with elliptical X/Y radii.

function AppearanceSection({ nodes, ids, group }: { nodes: SceneNode[]; ids: string[]; group: boolean }) {
  const hasRadius = !group && nodes.every((n) => n.type === "frame" || n.type === "rect" || n.type === "image");
  const visible = shared(nodes, (n) => n.visible);
  const locked = shared(nodes, (n) => n.locked);
  const rad: Radius = nodes[0].radius ?? uniformRadius(0);

  const opacity = (
    <NumberField
      label={<Blend size={12} />}
      title="Opacity"
      suffix="%"
      value={shared(nodes, (n) => Math.round(n.opacity * 100))}
      onChange={(v) => edit(ids, (n) => void (n.opacity = Math.min(1, Math.max(0, v / 100))))}
      onCommit={commit}
      min={0}
      max={100}
    />
  );

  return (
    <Section
      title="Appearance"
      actions={
        <>
          <IconBtn size="sm" label={visible === false ? "Show" : "Hide"} command="arrange.hide" onClick={() => editNow(ids, (n) => void (n.visible = visible === false))}>
            {visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
          </IconBtn>
          <IconBtn size="sm" label={locked ? "Unlock" : "Lock"} command="arrange.lock" active={!!locked} onClick={() => editNow(ids, (n) => void (n.locked = !locked))}>
            {locked ? <Lock size={14} /> : <Unlock size={14} />}
          </IconBtn>
        </>
      }
    >
      {hasRadius ? (
        <>
          <Row>
            {opacity}
            <RadiusField nodes={nodes} ids={ids} r={rad} />
            <IconBtn
              size="sm"
              label={rad.linked ? "Independent corners" : "Uniform corners"}
              active={!rad.linked}
              onClick={() =>
                editNow(ids, (n) => {
                  if (!n.radius) n.radius = uniformRadius(0);
                  n.radius.linked = !n.radius.linked;
                  if (n.radius.linked) for (const c of CORNERS) n.radius[c] = { ...n.radius.tl };
                })
              }
            >
              <IndependentCornersIcon />
            </IconBtn>
          </Row>
          <CornerEditor nodes={nodes} ids={ids} r={rad} />
          <Checkbox
            label={
              <span>
                Elliptical corners <span className="text-fg-subtle">(separate X / Y radius)</span>
              </span>
            }
            checked={!rad.circular}
            onChange={(v) =>
              editNow(ids, (n) => {
                if (!n.radius) n.radius = uniformRadius(0);
                n.radius.circular = !v;
                if (n.radius.circular) for (const c of CORNERS) n.radius[c].ry = n.radius[c].rx;
                n.radius.token = undefined;
              })
            }
          />
          <RadiusHint nodes={nodes} ids={ids} r={rad} />
        </>
      ) : (
        <Row>{opacity}</Row>
      )}
    </Section>
  );
}

function IndependentCornersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
      <path d="M1.5 5V3.5a2 2 0 0 1 2-2H5" />
      <path d="M9 1.5h1.5a2 2 0 0 1 2 2V5" />
      <path d="M12.5 9v1.5a2 2 0 0 1-2 2H9" />
      <path d="M5 12.5H3.5a2 2 0 0 1-2-2V9" />
    </svg>
  );
}

function setRadius(ids: string[], fn: (r: Radius) => void) {
  edit(ids, (n) => {
    if (!n.radius) n.radius = uniformRadius(0);
    fn(n.radius);
    n.radius.token = undefined;
  });
}

function bindRadius(ids: string[], path: string | undefined) {
  editNow(ids, (n) => {
    if (!path) {
      if (n.radius) n.radius.token = undefined;
      return;
    }
    n.radius = uniformRadius(tsFor(ids).dimension(path) ?? 0, path);
  });
}

/** The main radius field: a number, "Mixed", or a bound token chip (like a Figma variable). */
function RadiusField({ nodes, ids, r: rad }: { nodes: SceneNode[]; ids: string[]; r: Radius }) {
  const ts = useNodeTokens(nodes);
  const token = shared(nodes, (n) => n.radius?.token ?? "") || undefined;
  const uniform = rad.linked && rad.circular;
  const value = uniform ? shared(nodes, (n) => (n.radius ?? uniformRadius(0)).tl.rx) : null;
  const nearest = value !== null ? ts.nearestDimension(value, "radius.") : null;
  const offScale = value !== null && value > 0 && !radiusScale(ts).includes(value);
  const picker = (trigger: ReactNode) => (
    <TokenPicker
      title="Radius tokens"
      items={radiusTokens(ts).map((t) => ({ path: t.path, meta: `${px(t.value)}`, preview: <CornerIcon size={12} /> }))}
      current={token}
      suggested={offScale ? nearest?.token.path : undefined}
      onPick={(p) => bindRadius(ids, p)}
      onDetach={() => bindRadius(ids, undefined)}
    >
      {trigger}
    </TokenPicker>
  );

  if (token) {
    return picker(
      <button type="button" className={clsx(fieldBox, "w-full gap-[4px] pr-[6px] text-left")} aria-label={`Radius token ${token}`}>
        <span className="grid h-full w-[26px] shrink-0 place-items-center pl-[2px] text-fg-subtle">
          <CornerIcon />
        </span>
        <TokenChip path={token.replace("radius.", "")} className="min-w-0" />
        <span className="ml-auto text-micro text-fg-subtle tnum">{px(ts.get(token)?.value)}</span>
      </button>,
    );
  }
  return (
    <NumberField
      label={<CornerIcon />}
      title={uniform ? "Corner radius" : "Corner radius (mixed corners)"}
      value={value}
      min={0}
      onChange={(v) =>
        setRadius(ids, (rr) => {
          for (const c of CORNERS) rr[c] = { rx: v, ry: v };
          rr.linked = true;
          rr.circular = true;
        })
      }
      onCommit={commit}
      right={picker(<TokenButton label="Apply radius token" highlight={offScale} />)}
    />
  );
}

function CornerEditor({ nodes, ids, r: rad }: { nodes: SceneNode[]; ids: string[]; r: Radius }) {
  const val = (c: CornerKey, k: "rx" | "ry") => shared(nodes, (n) => (n.radius ?? uniformRadius(0))[c][k]);
  const setCorner = (c: CornerKey | "all", k: "rx" | "ry" | "both", v: number) =>
    setRadius(ids, (rr) => {
      for (const cc of c === "all" ? CORNERS : [c]) {
        if (k !== "ry") rr[cc].rx = v;
        if (k !== "rx") rr[cc].ry = v;
      }
    });
  const ORDER: CornerKey[] = ["tl", "tr", "bl", "br"];
  const NAME: Record<CornerKey, string> = { tl: "Top left", tr: "Top right", br: "Bottom right", bl: "Bottom left" };

  if (rad.linked && rad.circular) return null;

  if (rad.linked && !rad.circular)
    return (
      <Field label="Radius X / Y">
        <Row>
          <NumberField label={<MoveHorizontal size={12} />} title="Horizontal radius (X)" value={val("tl", "rx")} min={0} onChange={(v) => setCorner("all", "rx", v)} onCommit={commit} />
          <NumberField label={<MoveVertical size={12} />} title="Vertical radius (Y)" value={val("tl", "ry")} min={0} onChange={(v) => setCorner("all", "ry", v)} onCommit={commit} />
        </Row>
      </Field>
    );

  if (!rad.linked && rad.circular)
    return (
      <div className={r.rows}>
        {[ORDER.slice(0, 2), ORDER.slice(2)].map((pair) => (
          <Row key={pair[0]}>
            {pair.map((c) => (
              <NumberField key={c} label={<CornerIcon corner={c} />} title={NAME[c]} value={val(c, "rx")} min={0} onChange={(v) => setCorner(c, "both", v)} onCommit={commit} />
            ))}
          </Row>
        ))}
      </div>
    );

  return (
    <Field label="Corners · radius X / Y">
      <div className={r.rows}>
        {ORDER.map((c) => (
          <Row key={c}>
            <NumberField label="X" title={`${NAME[c]} · horizontal radius`} value={val(c, "rx")} min={0} onChange={(v) => setCorner(c, "rx", v)} onCommit={commit} />
            <NumberField label="Y" title={`${NAME[c]} · vertical radius`} value={val(c, "ry")} min={0} onChange={(v) => setCorner(c, "ry", v)} onCommit={commit} />
            <Tip label={NAME[c]}>
              <span className="grid place-items-center text-fg-subtle">
                <CornerIcon corner={c} />
              </span>
            </Tip>
          </Row>
        ))}
      </div>
    </Field>
  );
}

function RadiusHint({ nodes, ids, r: rad }: { nodes: SceneNode[]; ids: string[]; r: Radius }) {
  const ts = useNodeTokens(nodes);
  const RADIUS_SCALE = radiusScale(ts);
  if (nodes[0].radius?.token) return null;
  if (!rad.circular) return <Hint tone="info">Elliptical corners aren&apos;t on the radius scale, so audits report them as a note.</Hint>;
  const values = CORNERS.map((c) => rad[c].rx).filter((v) => v > 0);
  if (!values.length) return null;
  const off = values.find((v) => !RADIUS_SCALE.includes(v));
  if (off === undefined) {
    const exact = rad.linked ? radiusTokens(ts).find((t) => px(t.value) === values[0]) : undefined;
    return exact ? (
      <Hint tone="info" action={`Bind ${exact.path}`} onAction={() => bindRadius(ids, exact.path)}>
        Matches the radius scale.
      </Hint>
    ) : null;
  }
  const nearest = ts.nearestDimension(off, "radius.");
  return (
    <Hint action={nearest ? `Use ${nearest.token.path} (${px(nearest.token.value)})` : undefined} onAction={nearest ? () => bindRadius(ids, nearest.token.path) : undefined}>
      {off}px is off the radius scale.
    </Hint>
  );
}

// ---------------------------------------------------------------------------

function TypographySection({ nodes, ids }: { nodes: TextNode[]; ids: string[] }) {
  const ts = useNodeTokens(nodes);
  const t = nodes[0].text;
  const setText = (fn: (t: TextNode["text"]) => void, continuous = false) => {
    const f = (n: SceneNode) => {
      const tn = n as TextNode;
      fn(tn.text);
      fitText(tn);
    };
    if (continuous) edit(ids, f);
    else editNow(ids, f);
  };
  const applyType = (path: string) => {
    const s = ts.typography(path)!;
    setText((x) => {
      Object.assign(x, s, { typeToken: path });
      if (detectDirection(x.content) === "rtl") {
        x.fontFamily = arabicFace(ts);
        x.letterSpacing = 0;
      }
    });
  };
  const detach = (fn: (t: TextNode["text"]) => void) => (x: TextNode["text"]) => {
    fn(x);
    x.typeToken = undefined;
  };
  const styleToken = shared(nodes, (n) => (n as TextNode).text.typeToken ?? "") || undefined;
  const style = styleToken ? ts.typography(styleToken) : undefined;
  const matches = !!style && style.fontSize === t.fontSize && style.fontWeight === t.fontWeight;
  const nearest = !matches ? ts.nearestTypography(t.fontSize, t.fontWeight) : null;

  return (
    <Section title="Typography">
      <Row>
        <TokenPicker
          title="Type styles"
          items={ts.ofType("typography").map((tk) => {
            const s = ts.typography(tk.path)!;
            return { path: tk.path, meta: `${s.fontSize}/${s.lineHeight}`, preview: <span className="w-[16px] text-center text-caption" style={{ fontWeight: s.fontWeight }}>Aa</span> };
          })}
          current={styleToken}
          suggested={nearest?.token.path}
          onPick={applyType}
          onDetach={() => setText((x) => void (x.typeToken = undefined))}
        >
          <button type="button" className={clsx(r.selectTrigger, "col-span-2 pl-[6px] text-left")} aria-label="Text style">
            <ALargeSmall size={14} className="shrink-0 text-fg-subtle" />
            {styleToken && matches ? <TokenChip path={styleToken.replace("type.", "")} className="min-w-0" /> : <span className="text-fg-muted">Custom</span>}
            <span className="ml-auto shrink-0 text-micro text-fg-subtle tnum">
              {t.fontSize}/{t.lineHeight} · {t.fontWeight}
            </span>
            <ChevronDown size={12} />
          </button>
        </TokenPicker>
      </Row>
      {!matches && nearest && (
        <Hint action={`Use ${nearest.token.path}`} onAction={() => applyType(nearest.token.path)}>
          {t.fontSize}px / {t.fontWeight} isn&apos;t a type style.
        </Hint>
      )}
      <Row>
        <Select
          className="col-span-2"
          ariaLabel="Font family"
          icon={<Type size={12} />}
          value={t.fontFamily}
          onChange={(v) => setText(detach((x) => void (x.fontFamily = v)))}
          options={[...new Set([...loadedFamilies(), t.fontFamily])].map((f) => ({ value: f, label: f }))}
        />
      </Row>
      <Row>
        <Select
          ariaLabel="Font weight"
          value={String(t.fontWeight)}
          onChange={(v) => setText(detach((x) => void (x.fontWeight = Number(v))))}
          options={[
            { value: "400", label: "Regular" },
            { value: "500", label: "Medium" },
            { value: "600", label: "Semi Bold" },
            { value: "700", label: "Bold" },
          ]}
        />
        <NumberField label={<ALargeSmall size={12} />} title="Font size" value={shared(nodes, (n) => (n as TextNode).text.fontSize)} onChange={(v) => setText(detach((x) => void (x.fontSize = v)), true)} onCommit={commit} min={1} />
      </Row>
      <Row>
        <NumberField label={<MoveVertical size={12} />} title="Line height (px)" value={shared(nodes, (n) => (n as TextNode).text.lineHeight)} onChange={(v) => setText(detach((x) => void (x.lineHeight = v)), true)} onCommit={commit} min={0} />
        <NumberField label={<MoveHorizontal size={12} />} title="Letter spacing (px)" step={0.1} value={shared(nodes, (n) => (n as TextNode).text.letterSpacing)} onChange={(v) => setText(detach((x) => void (x.letterSpacing = v)), true)} onCommit={commit} />
      </Row>
      <Row>
        <Segmented
          label="Text align"
          value={shared(nodes, (n) => (n as TextNode).text.align)}
          onChange={(v) => setText((x) => void (x.align = v))}
          options={[
            { value: "start", label: <TextAlignStart size={14} />, title: "Align start" },
            { value: "center", label: <TextAlignCenter size={14} />, title: "Align center" },
            { value: "end", label: <TextAlignEnd size={14} />, title: "Align end" },
            { value: "justify", label: <TextAlignJustify size={14} />, title: "Justify" },
          ]}
        />
        <Segmented
          label="Text direction"
          value={shared(nodes, (n) => (n as TextNode).text.direction)}
          onChange={(v) => setText((x) => void (x.direction = v))}
          options={[
            { value: "auto", label: "Auto", title: "Direction from the first strong character" },
            { value: "ltr", label: "LTR", title: "Left to right" },
            { value: "rtl", label: "RTL", title: "Right to left" },
          ]}
        />
      </Row>
      <Row>
        <Segmented
          label="Resizing"
          className="col-span-2"
          value={shared(nodes, (n) => (n as TextNode).text.autoSize)}
          onChange={(v) => setText((x) => void (x.autoSize = v))}
          options={[
            { value: "width", label: "Auto width", title: "Grow to fit the text on one line" },
            { value: "height", label: "Auto height", title: "Fixed width, grow downwards" },
            { value: "fixed", label: "Fixed", title: "Fixed size" },
          ]}
        />
      </Row>
      <div className="flex items-center gap-[2px]">
        <TextToggle command="text.italic">
          <Italic size={14} />
        </TextToggle>
        <TextToggle command="text.underline">
          <Underline size={14} />
        </TextToggle>
        <TextToggle command="text.strikethrough">
          <Strikethrough size={14} />
        </TextToggle>
      </div>
      {nodes.length === 1 && (
        <Row>
          <textarea className={clsx(r.textarea, "col-span-2 min-h-[64px] w-full")} dir="auto" value={t.content} aria-label="Text content" onChange={(e) => setText((x) => void (x.content = e.target.value), true)} onBlur={commit} />
        </Row>
      )}
    </Section>
  );
}

/** Italic / underline / strikethrough: the same commands as ⌘I, ⌘U, ⇧⌘X, so the tooltip shows their keys. */
function TextToggle({ command, children }: { command: string; children: ReactNode }) {
  const c = useCommand(command);
  if (!c) return null;
  return (
    <IconBtn size="sm" label={c.label} command={command} active={!!c.checked} disabled={c.enabled !== true} onClick={() => runCommand(command, "toolbar")}>
      {children}
    </IconBtn>
  );
}

function IconSection({ node }: { node: IconNode }) {
  return (
    <Section title="Icon">
      <Row>
        <div className="col-span-2 min-w-0">
          <IconPicker ariaLabel="Icon" value={node.icon} set={tokensForNode(studio().doc, node.id).iconSet} onChange={(v) => v && editNow([node.id], (n) => void ((n as IconNode).icon = v))} />
        </div>
      </Row>
      <Row>
        <NumberField label={<StrokeWeightIcon />} title="Stroke weight" step={0.25} value={node.strokeWidth} onChange={(v) => edit([node.id], (n) => void ((n as IconNode).strokeWidth = v))} onCommit={commit} min={0.5} max={4} />
      </Row>
      <Checkbox label="Mirror for RTL" checked={node.mirrored} onChange={(v) => editNow([node.id], (n) => void ((n as IconNode).mirrored = v))} />
      {isDirectional(node.icon) && <Hint tone="info">Directional icon: it should be mirrored inside right-to-left frames.</Hint>}
    </Section>
  );
}

function StrokeWeightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="currentColor">
      <rect x="1" y="1.5" width="10" height="1" rx="0.5" />
      <rect x="1" y="4.75" width="10" height="1.75" rx="0.6" />
      <rect x="1" y="8.5" width="10" height="2.5" rx="0.8" />
    </svg>
  );
}

// ---------------------------------------------------------------------------

/** Figma paint row: one field spanning two columns (swatch · token chip or hex), remove in column 3. */
function PaintRow({
  color,
  token,
  gradient,
  prefer,
  ts,
  onChange,
  onRemove,
  label,
}: {
  color: string;
  token?: string;
  gradient?: Gradient;
  prefer: string[];
  ts: TokenSet;
  onChange: (color: string, token?: string, gradient?: Gradient) => void;
  onRemove?: () => void;
  label: string;
}) {
  const hex = gradient ? "Gradient" : color.replace("#", "").toUpperCase();
  return (
    <Row>
      <ColorPopover value={color} token={token} prefer={prefer} ts={ts} gradients={label === "Fill"} onChange={onChange}>
        <button type="button" className={clsx(r.field, r.paintRow, "group/row text-left")} aria-label={`${label} colour`}>
          <Swatch color={color} gradient={gradient} size={16} />
          {token ? <TokenChip path={token} className="min-w-0" /> : <span className="min-w-0 truncate font-mono text-caption text-fg">{hex}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-[4px]">
            {token ? (
              <span className="font-mono text-micro text-fg-subtle">{hex}</span>
            ) : (
              <span title="Not bound to a token" className="grid size-[20px] place-items-center text-warning">
                <Hexagon size={12} />
              </span>
            )}
          </span>
        </button>
      </ColorPopover>
      {onRemove ? (
        <IconBtn size="sm" label={`Remove ${label.toLowerCase()}`} onClick={onRemove}>
          <Minus size={14} />
        </IconBtn>
      ) : (
        <span />
      )}
    </Row>
  );
}

function FillSection({ nodes, ids }: { nodes: SceneNode[]; ids: string[] }) {
  const one = nodes[0];
  const fill = one.fill;
  const isText = one.type === "text";
  const isIcon = one.type === "icon";
  const prefer = isText ? ["text."] : isIcon ? ["icon."] : ["bg.", "feedback."];
  const ts = useNodeTokens(nodes);
  const set = (color: string, token?: string, gradient?: Gradient) => editNow(ids, (n) => void (n.fill = gradient ? { color, token, gradient } : { color, token }));
  const doc = useStudio((s) => s.doc);
  // Same suggestion as the audit (e.g. the nearest text token that also passes contrast).
  const suggested = fill && !fill.token ? auditNode(doc, one).find((f) => f.rule === "off-token-color")?.replaceWith : undefined;
  const nearest = suggested ? { token: ts.get(suggested)!, deltaE: ts.nearestColor(fill!.color, [suggested])!.deltaE } : null;
  const matches = fill && !fill.token ? ts.colorMatches(fill.color).filter((t) => prefer.some((p) => t.path.startsWith(p))) : [];

  return (
    <Section
      title={fill ? "Fill" : <span className={r.sectionTitleCollapsed}>Fill</span>}
      actions={
        !fill && !isText && !isIcon ? (
          <IconBtn size="sm" label="Add fill" onClick={() => set(ts.color("bg.surface")!, "bg.surface")}>
            <Plus size={14} />
          </IconBtn>
        ) : null
      }
    >
      {fill && (
        <>
          <PaintRow label="Fill" color={fill.color} token={fill.token} gradient={fill.gradient} prefer={prefer} ts={ts} onChange={set} onRemove={!isText && !isIcon ? () => editNow(ids, (n) => void (n.fill = null)) : undefined} />
          {!fill.token &&
            (matches.length > 1 ? (
              <Hint>
                Same value as{" "}
                {matches.map((m, i) => (
                  <span key={m.path}>
                    {i > 0 && (i === matches.length - 1 ? " and " : ", ")}
                    <button type="button" className={clsx(r.link, "font-medium")} onClick={() => set(m.value as string, m.path)}>
                      {m.path}
                    </button>
                  </span>
                ))}
                . Pick the one that matches the intent.
              </Hint>
            ) : matches.length === 1 ? (
              <Hint tone="info" action={`Bind ${matches[0].path}`} onAction={() => set(matches[0].value as string, matches[0].path)}>
                Matches a token.
              </Hint>
            ) : nearest ? (
              <Hint action={`Use ${nearest.token.path}`} onAction={() => set(nearest.token.value as string, nearest.token.path)}>
                Raw colour (ΔE {nearest.deltaE.toFixed(1)} from the suggested token).
              </Hint>
            ) : null)}
        </>
      )}
    </Section>
  );
}

function StrokeSection({ nodes, ids }: { nodes: SceneNode[]; ids: string[] }) {
  const s = nodes[0].stroke;
  const ts = useNodeTokens(nodes);
  return (
    <Section
      title={s ? "Stroke" : <span className={r.sectionTitleCollapsed}>Stroke</span>}
      actions={
        !s ? (
          <IconBtn
            size="sm"
            label="Add stroke"
            onClick={() => editNow(ids, (n) => void (n.stroke = { color: ts.color("border.default")!, token: "border.default", width: ts.dimension("border-width.default") ?? 1, widthToken: "border-width.default" }))}
          >
            <Plus size={14} />
          </IconBtn>
        ) : null
      }
    >
      {s && (
        <>
          <PaintRow
            label="Stroke"
            color={s.color}
            token={s.token}
            prefer={["border."]}
            ts={ts}
            onChange={(color, token) => editNow(ids, (n) => void (n.stroke = { ...(n.stroke ?? { width: 1 }), color, token }))}
            onRemove={() => editNow(ids, (n) => void (n.stroke = null))}
          />
          <Row>
            <NumberField
              label={<StrokeWeightIcon />}
              title={s.widthToken ? `Stroke weight (${s.widthToken})` : "Stroke weight"}
              value={shared(nodes, (n) => n.stroke?.width ?? 0)}
              onChange={(v) =>
                edit(ids, (n) => {
                  if (!n.stroke) return;
                  n.stroke.width = v;
                  n.stroke.widthToken = undefined;
                })
              }
              onCommit={commit}
              min={0}
              step={0.5}
            />
            {nodes.every((n) => n.type === "path") ? (
              // Vector strokes are centred on the path (Inside/Outside need closed regions).
              <Select ariaLabel="Stroke position" className="pointer-events-none opacity-60" value="center" onChange={() => undefined} options={[{ value: "center", label: "Center" }]} />
            ) : (
              <Select ariaLabel="Stroke position" value="inside" onChange={() => undefined} options={[{ value: "inside", label: "Inside" }]} />
            )}
          </Row>
        </>
      )}
    </Section>
  );
}

function EffectsSection({ nodes, ids }: { nodes: SceneNode[]; ids: string[] }) {
  const ts = useNodeTokens(nodes);
  const shadow = shared(nodes, (n) => n.shadowToken ?? "") || undefined;
  const effects = nodes[0].effects ?? [];
  const set = (v?: string) =>
    editNow(ids, (n) => {
      n.shadowToken = v;
      const layers = v ? ts.shadowLayers(v) : undefined;
      n.effects = layers?.length ? layers : undefined;
    });
  // Previews sit on the light stage so a shadow reads the way it will on the user's screen.
  const items = ts.roles("shadow").map((t) => ({ path: t.path, preview: <span className="size-[12px] rounded-xs bg-stage" style={{ boxShadow: cssShadow(ts.shadowLayers(t.path)) }} /> }));
  const kind = effects.some((e) => e.kind === "inner") ? (effects.some((e) => e.kind === "drop") ? "Shadows" : "Inner shadow") : "Drop shadow";
  return (
    <Section
      title={shadow ? "Effects" : <span className={r.sectionTitleCollapsed}>Effects</span>}
      actions={
        !shadow ? (
          <IconBtn size="sm" label="Add shadow" onClick={() => set("shadow.sm")}>
            <Plus size={14} />
          </IconBtn>
        ) : null
      }
    >
      {shadow && (
        <>
          <Row>
            <TokenPicker title="Elevation tokens" items={items} current={shadow} onPick={set}>
              <button type="button" className={clsx(r.field, r.paintRow, "text-left")} aria-label="Shadow token">
                <ShadowIcon />
                <span className="shrink-0 text-fg">{kind}</span>
                <TokenChip path={shadow.replace("shadow.", "")} className="ml-auto min-w-0" />
                <ChevronDown size={12} className="shrink-0 text-fg-subtle" />
              </button>
            </TokenPicker>
            <IconBtn size="sm" label="Remove effect" onClick={() => set(undefined)}>
              <Minus size={14} />
            </IconBtn>
          </Row>
          {effects.map((e, i) => (
            <div key={i} className="flex items-center gap-[8px] pl-[6px] text-micro text-fg-muted">
              <Swatch color={e.color} size={12} />
              <span className="w-[36px] text-fg-subtle">{e.kind === "inner" ? "Inner" : "Drop"}</span>
              <span className="font-mono tnum">
                {e.x} {e.y} · blur {e.blur} · spread {e.spread}
              </span>
            </div>
          ))}
          {!effects.length && <p className="pl-[6px] text-caption text-fg-subtle">This system defines {shadow} as no shadow.</p>}
        </>
      )}
    </Section>
  );
}

function ShadowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0 text-fg-subtle" fill="none" stroke="currentColor" strokeWidth="1.25">
      <rect x="1.5" y="1.5" width="8.5" height="8.5" rx="1.5" />
      <path d="M12.5 4.5v6a2 2 0 0 1-2 2h-6" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Layout grid: Figma's columns / rows / square grid on a frame (doc/grids.ts; ⌃G shows them).

const GRID_KINDS: { value: LayoutGrid["kind"]; label: string; title: string }[] = [
  { value: "columns", label: "Columns", title: "Vertical bands" },
  { value: "rows", label: "Rows", title: "Horizontal bands" },
  { value: "grid", label: "Grid", title: "Square cells" },
];

const GRID_ALIGNS: { value: LayoutGrid["align"]; label: string }[] = [
  { value: "stretch", label: "Stretch" },
  { value: "start", label: "Left" },
  { value: "center", label: "Center" },
  { value: "end", label: "Right" },
];

function GridKindIcon({ kind }: { kind: LayoutGrid["kind"] }) {
  return kind === "columns" ? <Columns3 size={14} /> : kind === "rows" ? <Rows3 size={14} /> : <Grid3x3 size={14} />;
}

/** "Columns 5", "Rows auto", "Grid 10px". */
const gridSummary = (g: LayoutGrid) => (g.kind === "grid" ? `Grid ${g.size}px` : `${g.kind === "columns" ? "Columns" : "Rows"} ${g.count > 0 ? g.count : "auto"}`);

function LayoutGridSection({ frame }: { frame: FrameNode }) {
  const grids = frame.grids ?? [];
  const view = useCommand("view.layout-grids");
  // A newly added grid opens its settings; the index survives re-renders but not a selection change.
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Section
      title={grids.length ? "Layout grid" : <span className={r.sectionTitleCollapsed}>Layout grid</span>}
      actions={
        <IconBtn
          size="sm"
          label="Add layout grid"
          onClick={() => {
            addLayoutGrid([frame.id], "columns");
            setOpen(grids.length);
          }}
        >
          <Plus size={14} />
        </IconBtn>
      }
    >
      {grids.length > 0 && (
        <>
          {grids.map((g, i) => (
            <LayoutGridRow key={i} frame={frame} grid={g} index={i} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
          ))}
          {view && !view.checked && (
            <Hint tone="info" action="Show" onAction={() => runCommand("view.layout-grids", "menu")}>
              Layout guides are hidden on the canvas{view.keys[0] && <Kbd keys={view.keys[0]} size="sm" className="mx-[4px] align-[-3px]" />}.
            </Hint>
          )}
        </>
      )}
    </Section>
  );
}

function LayoutGridRow({ frame, grid: g, index, open, onToggle }: { frame: FrameNode; grid: LayoutGrid; index: number; open: boolean; onToggle: () => void }) {
  const id = frame.id;
  const set = (patch: Partial<LayoutGrid>) => setLayoutGrid(id, index, patch);
  // Continuous edits (scrubbing, typing) are one undo step, committed on release.
  const setLive = (patch: Partial<LayoutGrid>) => edit([id], (n) => void Object.assign((n as FrameNode).grids![index], patch));
  const rgb = g.color.slice(0, 7);
  const alpha = Math.round((parseInt(g.color.slice(7, 9) || "ff", 16) / 255) * 100);
  const withAlpha = (hex: string, pct: number) =>
    `${hex.slice(0, 7).toUpperCase()}${Math.round((Math.min(100, Math.max(0, pct)) / 100) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase()}`;
  const stretch = g.align === "stretch";
  return (
    <div className={r.rows}>
      <Row>
        <div className={clsx(fieldBox, "col-span-2 gap-[2px] pr-[2px]", g.hidden && "text-fg-subtle")}>
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${gridSummary(g)} settings`}
            onClick={onToggle}
            className="q-item flex h-full min-w-0 flex-1 items-center gap-[6px] rounded-sm pl-[6px] text-left text-caption hover:text-fg focus-visible:outline-none"
          >
            <ChevronRight size={12} className={clsx("shrink-0 text-fg-subtle transition-transform duration-fast ease-out motion-reduce:transition-none", open && "rotate-90")} />
            <span className={clsx("shrink-0", g.hidden ? "text-fg-faint" : "text-fg-subtle")}>
              <GridKindIcon kind={g.kind} />
            </span>
            <span className={clsx("min-w-0 truncate", g.hidden ? "text-fg-subtle" : "text-fg")}>{gridSummary(g)}</span>
            <Swatch color={g.color} size={12} className="ml-auto" />
          </button>
          <IconBtn size="sm" label={g.hidden ? "Show grid" : "Hide grid"} onClick={() => set({ hidden: !g.hidden || undefined })}>
            {g.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </IconBtn>
        </div>
        <IconBtn size="sm" label="Remove layout grid" onClick={() => removeLayoutGrid(id, index)}>
          <Minus size={14} />
        </IconBtn>
      </Row>
      {open && (
        <div className={clsx(r.rows, "q-rise pb-[4px]")}>
          <Row>
            <Segmented label="Grid type" className="col-span-2" value={g.kind} options={GRID_KINDS.map((k) => ({ value: k.value, label: k.label, title: k.title }))} onChange={(kind) => set(kind === "grid" ? { kind, size: g.kind === "grid" ? g.size : 10 } : { kind })} />
          </Row>
          {g.kind === "grid" ? (
            <Row>
              <NumberField label={<Grid3x3 size={12} />} title="Cell size" suffix="px" value={g.size} min={1} onChange={(v) => setLive({ size: Math.max(1, v) })} onCommit={commit} />
            </Row>
          ) : (
            <>
              <Row>
                <NumberField label="#" title={`${g.kind === "columns" ? "Columns" : "Rows"} (0 = as many as fit)`} value={g.count} min={0} max={100} onChange={(v) => setLive({ count: Math.max(0, Math.round(v)) })} onCommit={commit} />
                <NumberField label={<GutterIcon kind={g.kind} />} title="Gutter" value={g.gutter} min={0} onChange={(v) => setLive({ gutter: Math.max(0, v) })} onCommit={commit} />
              </Row>
              <Row>
                <Select
                  ariaLabel="Grid type"
                  value={g.align}
                  onChange={(align) => set({ align })}
                  options={GRID_ALIGNS.map((a) => ({ value: a.value, label: g.kind === "rows" && a.value !== "stretch" && a.value !== "center" ? (a.value === "start" ? "Top" : "Bottom") : a.label }))}
                />
                {stretch ? (
                  <NumberField label={<MarginIcon kind={g.kind} />} title="Margin" value={g.margin} min={0} onChange={(v) => setLive({ margin: Math.max(0, v) })} onCommit={commit} />
                ) : (
                  <NumberField label={g.kind === "columns" ? "W" : "H"} title={g.kind === "columns" ? "Column width" : "Row height"} value={g.size} min={1} onChange={(v) => setLive({ size: Math.max(1, v) })} onCommit={commit} />
                )}
              </Row>
              {!stretch && g.align !== "center" && (
                <Row>
                  <NumberField label={<MarginIcon kind={g.kind} />} title="Offset" value={g.margin} min={0} onChange={(v) => setLive({ margin: Math.max(0, v) })} onCommit={commit} />
                </Row>
              )}
            </>
          )}
          <Row>
            <ColorPopover value={rgb} onChange={(c) => set({ color: withAlpha(c, alpha) })}>
              <button type="button" className={clsx(r.field, "gap-[8px] pl-[6px] text-left")} aria-label="Grid colour">
                <Swatch color={g.color} size={16} />
                <span className="min-w-0 truncate font-mono text-caption text-fg">{rgb.replace("#", "").toUpperCase()}</span>
              </button>
            </ColorPopover>
            <NumberField label={<Blend size={12} />} title="Grid opacity" suffix="%" value={alpha} min={0} max={100} onChange={(v) => setLive({ color: withAlpha(rgb, v) })} onCommit={commit} />
          </Row>
        </div>
      )}
    </div>
  );
}

/** Two bands with the gap between them marked. */
function GutterIcon({ kind }: { kind: LayoutGrid["kind"] }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="currentColor" style={kind === "rows" ? { transform: "rotate(90deg)" } : undefined}>
      <rect x="1" y="1" width="3" height="10" rx="0.75" opacity="0.45" />
      <rect x="8" y="1" width="3" height="10" rx="0.75" opacity="0.45" />
      <rect x="5.4" y="3" width="1.2" height="6" rx="0.6" />
    </svg>
  );
}

/** A frame edge with the inset marked. */
function MarginIcon({ kind }: { kind: LayoutGrid["kind"] }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.1" style={kind === "rows" ? { transform: "rotate(90deg)" } : undefined}>
      <path d="M1.5 1v10M10.5 1v10" strokeLinecap="round" />
      <rect x="4" y="2.5" width="4" height="7" rx="0.75" fill="currentColor" fillOpacity="0.35" stroke="none" />
    </svg>
  );
}

/** Screenshots on the canvas become design systems, in the AI chat. */
function ImageSystemSection({ node }: { node: ImageNode }) {
  const open = useExtractionOf(node.id);
  const label = !open ? "Extract design system" : open.running ? (open.phase === "scanning" ? "Qalam AI is looking…" : "Extracting… open in AI chat") : open.phase === "asking" ? "Answer Qalam AI's questions" : "Review the draft in AI chat";
  return (
    <Section title="Design system">
      <p className="pr-[8px] text-caption text-fg-muted">Qalam AI looks at this screenshot first, then asks in the AI chat what to extract: tokens only, the components it uses, or extras designed to match.</p>
      <Row>
        <Button variant="secondary" className="col-span-2" onClick={() => (open ? openExtractTurn(open.chatId, open.turnId) : void startExtractChat({ nodeIds: [node.id] }))}>
          <QalamAIGlyph size={14} /> <span className="truncate">{label}</span>
        </Button>
      </Row>
    </Section>
  );
}

function IssuesSection({ node }: { node: SceneNode }) {
  const setAITab = useStudio((s) => s.setAITab);
  const flags = node.meta.flags ?? [];
  return (
    <Section
      title={
        <span className="flex items-center gap-[8px]">
          Issues <Tag tone={flags.some((f) => f.severity === "error") ? "danger" : "warning"}>{flags.length}</Tag>
        </span>
      }
      actions={
        <Button variant="ghost" size="sm" onClick={() => setAITab("audit")}>
          Open audit
        </Button>
      }
    >
      <div className="flex flex-col gap-[10px] pr-[8px]">
        {flags.map((f, i) => (
          <div key={i} className="flex gap-[8px] text-caption">
            {f.severity === "error" ? <CircleAlert size={14} className="mt-px shrink-0 text-danger" /> : <TriangleAlert size={14} className="mt-px shrink-0 text-warning" />}
            <div className="min-w-0">
              <div className="text-fg">{f.message}</div>
              <div className="mt-[2px] font-mono text-micro text-fg-subtle">{f.rule}</div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ExportSection({ nodes }: { nodes: SceneNode[] }) {
  const [scale, setScale] = useState("2");
  const label = nodes.length === 1 ? nodes[0].name : `${nodes.length} layers`;
  return (
    <Section title="Export">
      <Row>
        <Select
          ariaLabel="Export scale"
          value={scale}
          onChange={setScale}
          options={[
            { value: "1", label: "1x" },
            { value: "2", label: "2x" },
            { value: "3", label: "3x" },
          ]}
        />
        <Select ariaLabel="Export format" value="png" onChange={() => undefined} options={[{ value: "png", label: "PNG" }]} />
      </Row>
      <Row>
        <Button variant="secondary" className="col-span-2 min-w-0" onClick={() => exportSelectionPNG(Number(scale))}>
          <span className="truncate">Export {label}</span>
        </Button>
      </Row>
    </Section>
  );
}
