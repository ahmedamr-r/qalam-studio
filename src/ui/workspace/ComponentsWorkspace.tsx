import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Component, ImagePlus, Plus } from "lucide-react";
import { confirmDialog } from "../surfaces/dialog";
import type { Inst } from "@/design-system/builders";
import { CATALOG, CATALOG_BY_NAME, type ComponentSpec } from "@/design-system/components";
import { CUSTOM } from "@/design-system/custom";
import { emptyGuide, type ComponentGuide, type Pattern } from "@/design-system/docs";
import { createToken, type NewType } from "@/design-system/edit";
import { insertComponent } from "@/design-system/place";
import { RECIPES, recipePaths } from "@/design-system/recipes";
import { tokenSetFor, useSystems, type DesignSystem } from "@/design-system/registry";
import { isListed } from "@/design-system/freeform";
import type { Tree } from "@/design-system/resolve";
import { Button, Segmented, Select, Tag } from "../controls";
import { useSlidingIndicator } from "../motion";
import { r } from "../recipes";
import { useComponentPreview, type Preview } from "../componentPreviews";
import { SideHeading, SideItem, WorkspaceHeader } from "./Workspace";
import { TokenTable } from "./TokensWorkspace";
import { PropsEditor, propSummary } from "./PropsEditor";
import { GuideDoc } from "./GuideDoc";
import { useEditor, useShownSystem, type Edit } from "./useEditor";
import StructureControls from "./StructureControls";
import { useWorkspace } from "./store";
import { ComponentLive } from "./ComponentLive";
import { assetURL } from "@/doc/assets";
import { attachComponentShot } from "../ai/composerBridge";

/**
 * The component library, opened full size from Assets: every catalog component (and the shown
 * system's own patterns) with a live preview, its properties as controls, the recipe tokens it is
 * drawn with (editable), and its design doc.
 */

const CATEGORY_LABEL: Record<ComponentSpec["category"], string> = {
  navigation: "Navigation",
  input: "Inputs & actions",
  content: "Content",
  feedback: "Feedback",
  layout: "Layout",
  commerce: "Commerce",
};

type Entry = { kind: "component"; name: string; spec: ComponentSpec } | { kind: "pattern"; name: string; pattern: Pattern };

/** Screen content width: components render as they would inside a 390px screen. */
const STAGE_W = 358;

/** Icon props for every lucide glyph here: 1.25px lines at any size. */
const ico = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/**
 * Text drawn on the stage. The stage is the light preview well in both themes (user content is
 * the brightest thing on screen), so its ink is fixed rather than a theme token.
 */
const STAGE_INK = "text-[#55524e]";

