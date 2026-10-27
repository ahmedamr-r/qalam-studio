import { createContext, useContext, useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronDown, Lock, LockOpen, Redo2, Undo2 } from "lucide-react";
import { ARABIC_FONTS, fontCandidates, rankFonts, weightGaps } from "@/design-system/interview/fonts";
import { KNOB_SPECS, NAMED_HUES, hueName, knobHash, type KnobGroup, type KnobId, type Knobs, type ReadBack } from "@/design-system/interview/knobs";
import { USED_WEIGHTS } from "@/design-system/interview/recipes";
import type { Scenario } from "@/design-system/interview/scenarios";
import { axisValues } from "@/design-system/interview/table";
import { TokenSet } from "@/design-system/resolve";
import { applyKnobs, canRedo, canUndo, mix, redo, setKnob, toggleLock, undo } from "@/projects/interview";
import { QalamAIGlyph } from "../brand";
import { ErrorNote, Progress } from "../ai/common";
import { Button, Hint, IconBtn, Swatch, Tag } from "../controls";
import { Menu, MenuItem, MenuLabel } from "../menu";
import { r } from "../recipes";
import { screenPNG } from "../componentPreviews";
import { runNudge, runReview } from "./ai";
import { draftSystem, renderScenario, scenariosFor } from "./previewCache";
import { PreviewStage } from "./stage";
import { promptAndSave } from "./save";
import { busy, cancelBusy, interview, update, useInterview } from "./store";

/**
 * Refining a direction on the product's own screens. Every choice is a knob: in a sentence that
 * describes the system, and in detail below. Hovering an option previews it on the screen; picking
 * it makes the change, and the components it changed glow while the rest dims ("4 Buttons, 2 Chips
 * changed"). Hold Space to flip back to how it was. Qalam AI can adjust from a few words, or review
 * the screen against the brief.
 */

const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

interface Ctx {
  read: ReadBack;
  knobs: Knobs;
  locks: KnobId[];
  scenario: Scenario;
  maxSide: number;
  setHover: (k: Knobs | null) => void;
}
const RefineCtx = createContext<Ctx | null>(null);
const useRefine = () => useContext(RefineCtx)!;

// ---------------------------------------------------------------------------
// Knob options

interface Option {
  value: string;
  label: string;
}

function optionsFor(id: KnobId, read: ReadBack, k: Knobs): Option[] {
  const axes = axisValues(read);
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  switch (id) {
    case "hue":
      return NAMED_HUES.map(([h, name]) => ({ value: String(h), label: cap(name) }));
    case "font": {
      const list = [...new Set([k.font, ...fontCandidates(axes, 10).slice(0, 10)])];
      return list.map((f) => ({ value: f, label: f }));
    }
    case "displayFont": {
      const list = [...new Set([...(k.displayFont === "same" ? [] : [k.displayFont]), ...rankFonts(axes, "display").slice(0, 6).map((f) => f.family)])].filter((f) => f !== k.font);
      return [{ value: "same", label: `Same as body (${k.font})` }, ...list.map((f) => ({ value: f, label: f }))];
    }
    case "arabicFont":
      return ARABIC_FONTS.map((f) => ({ value: f, label: f }));
    default:
      return KNOB_SPECS[id].options.map((o) => ({ value: o, label: cap(KNOB_SPECS[id].phrase(o)) }));
  }
}

/** The knob's value in a few words. */
function valueLabel(id: KnobId, k: Knobs): string {
  switch (id) {
    case "hue":
      return k.brandHex ? "your brand colour" : hueName(k.hue);
    case "bodySize":
      return `${k.bodySize}px`;
    case "typeRatio":
      return k.typeRatio === "1.2" ? "tight" : "dramatic";
    case "displayFont":
      return k.displayFont === "same" ? "the same font" : k.displayFont;
    case "font":
    case "arabicFont":
      return String(k[id]);
    default:
      return KNOB_SPECS[id].phrase(String(k[id]));
  }
}

