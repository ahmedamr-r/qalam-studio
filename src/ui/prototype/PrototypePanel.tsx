import { useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  Activity,
  ArrowRight,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  CornerUpLeft,
  Diamond,
  Expand,
  Frame,
  LucideProvider,
  Minus,
  MousePointer2,
  MousePointerClick,
  Play,
  Plus,
  Pointer,
  RotateCcw,
  Sparkles,
  Timer,
  ToggleRight,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Doc, MotionRef, ProtoLink, ProtoTrack, ProtoTransitionKind, ProtoTrigger, TrackPreset } from "@/doc/schema";
import { studio, useStudio } from "@/doc/store";
import { DEFAULT_DELAY, DEFAULT_STATE, MAX_STATES, pathMatches } from "@/doc/proto";
import {
  addLink,
  addState,
  addTrack,
  clearStateProp,
  componentAt,
  componentsOf,
  editProto,
  linkProblem,
  linksFrom,
  newLink,
  newTrack,
  protoScope,
  removeLink,
  removeState,
  removeTrack,
  renameState,
  screenIds,
  setStart,
  setStateProp,
  stateChanges,
  stateNameError,
  statesOf,
  tracksOf,
  updateLink,
  updateTrack,
} from "@/doc/proto-edit";
import { MOTION_REFS, motionTransition } from "@/design-system/motion";
import { instOf } from "@/design-system/instances";
import { CATALOG_BY_NAME, type PropSpec } from "@/design-system/components";
import { runCommand } from "@/commands/registry";
import { Checkbox, Field, Hint, IconBtn, NumberField, Row, Section, Segmented, Select, Tag, TokenChip, TokenPicker, fieldBox } from "../controls";
import { r } from "../recipes";
import { layerKind } from "../layerKind";
import { isPart } from "@/proto/routes";
import { RouteSections } from "./RouteSections";

/*
 * The Prototype tab (Figma UI3's, beside Design): the links, states and tracks of the selected
 * screen, or of the component the selection is in, edited by hand. Rows sit on the Design panel's
 * `1fr 1fr 24px` grid and open their settings in place, like layout grids; each change is one undo
 * step through editProto (doc/proto-edit.ts). Present (⌥⌘↵) plays what is wired here.
 */

type Scope = { screen: string; path?: string; node: string };

const TRIGGERS: { value: ProtoTrigger; label: string; short: string; Icon: LucideIcon }[] = [
  { value: "tap", label: "On tap", short: "Tap", Icon: MousePointerClick },
  { value: "press", label: "On press", short: "Press", Icon: Pointer },
  { value: "hover", label: "On hover", short: "Hover", Icon: MousePointer2 },
  { value: "delay", label: "After delay", short: "After", Icon: Timer },
];
const TRIGGER = Object.fromEntries(TRIGGERS.map((t) => [t.value, t])) as Record<ProtoTrigger, (typeof TRIGGERS)[number]>;

const KINDS: { value: ProtoTransitionKind; label: string }[] = [
  { value: "smart", label: "Smart animate" },
  { value: "push", label: "Push" },
  { value: "dissolve", label: "Dissolve" },
  { value: "sheet", label: "Sheet" },
];

const PRESETS: { value: TrackPreset; label: string; Icon: LucideIcon }[] = [
  { value: "fade-up", label: "Fade up", Icon: ArrowUpFromLine },
  { value: "scale-in", label: "Scale in", Icon: Expand },
  { value: "pulse", label: "Pulse (loops)", Icon: Activity },
  { value: "shimmer", label: "Shimmer (loops)", Icon: Sparkles },
];
const PRESET = Object.fromEntries(PRESETS.map((t) => [t.value, t])) as Record<TrackPreset, (typeof PRESETS)[number]>;

/** Select values that aren't ids or paths. */
const WHOLE_SCREEN = "@screen";
const AUTO_START = "@auto";

export default function PrototypePanel() {
  const doc = useStudio((s) => s.doc);
  const selection = useStudio((s) => s.selection);
  const scope = useMemo(() => protoScope(doc, selection), [doc, selection]);
  return (
    <LucideProvider strokeWidth={1.25} absoluteStrokeWidth>
      <div data-region="prototype" data-prototype-panel aria-label="Prototype panel" className="flex flex-col pb-[24px]">
        {scope ? (
          // A new scope starts with every row closed.
          <ScopePanel key={`${scope.screen}:${scope.path ?? ""}`} doc={doc} scope={scope} selected={selection[0]} />
        ) : (
          <Overview doc={doc} selected={selection.length} />
        )}
      </div>
    </LucideProvider>
  );
}

