"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Layers3, RotateCcw, Triangle } from "lucide-react";
import { COMPONENT_BY_NAME, SYSTEM, customised, withComponentChoice, type ShapeableComponent } from "@/design-system/interview/components";
import { keystoneSpec, pyramid } from "@/design-system/interview/keystones";
import { DOMAIN_NOUN, type Knobs, type ReadBack } from "@/design-system/interview/knobs";
import type { Scenario } from "@/design-system/interview/scenarios";
import { focusComponent, markReviewed, resetComponent, setComponentChoice, setComponentsMode } from "@/projects/interview";
import { Button, Tag } from "../controls";
import { Menu, MenuItem } from "../menu";
import { r } from "../recipes";
import { StepHead } from "./InterviewApp";
import { renderScenario, scenariosFor } from "./previewCache";
import { promptAndSave } from "./save";
import { PreviewStage } from "./stage";
import { update, useInterview } from "./store";

/**
 * Components: shape them one by one, or keep them together. One by one is a pyramid: the product's
 * keystone (its most complex piece) on top, the components it's built from below it, ranked by
 * how much of it they make up, then the rest of what the screens use. Each component has a few
 * options of its own over the system's; hover to preview, pick to apply, and see where it's used.
 * Together, every component keeps following the system-wide knobs from Refine.
 */

export function ComponentsStep() {
  const mode = useInterview((s) => s.state.components?.mode);
  const read = useInterview((s) => s.state.read);
  const knobs = useInterview((s) => s.state.knobs);
  if (!read || !knobs) return null;
  if (mode === "individual") return <PyramidEditor read={read} knobs={knobs} />;
  if (mode === "together") return <Together read={read} knobs={knobs} />;
  return <ChoosePath read={read} />;
}

// ---------------------------------------------------------------------------

function ChoosePath({ read }: { read: ReadBack }) {
  const { keystone, tiers } = useMemo(() => pyramid(read), [read]);
  const base = tiers.find((t) => t.id === "base")?.components ?? [];
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[920px] flex-col gap-[24px] px-[16px] py-[40px]">
        <StepHead eyebrow="Design system · Components" title="How do you want to shape your components?">
          Your components already follow the system you shaped. You can leave it there, or go further and shape them one at a time.
        </StepHead>
        <div className="grid gap-[16px] md:grid-cols-2">
          <PathCard
            icon={<Triangle size={16} absoluteStrokeWidth strokeWidth={1.25} />}
            title="One by one"
            tag="For detail"
            body={
              <>
                Start from the <b className="font-medium text-fg">{keystone.name.toLowerCase()}</b>, the hardest piece of {DOMAIN_NOUN[read.domain]}, and
                work down to what it&apos;s built from. Change any component without touching the rest.
              </>
            }
            action="Shape them one by one"
            onClick={() => update((s) => setComponentsMode(focusComponent(s, base[0] ?? "Button"), "individual"))}
          >
            <MiniPyramid top={keystone.name} parts={base.map((c) => COMPONENT_BY_NAME.get(c)?.label ?? c)} />
          </PathCard>
          <PathCard
            icon={<Layers3 size={16} absoluteStrokeWidth strokeWidth={1.25} />}
            title="All together"
            tag="Quick"
            body={<>Every component keeps following the system-wide choices from Refine: corners, colour, density and depth change them all at once. You can still fine-tune single components later.</>}
            action="Keep them together"
            onClick={() => update((s) => setComponentsMode(s, "together"))}
          />
        </div>
        <div className="flex items-center gap-[8px]">
          <Button variant="ghost" onClick={() => update((s) => ({ ...s, stage: "refine" }))}>
            Back to Refine
          </Button>
        </div>
      </div>
    </div>
  );
}