const withValue = (k: Knobs, id: KnobId, v: string): Knobs => ({ ...k, [id]: id === "hue" ? Number(v) : v }) as Knobs;

function commit(id: KnobId, v: string) {
  const { state } = interview();
  if (!state.knobs) return;
  const next = withValue(state.knobs, id, v);
  update((s) => setKnob(s, id, next[id], `${KNOB_SPECS[id].label}: ${valueLabel(id, next)}`));
}

/** A knob as a menu: hovering an option previews it, picking it changes the system. */
function KnobMenu({ id, variant }: { id: KnobId; variant: "chip" | "field" }) {
  const { read, knobs, locks, scenario, maxSide, setHover } = useRefine();
  const [open, setOpen] = useState(false);
  const options = optionsFor(id, read, knobs);
  const locked = locks.includes(id);
  const fixed = id === "hue" && !!knobs.brandHex;
  const current = String(knobs[id]);
  const onOpen = (o: boolean) => {
    setOpen(o);
    if (o) for (const opt of options.slice(0, 6)) if (opt.value !== current) void renderScenario(withValue(knobs, id, opt.value), read, scenario, maxSide, "prefetch");
    else setHover(null);
  };
  const label = valueLabel(id, knobs);
  if (locked || fixed)
    return (
      <span className={variant === "chip" ? "rounded-md bg-active px-[6px] py-[1px] font-medium text-fg" : clsx(r.selectTrigger, "opacity-70")} title={fixed ? "From your brand colour" : "Locked"}>
        {label}
      </span>
    );
  return (
    <Menu
      label={KNOB_SPECS[id].label}
      open={open}
      onOpenChange={onOpen}
      checks
      className="max-h-[360px] w-[240px] overflow-y-auto"
      trigger={
        variant === "chip" ? (
          <button type="button" className="q-item inline-flex items-center gap-[2px] rounded-md bg-active px-[6px] py-[1px] font-medium text-fg underline decoration-fg-faint decoration-dotted underline-offset-[3px] hover:bg-hover aria-expanded:bg-hover">
            {label}
            <ChevronDown size={12} />
          </button>
        ) : (
          <button type="button" className={r.selectTrigger}>
            <span className="truncate">{label}</span>
            <ChevronDown size={12} />
          </button>
        )
      }
    >
      {options.map((o) => (
        <MenuItem key={o.value} checked={o.value === current} onSelect={() => (setHover(null), commit(id, o.value))}>
          <span className="flex-1 truncate" onPointerEnter={() => setHover(withValue(knobs, id, o.value))} onPointerLeave={() => setHover(null)}>
            {id === "font" || id === "displayFont" ? <span style={{ fontFamily: o.value === "same" ? undefined : `"${o.value}"` }}>{o.label}</span> : o.label}
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}

// ---------------------------------------------------------------------------

const GROUPS: { group: KnobGroup; title: string; knobs: KnobId[] }[] = [
  { group: "colour", title: "Colour", knobs: ["hue", "chroma", "neutralTint", "contrast"] },
  { group: "type", title: "Type", knobs: ["font", "displayFont", "bodySize", "typeRatio", "arabicFont"] },
  { group: "shape", title: "Shape", knobs: ["radius", "density", "elevation", "fill", "motion"] },
];

export function RefineStep() {
  const state = useInterview((s) => s.state);
  const read = state.read;
  const knobs = state.knobs;
  const list = useMemo(() => (read ? scenariosFor(read) : []), [read]);
  const [sid, setSid] = useState("hero");
  const [hover, setHover] = useState<Knobs | null>(null);
  const [maxSide, setMaxSide] = useState(1400);
  const scenario = list.find((s) => s.id === sid) ?? list[0];
  if (!read || !knobs || !scenario) return null;
  const ctx: Ctx = { read, knobs, locks: state.locks ?? [], scenario, maxSide, setHover };
  return (
    <RefineCtx.Provider value={ctx}>
      <div className="grid h-full grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-line-subtle bg-panel">
          <Controls />
        </aside>
        <section className="flex min-h-0 flex-col">
          <div className="flex h-[44px] shrink-0 items-center gap-[4px] border-b border-line-subtle px-[12px]" role="tablist" aria-label="Preview screens">
            {list.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === scenario.id}
                onClick={() => setSid(s.id)}
                className={clsx("q-item h-[28px] rounded-md px-[10px] text-caption font-medium", s.id === scenario.id ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}
                dir="auto"
              >
                {s.label}
              </button>
            ))}
          </div>
          <PreviewStage knobs={knobs} read={read} scenario={scenario} maxSide={maxSide} hover={hover} onSize={setMaxSide} />
        </section>
      </div>
    </RefineCtx.Provider>
  );
}

function Controls() {
  const state = useInterview((s) => s.state);
  const working = useInterview((s) => s.busy);
  const error = useInterview((s) => s.error);
  const { read, knobs, locks } = useRefine();
  const picked = state.directions?.picked;
  const from = picked !== undefined ? state.directions?.list[picked]?.name : undefined;
  const draft = draftSystem(knobs, read);
  const gaps = [...weightGaps(knobs.font, USED_WEIGHTS).map((w) => `${knobs.font} has no ${w} weight`), ...(read.scripts.includes("arabic") ? weightGaps(knobs.arabicFont, USED_WEIGHTS).map((w) => `${knobs.arabicFont} has no ${w} weight`) : [])];
  const history = state.history;
  const lastNudge = state.nudges?.[state.nudges.length - 1];

  return (
    <>
      <div className="flex h-[44px] shrink-0 items-center gap-[4px] border-b border-line-subtle pl-[16px] pr-[8px]">
        <h2 className="min-w-0 flex-1 truncate text-body font-semibold">{from ? `Refining “${from}”` : "Refine"}</h2>
        <IconBtn label="Undo" disabled={!canUndo(state)} onClick={() => update(undo)}>
          <Undo2 {...ICON} />
        </IconBtn>
        <IconBtn label="Redo" disabled={!canRedo(state)} onClick={() => update(redo)}>
          <Redo2 {...ICON} />
        </IconBtn>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex flex-col gap-[8px] border-b border-line-subtle p-[16px]">
          <p className={r.fieldCaption}>Your system</p>
          <p className="text-body leading-[26px] text-fg">
            It&apos;s <KnobMenu id="density" variant="chip" />, with <KnobMenu id="chroma" variant="chip" /> in <KnobMenu id="hue" variant="chip" />, <KnobMenu id="radius" variant="chip" />,{" "}
            <KnobMenu id="elevation" variant="chip" /> and <KnobMenu id="fill" variant="chip" />. Text is set in <KnobMenu id="font" variant="chip" /> at <KnobMenu id="bodySize" variant="chip" />.
          </p>
          <div className="flex items-center gap-[4px] pt-[2px]">
            {["bg.brand-strong", "bg.brand", "bg.brand-subtle", "bg.surface", "text.primary", "bg.go", "bg.eat"].map((p) => (
              <Swatch key={p} color={new TokenSet(draft.ds.tree).color(p) ?? "#000000"} size={16} />
            ))}
          </div>
        </section>

        {GROUPS.map((g) => (
          <section key={g.group} className="border-b border-line-subtle px-[16px] py-[12px]">
            <div className="mb-[6px] flex items-center justify-between">
              <h3 className={r.sectionTitle}>{g.title}</h3>
              {(state.directions?.list.length ?? 0) > 1 && <MixMenu group={g.group} />}
            </div>
            <div className="flex flex-col gap-[6px]">
              {g.knobs.map((id) => (id === "arabicFont" && !read.scripts.includes("arabic") ? null : <KnobRow key={id} id={id} locked={locks.includes(id)} />))}
            </div>
          </section>
        ))}

        <section className="flex flex-col gap-[8px] border-b border-line-subtle p-[16px]">
          <h3 className={clsx(r.sectionTitle, "flex items-center gap-[6px]")}>
            <QalamAIGlyph size={14} /> Ask Qalam AI
          </h3>
          <Nudge />
          {lastNudge && (
            <div className="flex flex-col gap-[4px] rounded-md bg-ai-subtle px-[10px] py-[8px] text-caption">
              <p className="text-fg">{lastNudge.reply}</p>
              {lastNudge.applied.map((a) => (
                <p key={a.knob} className="text-fg-muted">
                  {KNOB_SPECS[a.knob].label}: {a.from} → {a.to}
                </p>
              ))}
            </div>
          )}
          <Review />
        </section>

        {working && (
          <div className="flex flex-col gap-[8px] p-[16px]">
            <Progress tokens={working.tokens} started={working.started} label={working.label} />
            <Button variant="ghost" size="sm" className="self-start" onClick={cancelBusy}>
              Stop
            </Button>
          </div>
        )}
        {error && (
          <div className="p-[16px]">
            <ErrorNote message={error} />
          </div>
        )}

        <section className="flex flex-col gap-[6px] p-[16px]">
          <h3 className={r.sectionTitle}>Checks</h3>
          {draft.failures.length === 0 ? (
            <p className="flex items-center gap-[6px] text-caption text-success">
              <span className="size-[6px] rounded-full bg-success" /> Every text and border colour meets WCAG 2.2 AA
            </p>
          ) : (
            <Hint>{draft.failures.length} colour pairs are under AA: {draft.failures.slice(0, 3).map((f) => `${f.fg} on ${f.bg} (${f.ratio}:1)`).join(", ")}</Hint>
          )}
          {gaps.map((g) => (
            <Hint key={g} tone="info">
              {g}; the nearest weight is used.
            </Hint>
          ))}
          {history && history.entries.length > 1 && (
            <p className="text-caption text-fg-subtle">
              {history.index} change{history.index === 1 ? "" : "s"} · last: {history.entries[history.index].note}
            </p>
          )}
        </section>
      </div>

      <div className="flex shrink-0 items-center gap-[8px] border-t border-line-subtle p-[12px]">
        <Button variant="ghost" onClick={() => update((s) => ({ ...s, stage: "directions" }))}>
          Directions
        </Button>
        <span className="flex-1" />
        <Button variant="secondary" disabled={!!working} onClick={() => update((s) => ({ ...s, stage: "components" }))}>
          Components
        </Button>
        <Button variant="primary" disabled={!!working} onClick={() => void promptAndSave()}>
          Save design system
        </Button>
      </div>
    </>
  );
}


function KnobRow({ id, locked }: { id: KnobId; locked: boolean }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_24px] items-center gap-[8px]">
      <span className="text-caption text-fg-muted">{KNOB_SPECS[id].label}</span>
      <KnobMenu id={id} variant="field" />
      <IconBtn label={locked ? `Unlock ${KNOB_SPECS[id].label.toLowerCase()}` : `Lock ${KNOB_SPECS[id].label.toLowerCase()} (Qalam AI and mixing leave it)`} size="sm" active={locked} onClick={() => update((s) => toggleLock(s, id))}>
        {locked ? <Lock size={12} /> : <LockOpen size={12} className="text-fg-faint" />}
      </IconBtn>
    </div>
  );
}