// ---------------------------------------------------------------------------
// Labels

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A component by its layer name and its copy ("Button · Call"), so two buttons read apart. */
function componentLabel(doc: Doc, id: string, path: string): string {
  const n = doc.nodes[id];
  if (!n) return path;
  const props = instOf(doc, id)?.props ?? {};
  const copy = ["label", "title", "text", "pin", "initials"].map((k) => props[k]).find((v): v is string => typeof v === "string" && !!v.trim());
  return copy ? `${n.name} · ${clip(copy.trim(), 28)}` : n.name;
}

/** The components on a screen with their labels; repeated labels get their path. */
function componentsOn(doc: Doc, screen: string): { path: string; id: string; label: string }[] {
  const list = componentsOf(doc, screen).map((c) => ({ ...c, label: componentLabel(doc, c.id, c.path) }));
  const seen = new Map<string, number>();
  for (const c of list) seen.set(c.label, (seen.get(c.label) ?? 0) + 1);
  return list.map((c) => ((seen.get(c.label) ?? 0) > 1 ? { ...c, label: `${c.label} (${c.path})` } : c));
}

const screenName = (doc: Doc, id: string) => doc.nodes[id]?.name ?? "Missing screen";

const destValue = (to: ProtoLink["to"]) => (to === "back" ? "back" : "screen" in to ? `screen:${to.screen}` : `state:${to.state}`);
const parseDest = (v: string): ProtoLink["to"] => (v === "back" ? "back" : v.startsWith("screen:") ? { screen: v.slice("screen:".length) } : { state: v.slice("state:".length) });

function DestLabel({ doc, to }: { doc: Doc; to: ProtoLink["to"] }) {
  if (to === "back")
    return (
      <>
        <CornerUpLeft size={12} className="shrink-0 text-fg-subtle" />
        <span className="min-w-0 truncate text-fg">Back</span>
      </>
    );
  if ("state" in to)
    return (
      <>
        <ToggleRight size={12} className="shrink-0 text-fg-subtle" />
        <span className="min-w-0 truncate text-fg">{to.state}</span>
      </>
    );
  return <span className="min-w-0 truncate text-fg">{screenName(doc, to.screen)}</span>;
}

/** "Every body section", "Every item in Card". */
function wildcardLabel(doc: Doc, screen: string, pattern: string): string {
  const region = /^(\w+)\.\*$/.exec(pattern);
  if (region) return `Every ${region[1]} section`;
  const items = /^(.+)\.children\.\*$/.exec(pattern);
  if (items) return `Every item in ${doc.nodes[componentAt(doc, screen, items[1]) ?? ""]?.name ?? items[1]}`;
  return pattern;
}

function trackTargetLabel(doc: Doc, t: ProtoTrack): string {
  const p = t.target.path;
  if (p === undefined) return "Whole screen";
  if (p.includes("*")) return wildcardLabel(doc, t.target.screen, p);
  return doc.nodes[componentAt(doc, t.target.screen, p) ?? ""]?.name ?? p;
}

// ---------------------------------------------------------------------------
// Motion tokens

const motionMeta = (ref: MotionRef) => {
  if (ref === "native") return "platform's";
  const t = motionTransition(ref);
  return "type" in t ? `spring ${t.visualDuration}s` : `${Math.round(t.duration * 1000)}ms`;
};

/** The token's curve: its cubic-bezier, or a spring settling with its bounce (native: a spring that doesn't bounce). */
function MotionCurve({ motion }: { motion: MotionRef }) {
  const t = motion === "native" ? ({ type: "spring", visualDuration: 0.3, bounce: 0 } as const) : motionTransition(motion);
  let d: string;
  if ("type" in t) {
    const pts = Array.from({ length: 25 }, (_, i) => {
      const x = i / 24;
      const y = 1 - Math.exp(-5 * x) * Math.cos(Math.PI * (1.6 + 8 * t.bounce) * x);
      return `${(1 + 10 * x).toFixed(2)} ${(11 - 9 * y).toFixed(2)}`;
    });
    d = `M${pts.join(" L")}`;
  } else {
    const [x1, y1, x2, y2] = t.ease;
    d = `M1 11 C${1 + 10 * x1} ${11 - 10 * y1} ${1 + 10 * x2} ${11 - 10 * y2} 11 1`;
  }
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden className="shrink-0 text-fg-subtle" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round">
      <path d={d} />
    </svg>
  );
}

const MOTION_ITEMS = MOTION_REFS.map((ref) => ({ path: ref, meta: motionMeta(ref), preview: <MotionCurve motion={ref} /> }));