function PathCard({ icon, title, tag, body, action, onClick, children }: { icon: React.ReactNode; title: string; tag: string; body: React.ReactNode; action: string; onClick: () => void; children?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-[14px] rounded-xl bg-panel p-[18px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-center gap-[10px]">
        <span className="grid size-[32px] place-items-center rounded-md bg-raised text-fg">{icon}</span>
        <h2 className="text-title font-semibold text-fg">{title}</h2>
        <Tag>{tag}</Tag>
      </div>
      <p className="text-body text-fg-muted">{body}</p>
      {children}
      <div className="mt-auto pt-[4px]">
        <Button variant="secondary" className="w-full" onClick={onClick}>
          {action}
        </Button>
      </div>
    </section>
  );
}

/** The keystone over the components it's made of. */
function MiniPyramid({ top, parts }: { top: string; parts: string[] }) {
  return (
    <div className="flex flex-col items-center gap-[6px] rounded-lg bg-muted px-[12px] py-[14px]">
      <span className="rounded-md bg-inverse px-[10px] py-[4px] text-caption font-medium text-fg-inverse">{top}</span>
      <span aria-hidden className="h-[10px] w-px bg-line-strong" />
      <div className="flex flex-wrap justify-center gap-[4px]">
        {parts.map((p, i) => (
          <span key={p} className="rounded-sm bg-raised px-[6px] py-[2px] text-micro font-medium text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
            {i + 1}. {p}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Together({ read, knobs }: { read: ReadBack; knobs: Knobs }) {
  const list = useMemo(() => [...scenariosFor(read).filter((s) => s.id === "strip"), keystoneScenario(read), ...scenariosFor(read).filter((s) => s.id === "hero")], [read]);
  const [sid, setSid] = useState<string>(list[0].id);
  const [maxSide, setMaxSide] = useState(1400);
  const scenario = list.find((s) => s.id === sid) ?? list[0];
  return (
    <div className="grid h-full grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col gap-[16px] border-r border-line-subtle bg-panel p-[16px]">
        <StepHead eyebrow="Design system · Components" title="All together">
          Every component follows the system you shaped in Refine. Change corners, colour, density or depth there and they all change at once.
        </StepHead>
        <div className="mt-auto flex flex-col gap-[8px]">
          <Button variant="secondary" onClick={() => update((s) => setComponentsMode(s, "individual"))}>
            Shape them one by one instead
          </Button>
          <div className="flex items-center gap-[8px]">
            <Button variant="ghost" onClick={() => update((s) => ({ ...s, stage: "refine" }))}>
              Back to Refine
            </Button>
            <span className="flex-1" />
            <Button variant="primary" onClick={() => void promptAndSave()}>
              Save design system
            </Button>
          </div>
        </div>
      </aside>
      <section className="flex min-h-0 flex-col">
        <ScenarioTabs list={list} current={scenario.id} onPick={setSid} />
        <PreviewStage knobs={knobs} read={read} scenario={scenario} maxSide={maxSide} hover={null} onSize={setMaxSide} hint="Every component here follows the system-wide choices in Refine." />
      </section>
    </div>
  );
}

const keystoneScenario = (read: ReadBack): Scenario => ({ id: "keystone", label: pyramid(read).keystone.name, spec: keystoneSpec(read) });
const sheetScenario = (c: ShapeableComponent): Scenario => ({ id: `component:${c.name}`, label: c.label, spec: c.sheet() });

function ScenarioTabs({ list, current, onPick }: { list: Scenario[]; current: string; onPick: (id: string) => void }) {
  return (
    <div className="flex h-[44px] shrink-0 items-center gap-[4px] overflow-x-auto border-b border-line-subtle px-[12px]" role="tablist" aria-label="Preview screens">
      {list.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={s.id === current}
          onClick={() => onPick(s.id)}
          className={clsx("q-item h-[28px] shrink-0 rounded-md px-[10px] text-caption font-medium", s.id === current ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}
          dir="auto"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PyramidEditor({ read, knobs }: { read: ReadBack; knobs: Knobs }) {
  const comp = useInterview((s) => s.state.components);
  const { keystone, tiers } = useMemo(() => pyramid(read), [read]);
  const order = tiers.flatMap((t) => t.components);
  const focus = COMPONENT_BY_NAME.get(comp?.focus ?? "") ?? COMPONENT_BY_NAME.get(order[0])!;
  const reviewed = comp?.reviewed ?? [];
  const [hover, setHover] = useState<Knobs | null>(null);
  const [maxSide, setMaxSide] = useState(1400);
  const [tab, setTab] = useState<string>("sheet");

  const sheet = useMemo(() => sheetScenario(focus), [focus]);
  const ks = useMemo(() => keystoneScenario(read), [read]);
  const hero = scenariosFor(read).find((s) => s.id === "hero");
  const list: Scenario[] = [sheet, ks, ...(hero ? [{ ...hero, label: "Home" }] : [])];
  const scenario = tab === "keystone" ? ks : tab === "hero" && hero ? hero : sheet;

  const pick = (name: string) => {
    update((s) => focusComponent(s, name));
    setTab("sheet");
    setHover(null);
  };
  const next = () => {
    update((s) => markReviewed(s, focus.name));
    const after = order.slice(order.indexOf(focus.name) + 1).find((c) => !reviewed.includes(c));
    if (after) pick(after);
  };
  const base = tiers.find((t) => t.id === "base")?.components ?? [];
  const baseDone = base.filter((c) => reviewed.includes(c) || c === focus.name).length;

  return (
    <div className="grid h-full grid-cols-[minmax(240px,280px)_minmax(300px,340px)_minmax(0,1fr)]">
      <nav aria-label="Components" className="flex min-h-0 flex-col border-r border-line-subtle bg-app">
        <div className="min-h-0 flex-1 overflow-y-auto p-[12px]">
          <button
            type="button"
            onClick={() => setTab("keystone")}
            className={clsx("q-item flex w-full flex-col gap-[4px] rounded-lg p-[12px] text-left", tab === "keystone" ? "bg-inverse text-fg-inverse" : "bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover")}
          >
            <span className={clsx("text-micro font-medium uppercase tracking-[0.06em]", tab === "keystone" ? "text-fg-inverse/70" : "text-fg-subtle")}>Keystone</span>
            <span className="text-body font-semibold">{keystone.name}</span>
            <span className={clsx("text-caption", tab === "keystone" ? "text-fg-inverse/80" : "text-fg-muted")}>{keystone.why}</span>
          </button>
          {tiers.map((t) => (
            <section key={t.id} className="mt-[16px]">
              <h3 className="px-[4px] text-caption font-semibold text-fg">{t.title}</h3>
              <p className="mb-[6px] px-[4px] text-micro text-fg-subtle">{t.id === "base" ? `${baseDone} of ${base.length} looked at. ${t.note}` : t.note}</p>
              <ul className="flex flex-col gap-[2px]">
                {t.components.map((name, i) => {
                  const c = COMPONENT_BY_NAME.get(name)!;
                  const n = customised(knobs, name);
                  const done = reviewed.includes(name);
                  const role = t.id === "base" ? keystone.parts.find((p) => p.component === name)?.role : undefined;
                  return (
                    <li key={name}>
                      <button
                        type="button"
                        aria-current={focus.name === name ? "true" : undefined}
                        onClick={() => pick(name)}
                        className={clsx("q-item flex w-full items-start gap-[8px] rounded-md px-[8px] py-[6px] text-left", focus.name === name ? "bg-active" : "hover:bg-hover", t.id === "later" && "opacity-70")}
                      >
                        <span className={clsx("mt-[1px] grid size-[18px] shrink-0 place-items-center rounded-full text-micro tnum", done ? "bg-success-subtle text-success" : "bg-hover text-fg-subtle")}>
                          {done ? <Check size={11} strokeWidth={2} /> : t.id === "base" ? i + 1 : "·"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium text-fg">{c.label}</span>
                          <span className="block truncate text-caption text-fg-subtle">{role ?? c.what}</span>
                        </span>
                        {n > 0 && <span className="mt-[2px] shrink-0 text-micro font-medium text-fg-muted tnum">{n} changed</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-[6px] border-t border-line-subtle p-[12px]">
          <Button variant="ghost" size="sm" onClick={() => update((s) => setComponentsMode(s, "together"))}>
            All together
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => update((s) => ({ ...s, stage: "refine" }))}>
            Refine
          </Button>
        </div>
      </nav>

      <aside className="flex min-h-0 flex-col border-r border-line-subtle bg-panel">
        <div className="min-h-0 flex-1 overflow-y-auto p-[16px]">
          <p className="text-micro font-medium uppercase tracking-[0.06em] text-fg-subtle">{base.includes(focus.name) ? `Part of the ${keystone.name.toLowerCase()}` : "Component"}</p>
          <h2 className="mt-[4px] text-heading font-semibold text-fg">{focus.label}</h2>
          <p className="mt-[2px] text-caption text-fg-muted">{keystone.parts.find((p) => p.component === focus.name)?.role ?? focus.what}</p>
          <div className="mt-[16px] flex flex-col gap-[8px]">
            {focus.options.map((o) => (
              <div key={o.id} className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-[8px]">
                <span className="text-caption text-fg-muted">{o.label}</span>
                <OptionMenu component={focus} option={o.id} knobs={knobs} read={read} scenario={scenario} maxSide={maxSide} setHover={setHover} />
              </div>
            ))}
          </div>
          {customised(knobs, focus.name) > 0 && (
            <button type="button" onClick={() => update((s) => resetComponent(s, focus.name))} className="q-item mt-[12px] inline-flex items-center gap-[6px] rounded-md px-[6px] py-[4px] text-caption text-fg-muted hover:bg-hover hover:text-fg">
              <RotateCcw size={12} /> Follow the system again
            </button>
          )}
          <p className="mt-[16px] text-caption text-fg-subtle">
            Options left on “Follow the system” keep changing with the system-wide choices in Refine. The dashed outlines on the {keystone.name.toLowerCase()} and Home show where {focus.label.toLowerCase()} are used.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-[8px] border-t border-line-subtle p-[12px]">
          <Button variant="secondary" size="sm" onClick={next}>
            {reviewed.includes(focus.name) ? "Next" : "Looks good, next"}
          </Button>
          <span className="flex-1" />
          <Button variant="primary" size="sm" onClick={() => void promptAndSave()}>
            Save design system
          </Button>
        </div>
      </aside>

      <section className="flex min-h-0 flex-col">
        <ScenarioTabs list={list} current={scenario.id} onPick={(id) => setTab(id === ks.id ? "keystone" : id === "hero" ? "hero" : "sheet")} />
        <PreviewStage knobs={knobs} read={read} scenario={scenario} maxSide={maxSide} hover={hover} onSize={setMaxSide} highlight={scenario === sheet ? null : focus.name} />
      </section>
    </div>
  );
}

/** One option of a component: hover a value to preview it, pick it to apply. */
function OptionMenu({
  component,
  option,
  knobs,
  read,
  scenario,
  maxSide,
  setHover,
}: {
  component: ShapeableComponent;
  option: string;
  knobs: Knobs;
  read: ReadBack;
  scenario: Scenario;
  maxSide: number;
  setHover: (k: Knobs | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const o = component.options.find((x) => x.id === option)!;
  const current = knobs.components?.[component.name]?.[option] ?? SYSTEM;
  const label = o.values.find((v) => v.value === current)?.label ?? "Follow the system";
  const onOpen = (v: boolean) => {
    setOpen(v);
    if (v) for (const x of o.values) if (x.value !== current) void renderScenario(withComponentChoice(knobs, component.name, option, x.value), read, scenario, maxSide, "prefetch");
    else setHover(null);
  };
  return (
    <Menu
      label={o.label}
      open={open}
      onOpenChange={onOpen}
      checks
      className="w-[220px]"
      trigger={
        <button type="button" className={clsx(r.selectTrigger, current === SYSTEM && "text-fg-muted")}>
          <span className="truncate">{label}</span>
          <ChevronDown size={12} />
        </button>
      }
    >
      {o.values.map((v) => (
        <MenuItem
          key={v.value}
          checked={v.value === current}
          onSelect={() => {
            setHover(null);
            update((s) => setComponentChoice(s, component.name, option, v.value, `${component.label} · ${o.label}: ${v.label}`));
          }}
        >
          <span className="flex-1 truncate" onPointerEnter={() => setHover(withComponentChoice(knobs, component.name, option, v.value))} onPointerLeave={() => setHover(null)}>
            {v.label}
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}