export default function ComponentsWorkspace() {
  const { ds, activeId } = useShownSystem();
  const systems = useSystems((s) => s.systems);
  const selected = useWorkspace((s) => s.component);
  const [q, setQ] = useState("");
  const { edit, onError } = useEditor(ds);

  const entries: Entry[] = useMemo(
    () => [...ds.docs.patterns.map((p): Entry => ({ kind: "pattern", name: p.name, pattern: p })), ...CATALOG.map((c): Entry => ({ kind: "component", name: c.name, spec: c }))],
    [ds.docs.patterns],
  );
  const entry = entries.find((e) => e.name === selected) ?? entries.find((e) => e.name === "Button")!;
  const shot = useRef<HTMLInputElement>(null);
  const match = (e: Entry) => !q || e.name.toLowerCase().includes(q.toLowerCase()) || (e.kind === "component" ? e.spec.description : e.pattern.purpose).toLowerCase().includes(q.toLowerCase());
  const pick = (name: string) => useWorkspace.setState({ component: name });

  return (
    <>
      <WorkspaceHeader icon={<Component {...ico} />} title="Components" search={q} onSearch={setQ} placeholder="Search components">
        <span className={r.crumbSep} aria-hidden>
          /
        </span>
        <Select
          className="w-[224px]"
          ariaLabel="Design system"
          value={ds.id}
          options={systems.filter((s) => isListed(s) || s.id === ds.id).map((s) => ({ value: s.id, label: `${s.name}${s.id === activeId ? " · active" : ""}` }))}
          onChange={(id) => useWorkspace.setState({ systemId: id })}
        />
      </WorkspaceHeader>
      <div className="relative flex min-h-0 flex-1">
        <nav aria-label="Components" className="flex w-[232px] shrink-0 flex-col overflow-y-auto border-r border-line-subtle bg-app pt-[4px] pb-[16px]">
          {/* A screenshot of one component: Qalam AI builds it in this system and adds it here (from the chat). */}
          <input
            ref={shot}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              useWorkspace.getState().close();
              attachComponentShot(f, ds.id);
            }}
          />
          <div className="px-[8px] pt-[4px] pb-[4px]">
            <button
              type="button"
              onClick={() => shot.current?.click()}
              title={`Qalam AI builds the component in your screenshot from catalog parts in ${ds.name}'s tokens, checks it against the screenshot and adds it here`}
              className="q-item flex h-[32px] w-full items-center gap-[8px] rounded-md px-[8px] text-body text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover hover:text-fg"
            >
              <ImagePlus size={14} {...ico} className="shrink-0 text-fg-subtle" /> Add from a screenshot
            </button>
          </div>
          {ds.docs.patterns.length > 0 && (
            <>
              <SideHeading>{ds.name} components</SideHeading>
              {entries
                .filter((e) => e.kind === "pattern" && match(e))
                .map((e) => (
                  <SideItem key={e.name} selected={e.name === entry.name} onClick={() => pick(e.name)}>
                    {e.name}
                  </SideItem>
                ))}
            </>
          )}
          {(Object.keys(CATEGORY_LABEL) as ComponentSpec["category"][]).map((cat) => {
            const list = entries.filter((e) => e.kind === "component" && e.spec.category === cat && match(e));
            if (!list.length) return null;
            return (
              <div key={cat}>
                <SideHeading>{CATEGORY_LABEL[cat]}</SideHeading>
                {list.map((e) => (
                  <SideItem key={e.name} selected={e.name === entry.name} onClick={() => pick(e.name)}>
                    {e.name}
                  </SideItem>
                ))}
              </div>
            );
          })}
        </nav>
        <Detail key={entry.name} ds={ds} entry={entry} edit={edit} onError={onError} />
      </div>
    </>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Keeps showing the last good render while the next one is on its way (no flashing while typing). */
function useSteadyPreview(id: string, inst: Inst, dsId: string, opts: { width: number; dir: "ltr" | "rtl" }) {
  const p = useComponentPreview(`${id}|${opts.width}|${opts.dir}`, inst, dsId, opts);
  const last = useRef<Preview | "error" | null>(null);
  if (p) last.current = p;
  return { preview: p ?? last.current, pending: !p };
}

function Stage({ id, inst, dsId, dir }: { id: string; inst: Inst; dsId: string; dir: "ltr" | "rtl" }) {
  const { preview, pending } = useSteadyPreview(id, inst, dsId, { width: STAGE_W, dir });
  return (
    <div
      className="relative grid min-h-[220px] place-items-center overflow-auto rounded-xl bg-stage p-[32px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]"
      style={{ backgroundImage: "radial-gradient(rgb(0 0 0 / 0.09) 1px, transparent 1px)", backgroundSize: "16px 16px", backgroundPosition: "8px 8px" }}
    >
      {preview === "error" ? (
        <span className={clsx("text-body", STAGE_INK)}>This combination of properties can&apos;t be built.</span>
      ) : preview ? (
        <img
          src={preview.url}
          alt=""
          draggable={false}
          className={clsx("max-w-full transition-opacity duration-fast", pending && "opacity-60")}
          style={{ width: preview.w, height: preview.h }}
        />
      ) : (
        <div className="q-breathe h-[64px] w-[240px] rounded-lg bg-black/[0.06]" />
      )}
      {preview && preview !== "error" && (
        <span className={clsx("absolute right-[12px] bottom-[8px] text-micro tnum", STAGE_INK)}>
          {Math.round(preview.w)} × {Math.round(preview.h)}
        </span>
      )}
    </div>
  );
}

/** The screenshot a component was read from, to compare with the render above. */
function Reference({ src }: { src: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // assetURL caches its object URLs, so they aren't revoked here.
    void assetURL(src).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [src]);
  if (!url) return null;
  return (
    <div className="flex flex-col gap-[8px]">
      <span className="text-caption text-fg-subtle">The screenshot it was read from</span>
      <div className="grid place-items-center rounded-xl bg-stage p-[16px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
        <img src={url} alt="" draggable={false} className="max-h-[240px] max-w-full object-contain" />
      </div>
    </div>
  );
}

