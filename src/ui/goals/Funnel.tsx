import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChartLine, ChevronDown, ChevronRight, ExternalLink, ImagePlus, X } from "lucide-react";
import { callAI } from "@/ai/client";
import { feedback } from "@/commands/feedback";
import { stepRef, type MapFlow, type MapStep, type ProductMap } from "@/code/map";
import type { StepPin, StepView } from "@/code/steps";
import { findQuote } from "@/discovery/quotes";
import { assetURL, putAsset } from "@/doc/assets";
import type { Hit } from "@/connectors/recipes";
import type { FunnelNumbers } from "@/goals/breakdown";
import { funnelDrops } from "@/goals/math";
import type { GoalProblem } from "@/goals/problems";
import type { Goal } from "@/goals/types";
import { orgFetch, orgPath } from "@/org/client";
import { numbersDb } from "@/org/connectors";
import { placeHref, projectHref, topicHref } from "@/projects/model";
import { QalamAIGlyph } from "../brand";
import { Button, IconBtn, Tip } from "../controls";
import { Menu, MenuItem } from "../menu";
import { r } from "../recipes";
import { ago } from "../time";

/**
 * A goal's funnel: the flow in the product's code whose events measure it (hub/maps, read by the
 * code reader), and how many people reach each step, counted by a saved PostHog funnel (code reads
 * the counts from PostHog's own answer). The biggest drop is code's arithmetic. Each step opens on
 * what sits there (src/code/steps.ts): a picture of its screen a person added (a screenshot or a
 * design's frame, never drawn by Qalam AI), the problems pinned to it, and what customers said
 * about it, placed by Qalam AI and kept by code only where the quote's words name the step.
 */

const ICON = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const pct = (r: number) => `${Math.round(r * 100)}%`;
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Pictures larger than this are refused: a screenshot is well under it. */
const PICTURE_MAX = 12 * 1024 * 1024;

interface Placed {
  added: number;
  kept: number;
  removed: number;
  read: number;
}

interface Row {
  label: string;
  step?: MapStep;
  count?: number;
  rate?: number | null;
  biggest?: boolean;
}