/** A motion token bound like a Figma variable: curve, token chip, the token list on click. */
function MotionField({ value, onChange, className }: { value: MotionRef; onChange: (m: MotionRef) => void; className?: string }) {
  return (
    <TokenPicker title="Motion tokens" items={MOTION_ITEMS} current={value} onPick={(v) => onChange(v as MotionRef)}>
      <button type="button" className={clsx(r.field, "gap-[6px] pl-[6px] pr-[6px] text-left", className)} aria-label={`Motion ${value}`}>
        <MotionCurve motion={value} />
        <TokenChip path={value} className="min-w-0" />
        <span className="ml-auto shrink-0 text-micro text-fg-subtle tnum">{motionMeta(value)}</span>
        <ChevronDown size={12} className="shrink-0 text-fg-subtle" />
      </button>
    </TokenPicker>
  );
}

// ---------------------------------------------------------------------------
// Small controls

/** A text field that commits on Enter or blur; Esc puts the value back. */
function TextInput({ value, onCommit, ariaLabel, validate, maxLength, className }: { value: string; onCommit: (v: string) => void; ariaLabel: string; validate?: (v: string) => string | null; maxLength?: number; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const error = draft !== null && validate ? validate(draft) : null;
  return (
    <div className={clsx("flex flex-col gap-[4px]", className)}>
      <label className={clsx(fieldBox, "px-[8px]", error && r.fieldInvalid)}>
        <input
          aria-label={ariaLabel}
          aria-invalid={!!error || undefined}
          className={r.fieldInput}
          value={draft ?? value}
          maxLength={maxLength}
          spellCheck={false}
          dir="auto"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => {
            if (!cancelled.current && draft !== null && !error && draft !== value) onCommit(draft);
            cancelled.current = false;
            setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
        />
      </label>
      {error && <Hint>{error}</Hint>}
    </div>
  );
}

/** A field-wide row that opens settings below it (chevron, icon, summary). */
function RowButton({ open, onToggle, label, children, warn }: { open: boolean; onToggle: () => void; label: string; children: ReactNode; warn?: string | null }) {
  return (
    <button type="button" aria-expanded={open} aria-label={label} onClick={onToggle} className={clsx(fieldBox, "col-span-2 gap-[6px] pl-[6px] pr-[8px] text-left hover:text-fg")}>
      <ChevronRight size={12} className={clsx("shrink-0 text-fg-subtle transition-transform duration-fast ease-out motion-reduce:transition-none", open && "rotate-90")} />
      {children}
      {warn && (
        <span title={warn} className="ml-auto grid shrink-0 place-items-center text-warning">
          <TriangleAlert size={12} />
        </span>
      )}
    </button>
  );
}

/** Indices shift when a row before the open one goes. */
const afterRemoving = (open: number | null, index: number) => (open === null || open === index ? null : open > index ? open - 1 : open);

// ---------------------------------------------------------------------------
// Nothing (or several layers) selected: where the prototype starts, and its screens.

function Overview({ doc, selected }: { doc: Doc; selected: number }) {
  const p = doc.proto;
  // Parts play inside their screen: they're not screens of their own here.
  const screens = screenIds(doc).filter((id) => !isPart(doc, id));
  const links = p?.links.length ?? 0;
  const states = Object.values(p?.states ?? {}).reduce((n, s) => n + Object.keys(s).length, 0);
  const tracks = p?.tracks.length ?? 0;
  const parts = [links && `${links} ${links === 1 ? "link" : "links"}`, states && `${states} ${states === 1 ? "state" : "states"}`, tracks && `${tracks} ${tracks === 1 ? "track" : "tracks"}`].filter(Boolean);
  return (
    <>
      <Section
        title="Prototype"
        actions={
          <IconBtn size="sm" label="Present" command="prototype.present" onClick={() => runCommand("prototype.present", "toolbar")}>
            <Play size={14} />
          </IconBtn>
        }
      >
        {screens.length > 0 && (
          <Field label="Starting screen">
            <Row>
              <Select
                className="col-span-2"
                ariaLabel="Starting screen"
                value={p?.start && screens.includes(p.start) ? p.start : AUTO_START}
                options={[{ value: AUTO_START, label: "First linked screen" }, ...screens.map((id) => ({ value: id, label: screenName(doc, id) }))]}
                onChange={(v) => editProto((q) => setStart(q, v === AUTO_START ? undefined : v))}
              />
            </Row>
          </Field>
        )}
        <p className="pr-[8px] text-caption text-fg-muted">
          {parts.length ? `${parts.join(" · ")}. ` : "Nothing is linked yet. "}
          {selected > 1 ? "Select one layer to edit its links." : "Select a screen, or a component on one, to link it to another screen and give it states and tracks."}
        </p>
      </Section>
      {screens.length > 0 && (
        <Section title="Screens">
          <div className="-mt-[4px] flex flex-col pr-[8px]">
            {screens.map((id) => {
              const n = linksFrom(p, id).length;
              return (
                <button key={id} type="button" className={clsx(r.layerRow, "w-full pl-[6px] text-left")} onClick={() => studio().select([id])}>
                  <Frame size={14} className="shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1 truncate">{screenName(doc, id)}</span>
                  {p?.start === id && <Tag>Start</Tag>}
                  {n > 0 && <span className="shrink-0 text-caption text-fg-subtle tnum">{n === 1 ? "1 link" : `${n} links`}</span>}
                </button>
              );
            })}
          </div>
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// A screen, or a component on one

function ScopePanel({ doc, scope, selected }: { doc: Doc; scope: Scope; selected: string }) {
  const components = useMemo(() => componentsOn(doc, scope.screen), [doc, scope.screen]);
  // A screen's sheet, dialog or bar: its own sections; links, states and tracks are a screen's.
  const part = isPart(doc, scope.screen);
  return (
    <>
      <ScopeHeader doc={doc} scope={scope} selected={selected} />
      <RouteSections doc={doc} scope={scope} />
      {!part && <LinksSection doc={doc} scope={scope} components={components} />}
      {!part && <StatesSection doc={doc} scope={scope} components={components} />}
      {!part && <TracksSection doc={doc} scope={scope} components={components} />}
    </>
  );
}

function ScopeHeader({ doc, scope, selected }: { doc: Doc; scope: Scope; selected: string }) {
  const node = doc.nodes[scope.node];
  const kind = layerKind(node);
  const inComponent = scope.path !== undefined;
  return (
    <section className={r.section}>
      <header className="grid h-[32px] grid-cols-[minmax(0,1fr)_auto] items-center gap-[8px]">
        <div className="flex min-w-0 items-center gap-[6px]">
          <kind.Icon size={14} className={clsx("shrink-0", kind.component ? "text-component" : "text-fg-subtle")} aria-hidden />
          <span className="truncate text-caption font-semibold text-fg">{node.name}</span>
        </div>
        <IconBtn size="sm" label="Present from here" command="prototype.present" onClick={() => runCommand("prototype.present", "toolbar")}>
          <Play size={14} />
        </IconBtn>
      </header>
      <div className="flex flex-col gap-[8px]">
        {inComponent ? (
          <p className="flex min-w-0 items-center gap-[6px] pr-[8px] text-caption text-fg-subtle">
            <span className="shrink-0">On</span>
            <button type="button" className={clsx(r.link, "min-w-0 truncate text-left")} onClick={() => studio().select([scope.screen])}>
              {screenName(doc, scope.screen)}
            </button>
            <span className="ml-auto shrink-0 font-mono text-micro">{scope.path}</span>
          </p>
        ) : isPart(doc, scope.screen) ? null : (
          <Checkbox checked={doc.proto?.start === scope.screen} onChange={(on) => editProto((p) => setStart(p, on ? scope.screen : undefined))} label="Prototype starts here" />
        )}
        {selected !== scope.node && (
          <Hint tone="info">
            Links start from components and screens: these are {inComponent ? `${node.name}’s, the component this layer is in` : "the screen’s"}.
          </Hint>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Links

function LinksSection({ doc, scope, components }: { doc: Doc; scope: Scope; components: ReturnType<typeof componentsOn> }) {
  const p = doc.proto;
  const list = linksFrom(p, scope.screen, scope.path);
  const [open, setOpen] = useState<number | null>(null);
  const add = () => {
    const at = p?.links.length ?? 0;
    editProto((q) => addLink(q, newLink(doc, scope.path !== undefined ? { screen: scope.screen, path: scope.path } : { screen: scope.screen })));
    setOpen(at);
  };
  const remove = (index: number) => {
    editProto((q) => removeLink(q, index));
    setOpen((o) => afterRemoving(o, index));
  };
  const row = ({ link, index }: (typeof list)[number]) => (
    <LinkRow key={index} doc={doc} scope={scope} components={components} link={link} index={index} open={open === index} onToggle={() => setOpen(open === index ? null : index)} onRemove={() => remove(index)} />
  );

  // A screen's links, under the component (or the screen) they start from.
  const groups: { key: string; label: string; id: string; items: typeof list }[] = [];
  if (scope.path === undefined) {
    const sources = [WHOLE_SCREEN, ...components.map((c) => c.path), ...list.map((x) => x.link.from.path ?? WHOLE_SCREEN)];
    for (const key of new Set(sources)) {
      const items = list.filter((x) => (x.link.from.path ?? WHOLE_SCREEN) === key);
      if (!items.length) continue;
      const c = components.find((x) => x.path === key);
      groups.push({ key, label: key === WHOLE_SCREEN ? "Screen" : (c?.label ?? key), id: key === WHOLE_SCREEN ? scope.screen : (c?.id ?? ""), items });
    }
  }

  return (
    <Section
      title={list.length ? "Links" : <span className={r.sectionTitleCollapsed}>Links</span>}
      actions={
        <IconBtn size="sm" label="Add link" onClick={add}>
          <Plus size={14} />
        </IconBtn>
      }
    >
      {list.length > 0 &&
        (scope.path !== undefined
          ? list.map(row)
          : groups.map((g) => (
              <div key={g.key} className={r.rows}>
                <SourceCaption label={g.label} component={g.key !== WHOLE_SCREEN} onSelect={g.id ? () => studio().select([g.id]) : undefined} />
                {g.items.map(row)}
              </div>
            )))}
    </Section>
  );
}

function SourceCaption({ label, component, onSelect }: { label: string; component: boolean; onSelect?: () => void }) {
  const Icon = component ? Diamond : Frame;
  return (
    <button type="button" disabled={!onSelect} onClick={onSelect} title={onSelect ? `Select ${label}` : undefined} className="-mb-[2px] flex h-[16px] min-w-0 items-center gap-[4px] self-start pr-[8px] text-left text-micro text-fg-subtle hover:text-fg disabled:pointer-events-none">
      <Icon size={10} className={clsx("shrink-0", component && "text-component")} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function LinkRow({
  doc,
  scope,
  components,
  link,
  index,
  open,
  onToggle,
  onRemove,
}: {
  doc: Doc;
  scope: Scope;
  components: ReturnType<typeof componentsOn>;
  link: ProtoLink;
  index: number;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const p = doc.proto;
  const problem = linkProblem(doc, p, link);
  const trigger = TRIGGER[link.on];
  const when = link.on === "delay" ? `After ${link.after ?? DEFAULT_DELAY}ms` : trigger.short;
  const toState = typeof link.to === "object" && "state" in link.to;
  const set = (patch: Parameters<typeof updateLink>[2], live = false) => editProto((q) => updateLink(q, index, patch), { live });

  const destinations = [
    { value: "back", label: "Back" },
    ...screenIds(doc).filter((id) => !isPart(doc, id))
      .filter((id) => id !== scope.screen)
      .map((id) => ({ value: `screen:${id}`, label: screenName(doc, id), group: "Screens" })),
    ...[DEFAULT_STATE, ...statesOf(p, scope.screen)].map((st) => ({ value: `state:${st}`, label: `State: ${st}`, group: "States of this screen" })),
  ];
  const dest = destValue(link.to);
  if (!destinations.some((o) => o.value === dest)) destinations.push({ value: dest, label: toState ? `State: ${(link.to as { state: string }).state} (missing)` : "Missing screen" });

  const from = link.from.path ?? WHOLE_SCREEN;
  const sources = [{ value: WHOLE_SCREEN, label: "Whole screen" }, ...components.map((c) => ({ value: c.path, label: c.label, group: "Components" }))];
  if (!sources.some((o) => o.value === from)) sources.push({ value: from, label: `${from} (missing)`, group: "Components" });

  return (
    <div className={r.rows}>
      <Row>
        <RowButton open={open} onToggle={onToggle} label={`${when} link settings`} warn={problem}>
          <trigger.Icon size={14} className="shrink-0 text-fg-subtle" />
          <span className="shrink-0 text-fg">{when}</span>
          <ArrowRight size={12} className="shrink-0 text-fg-subtle" />
          <DestLabel doc={doc} to={link.to} />
        </RowButton>
        <IconBtn size="sm" label="Remove link" onClick={onRemove}>
          <Minus size={14} />
        </IconBtn>
      </Row>
      {open && (
        <div className={clsx(r.rows, "q-rise pb-[4px]")}>
          <Field label="Trigger">
            <Row>
              <Select ariaLabel="Trigger" icon={<trigger.Icon />} value={link.on} options={TRIGGERS.map((t) => ({ value: t.value, label: t.label }))} onChange={(on) => set({ on })} />
              {link.on === "delay" ? (
                <NumberField label={<Timer />} title="Delay after the screen appears" suffix="ms" value={link.after ?? DEFAULT_DELAY} min={0} max={60_000} step={10} onChange={(after) => set({ after }, true)} onCommit={() => studio().commitTx()} />
              ) : (
                <span />
              )}
            </Row>
          </Field>
          {scope.path === undefined && link.on !== "delay" && (
            <Field label="Starts from">
              <Row>
                <Select className="col-span-2" ariaLabel="Starts from" value={from} options={sources} onChange={(v) => set({ from: v === WHOLE_SCREEN ? { screen: scope.screen } : { screen: scope.screen, path: v } })} />
              </Row>
            </Field>
          )}
          <Field label="Destination">
            <Row>
              <Select
                className="col-span-2"
                ariaLabel="Destination"
                icon={link.to === "back" ? <CornerUpLeft /> : toState ? <ToggleRight /> : <ArrowRight />}
                value={dest}
                options={destinations}
                onChange={(v) => set({ to: parseDest(v) })}
              />
            </Row>
          </Field>
          <Field label={toState ? "Animation (in place)" : "Animation"}>
            <div className={r.rows}>
              {!toState && (
                <Row>
                  <Select className="col-span-2" ariaLabel="Transition" value={link.transition.kind} options={KINDS} onChange={(kind) => set({ kind })} />
                </Row>
              )}
              <Row>
                <MotionField className="col-span-2" value={link.transition.motion} onChange={(motion) => set({ motion })} />
              </Row>
            </div>
          </Field>
          {problem && <Hint>{problem}. Present leaves this link out.</Hint>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// States

/** Props a state can set on a component: the catalog's simple ones, with the instance's own value. */
function stateProps(doc: Doc, id: string | undefined): { name: string; spec: PropSpec; base: unknown }[] {
  const inst = id ? instOf(doc, id) : undefined;
  const spec = inst ? CATALOG_BY_NAME.get(inst.component) : undefined;
  if (!inst || !spec) return [];
  return Object.entries(spec.props).flatMap(([name, ps]) =>
    ps.type === "number" || ps.type === "boolean" || ps.type === "enum" || ps.type === "string" || ps.type === "icon" ? [{ name, spec: ps, base: inst.props?.[name] ?? (ps.type === "enum" ? ps.default : undefined) }] : [],
  );
}

function PropControl({ spec, value, label, onChange }: { spec: PropSpec; value: unknown; label: string; onChange: (v: unknown, live?: boolean) => void }) {
  switch (spec.type) {
    case "number":
      return (
        <NumberField
          label="#"
          ariaLabel={label}
          value={typeof value === "number" ? value : (spec.min ?? 0)}
          min={spec.min}
          max={spec.max}
          onChange={(v) => onChange(v, true)}
          onCommit={() => studio().commitTx()}
        />
      );
    case "boolean":
      return (
        <Segmented
          label={label}
          value={value === true ? "on" : "off"}
          options={[
            { value: "off", label: "Off" },
            { value: "on", label: "On" },
          ]}
          onChange={(v) => onChange(v === "on")}
        />
      );
    case "enum":
      return <Select ariaLabel={label} value={typeof value === "string" ? value : ""} options={spec.values.map((v) => ({ value: v, label: v }))} onChange={(v) => onChange(v)} />;
    default:
      return <TextInput ariaLabel={label} value={typeof value === "string" ? value : ""} maxLength={spec.type === "string" ? spec.maxChars : 40} onCommit={(v) => onChange(v)} />;
  }
}

function StatesSection({ doc, scope, components }: { doc: Doc; scope: Scope; components: ReturnType<typeof componentsOn> }) {
  const names = statesOf(doc.proto, scope.screen);
  const [open, setOpen] = useState<string | null>(null);
  const add = () => {
    let name = "";
    editProto((q) => {
      const added = addState(q, scope.screen);
      name = added.name;
      return added.proto;
    });
    if (name) setOpen(name);
  };
  return (
    <Section
      title={names.length ? "States" : <span className={r.sectionTitleCollapsed}>States</span>}
      actions={
        <IconBtn size="sm" label="Add state" disabled={names.length >= MAX_STATES} onClick={add}>
          <Plus size={14} />
        </IconBtn>
      }
    >
      {names.map((name) => (
        <StateRow
          key={name}
          doc={doc}
          scope={scope}
          components={components}
          name={name}
          open={open === name}
          onToggle={() => setOpen(open === name ? null : name)}
          onRenamed={(to) => setOpen(to)}
        />
      ))}
    </Section>
  );
}

function StateRow({
  doc,
  scope,
  components,
  name,
  open,
  onToggle,
  onRenamed,
}: {
  doc: Doc;
  scope: Scope;
  components: ReturnType<typeof componentsOn>;
  name: string;
  open: boolean;
  onToggle: () => void;
  onRenamed: (name: string) => void;
}) {
  const p = doc.proto;
  const changes = stateChanges(p, scope.screen, name);
  const links = linksFrom(p, scope.screen).filter(({ link }) => typeof link.to === "object" && "state" in link.to && link.to.state === name).length;
  const summary = changes.length ? `${changes.length} ${changes.length === 1 ? "change" : "changes"}` : "No changes";
  const setProp = (path: string, prop: string, value: unknown, live = false) => editProto((q) => setStateProp(q, scope.screen, name, path, prop, value), { live });
  const clearProp = (path: string, prop: string) => editProto((q) => clearStateProp(q, scope.screen, name, path, prop));
  const node = doc.nodes[scope.node];

  return (
    <div className={r.rows}>
      <Row>
        <RowButton open={open} onToggle={onToggle} label={`${name} state settings`}>
          <ToggleRight size={14} className="shrink-0 text-fg-subtle" />
          <span className="min-w-0 truncate text-fg">{name}</span>
          <span className="ml-auto shrink-0 text-micro text-fg-subtle tnum">{summary}</span>
        </RowButton>
        <IconBtn size="sm" label={links ? `Remove state ${name} and its ${links === 1 ? "link" : "links"}` : `Remove state ${name}`} onClick={() => editProto((q) => removeState(q, scope.screen, name))}>
          <Minus size={14} />
        </IconBtn>
      </Row>
      {open && (
        <div className={clsx(r.rows, "q-rise pb-[4px]")}>
          <Field label="Name">
            <Row>
              <TextInput
                className="col-span-2"
                ariaLabel="State name"
                value={name}
                validate={(v) => stateNameError(p, scope.screen, v, name)}
                onCommit={(to) => {
                  editProto((q) => renameState(q, scope.screen, name, to));
                  onRenamed(to.trim());
                }}
              />
            </Row>
          </Field>
          {scope.path !== undefined ? (
            <ComponentInState doc={doc} scope={scope} state={name} setProp={setProp} clearProp={clearProp} label={`${node.name} in this state`} />
          ) : (
            <>
              {changes.length > 0 && (
                <Field label="Changes">
                  <div className={r.rows}>
                    {[...new Set(changes.map((c) => c.path))].map((path) => {
                      const comp = components.find((x) => x.path === path);
                      const props = stateProps(doc, comp?.id);
                      return (
                        <div key={path} className={r.rows}>
                          <SourceCaption label={comp?.label ?? `${path} (missing)`} component onSelect={comp ? () => studio().select([comp.id]) : undefined} />
                          {changes
                            .filter((c) => c.path === path)
                            .map((c) => {
                              const ps = props.find((x) => x.name === c.prop);
                              return (
                                <Row key={c.prop}>
                                  <span className="min-w-0 truncate text-caption font-medium text-fg">{c.prop}</span>
                                  {ps ? (
                                    <PropControl spec={ps.spec} value={c.value} label={`${comp?.label ?? path} ${c.prop}`} onChange={(v, live) => setProp(path, c.prop, v, live)} />
                                  ) : (
                                    <span className="truncate font-mono text-micro text-fg-subtle">{JSON.stringify(c.value)}</span>
                                  )}
                                  <IconBtn size="sm" label={`Stop changing ${c.prop}`} onClick={() => clearProp(path, c.prop)}>
                                    <Minus size={14} />
                                  </IconBtn>
                                </Row>
                              );
                            })}
                        </div>
                      );
                    })}
                  </div>
                </Field>
              )}
              <Hint tone="info">Select a component on this screen to set its props in “{name}”.</Hint>
            </>
          )}
          {!links && <Hint tone="info">No link changes to this state yet: add one with the destination “State: {name}”.</Hint>}
        </div>
      )}
    </div>
  );
}

function ComponentInState({
  doc,
  scope,
  state,
  setProp,
  clearProp,
  label,
}: {
  doc: Doc;
  scope: Scope;
  state: string;
  setProp: (path: string, prop: string, value: unknown, live?: boolean) => void;
  clearProp: (path: string, prop: string) => void;
  label: string;
}) {
  const path = scope.path!;
  const props = stateProps(doc, scope.node);
  const diff = doc.proto?.states[scope.screen]?.[state] ?? {};
  if (!props.length) return <Hint tone="info">This component has no props a state can change.</Hint>;
  return (
    <Field label={label}>
      <div className={r.rows}>
        {props.map((ps) => {
          const key = `${path}.props.${ps.name}`;
          const set = key in diff;
          return (
            <Row key={ps.name}>
              <span className={clsx("min-w-0 truncate text-caption", set ? "font-medium text-fg" : "text-fg-subtle")} title={set ? `${ps.name} is set in this state` : `${ps.name}, as the component has it`}>
                {ps.name}
              </span>
              <PropControl spec={ps.spec} value={set ? diff[key] : ps.base} label={ps.name} onChange={(v, live) => setProp(path, ps.name, v, live)} />
              {set ? (
                <IconBtn size="sm" label={`Reset ${ps.name}`} onClick={() => clearProp(path, ps.name)}>
                  <RotateCcw size={12} />
                </IconBtn>
              ) : (
                <span />
              )}
            </Row>
          );
        })}
      </div>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Tracks

function TracksSection({ doc, scope, components }: { doc: Doc; scope: Scope; components: ReturnType<typeof componentsOn> }) {
  const p = doc.proto;
  const list = tracksOf(p, scope.screen, scope.path);
  const [open, setOpen] = useState<number | null>(null);
  const add = () => {
    const at = p?.tracks.length ?? 0;
    editProto((q) => addTrack(q, newTrack(doc, scope.screen, scope.path)));
    setOpen(at);
  };
  const remove = (index: number) => {
    editProto((q) => removeTrack(q, index));
    setOpen((o) => afterRemoving(o, index));
  };
  return (
    <Section
      title={list.length ? "Tracks" : <span className={r.sectionTitleCollapsed}>Tracks</span>}
      actions={
        <IconBtn size="sm" label="Add track: plays when the screen appears" onClick={add}>
          <Plus size={14} />
        </IconBtn>
      }
    >
      {list.map(({ track, index }) => (
        <TrackRow key={index} doc={doc} scope={scope} components={components} track={track} index={index} open={open === index} onToggle={() => setOpen(open === index ? null : index)} onRemove={() => remove(index)} />
      ))}
    </Section>
  );
}

function TrackRow({
  doc,
  scope,
  components,
  track,
  index,
  open,
  onToggle,
  onRemove,
}: {
  doc: Doc;
  scope: Scope;
  components: ReturnType<typeof componentsOn>;
  track: ProtoTrack;
  index: number;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const preset = PRESET[track.preset];
  const target = track.target.path ?? WHOLE_SCREEN;
  const wildcard = target.includes("*");
  const set = (patch: Parameters<typeof updateTrack>[2], live = false) => editProto((q) => updateTrack(q, index, patch), { live });
  const matches = track.target.path === undefined || components.some((c) => pathMatches(track.target.path!, c.path));
  const problem = matches ? null : `Nothing on the screen matches ${track.target.path}`;

  // Where it can play: on a component, that component or every one beside it; on a screen, anything on it.
  const targets: { value: string; label: string; group?: string }[] = [];
  if (scope.path !== undefined) {
    const siblings = scope.path.replace(/\d+$/, "*");
    targets.push({ value: scope.path, label: "This component" }, { value: siblings, label: `${wildcardLabel(doc, scope.screen, siblings)}, in turn` });
  } else {
    targets.push({ value: WHOLE_SCREEN, label: "Whole screen" });
    const regions = [...new Set(components.filter((c) => /^\w+\.\d+$/.test(c.path)).map((c) => c.path.replace(/\d+$/, "*")))];
    const lists = [...new Set(components.filter((c) => /\.children\.\d+$/.test(c.path)).map((c) => c.path.replace(/\d+$/, "*")))];
    for (const w of [...regions, ...lists]) targets.push({ value: w, label: wildcardLabel(doc, scope.screen, w), group: "Several, in turn" });
    for (const c of components) targets.push({ value: c.path, label: c.label, group: "One component" });
  }
  if (!targets.some((t) => t.value === target)) targets.push({ value: target, label: target });

  return (
    <div className={r.rows}>
      <Row>
        <RowButton open={open} onToggle={onToggle} label={`${preset.label} track settings`} warn={problem}>
          <preset.Icon size={14} className="shrink-0 text-fg-subtle" />
          <span className="shrink-0 text-fg">{preset.label.replace(/ \(loops\)$/, "")}</span>
          <span className="min-w-0 truncate text-fg-subtle">{trackTargetLabel(doc, track)}</span>
        </RowButton>
        <IconBtn size="sm" label="Remove track" onClick={onRemove}>
          <Minus size={14} />
        </IconBtn>
      </Row>
      {open && (
        <div className={clsx(r.rows, "q-rise pb-[4px]")}>
          <Field label="Plays on">
            <Row>
              <Select
                className="col-span-2"
                ariaLabel="Plays on"
                value={target}
                options={targets}
                onChange={(v) => set({ target: v === WHOLE_SCREEN ? { screen: scope.screen } : { screen: scope.screen, path: v }, ...(v.includes("*") && !track.stagger ? { stagger: 60 } : {}) })}
              />
            </Row>
          </Field>
          <Field label="Animation">
            <div className={r.rows}>
              <Row>
                <Select ariaLabel="Preset" icon={<preset.Icon />} value={track.preset} options={PRESETS.map((x) => ({ value: x.value, label: x.label }))} onChange={(v) => set({ preset: v })} />
                {wildcard ? (
                  <NumberField label={<Timer />} title="Stagger: between one component and the next" suffix="ms" value={track.stagger ?? 0} min={0} max={2000} step={5} onChange={(stagger) => set({ stagger }, true)} onCommit={() => studio().commitTx()} />
                ) : (
                  <span />
                )}
              </Row>
              <Row>
                <MotionField className="col-span-2" value={track.motion} onChange={(motion) => set({ motion })} />
              </Row>
            </div>
          </Field>
          {problem && <Hint>{problem}. Present leaves this track out.</Hint>}
        </div>
      )}
    </div>
  );
}