/** One tile per value of the component's main option (variant, tone or size), rendered side by side. */
function VariantStrip({ spec, props, dsId, dir, onPick }: { spec: ComponentSpec; props: Record<string, unknown>; dsId: string; dir: "ltr" | "rtl"; onPick: (prop: string, v: string) => void }) {
  const key = ["variant", "tone", "size"].find((k) => spec.props[k]?.type === "enum");
  const p = key ? spec.props[key] : undefined;
  if (!key || !p || p.type !== "enum") return null;
  const current = typeof props[key] === "string" ? props[key] : p.default;
  return (
    <div>
      <div className="mb-[8px] text-caption font-semibold text-fg">
        {key[0].toUpperCase() + key.slice(1)} <span className="font-normal text-fg-subtle tnum">· {p.values.length} options</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-[8px]">
        {p.values.map((v) => (
          <VariantTile key={v} spec={spec} props={{ ...props, [key]: v }} dsId={dsId} dir={dir} label={v} selected={v === current} onClick={() => onPick(key, v)} />
        ))}
      </div>
    </div>
  );
}

function VariantTile({
  spec,
  props,
  dsId,
  dir,
  label,
  selected,
  onClick,
}: {
  spec: ComponentSpec;
  props: Record<string, unknown>;
  dsId: string;
  dir: "ltr" | "rtl";
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const inst: Inst = { component: spec.name, props, children: spec.exampleChildren };
  const { preview } = useSteadyPreview(`variant:${spec.name}:${JSON.stringify(props)}`, inst, dsId, { width: STAGE_W, dir });
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        "q-press flex min-w-0 flex-col overflow-hidden rounded-lg text-left",
        // A picked option card: saffron edge and tint (spec: optionCardSelected), never a fill.
        selected
          ? "shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-accent)_55%,transparent)]"
          : "shadow-[0_0_0_1px_var(--color-line-subtle)] hover:shadow-[0_0_0_1px_var(--color-line-strong)]",
      )}
    >
      <div className="grid h-[80px] place-items-center bg-stage p-[8px]">
        {preview && preview !== "error" && (
          <img src={preview.url} alt="" draggable={false} className="max-h-full max-w-full object-contain" style={{ width: preview.w * 0.5, height: preview.h * 0.5 }} />
        )}
      </div>
      <span className={clsx("flex h-[28px] items-center px-[8px] text-caption", selected ? "bg-accent-subtle font-medium text-fg" : "bg-panel text-fg-muted")}>{label}</span>
    </button>
  );
}

type Tab = "docs" | "tokens" | "api";

