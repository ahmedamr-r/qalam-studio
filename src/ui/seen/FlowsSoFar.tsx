import clsx from "clsx";
import { Check, Code2, Route, X } from "lucide-react";
import { Button, Tip } from "../controls";
import { Panel } from "../chat/Panels";
import { decide, decideStep, settle, useSeen } from "./client";
import { FlowStrip } from "./FlowStrip";
import { Shot } from "./Shot";
import { offered } from "./thread";

/*
 * "{Product} so far": the flows Qalam AI proposes, drawn as rows of screens, each accepted or
 * discarded here; the screens in no flow yet; the code steps it thinks screens show. Adding them
 * puts what's accepted in the product's map (every screen read is kept, flows or not).
 */

const ICON = { strokeWidth: 1.5, absoluteStrokeWidth: true } as const;
const card = "relative overflow-hidden rounded-lg bg-raised shadow-[inset_0_0_0_1px_var(--color-line-subtle)] before:absolute before:inset-y-0 before:left-0 before:w-[3px]";
const EDGE = { proposed: "before:bg-ai", accepted: "before:bg-success", discarded: "before:bg-transparent opacity-55" } as const;

function Settle({ state, onAccept, onDiscard }: { state: keyof typeof EDGE; onAccept: () => void; onDiscard: () => void }) {
  return (
    <span className="flex shrink-0 items-center gap-[4px]">
      <Tip label="Discard">
        <button type="button" aria-label="Discard" aria-pressed={state === "discarded"} onClick={onDiscard} className={clsx("q-item grid size-[26px] place-items-center rounded-md shadow-[inset_0_0_0_1px_var(--color-line)]", state === "discarded" ? "bg-danger-subtle text-danger" : "text-fg-subtle hover:bg-danger-subtle hover:text-danger")}>
          <X size={14} {...ICON} />
        </button>
      </Tip>
      <Tip label="Accept">
        <button type="button" aria-label="Accept" aria-pressed={state === "accepted"} onClick={onAccept} className={clsx("q-item grid size-[26px] place-items-center rounded-md", state === "accepted" ? "bg-success text-app" : "bg-success-subtle text-success hover:bg-success hover:text-app")}>
          <Check size={14} strokeWidth={2} />
        </button>
      </Tip>
    </span>
  );
}

export function FlowsSoFar({ productName }: { productName: string }) {
  const view = useSeen((s) => s.view);
  const decided = useSeen((s) => s.decided);
  const stepsDecided = useSeen((s) => s.steps);
  const busy = useSeen((s) => s.busy);
  const r = view?.reading ?? null;
  const proposal = r?.proposal;
  const shown = proposal ?? view?.map ?? null;
  const screens = new Map((shown?.screens ?? []).map((s) => [s.key, s]));
  const flows = proposal ? offered(r, view?.map ?? null) : (view?.map?.flows ?? []);
  const placed = new Set((shown?.flows ?? []).flatMap((f) => f.steps));
  const loose = (shown?.screens ?? []).filter((s) => !placed.has(s.key));
  const steps = Object.entries(r?.steps ?? {});
  const reviewing = r?.phase === "review" && !!proposal;
  const open = flows.filter((f) => !decided[f.key]).length;
  return (
    <Panel
      title={`${productName} so far`}
      actions={
        reviewing && open > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => flows.forEach((f) => !decided[f.key] && decide(f.key, "accepted"))}>
            Accept all · {open}
          </Button>
        ) : null
      }
      body={false}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto p-[14px]">
        {!shown && <p className="text-caption text-fg-subtle">The flows show here as Qalam AI places the screenshots.</p>}
        {flows.length > 0 && (
          <section className="flex flex-col gap-[8px]">
            <h3 className="flex items-center gap-[6px] text-caption font-semibold text-fg">
              <Route size={13} {...ICON} /> Flows <span className="font-normal text-fg-subtle tnum">{flows.length}</span>
            </h3>
            {flows.map((f) => {
              const state = proposal ? (decided[f.key] ?? "proposed") : "accepted";
              return (
                <div key={f.key} className={clsx(card, EDGE[state], "flex flex-col gap-[8px] py-[10px] pl-[12px] pr-[10px]")}>
                  <div className="flex items-start gap-[8px]">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={clsx("text-body font-medium text-fg", state === "discarded" && "line-through")} dir="auto">
                        {f.name}
                      </span>
                      {f.aim && (
                        <span className="text-caption text-fg-muted" dir="auto">
                          {f.aim}
                        </span>
                      )}
                    </span>
                    {reviewing && <Settle state={state} onAccept={() => decide(f.key, "accepted")} onDiscard={() => decide(f.key, "discarded")} />}
                  </div>
                  <FlowStrip flow={f} screens={screens} w={44} />
                  {f.notShown.length > 0 && <p className="text-caption text-fg-subtle">Not shown yet: {f.notShown.join("; ")}</p>}
                </div>
              );
            })}
          </section>
        )}
        {steps.length > 0 && (
          <section className="flex flex-col gap-[8px]">
            <h3 className="flex items-center gap-[6px] text-caption font-semibold text-fg">
              <Code2 size={13} {...ICON} /> Steps in the code
            </h3>
            {steps.map(([screen, step]) => {
              const s = screens.get(screen);
              const state = stepsDecided[screen] ?? "proposed";
              return (
                <div key={screen} className={clsx(card, EDGE[state], "flex items-center gap-[8px] py-[8px] pl-[12px] pr-[10px]")}>
                  {s && <Shot shot={s.shots[0]} label={s.name} w={28} />}
                  <span className="min-w-0 flex-1 text-caption text-fg" dir="auto">
                    {s?.name ?? screen} shows the step <span className="font-mono text-micro text-fg-muted">{step.split("/").pop()}</span>, so it can be its picture on the goal's funnel
                  </span>
                  {reviewing && <Settle state={state} onAccept={() => decideStep(screen, "accepted")} onDiscard={() => decideStep(screen, "discarded")} />}
                </div>
              );
            })}
          </section>
        )}
        {loose.length > 0 && (
          <section className="flex flex-col gap-[8px]">
            <h3 className="text-caption font-semibold text-fg">
              Not in a flow yet <span className="font-normal text-fg-subtle tnum">{loose.length}</span>
            </h3>
            <div className="flex flex-wrap gap-[6px]">
              {loose.map((s) => (
                <Shot key={s.key} shot={s.shots[0]} label={s.name} w={40} />
              ))}
            </div>
          </section>
        )}
      </div>
      {reviewing && (
        <footer className="flex items-center gap-[8px] border-t border-line-subtle px-[14px] py-[10px]">
          <span className="min-w-0 flex-1 truncate text-caption text-fg-subtle">{open ? `${open} still to accept or discard` : "Ready to add"}</span>
          <Button size="sm" disabled={busy} onClick={() => void settle()}>
            {busy ? "Adding…" : `Add to ${productName}`}
          </Button>
        </footer>
      )}
    </Panel>
  );
}
