import clsx from "clsx";
import { Check, LoaderCircle, X } from "lucide-react";
import { create } from "zustand";
import { AIError } from "@/ai/client";
import { askText } from "@/proto/asks";
import { RECIPE_NAMES } from "@/proto/recipes";
import { QalamAIGlyph } from "../../brand/ai-glyph";
import { Button, Checkbox } from "../../controls";
import { r } from "../../recipes";
import { usePrototypeMode } from "../store";
import { build, propose, settle, type BuildReport, type Proposal } from "./agent";

/*
 * Qalam AI in the session: it proposes what to prototype on the screen — every step code can
 * build there, picked, ordered and worded, the recommended ones ticked — the designer picks and
 * adds their own ask, and Build makes it: each step checked, kept or left out with why. It lives
 * in a store, not the panel, so a build (which recompiles the prototype) doesn't lose it.
 */

export type AgentState =
  | { phase: "idle" }
  | { phase: "proposing"; tokens: number }
  | { phase: "proposed"; proposal: Proposal; ask: string }
  | { phase: "building"; proposal: Proposal; tokens: number }
  | { phase: "built"; proposal: Proposal; report: BuildReport }
  | { phase: "failed"; error: string; from: "propose" | "build"; proposal?: Proposal; ask: string };

export const useAgent = create<{ screen: string | null; state: AgentState; ask: string }>(() => ({ screen: null, state: { phase: "idle" }, ask: "" }));
let running: AbortController | null = null;

const set = (screen: string, state: AgentState) => useAgent.setState({ screen, state });
const message = (e: unknown) => (e instanceof AIError ? e.message : e instanceof Error ? e.message : String(e));

/** Ask Qalam AI what to prototype on the screen (with what the designer asked for). */
export async function startPropose(screen: string, doc: Parameters<typeof propose>[0], ask: string) {
  running?.abort();
  const ctl = new AbortController();
  running = ctl;
  set(screen, { phase: "proposing", tokens: 0 });
  try {
    const proposal = await propose(doc, screen, ask, ctl.signal, (tokens) => useAgent.getState().state.phase === "proposing" && set(screen, { phase: "proposing", tokens }));
    if (running === ctl) set(screen, { phase: "proposed", proposal, ask });
  } catch (e) {
    if ((e as Error).name === "AbortError") return set(screen, { phase: "idle" });
    if (running === ctl) set(screen, { phase: "failed", error: message(e), from: "propose", ask });
  } finally {
    if (running === ctl) running = null;
  }
}

/** Build what's ticked; the prototype compiles again with it. */
export async function startBuild(screen: string, proposal: Proposal) {
  running?.abort();
  const ctl = new AbortController();
  running = ctl;
  set(screen, { phase: "building", proposal, tokens: 0 });
  try {
    const report = await build(screen, proposal, ctl.signal, (tokens) => useAgent.getState().state.phase === "building" && set(screen, { phase: "building", proposal, tokens }));
    if (running !== ctl) return;
    set(screen, { phase: "built", proposal, report });
    usePrototypeMode.setState((s) => ({ version: s.version + 1 }));
  } catch (e) {
    if ((e as Error).name === "AbortError") return set(screen, { phase: "proposed", proposal, ask: useAgent.getState().ask });
    if (running === ctl) set(screen, { phase: "failed", error: message(e), from: "build", proposal, ask: useAgent.getState().ask });
  } finally {
    if (running === ctl) running = null;
  }
}

export const stopAgent = () => running?.abort();

/** A proposal as listed (and numbered on the device): what Qalam AI proposed, then what's also possible. */
export const listed = (p: Proposal) => [...p.steps.filter((s) => s.proposed), ...p.steps.filter((s) => !s.proposed)];

/** Tick or untick a proposed step (from its row, or its marker on the device). */
export function tickStep(screen: string, id: string, v?: boolean) {
  const { state, ask } = useAgent.getState();
  if (state.phase !== "proposed") return;
  const steps = state.proposal.steps.map((s) => (s.candidate.id === id ? { ...s, ticked: v ?? !s.ticked } : s));
  set(screen, { phase: "proposed", ask, proposal: { ...state.proposal, steps: settle(steps, id) } });
}
export const closeAgent = () => {
  running?.abort();
  useAgent.setState({ state: { phase: "idle" }, ask: "" });
};

const Spin = () => <LoaderCircle size={14} className="animate-spin text-fg-subtle" aria-hidden />;

