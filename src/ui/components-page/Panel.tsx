import { useMemo, useState } from "react";
import clsx from "clsx";
import { Component, Crosshair, LucideProvider, Maximize2, Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { studio, useStudio } from "@/doc/store";
import { pageName, wholeDoc } from "@/doc/pages";
import type { Doc, ShowcaseMeta } from "@/doc/schema";
import { CATALOG_BY_NAME, type ComponentSpec } from "@/design-system/components";
import { CUSTOM } from "@/design-system/custom";
import { emptyGuide, type ComponentGuide, type Pattern } from "@/design-system/docs";
import { recipePaths } from "@/design-system/recipes";
import { dsIdForNode, tokenSetFor, useActiveSystem, useSystems, type DesignSystem } from "@/design-system/registry";
import { instancesOf, instOf } from "@/design-system/instances";
import { insertComponent } from "@/design-system/place";
import { SHOWCASE_GROUPS, variantAxis, cellId } from "@/design-system/showcase";
import type { Inst } from "@/design-system/builders";
import { Button, Hint, Section, Tag, TokenChip } from "../controls";
import { r } from "../recipes";
import { glideToLayer, onCanvasReady } from "../discovery/canvas";
import { openWorkspace } from "../workspace/store";
import { GuideDoc } from "../workspace/GuideDoc";
import { propSummary } from "../workspace/PropsEditor";
import { TokenPreview, valueText } from "../workspace/TokenValue";
import { backPage, goToPage, revealLayers } from "../pages";
import { selectedShowcase } from "./runtime";

/*
 * The right panel on the Components page: what the page is when nothing is selected, and the
 * selected component's details (read-only: the page shows the system; it changes in Assets or
 * Tokens, and every change shows here at once).
 */

const CATEGORY_LABEL = Object.fromEntries(SHOWCASE_GROUPS.map((g) => [g.category, g.label])) as Record<ComponentSpec["category"], string>;
const TOKENS_SHOWN = 8;

export default function ComponentsPagePanel() {
  const ds = useActiveSystem();
  const picked = useStudio(
    useShallow((s) => {
      const t = selectedShowcase(s.doc, s.selection);
      return t ? [t.card.id, t.cell?.id ?? "", JSON.stringify(t.meta)] : [];
    }),
  );
  return (
    <LucideProvider strokeWidth={1.25} absoluteStrokeWidth>
      <div data-region="design" aria-label="Component details" className="flex flex-col pb-[24px]">
        {picked.length ? <ComponentDetails key={`${ds.id}:${picked[0]}`} ds={ds} cell={picked[1] ? (JSON.parse(picked[2]) as ShowcaseMeta) : null} card={picked[0]} /> : <Overview ds={ds} />}
      </div>
    </LucideProvider>
  );
}

// ---------------------------------------------------------------------------
// Nothing selected

function Overview({ ds }: { ds: DesignSystem }) {
  const freeform = useSystems((s) => s.freeform);
  const sections = useStudio(useShallow((s) => s.doc.roots.map((id) => `${id}\u0001${s.doc.nodes[id]?.name ?? ""}\u0001${countCards(s.doc, id)}`)));
  const total = sections.reduce((n, row) => n + Number(row.split("\u0001")[2]), 0);
  return (
    <>
      <section className={r.section}>
        <div className="flex flex-col gap-[8px] pt-[12px]">
          <div className="flex items-center gap-[8px]">
            <Component size={16} className="shrink-0 text-component" />
            <h2 className="min-w-0 flex-1 truncate text-title font-semibold text-fg">{ds.name}</h2>
            <Tag tone="success">Live</Tag>
          </div>
          <p className="text-body leading-[20px] text-fg-muted">
            {total ? <><span className="tnum">{total}</span> components</> : "Every component"}, drawn from {ds.name}&apos;s tokens. Changes in Tokens or Assets show here at once. Click a component for its details.
          </p>
          {freeform && <Hint tone="info">This project lets Qalam AI pick each screen&apos;s look. This page shows {ds.name}, the system in Assets.</Hint>}
          <div className="flex flex-wrap gap-[8px] pt-[4px]">
            <Button size="sm" variant="secondary" onClick={() => openWorkspace("components", { systemId: ds.id })}>
              <Maximize2 size={12} /> Open the library
            </Button>
            <Button size="sm" variant="secondary" onClick={() => openWorkspace("tokens", { systemId: ds.id })}>
              Edit tokens
            </Button>
          </div>
        </div>
      </section>
      <Section title="Sections">
        <div className="-mx-[8px] flex flex-col">
          {sections.map((row) => {
            const [id, name, count] = row.split("\u0001");
            return (
              <button
                key={id}
                type="button"
                onClick={() => onCanvasReady((c) => c.glideToFit([id]))}
                className="q-item flex h-[28px] items-center gap-[8px] rounded-md px-[8px] text-left text-body text-fg-muted hover:bg-hover hover:text-fg"
              >
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="text-caption text-fg-subtle tnum">{count}</span>
              </button>
            );
          })}
        </div>
      </Section>
    </>
  );
}

function countCards(doc: Doc, sectionId: string): number {
  const list = doc.nodes[sectionId]?.children.find((c) => doc.nodes[c]?.name === "Components");
  return list ? doc.nodes[list].children.length : 0;
}

// ---------------------------------------------------------------------------
// A component

function ComponentDetails({ ds, card, cell }: { ds: DesignSystem; card: string; cell: ShowcaseMeta | null }) {
  const meta = useStudio((s) => s.doc.nodes[card]?.meta.showcase);
  const name = meta?.component ?? "";
  const own = !!meta?.own;
  const spec = own ? undefined : CATALOG_BY_NAME.get(name);
  const pattern = own ? ds.docs.patterns.find((p) => p.name === name) : undefined;
  if (!meta || (!spec && !pattern)) return null;
  const guide: ComponentGuide = spec ? (ds.docs.components.find((g) => g.component === name) ?? emptyGuide(name, spec.description)) : pattern!.guide;
  const description = spec ? spec.description : pattern!.purpose;
  const axis = spec ? variantAxis(spec) : null;
  const value = cell?.prop && cell.value !== undefined ? { prop: cell.prop, value: cell.value } : null;
  const inst: Inst = spec ? { component: spec.name, props: { ...structuredClone(spec.example), ...(value ? { [value.prop]: value.value } : {}) }, children: spec.exampleChildren } : { component: CUSTOM, props: { name } };

  return (
    <>
      <section className={r.section}>
        <div className="flex flex-col gap-[8px] pt-[12px]">
          <h2 className="text-heading font-semibold text-fg">{name}</h2>
          <div className="flex flex-wrap items-center gap-[6px]">
            {spec ? <Tag>{CATEGORY_LABEL[spec.category]}</Tag> : <Tag tone="component">{ds.name} component</Tag>}
            {spec?.container && <Tag>Container</Tag>}
            {pattern?.origin === "ai" && <Tag tone="ai">Made by Qalam AI</Tag>}
            {value && (
              <Tag tone="component">
                {value.prop}: {value.value}
              </Tag>
            )}
          </div>
          <p className="text-body leading-[20px] text-fg-muted">{description}</p>
          <div className="flex flex-wrap gap-[8px] pt-[4px]">
            <Button size="sm" variant="secondary" onClick={() => openWorkspace("components", { component: name, systemId: ds.id })}>
              <Maximize2 size={12} /> Open in library
            </Button>
            <InsertButton inst={inst} />
          </div>
        </div>
      </section>
      {spec && axis && <Variants name={name} prop={axis.prop} values={axis.values} current={value?.value ?? null} />}
      {spec && <Properties spec={spec} value={value} />}
      {pattern && <PatternProps pattern={pattern} />}
      <Tokens ds={ds} name={name} guide={guide} />
      <Section title="Usage">
        <GuideDoc guide={guide} systemName={ds.name} onSave={() => {}} editable={false} compact />
      </Section>
      <InUse ds={ds} name={name} own={own} />
    </>
  );
}

/** Insert this component (this variant) on the page the Components page was opened from. */
function InsertButton({ inst }: { inst: Inst }) {
  const back = useStudio((s) => pageName(s.doc, backPage()));
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        if (goToPage(backPage())) void insertComponent(inst);
      }}
    >
      <Plus size={12} /> Insert on {back}
    </Button>
  );
}

