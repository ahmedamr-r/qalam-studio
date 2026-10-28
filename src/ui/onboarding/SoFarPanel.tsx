import { useState } from "react";
import clsx from "clsx";
import { Check, ChevronRight, Star, Target, X } from "lucide-react";
import { useGoals } from "@/goals/client";
import { useOrgContext } from "@/org/context";
import { ConnectorLogo } from "../brand/ConnectorLogo";
import { Button, IconBtn, Tag } from "../controls";
import { qr } from "../ai/Questionnaire";
import { Panel, useWide, WIDE } from "../chat/Panels";
import { dropKnown, useKnow } from "../setup/know";
import { acceptLines, discardLines, useSetup } from "../setup/setup";
import { StatusDot } from "../viz";
import { openSoFar, useFirstRun } from "./flow";
import { soFarOf, type GoalRow, type LineRow, type RestsOn } from "./soFar";

/*
 * "{Org} so far": the goals as one tree, then the About and each product, filling in as the
 * conversation goes. Qalam AI's proposals are settled here, line by line or all at once, so the
 * chat stays short; the goals they wrote can be left out here before they're added.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

function Rests({ rests }: { rests?: RestsOn }) {
  const n = (rests?.quotes.length ?? 0) + (rests?.answers.length ?? 0);
  if (!rests || !n) return null;
  return (
    <details className="group/rests text-caption text-fg-subtle">
      <summary className="flex cursor-pointer list-none items-center gap-[4px] hover:text-fg-muted [&::-webkit-details-marker]:hidden">
        <ChevronRight size={11} {...ICON} className="transition-transform duration-fast group-open/rests:rotate-90" />
        Rests on {n === 1 ? "1 thing you said" : `${n} things you said`}
      </summary>
      <div className="flex flex-col gap-[2px] pl-[15px] pt-[2px]">
        {rests.quotes.map((q, i) => (
          <p key={`q${i}`} className="line-clamp-3" dir="auto">
            “{q}”
          </p>
        ))}
        {rests.answers.map((a, i) => (
          <p key={`a${i}`} className="line-clamp-3" dir="auto">
            {a.question}: {a.answer}
          </p>
        ))}
      </div>
    </details>
  );
}

function Settle({ id, state, working, act }: { id: string; state: LineRow["state"]; working: boolean; act: (fn: () => Promise<void>) => void }) {
  if (state === "accepted")
    return (
      <span className="inline-flex h-[22px] shrink-0 items-center gap-[4px] text-caption text-success">
        <Check size={12} strokeWidth={2} />
      </span>
    );
  if (state === "discarded") return <span className="inline-flex h-[22px] shrink-0 items-center text-caption text-fg-subtle">Discarded</span>;
  if (state !== "proposed") return null;
  return (
    <span className="flex shrink-0 items-center gap-[2px]">
      <button type="button" disabled={working} className={qr.textBtn} onClick={() => act(() => discardLines([id]))}>
        Discard
      </button>
      <Button size="sm" variant="secondary" disabled={working} onClick={() => act(() => acceptLines([id]))}>
        Accept
      </Button>
    </span>
  );
}

function Goal({ g, mine, working, act }: { g: GoalRow; mine: boolean; working: boolean; act: (fn: () => Promise<void>) => void }) {
  return (
    <li className={clsx("group/goal flex flex-col gap-[2px] py-[6px] pr-[10px]", g.state === "discarded" && "opacity-55")} style={{ paddingLeft: 12 + Math.min(g.depth, 4) * 16 }}>
      <div className="flex items-start gap-[8px]">
        <span className={clsx("pt-[3px]", g.north ? "text-fg" : "text-fg-subtle")}>{g.north ? <Star size={13} {...ICON} /> : <Target size={13} {...ICON} />}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={clsx("text-body leading-[20px] text-fg", g.state === "discarded" && "line-through")} dir="auto">
            {g.title}
          </span>
          <span className="flex items-center gap-[6px] text-caption text-fg-muted tnum">
            {mine && <StatusDot tone="on" />}
            {[mine ? "Yours" : null, g.detail || null].filter(Boolean).join(" · ")}
          </span>
        </span>
        {g.lineId && <Settle id={g.lineId} state={g.state} working={working} act={act} />}
        {g.ref && (
          <IconBtn size="sm" label="Leave it out" onClick={() => dropKnown(g.ref!)}>
            <X size={13} {...ICON} />
          </IconBtn>
        )}
      </div>
      <div className="pl-[21px]">
        <Rests rests={g.rests} />
      </div>
    </li>
  );
}

export function SoFar() {
  const org = useFirstRun((s) => s.org);
  const naming = useFirstRun((s) => s.naming);
  const picked = useFirstRun((s) => s.picked);
  const tools = useFirstRun((s) => s.tools);
  const source = useSetup((s) => s.source);
  const know = useKnow();
  const goals = useGoals();
  const { about, products } = useOrgContext();
  const wide = useWide(WIDE);
  const [working, setWorking] = useState(false);
  const act = (fn: () => Promise<void>) => {
    if (working) return;
    setWorking(true);
    void fn().finally(() => setWorking(false));
  };
  const name = org?.name ?? naming.name ?? "Your organization";
  const v = soFarOf({ org: name, session: source?.setup ?? null, quotes: source?.quotes ?? [], products, know: { phase: know.phase, goals: know.goals }, tree: goals, about });
  const mine = new Set(picked ?? goals.mine);
  const connected = (tools ?? []).filter((t) => t.tone === "ok");
  return (
    <Panel
      title={`${name} so far`}
      actions={
        <>
          {v.open.length > 0 && (
            <Button size="sm" disabled={working} onClick={() => act(() => acceptLines(v.open))}>
              Accept all · {v.open.length}
            </Button>
          )}
          {!wide && (
            <IconBtn size="sm" label="Close" onClick={() => openSoFar(false)}>
              <X size={14} {...ICON} />
            </IconBtn>
          )}
        </>
      }
    >
      {v.from === "none" && !connected.length ? (
        <p className="px-[14px] py-[16px] text-caption text-fg-subtle">{org ? "Goals, About and products show here as Qalam AI finds them." : "Your organization shows here once it has a name."}</p>
      ) : (
        <div className="flex flex-col gap-[14px] py-[10px]">
          {v.goals.length > 0 && (
            <section aria-label="Goals" className="flex flex-col">
              <h3 className="flex items-center gap-[6px] px-[14px] pb-[2px] text-micro font-medium text-fg-subtle">
                Goals {v.from === "proposal" && v.open.length > 0 && <Tag tone="ai">Proposed</Tag>}
                {v.from === "know" && <Tag>Not added yet</Tag>}
              </h3>
              <ul className="flex flex-col">
                {v.goals.map((g) => (
                  <Goal key={g.key} g={g} mine={!!g.goalId && mine.has(g.goalId)} working={working} act={act} />
                ))}
              </ul>
            </section>
          )}
          {v.groups.map((g) => (
            <section key={g.key} aria-label={g.title} className="flex flex-col gap-[4px] px-[14px]">
              <h3 className="flex items-center gap-[6px] text-micro font-medium text-fg-subtle" dir="auto">
                {g.title} {g.fresh && <Tag tone="ai">New product</Tag>}
              </h3>
              {g.lines.map((l) => (
                <div key={l.id} className={clsx("flex flex-col gap-[2px]", l.state === "discarded" && "opacity-55")}>
                  <div className="flex items-start gap-[8px]">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-caption text-fg-muted">{l.label}</span>
                      <span className={clsx("line-clamp-4 text-body leading-[20px] text-fg", l.state === "discarded" && "line-through")} dir="auto">
                        {l.text}
                      </span>
                    </span>
                    <Settle id={l.id} state={l.state} working={working} act={act} />
                  </div>
                  <Rests rests={l.rests} />
                </div>
              ))}
            </section>
          ))}
          {connected.length > 0 && (
            <section aria-label="Connected" className="flex flex-col gap-[4px] px-[14px]">
              <h3 className="text-micro font-medium text-fg-subtle">Connected</h3>
              {connected.map((t) => (
                <span key={t.id} className="flex items-center gap-[8px] text-body text-fg">
                  <ConnectorLogo id={t.id} decorative /> {t.label}
                </span>
              ))}
            </section>
          )}
        </div>
      )}
    </Panel>
  );
}