function Detail({ ds, entry, edit, onError }: { ds: DesignSystem; entry: Entry; edit: Edit; onError: (m: string) => void }) {
  const spec = entry.kind === "component" ? entry.spec : null;
  const [props, setProps] = useState<Record<string, unknown>>(() => structuredClone(spec?.example ?? {}));
  const [dir, setDir] = useState<"ltr" | "rtl">("ltr");
  const [tab, setTab] = useState<Tab>("docs");
  const [renaming, setRenaming] = useState<string | null>(null);
  const shownProps = useDebounced(props, 200);
  const ts = useMemo(() => tokenSetFor(ds.id), [ds]);

  // A system's own component shows (and is inserted) as a linked instance, with its props' examples.
  const inst: Inst = spec ? { component: spec.name, props: shownProps, children: spec.exampleChildren } : { component: CUSTOM, props: { name: entry.name } };
  const guide: ComponentGuide = spec
    ? (ds.docs.components.find((c) => c.component === spec.name) ?? emptyGuide(spec.name, spec.description))
    : (entry as Extract<Entry, { kind: "pattern" }>).pattern.guide;
  const description = spec ? spec.description : (entry as Extract<Entry, { kind: "pattern" }>).pattern.purpose;
  const tokenPaths = useMemo(
    () =>
      recipePaths(
        entry.name,
        ts.tokens.map((t) => t.path),
        guide.tokens,
      ),
    [entry.name, ts, guide.tokens],
  );
  const tokens = useMemo(() => tokenPaths.map((p) => ts.get(p)!).filter(Boolean), [tokenPaths, ts]);

  const saveGuide = (patch: Partial<ComponentGuide>) =>
    edit(`Edit ${entry.name} docs`, (_tree: Tree, docs) => {
      const d = structuredClone(docs);
      if (entry.kind === "pattern") {
        const p = d.patterns.find((x) => x.name === entry.name);
        if (!p) return { error: `${entry.name} is no longer in this system` };
        p.guide = { ...p.guide, ...patch };
        if (patch.purpose !== undefined) p.purpose = patch.purpose;
      } else {
        const i = d.components.findIndex((c) => c.component === entry.name);
        const next = { ...(i >= 0 ? d.components[i] : emptyGuide(entry.name, spec?.description)), ...patch };
        if (i >= 0) d.components[i] = next;
        else d.components.push(next);
      }
      return { docs: d };
    });

  const recipeGroup = RECIPES[entry.name]?.[0];
  const createRecipeToken = recipeGroup
    ? (type: NewType) => {
        let made = "";
        const id = edit("Create token", (tree) => {
          const r = createToken(tree, { type, tier: "component", group: recipeGroup });
          made = r.path;
          return { tree: r.tree };
        });
        if (id) setRenaming(made);
      }
    : undefined;

  const insert = () => {
    void insertComponent(spec ? { component: spec.name, props, children: spec.exampleChildren } : inst);
    useWorkspace.getState().close();
  };

  return (
    <div className="flex min-w-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex items-start gap-[16px] px-[24px] pt-[20px] pb-[16px]">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-[8px]">
              <h3 className="text-display font-semibold text-fg">{entry.name}</h3>
              {spec ? <Tag>{CATEGORY_LABEL[spec.category]}</Tag> : <Tag tone="component">{ds.name} component</Tag>}
              {entry.kind === "pattern" && entry.pattern.origin === "ai" && <Tag tone="ai">Made by Qalam AI</Tag>}
              {entry.kind === "pattern" && entry.pattern.reference && <Tag tone="ai">Read from a screenshot</Tag>}
              {spec?.container && <Tag>Container</Tag>}
            </div>
            <p className="mt-[4px] max-w-[720px] text-body leading-[20px] text-fg-muted">{description}</p>
          </div>
          <Button onClick={insert}>
            <Plus size={14} {...ico} /> Insert on canvas
          </Button>
        </header>

        <div className="flex flex-col gap-[16px] px-[24px]">
          <div className="flex items-center justify-between gap-[12px]">
            <span className="text-caption text-fg-subtle">
              Rendered with <b className="font-medium text-fg-muted">{ds.name}</b> at screen width
            </span>
            <Segmented
              label="Preview direction"
              className="w-[168px]"
              value={dir}
              onChange={setDir}
              options={[
                { value: "ltr", label: "LTR" },
                { value: "rtl", label: "RTL · عربي" },
              ]}
            />
          </div>
          <Stage id={`ws:${entry.name}:${JSON.stringify(inst)}`} inst={inst} dsId={ds.id} dir={dir} />
          {entry.kind === "pattern" && entry.pattern.reference && <Reference src={entry.pattern.reference} />}
          {spec && <StructureControls component={entry.name} ts={ts} edit={edit} />}
          {spec && <VariantStrip spec={spec} props={shownProps} dsId={ds.id} dir={dir} onPick={(k, v) => setProps((p) => ({ ...p, [k]: v }))} />}
          {spec && <ComponentLive name={entry.name} ds={ds} />}
        </div>

        <Tabs
          tab={tab}
          setTab={setTab}
          tabs={[
            { id: "docs", label: "Design doc" },
            { id: "tokens", label: "Tokens", count: tokens.length },
            ...(spec ? [{ id: "api" as const, label: "API" }] : []),
          ]}
        />

        <div key={tab} className={clsx("q-rise flex min-h-[320px] flex-col", tab !== "tokens" && "px-[24px] py-[20px]")}>
          {tab === "docs" && <GuideDoc guide={guide} systemName={ds.name} onSave={(patch) => void saveGuide(patch)} />}
          {tab === "tokens" &&
            (tokens.length ? (
              <div className="flex h-[min(560px,70vh)] flex-col">
                <TokenTable ds={ds} ts={ts} tokens={tokens} flat={false} renaming={renaming} setRenaming={setRenaming} edit={edit} onError={onError} onCreate={createRecipeToken} />
              </div>
            ) : (
              <p className="max-w-[640px] px-[24px] py-[20px] text-body leading-[20px] text-fg-muted">
                {entry.name} has no recipe of its own: it is drawn straight from semantic tokens (text, bg, space, type). Edit those in the token editor.
              </p>
            ))}
          {tab === "api" && spec && <ApiTable spec={spec} />}
        </div>
      </main>
      <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-line-subtle bg-panel">
        {spec ? (
          <PropsEditor spec={spec} props={props} onChange={setProps} onReset={() => setProps(structuredClone(spec.example))} />
        ) : (
          <PatternPanel key={`${ds.id}:${entry.name}`} pattern={(entry as Extract<Entry, { kind: "pattern" }>).pattern} systemName={ds.name} edit={edit} />
        )}
      </aside>
    </div>
  );
}