function Variants({ name, prop, values, current }: { name: string; prop: string; values: string[]; current: string | null }) {
  const pick = (v: string) => {
    const id = cellId(name, v);
    if (!studio().doc.nodes[id]) return;
    studio().select([id]);
    onCanvasReady((c) => glideToLayer(c, id));
  };
  return (
    <Section title={`${prop[0].toUpperCase()}${prop.slice(1)} · ${values.length}`}>
      <div className="-mx-[8px] flex flex-col" role="listbox" aria-label={prop}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            role="option"
            aria-selected={v === current}
            onClick={() => pick(v)}
            className={clsx("q-item flex h-[28px] items-center gap-[8px] rounded-md px-[8px] text-left text-body text-fg-muted hover:bg-hover", v === current && r.selectedRow)}
          >
            <span className="min-w-0 flex-1 truncate">{v}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

const shown = (v: unknown): string => {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "string") return v.length > 24 ? `${v.slice(0, 23)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? "item" : "items"}`;
  return "Set";
};

function Properties({ spec, value }: { spec: ComponentSpec; value: { prop: string; value: string } | null }) {
  const rows = Object.entries(spec.props);
  if (!rows.length) return null;
  return (
    <Section title={`Properties · ${rows.length}`}>
      <dl className="flex flex-col gap-[10px]">
        {rows.map(([prop, p]) => (
          <div key={prop} className="flex flex-col gap-[2px]">
            <div className="flex items-baseline gap-[8px]">
              <dt className="min-w-0 flex-1 truncate font-mono text-caption text-fg">{prop}</dt>
              <dd className="max-w-[50%] shrink-0 truncate text-caption text-fg-muted tnum" title={typeof spec.example[prop] === "string" ? String(spec.example[prop]) : undefined}>
                {shown(value?.prop === prop ? value.value : spec.example[prop])}
              </dd>
            </div>
            <dd className="text-micro text-fg-subtle">{propSummary(p)}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function PatternProps({ pattern }: { pattern: Pattern }) {
  const props = pattern.props ?? [];
  if (!props.length) return null;
  return (
    <Section title={`Properties · ${props.length}`}>
      <dl className="flex flex-col gap-[10px]">
        {props.map((p) => (
          <div key={p.name} className="flex flex-col gap-[2px]">
            <div className="flex items-baseline gap-[8px]">
              <dt className="min-w-0 flex-1 truncate font-mono text-caption text-fg">{p.name}</dt>
              <dd className="max-w-[50%] shrink-0 truncate text-caption text-fg-muted">{shown(p.example)}</dd>
            </div>
            <dd className="text-micro text-fg-subtle">{p.kind === "icon" ? "Icon" : `Text, up to ${p.maxChars} characters`}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function Tokens({ ds, name, guide }: { ds: DesignSystem; name: string; guide: ComponentGuide }) {
  const ts = useMemo(() => tokenSetFor(ds.id), [ds]);
  const tokens = useMemo(
    () =>
      recipePaths(
        name,
        ts.tokens.map((t) => t.path),
        guide.tokens,
      )
        .map((p) => ts.get(p)!)
        .filter(Boolean),
    [name, ts, guide.tokens],
  );
  const [all, setAll] = useState(false);
  return (
    <Section
      title={`Tokens · ${tokens.length}`}
      actions={
        <button type="button" className={clsx(r.link, "text-caption")} onClick={() => openWorkspace("tokens", { systemId: ds.id })}>
          Edit
        </button>
      }
    >
      {tokens.length ? (
        <div className="flex flex-col gap-[6px]">
          {(all ? tokens : tokens.slice(0, TOKENS_SHOWN)).map((t) => (
            <div key={t.path} className="flex min-w-0 items-center gap-[8px]">
              <TokenChip path={t.path.replace(/^component\./, "")} tone="component" className="min-w-0 flex-1" />
              <TokenPreview ts={ts} t={t} size={14} />
              <span className="max-w-[40%] shrink-0 truncate text-caption text-fg-muted tnum">{valueText(ts, t)}</span>
            </div>
          ))}
          {tokens.length > TOKENS_SHOWN && (
            <button type="button" className={clsx(r.link, "self-start text-caption")} onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${tokens.length}`}
            </button>
          )}
        </div>
      ) : (
        <p className="text-caption leading-[18px] text-fg-muted">No recipe of its own: it is drawn from semantic tokens (text, background, space, type).</p>
      )}
    </Section>
  );
}

/** Where the component is used: on every page, in this system. */
function InUse({ ds, name, own }: { ds: DesignSystem; name: string; own: boolean }) {
  const doc = useStudio((s) => s.doc);
  const ids = useMemo(() => {
    const whole = wholeDoc(doc);
    // The system's own components are Custom instances that name them.
    const all = own ? instancesOf(whole, CUSTOM).filter((id) => instOf(whole, id)?.props?.name === name) : instancesOf(whole, name);
    return all.filter((id) => dsIdForNode(whole, id) === ds.id);
  }, [doc, name, own, ds.id]);
  return (
    <Section title="In use">
      <div className="flex items-center gap-[8px]">
        <p className="min-w-0 flex-1 text-caption leading-[18px] text-fg-muted">
          {ids.length ? (
            <>
              <span className="font-medium text-fg tnum">{ids.length}</span> {ids.length === 1 ? "instance follows" : "instances follow"} it on your pages.
            </>
          ) : (
            "Not used on your pages yet."
          )}
        </p>
        {ids.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => revealLayers(ids)}>
            <Crosshair size={12} /> Show
          </Button>
        )}
      </div>
    </Section>
  );
}