/** The agent's part of the steps panel, while it's at work for `screen`; rows hover with their markers. */
export function AgentView({ screen, doc, hover, onHover }: { screen: string; doc: Parameters<typeof propose>[0]; hover: number | null; onHover: (i: number | null) => void }) {
  const { state, ask, screen: on } = useAgent();
  if (on !== screen || state.phase === "idle") return null;

  if (state.phase === "proposing" || state.phase === "building") {
    const label = state.phase === "proposing" ? "Qalam AI is reading the screen" : "Building what you picked";
    return (
      <div className="flex flex-col gap-[10px] px-[16px] pb-[12px]">
        <p className="flex items-center gap-[8px] text-body text-fg">
          <Spin /> {label}…{state.tokens > 0 && <span className="text-caption text-fg-subtle">{state.tokens.toLocaleString()} tokens</span>}
        </p>
        {state.phase === "building" && (
          <ul className="flex flex-col gap-[6px]">
            {state.proposal.steps
              .filter((s) => s.ticked)
              .map((s) => (
                <li key={s.candidate.id} className="flex items-start gap-[8px] text-caption text-fg-muted">
                  <span className="mt-px">
                    <Spin />
                  </span>
                  {s.label}
                </li>
              ))}
          </ul>
        )}
        <Button variant="secondary" size="sm" onClick={stopAgent}>
          Stop
        </Button>
      </div>
    );
  }

  if (state.phase === "failed") {
    return (
      <div className="flex flex-col gap-[8px] px-[16px] pb-[12px]">
        <p className="text-caption text-danger">{state.error}</p>
        <div className="flex gap-[6px]">
          <Button size="sm" onClick={() => (state.from === "build" && state.proposal ? void startBuild(screen, state.proposal) : void startPropose(screen, doc, state.ask))}>
            Try again
          </Button>
          <Button variant="ghost" size="sm" onClick={closeAgent}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  if (state.phase === "built") {
    const kept = state.report.results.filter((x) => x.ok).length;
    const left = state.report.results.filter((x) => !x.ok);
    return (
      <div className="flex flex-col gap-[8px] px-[16px] pb-[12px]">
        <p className="text-body text-fg">
          Built {kept} of {state.report.results.length} {state.report.results.length === 1 ? "step" : "steps"}
          {state.report.by === "model" ? "" : " with parts code wrote"}.
        </p>
        {left.map((x) => {
          const s = state.proposal.steps.find((p) => p.candidate.id === x.id);
          return (
            <p key={x.id} className="flex items-start gap-[6px] text-caption text-fg-muted">
              <X size={14} className="mt-px shrink-0 text-danger" aria-hidden /> <span>{s?.label ?? x.id}: {x.issues[0]}</span>
            </p>
          );
        })}
        <Button variant="secondary" size="sm" onClick={closeAgent}>
          Done
        </Button>
      </div>
    );
  }

  // Proposed: pick what to build, ask for more. Rows are numbered like their markers on the device.
  const { proposal } = state;
  const picked = proposal.steps.filter((s) => s.ticked).length;
  const all = listed(proposal);
  const main = all.filter((s) => s.proposed);
  const more = all.filter((s) => !s.proposed);
  const row = (s: Proposal["steps"][number]) => {
    const i = all.indexOf(s);
    return (
      <li key={s.candidate.id} className={clsx("flex gap-[8px] rounded-md px-[4px] py-[6px]", hover === i ? "bg-hover" : "hover:bg-hover")} onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)}>
        <span className={clsx("mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-full text-micro font-semibold", s.ticked ? "bg-selection text-white" : "border border-selection text-selection")}>{i + 1}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <Checkbox checked={s.ticked} onChange={(v) => tickStep(screen, s.candidate.id, v)} label={<span className="text-body text-fg">{s.label}</span>} />
          {s.why && <p className="pl-[28px] text-caption text-fg-subtle">{s.why}</p>}
          {s.plan && (
            <p className="pl-[28px] text-caption text-fg-muted">
              {s.candidate.recipe === "nextPage" ? "Shows" : "Holds"}: {s.plan}
            </p>
          )}
          <p className="pl-[28px] text-micro text-fg-faint">
            {RECIPE_NAMES[s.candidate.recipe] ?? s.candidate.recipe}
            {s.candidate.needs ? ` · adds a ${s.candidate.needs.kind}` : ""}
            {s.candidate.recipe === "nextPage" && s.candidate.opts?.name ? ` · ${s.candidate.opts.name}, not designed yet` : ""}
          </p>
        </div>
      </li>
    );
  };
  return (
    <div className="flex min-h-0 flex-col gap-[10px] px-[12px] pb-[12px]">
      <p className="flex items-center gap-[6px] px-[4px] text-caption text-fg-subtle">
        <QalamAIGlyph size={14} /> {proposal.by === "model" ? "Qalam AI proposes" : "What can be built here"}
      </p>
      {proposal.steps.length ? (
        <ol className="flex flex-col gap-[2px]">{main.map(row)}</ol>
      ) : (
        <p className="px-[4px] text-caption text-fg-muted">Nothing on this screen can be prototyped yet: no taps, picks or scrolling the recipes know.</p>
      )}
      {more.length > 0 && (
        <>
          <p className="px-[4px] text-micro text-fg-subtle">Also possible</p>
          <ol className="flex flex-col gap-[2px]">{more.map(row)}</ol>
        </>
      )}
      {proposal.asks.length > 0 && (
        <div className="flex flex-col gap-[4px] px-[4px]">
          <p className="text-micro text-fg-subtle">Not built yet</p>
          {proposal.asks.map((a, i) => (
            <p key={i} className="text-caption text-fg-muted">
              <span className="text-fg">{a.label}</span> — {a.reason}
            </p>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-[6px] px-[4px]">
        <textarea
          className={clsx(r.textarea, "min-h-[56px] w-full resize-none text-caption")}
          placeholder="Ask for something else (a toast when an item's added, a sheet for filters…)"
          value={ask}
          onChange={(e) => useAgent.setState({ ask: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {ask.trim() && (
          <Button variant="secondary" size="sm" className="self-end" onClick={() => void startPropose(screen, doc, askText(doc.proto?.routes?.[screen], ask))}>
            <QalamAIGlyph size={14} /> Propose again
          </Button>
        )}
      </div>
      <div className="flex gap-[6px] px-[4px]">
        <Button size="sm" onClick={() => void startBuild(screen, proposal)} disabled={!picked}>
          <Check size={14} aria-hidden /> Build {picked} {picked === 1 ? "step" : "steps"}
        </Button>
        <Button variant="ghost" size="sm" onClick={closeAgent}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