/** Tab bar with an underline that slides to the picked tab (instant on first paint). */
function Tabs<T extends string>({ tab, setTab, tabs }: { tab: T; setTab: (t: T) => void; tabs: { id: T; label: string; count?: number }[] }) {
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement, HTMLSpanElement>(tab, { axis: "x" });
  return (
    <div className="sticky top-0 z-10 mt-[24px] shrink-0 border-b border-line-subtle bg-panel px-[16px]">
      <div ref={containerRef} className="relative flex h-[40px] items-stretch gap-[4px]" role="tablist" aria-label="Component details">
        {/* The indicator spans the tab; its ::after draws the 2px underline at the bottom edge. */}
        <span
          ref={indicatorRef}
          aria-hidden
          className="q-indicator data-[hidden]:opacity-0 after:absolute after:inset-x-[8px] after:bottom-0 after:h-[2px] after:rounded-full after:bg-fg"
        />
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-indicator-active={tab === t.id || undefined}
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex items-center gap-[6px] rounded-md px-[8px] text-body font-medium transition-colors duration-fast hover:duration-0 focus-visible:outline-offset-[-2px]",
              tab === t.id ? "text-fg" : "text-fg-subtle hover:text-fg-muted",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="text-caption font-normal text-fg-subtle tnum">{t.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function ApiTable({ spec }: { spec: ComponentSpec }) {
  const rows = Object.entries(spec.props);
  return (
    <div className="overflow-hidden rounded-lg shadow-[inset_0_0_0_1px_var(--color-line)]">
      <table className="w-full text-left text-body">
        <thead className="bg-muted text-micro text-fg-subtle">
          <tr>
            <th className="h-[32px] px-[12px] font-medium">Property</th>
            <th className="px-[12px] font-medium">Type</th>
            <th className="px-[12px] font-medium">Values</th>
            <th className="px-[12px] font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, p]) => (
            <tr key={name} className="border-t border-line-subtle align-top">
              <td className="px-[12px] py-[8px] font-mono text-caption text-fg">{name}</td>
              <td className="px-[12px] py-[8px] font-mono text-caption text-fg-muted">{p.type}</td>
              <td className="px-[12px] py-[8px] text-caption text-fg-muted">{p.type === "enum" ? p.values.join(" · ") : p.type === "items" ? Object.keys(p.fields).join(", ") : propSummary(p)}</td>
              <td className="px-[12px] py-[8px] text-caption text-fg-subtle">{p.description ?? ("required" in p && p.required ? "Required" : "")}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={4} className="px-[12px] py-[12px] text-caption text-fg-subtle">
                No properties.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="border-t border-line-subtle bg-muted px-[12px] py-[8px] text-micro text-fg-subtle">
        Character limits hold for English and Arabic copy. Qalam AI can only set these properties when it composes screens.
      </p>
    </div>
  );
}

/** The part of a composition at a path of child indexes ("" is the top). */
const partAt = (inst: Inst, path: string): Inst | undefined =>
  path === "" ? inst : path.split(".").reduce<Inst | undefined>((cur, i) => cur?.children?.[Number(i)], inst);

/**
 * A system's own component: its props, its parts (pick one to change its properties) and removal.
 * Every change is a change to the system, so the screens that place it follow.
 */
function PatternPanel({ pattern, systemName, edit }: { pattern: Pattern; systemName: string; edit: Edit }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState<Inst>(pattern.composition);
  const save = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(save.current), []);
  // Changes from elsewhere (undo, another tab) replace the draft unless a save is pending.
  useEffect(() => {
    if (!save.current) setDraft(pattern.composition);
  }, [pattern.composition]);

  const part = picked !== null ? partAt(draft, picked) : undefined;
  const partSpec = part ? CATALOG_BY_NAME.get(part.component) : undefined;
  const change = (props: Record<string, unknown>) => {
    const next = structuredClone(draft);
    const target = partAt(next, picked ?? "");
    if (!target) return;
    target.props = props;
    setDraft(next);
    clearTimeout(save.current);
    save.current = setTimeout(() => {
      save.current = undefined;
      edit(`Edit ${pattern.name}`, (_tree: Tree, docs) => {
        const d = structuredClone(docs);
        const p = d.patterns.find((x) => x.name === pattern.name);
        if (!p) return { error: `${pattern.name} is no longer in this system` };
        p.composition = next;
        return { docs: d };
      });
    }, 400);
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Remove ${pattern.name} from ${systemName}?`,
      body: "Screens keep a copy only if it was made for them. You can undo this in the editor.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) edit(`Remove ${pattern.name}`, (_tree: Tree, docs) => ({ docs: { ...docs, patterns: docs.patterns.filter((x) => x.name !== pattern.name) } }));
  };

  const row = (i: Inst, depth: number, path: string): ReactNode => (
    <div key={path || "top"}>
      <button
        type="button"
        onClick={() => setPicked(path)}
        aria-pressed={picked === path}
        className={clsx("q-item flex h-[28px] w-full items-center gap-[6px] rounded-md pr-[8px] text-left text-body", picked === path ? r.selectedRow : "text-fg-muted hover:bg-hover hover:text-fg")}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <Component size={14} {...ico} className="shrink-0 text-component" />
        <span className="font-medium">{i.component}</span>
        <span className="truncate text-caption text-fg-subtle">
          {Object.values(i.props ?? {})
            .filter((v) => typeof v === "string")
            .slice(0, 2)
            .join(" · ")}
        </span>
      </button>
      {i.children?.map((c, n) => row(c, depth + 1, path === "" ? String(n) : `${path}.${n}`))}
    </div>
  );
  return (
    <div className="flex flex-col">
      {!!pattern.props?.length && (
        <>
          <div className={clsx(r.panelHeader, "border-b border-line-subtle")}>
            <h3 className={r.panelTitle}>Props</h3>
          </div>
          <div className="flex flex-col gap-[6px] px-[16px] py-[12px]">
            <p className="text-caption text-fg-subtle">Each instance fills these in; the parts show them where they say {"{name}"}.</p>
            {pattern.props.map((p) => (
              <div key={p.name} className="flex items-baseline gap-[8px] text-caption">
                <span className="font-mono text-fg">{p.name}</span>
                <span className="text-fg-subtle">{p.kind === "icon" ? "icon" : `text ≤${p.maxChars}`}</span>
                <span className="min-w-0 flex-1 truncate text-right text-fg-muted">{p.example}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className={clsx(r.panelHeader, "border-b border-line-subtle", !!pattern.props?.length && "border-t")}>
        <h3 className={r.panelTitle}>Composition</h3>
      </div>
      <div className="p-[8px]">
        <p className="mb-[8px] px-[8px] text-caption text-fg-subtle">Built from catalog components, so it follows the system&apos;s tokens. Pick a part to change it: screens that place {pattern.name} update.</p>
        {row(draft, 0, "")}
      </div>
      {part && partSpec && (
        <div className="border-t border-line-subtle">
          <PropsEditor spec={partSpec} props={part.props ?? {}} onChange={change} onReset={() => change(partAt(pattern.composition, picked ?? "")?.props ?? {})} />
        </div>
      )}
      <div className="mt-auto flex items-center gap-[8px] border-t border-line-subtle px-[16px] py-[12px]">
        <Button size="sm" variant="ghost" className="-ml-[8px] hover:text-danger" onClick={() => void remove()}>
          Remove from {systemName}
        </Button>
      </div>
    </div>
  );
}