function MixMenu({ group }: { group: KnobGroup }) {
  const list = useInterview((s) => s.state.directions?.list ?? []);
  const picked = useInterview((s) => s.state.directions?.picked);
  return (
    <Menu
      label={`Take ${group} from`}
      align="end"
      className="w-[220px]"
      trigger={
        <button type="button" className={r.inlineSelect}>
          Mix <ChevronDown size={12} />
        </button>
      }
    >
      <MenuLabel>Take the {group} from</MenuLabel>
      {list.map((d, i) =>
        i === picked ? null : (
          <MenuItem key={i} onSelect={() => update((s) => mix(s, i, group))}>
            {d.name}
          </MenuItem>
        ),
      )}
    </Menu>
  );
}

function Nudge() {
  const [text, setText] = useState("");
  const working = useInterview((s) => !!s.busy);
  const send = async () => {
    const t = text.trim();
    const { state } = interview();
    if (t.length < 2 || !state.read || !state.knobs) return;
    const res = await busy("Adjusting the system", (signal, onProgress) => runNudge(t, state.read!, state.knobs!, state.locks ?? [], { signal, onProgress, sample: state.sample }));
    if (!res) return;
    setText("");
    update((s) => {
      const next = applyKnobs(s, res.knobs, "nudge", `“${t.slice(0, 40)}”`);
      return { ...next, nudges: [...(s.nudges ?? []).slice(-19), { text: t, reply: res.reply, applied: res.applied, at: Date.now() }] };
    });
  };
  return (
    <div className="flex flex-col gap-[6px]">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 400))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        rows={2}
        placeholder="More serious, warmer greys, less busy…"
        aria-label="Tell Qalam AI what to change"
        className="w-full resize-none rounded-md bg-field px-[10px] py-[8px] text-body text-fg outline-none placeholder:text-fg-faint focus:shadow-focus-field"
      />
      <Button variant="secondary" size="sm" className="self-end" disabled={working || text.trim().length < 2} onClick={() => void send()}>
        Adjust
      </Button>
    </div>
  );
}