export function Funnel({ goal, funnel, numbers, steps, problems, onWork, onChanged }: { goal: Goal; funnel: { map: ProductMap; flow: MapFlow } | null; numbers?: FunnelNumbers; steps: StepView | null; problems: GoalProblem[]; onWork: (p: GoalProblem) => void; onChanged: () => void }) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState(funnel?.flow.name ?? goal.title);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  if (!funnel && !numbers) return null;
  const find = async () => {
    setBusy("Asking PostHog through Claude Code… about a minute");
    setError(null);
    try {
      setHits((await numbersDb.insights(query)).hits);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  const read = async (hit: Hit) => {
    setBusy("Reading the funnel through Claude Code… about a minute");
    setError(null);
    try {
      const got = await numbersDb.read(hit.id);
      if (!got.steps?.length) throw new Error("That insight isn't a funnel: pick a saved funnel.");
      await orgFetch(`/goals/${encodeURIComponent(goal.id)}/funnel`, { method: "PUT", json: { insight: { ref: hit.id, name: got.name ?? hit.title, ...(got.url ?? hit.url ? { url: got.url ?? hit.url } : {}) }, steps: got.steps } });
      setPicking(false);
      setHits(null);
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  const place = async () => {
    setPlacing("Finding what customers said near these steps");
    setPlaced(null);
    try {
      const { data } = await callAI<Placed>(await orgPath(`/goals/${encodeURIComponent(goal.id)}/steps`), {}, undefined, undefined, (e) => {
        if (e.type === "activity") setPlacing(e.label);
      });
      setPlaced(data);
      onChanged();
    } catch (e) {
      feedback(`Qalam AI couldn't finish: ${message(e)}`, { kind: "error", id: "goal.steps" });
    } finally {
      setPlacing(null);
    }
  };
  const pin = async (step: string, what: StepPin["what"], id: string, on: boolean) => {
    await orgFetch("/steps", { method: "POST", json: { step, what, id, on } }).catch((e) => feedback(`Couldn't change it: ${message(e)}`, { kind: "error", id: "goal.step" }));
    onChanged();
  };

  const drops = numbers ? funnelDrops(numbers.steps) : [];
  const top = Math.max(1, ...drops.map((d) => d.count));
  const rows: Row[] = numbers ? drops.map((d) => ({ label: d.label, step: funnel?.flow.steps.find((s) => s.events.includes(d.label)), count: d.count, rate: d.rate, biggest: d.biggest })) : (funnel?.flow.steps ?? []).map((s) => ({ label: s.title, step: s }));
  const refOf = (s: MapStep) => stepRef(funnel!.map.key, s.key);
  const pinsAt = (s: MapStep) => steps?.pins.filter((p) => p.step === refOf(s)) ?? [];
  const worst = drops.find((d) => d.biggest);
  const worstTitle = worst ? (funnel?.flow.steps.find((s) => s.events.includes(worst.label))?.title ?? worst.label) : null;

  return (
    <section aria-labelledby="funnel-title" id="funnel" className="flex scroll-mt-[64px] flex-col gap-[8px]">
      <div className="flex flex-wrap items-end justify-between gap-[12px]">
        <div className="flex flex-col gap-[2px]">
          <h2 id="funnel-title" className="text-title font-medium">
            Funnel
          </h2>
          <p className="text-caption text-fg-subtle">{funnel ? `The steps in the code that measure it: ${funnel.flow.name}, from ${funnel.map.repo}${funnel.map.commit ? ` at ${funnel.map.commit.slice(0, 7)}` : ""}. Open a step for what sits there.` : "How many people reach each step, from PostHog."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          {funnel && (
            <Button variant="secondary" size="sm" disabled={!!placing} onClick={() => void place()}>
              <QalamAIGlyph size={12} /> {placing ? "Reading…" : "Find what customers said"}
            </Button>
          )}
          {!picking && (
            <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
              <ChartLine {...ICON} /> {numbers ? "Read the counts again" : "Read the counts from PostHog"}
            </Button>
          )}
        </div>
      </div>
      {placing && <p className="q-shimmer-text text-caption text-fg-muted">{placing}…</p>}
      {placed && !placing && (
        <p className="text-caption text-fg-muted">
          {!placed.read
            ? "There are no customer quotes to read yet: add interviews or support conversations first."
            : placed.added || placed.removed
              ? `${plural(placed.kept, "quote")} placed at steps${placed.removed ? ` · ${placed.removed} no longer` : ""}, from ${plural(placed.read, "quote")} read.`
              : placed.kept
                ? "Nothing new: the same quotes are about the same steps."
                : `Qalam AI read ${plural(placed.read, "quote")} and none is clearly about one step.`}
        </p>
      )}
      <ol className="flex flex-col rounded-lg bg-panel py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
        {rows.map((row, i) => {
          const at = row.step ? pinsAt(row.step) : [];
          const key = row.step ? refOf(row.step) : `${row.label}:${i}`;
          return (
            <StepRow
              key={key}
              n={i + 1}
              row={row}
              top={top}
              counted={!!numbers}
              pins={at}
              quotes={steps?.quotes ?? {}}
              problems={problems}
              open={open === key}
              onToggle={() => setOpen((o) => (o === key ? null : key))}
              onPin={(what, id, on) => row.step && void pin(refOf(row.step), what, id, on)}
              onWork={onWork}
            />
          );
        })}
      </ol>
      {numbers && (
        <span className="flex flex-wrap items-center gap-[6px] text-micro text-fg-subtle">
          {worstTitle && <span className="text-warning">The biggest drop is at “{worstTitle}”.</span>}
          PostHog · {numbers.insight.name} · read {ago(numbers.at)}
          {numbers.insight.url && (
            <a href={numbers.insight.url} target="_blank" rel="noreferrer" aria-label="Open it in PostHog" className={r.iconButtonSm}>
              <ExternalLink {...ICON} />
            </a>
          )}
        </span>
      )}
      {picking && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void find();
          }}
          className="flex flex-col gap-[6px] rounded-lg bg-panel px-[14px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]"
        >
          <span className="flex items-center gap-[6px]">
            <span className={clsx(r.field, "flex-1")}>
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A saved funnel's name" aria-label="Search PostHog's insights" className={r.fieldInput} />
            </span>
            <Button type="submit" size="sm" variant="secondary" disabled={!!busy}>
              Find
            </Button>
            <IconBtn size="sm" label="Cancel" onClick={() => (setPicking(false), setHits(null))}>
              <X {...ICON} />
            </IconBtn>
          </span>
          {hits?.map((h) => (
            <button key={h.id} type="button" disabled={!!busy} onClick={() => void read(h)} className="q-item flex flex-col items-start rounded-md px-[6px] py-[4px] text-left hover:bg-hover">
              <span className="truncate text-caption text-fg">{h.title}</span>
              {h.snippet && <span className="truncate text-micro text-fg-subtle">{h.snippet}</span>}
            </button>
          ))}
          {hits && !hits.length && <p className="text-micro text-fg-subtle">No saved insight by that name.</p>}
          {busy && <p className="q-shimmer-text text-micro text-fg-muted">{busy}</p>}
          {error && (
            <p className="text-micro text-danger">
              {error}{" "}
              {/Connections/.test(error) && (
                <a href={placeHref("connections")} className="underline">
                  Open Connections
                </a>
              )}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

/** One step: its number, its screen's picture, its title, how many reach it, and what's pinned there. */
function StepRow({ n, row, top, counted, pins, quotes, problems, open, onToggle, onPin, onWork }: { n: number; row: Row; top: number; counted: boolean; pins: StepPin[]; quotes: StepView["quotes"]; problems: GoalProblem[]; open: boolean; onToggle: () => void; onPin: (what: StepPin["what"], id: string, on: boolean) => void; onWork: (p: GoalProblem) => void }) {
  const picture = pins.find((p) => p.what === "picture");
  const here = pins.flatMap((p) => (p.what === "need" ? (problems.find((x) => x.topic === p.id) ?? []) : []));
  const said = pins.filter((p) => p.what === "quote");
  const s = row.step;
  const what = [here.length ? plural(here.length, "problem") : null, said.length ? plural(said.length, "quote") : null].filter(Boolean).join(" · ");
  const head = (
    <>
      <span className="text-caption text-fg-subtle tnum">{n}</span>
      <Thumb src={picture?.id} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body text-fg">{s?.title ?? row.label}</span>
        <span className="flex min-w-0 items-center gap-[6px] overflow-hidden text-micro">
          {s ? <span className="min-w-0 shrink-[4] truncate font-mono text-fg-subtle">{s.file}</span> : <span className="min-w-0 truncate text-fg-subtle">Not a step in the code</span>}
          {what && <span className="min-w-0 truncate text-fg-muted">· {what}</span>}
          {row.biggest && !here.length && <span className="min-w-0 truncate text-warning">· No problem pinned here</span>}
        </span>
      </span>
      {counted ? (
        <>
          <span className="relative block h-[6px] overflow-hidden rounded-full bg-active" aria-hidden>
            <span className={clsx("absolute inset-y-0 left-0 rounded-full", row.biggest ? "bg-warning" : "bg-fg-muted")} style={{ width: `${(100 * (row.count ?? 0)) / top}%` }} />
          </span>
          <span className={clsx("text-right text-caption tnum", row.biggest ? "text-warning" : "text-fg-muted")}>
            {(row.count ?? 0).toLocaleString("en-US")}
            {row.rate !== null && row.rate !== undefined && ` · ${pct(row.rate)}`}
          </span>
        </>
      ) : (
        <span className="truncate text-right font-mono text-micro text-fg-muted">{s?.events.join(", ") || "sends no event"}</span>
      )}
      <span className="text-fg-subtle">{s && (open ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />)}</span>
    </>
  );
  const grid = clsx("grid w-full items-center gap-x-[10px] px-[14px] py-[6px] text-left", counted ? "grid-cols-[20px_24px_minmax(0,1fr)_minmax(80px,200px)_96px_12px]" : "grid-cols-[20px_24px_minmax(0,1fr)_minmax(0,200px)_12px]", "max-[640px]:grid-cols-[20px_24px_minmax(0,1fr)_96px_12px] max-[640px]:[&>.relative]:hidden");
  return (
    <li className={clsx(open && "bg-hover/40")}>
      {s ? (
        <button type="button" aria-expanded={open} onClick={onToggle} className={clsx(grid, "q-item rounded-md hover:bg-hover")}>
          {head}
        </button>
      ) : (
        <div className={grid}>{head}</div>
      )}
      {s && open && <StepDetail step={s} picture={picture?.id} here={here} said={said} quotes={quotes} problems={problems} onPin={onPin} onWork={onWork} />}
    </li>
  );
}

/** What sits at a step: its screen's picture, the problems pinned there, what customers said about it, and where it is in the code. */
function StepDetail({ step, picture, here, said, quotes, problems, onPin, onWork }: { step: MapStep; picture?: string; here: GoalProblem[]; said: StepPin[]; quotes: StepView["quotes"]; problems: GoalProblem[]; onPin: (what: StepPin["what"], id: string, on: boolean) => void; onWork: (p: GoalProblem) => void }) {
  const others = problems.filter((p) => !here.includes(p));
  return (
    <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-[16px] px-[14px] pt-[4px] pb-[14px] pl-[44px] max-[640px]:grid-cols-1 max-[640px]:pl-[14px]">
      <Picture src={picture} onAdd={(id) => onPin("picture", id, true)} onRemove={() => picture && onPin("picture", picture, false)} />
      <div className="flex min-w-0 flex-col gap-[14px]">
        <Part
          title="Problems here"
          action={
            others.length ? (
              <Menu
                label="Pin a problem here"
                align="end"
                className="max-h-[320px] w-[300px] overflow-y-auto"
                trigger={
                  <button type="button" className={clsx(r.buttonSm, r.buttonGhost)}>
                    Pin a problem…
                  </button>
                }
              >
                {others.map((p) => (
                  <MenuItem key={p.topic} onSelect={() => onPin("need", p.topic, true)}>
                    <span className="truncate">{p.title}</span>
                  </MenuItem>
                ))}
              </Menu>
            ) : null
          }
        >
          {here.length ? (
            <ul className="flex flex-col">
              {here.map((p) => {
                const on = p.onBoard ? p.boards[0] : undefined;
                return (
                  <li key={p.topic} className="group/pin flex min-h-[28px] items-center gap-[8px]">
                    <a href={topicHref(p.topic)} className="min-w-0 flex-1 truncate text-body text-fg hover:underline">
                      {p.title}
                    </a>
                    {on ? (
                      <a href={`${projectHref({ id: on.board, type: "discovery" })}?card=${encodeURIComponent(on.card)}`} className="shrink-0 text-caption text-fg-muted hover:text-fg hover:underline">
                        On its board
                      </a>
                    ) : (
                      <button type="button" onClick={() => onWork(p)} className={clsx(r.buttonSm, r.buttonSecondary, "shrink-0")}>
                        Work on it
                      </button>
                    )}
                    <Tip label="Not at this step">
                      <button type="button" aria-label="Not at this step" onClick={() => onPin("need", p.topic, false)} className={clsx(r.iconButtonSm, "opacity-0 group-hover/pin:opacity-100 focus-visible:opacity-100")}>
                        <X {...ICON} />
                      </button>
                    </Tip>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-caption text-fg-subtle">{problems.length ? "No problem pinned here yet. Pin the one that explains what happens at this step." : "Link problems to the goal first, then pin them to the step they happen at."}</p>
          )}
        </Part>
        <Part title="What customers said here">
          {said.length ? (
            <ul className="flex flex-col gap-[8px]">
              {said.map((p) => (
                <li key={p.id} className="group/pin flex items-start gap-[8px]">
                  {p.by === "qalam" && <QalamAIGlyph size={12} className="mt-[3px] shrink-0" />}
                  <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    <Said text={quotes[p.id]?.text} words={p.words} />
                    {quotes[p.id]?.who && <span className="text-micro text-fg-subtle">{quotes[p.id]!.who}</span>}
                  </span>
                  <Tip label="Not about this step">
                    <button type="button" aria-label="Not about this step" onClick={() => onPin("quote", p.id, false)} className={clsx(r.iconButtonSm, "opacity-0 group-hover/pin:opacity-100 focus-visible:opacity-100")}>
                      <X {...ICON} />
                    </button>
                  </Tip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-caption text-fg-subtle">Nothing placed here yet. “Find what customers said” has Qalam AI read the quotes against the steps; it keeps one only where the quote names this step.</p>
          )}
        </Part>
        <Part title="In the code">
          <span className="flex min-w-0 flex-col gap-[2px] font-mono text-micro">
            <span className="truncate text-fg-muted">{step.file}</span>
            <span className="truncate text-fg-subtle">{step.snippet}</span>
            {!!step.events.length && <span className="truncate text-fg-subtle">sends {step.events.join(", ")}</span>}
          </span>
        </Part>
      </div>
    </div>
  );
}

function Part({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex min-h-[24px] items-center justify-between gap-[8px]">
        <h3 className="text-caption font-medium text-fg-muted">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A quote, with the words that put it at the step marked (or just those words, when the quote's text isn't here). */
function Said({ text, words }: { text?: string; words?: string }) {
  const span = text && words ? findQuote(text, words)?.span : null;
  if (!text) return <span className="text-body text-fg">“{words}”</span>;
  if (!span) return <span className="text-body text-fg">“{text}”</span>;
  return (
    <span className="text-body text-fg">
      “{text.slice(0, span[0])}
      <mark className="rounded-[2px] bg-active px-[1px] text-fg">{text.slice(span[0], span[1])}</mark>
      {text.slice(span[1])}”
    </span>
  );
}

function useAsset(src?: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (src) void assetURL(src).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [src]);
  return url;
}

function Thumb({ src }: { src?: string }) {
  const url = useAsset(src);
  return url ? <img src={url} alt="" className="h-[32px] w-[24px] rounded-[3px] object-cover object-top shadow-[0_0_0_1px_var(--color-line-subtle)]" /> : <span aria-hidden className="h-[32px] w-[24px] rounded-[3px] bg-active" />;
}

/** The screen's picture: added by a person (picked, dropped or pasted), never drawn by Qalam AI. */
function Picture({ src, onAdd, onRemove }: { src?: string; onAdd: (id: string) => void; onRemove: () => void }) {
  const url = useAsset(src);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const take = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return feedback("That isn't a picture: add a screenshot or an exported frame.", { kind: "error", id: "goal.picture" });
    if (file.size > PICTURE_MAX) return feedback("That picture is too large: export it under 12 MB.", { kind: "error", id: "goal.picture" });
    setSaving(true);
    try {
      onAdd(await putAsset(file));
    } catch (e) {
      feedback(`Couldn't keep the picture: ${message(e)}`, { kind: "error", id: "goal.picture" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      tabIndex={-1}
      onPaste={(e) => {
        const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
        if (file) (e.preventDefault(), void take(file));
      }}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void take(e.dataTransfer.files[0]);
      }}
      className="flex flex-col gap-[6px] outline-none max-[640px]:max-w-[220px]"
    >
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => (void take(e.target.files?.[0]), (e.target.value = ""))} />
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" aria-label="Open the picture" className="block overflow-hidden rounded-md shadow-[0_0_0_1px_var(--color-line-subtle)]">
          <img src={url} alt="The step's screen" className="max-h-[360px] w-full object-contain object-top" />
        </a>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={clsx("q-item flex aspect-[9/16] w-full flex-col items-center justify-center gap-[6px] rounded-md px-[12px] text-center shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover", over && "bg-hover")}
        >
          <ImagePlus size={16} absoluteStrokeWidth strokeWidth={1.25} className="text-fg-subtle" />
          <span className="text-caption text-fg-muted">{saving ? "Keeping it…" : "Add the screen"}</span>
          <span className="text-micro text-fg-subtle">A screenshot or a design&apos;s frame: pick, drop or paste it</span>
        </button>
      )}
      {url && (
        <span className="flex items-center gap-[4px]">
          <button type="button" onClick={() => input.current?.click()} className={clsx(r.buttonSm, r.buttonGhost, "-ml-[8px]")}>
            {saving ? "Keeping it…" : "Replace"}
          </button>
          <button type="button" onClick={onRemove} className={clsx(r.buttonSm, r.buttonGhost)}>
            Take it off
          </button>
        </span>
      )}
    </div>
  );
}