function Review() {
  const { read, knobs, locks, scenario } = useRefine();
  const review = useInterview((s) => s.state.review);
  const working = useInterview((s) => !!s.busy);
  const run = async () => {
    const { state } = interview();
    const res = await busy("Reviewing the screen", async (signal, onProgress) => {
      const png = await screenPNG(scenario.spec, draftSystem(knobs, read).ds, 1200);
      if (!png) throw new Error("Couldn't draw the screen to review.");
      return runReview(png.data, read, knobs, locks, { signal, onProgress, sample: state.sample });
    });
    if (!res) return;
    const { knobs: suggested, ...rest } = res;
    update((s) => ({ ...s, review: { ...rest, suggested, knobHash: knobHash(knobs), scenario: scenario.label, at: Date.now() } }));
  };
  const stale = review && review.knobHash !== knobHash(knobs);
  return (
    <div className="flex flex-col gap-[8px]">
      <Button variant="secondary" size="sm" className="self-start" disabled={working} onClick={() => void run()}>
        <QalamAIGlyph size={12} /> Review this screen against the brief
      </Button>
      {review && (
        <div className={clsx("flex flex-col gap-[6px] rounded-md px-[10px] py-[8px] text-caption shadow-[inset_0_0_0_1px_var(--color-line-subtle)]", stale && "opacity-60")}>
          <p className="text-fg">{review.summary}</p>
          {review.checks.map((c) => (
            <div key={c.adjective} className="flex items-start gap-[6px]">
              <Tag tone={c.verdict === "reads" ? "success" : c.verdict === "partly" ? "warning" : "danger"}>{c.adjective}</Tag>
              <span className="min-w-0 text-fg-muted">{c.observation}</span>
            </div>
          ))}
          {review.applied.length > 0 && !stale && (
            <Button variant="secondary" size="sm" className="self-start" onClick={() => update((s) => applyKnobs(s, review.suggested, "review", "Qalam AI's review"))}>
              Apply: {review.applied.map((a) => `${KNOB_SPECS[a.knob].label.toLowerCase()} ${a.to}`).join(", ")}
            </Button>
          )}
          {stale && <p className="text-fg-subtle">From an earlier version of the system.</p>}
        </div>
      )}
    </div>
  );
}
