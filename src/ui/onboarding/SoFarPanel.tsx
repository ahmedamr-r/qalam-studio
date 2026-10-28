import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Box, Briefcase, Building2, Check, CircleDashed, Plug, Quote, Star, Tags, Target, TrendingUp, Users, X, type LucideIcon } from "lucide-react";
import { useGoals } from "@/goals/client";
import { useOrgContext } from "@/org/context";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { ConnectorLogo } from "../brand/ConnectorLogo";
import { Button, IconBtn, Tip } from "../controls";
import { Panel, useWide, WIDE } from "../chat/Panels";
import { r } from "../recipes";
import { dropKnown, useKnow } from "../setup/know";
import { acceptLines, discardLines, useSetup } from "../setup/setup";
import { openSoFar, useFirstRun } from "./flow";
import { metricLine } from "@/goals/goals-md";
import { soFarOf, tally, type GoalRow, type LineField, type LineRow, type RestsOn, type RowState } from "./soFar";

/*
 * "{Org} so far": what the organization is becoming, drawn rather than listed. A strip says how
 * the review stands; then the goals as a tree of cards (the North Star marked, each with its
 * number), the About, each product, and what's connected, each section with its own colour and
 * icon. Qalam AI's proposals are settled here, one at a time or all at once, so the chat stays
 * short; the goals they wrote can be left out before they're added.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

/** Each section's mark: an icon on a tint of its colour (the knowledge hub's quiet group colours). */
const SECTION = {
  goals: { icon: Target, tone: "text-kh-you bg-kh-you/15" },
  about: { icon: Building2, tone: "text-kh-system bg-kh-system/15" },
  product: { icon: Box, tone: "text-component bg-component-subtle" },
  connected: { icon: Plug, tone: "text-kh-research bg-kh-research/15" },
} as const;

const FIELD: Record<LineField, LucideIcon> = { context: Briefcase, audience: Users, segments: Tags, goals: Target };

/** A line's state as the colour of its edge: Qalam AI's rose while proposed, green once accepted. */
const EDGE: Record<RowState, string> = {
  proposed: "before:bg-ai",
  accepted: "before:bg-success",
  discarded: "before:bg-transparent",
  kept: "before:bg-transparent",
};

const card = "relative overflow-hidden rounded-lg bg-raised shadow-[inset_0_0_0_1px_var(--color-line-subtle)] before:absolute before:inset-y-0 before:left-0 before:w-[3px]";

function SectionHead({ kind, title, count, children }: { kind: keyof typeof SECTION; title: string; count?: number; children?: ReactNode }) {
  const { icon: Icon, tone } = SECTION[kind];
  return (
    <h3 className="flex items-center gap-[8px] text-caption font-semibold text-fg" dir="auto">
      <span className={clsx("grid size-[22px] shrink-0 place-items-center rounded-md", tone)}>
        <Icon size={13} {...ICON} />
      </span>
      <span className="truncate">{title}</span>
      {count !== undefined && <span className="font-normal text-fg-subtle tnum">{count}</span>}
      <span className="flex-1" />
      {children}
    </h3>
  );
}

/** A small label with an icon (or Qalam AI's glyph as `lead`); `wrap` lets long words run onto a second line. */
function Chip({ icon: Icon, lead, children, tone = "text-fg-muted bg-active", wrap }: { icon?: LucideIcon; lead?: ReactNode; children: ReactNode; tone?: string; wrap?: boolean }) {
  return (
    <span className={clsx("inline-flex max-w-full shrink-0 items-center gap-[4px] self-start rounded-sm px-[6px] text-micro font-medium", wrap ? "min-h-[20px] py-[2px]" : "h-[20px]", tone)}>
      {Icon && <Icon size={11} {...ICON} className="shrink-0" />}
      {lead}
      <span className={clsx("tnum", wrap ? "min-w-0" : "truncate")}>{children}</span>
    </span>
  );
}

/** What a line rests on: a count you can open into their words and answers. */
function Rests({ rests }: { rests?: RestsOn }) {
  const [open, setOpen] = useState(false);
  const n = (rests?.quotes.length ?? 0) + (rests?.answers.length ?? 0);
  if (!rests || !n) return null;
  return (
    <div className="flex flex-col gap-[4px]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="q-item inline-flex h-[20px] items-center gap-[4px] self-start rounded-sm px-[6px] text-micro font-medium text-fg-muted hover:bg-hover hover:text-fg">
        <Quote size={11} {...ICON} /> Rests on {n === 1 ? "1 thing you said" : `${n} things you said`}
      </button>
      {open && (
        <div className="flex flex-col gap-[4px] border-l-2 border-line pl-[8px]">
          {rests.quotes.map((q, i) => (
            <p key={`q${i}`} className="text-caption text-fg-muted" dir="auto">
              “{q}”
            </p>
          ))}
          {rests.answers.map((a, i) => (
            <p key={`a${i}`} className="text-caption text-fg-muted" dir="auto">
              <span className="text-fg-subtle">{a.question}</span> {a.answer}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Accept and Discard as two small buttons, or the state once it's settled. */
function Settle({ id, state, working, act }: { id: string; state: RowState; working: boolean; act: (fn: () => Promise<void>) => void }) {
  if (state === "accepted")
    return (
      <span className="inline-flex h-[24px] shrink-0 items-center gap-[4px] rounded-md bg-success-subtle px-[7px] text-micro font-semibold text-success">
        <Check size={12} strokeWidth={2.25} /> Accepted
      </span>
    );
  if (state === "discarded") return <span className="inline-flex h-[24px] shrink-0 items-center px-[4px] text-micro font-medium text-fg-subtle">Discarded</span>;
  if (state !== "proposed") return null;
  return (
    <span className="flex shrink-0 items-center gap-[4px]">
      <Tip label="Discard">
        <button type="button" aria-label="Discard" disabled={working} onClick={() => act(() => discardLines([id]))} className="q-item grid size-[26px] place-items-center rounded-md text-fg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-danger-subtle hover:text-danger disabled:opacity-50">
          <X size={14} {...ICON} />
        </button>
      </Tip>
      <Tip label="Accept">
        <button type="button" aria-label="Accept" disabled={working} onClick={() => act(() => acceptLines([id]))} className="q-item grid size-[26px] place-items-center rounded-md bg-success-subtle text-success hover:bg-success hover:text-app disabled:opacity-50">
          <Check size={14} strokeWidth={2} />
        </button>
      </Tip>
    </span>
  );
}

function GoalCard({ g, mine, working, act }: { g: GoalRow; mine: boolean; working: boolean; act: (fn: () => Promise<void>) => void }) {
  const Icon = g.north ? Star : Target;
  return (
    <li className="relative" style={{ marginLeft: Math.min(g.depth, 4) * 20 }}>
      {g.depth > 0 && <span aria-hidden className="absolute -left-[12px] -top-[6px] h-[28px] w-[10px] rounded-bl-md border-b border-l border-line-strong" />}
      <div className={clsx(card, EDGE[g.state], "flex flex-col gap-[6px] py-[10px] pl-[12px] pr-[10px]", g.north && "bg-[color-mix(in_oklab,var(--color-accent)_7%,var(--color-raised))]", g.state === "discarded" && "opacity-55")}>
        <div className="flex items-start gap-[8px]">
          <span className={clsx("mt-[1px] grid size-[22px] shrink-0 place-items-center rounded-full", g.north ? "bg-accent/15 text-fg-accent" : "bg-kh-you/15 text-kh-you")}>
            <Icon size={12} {...ICON} fill={g.north ? "currentColor" : "none"} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            {g.north && <span className="text-micro font-semibold uppercase tracking-[0.04em] text-fg-accent">North Star</span>}
            <span className={clsx("text-body font-medium leading-[20px] text-fg", g.state === "discarded" && "line-through")} dir="auto">
              {g.title}
            </span>
          </span>
          {g.lineId && <Settle id={g.lineId} state={g.state} working={working} act={act} />}
          {g.ref && (
            <IconBtn size="sm" label="Leave it out" onClick={() => dropKnown(g.ref!)}>
              <X size={13} {...ICON} />
            </IconBtn>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-[4px] pl-[30px]">
          {g.metric ? (
            <Chip icon={TrendingUp} tone="text-fg bg-active" wrap>
              {[g.metric.name !== g.title ? g.metric.name : null, metricLine(g.metric)].filter(Boolean).join(" · ")}
            </Chip>
          ) : (
            <Chip icon={CircleDashed} tone="text-warning bg-warning-subtle">
              No number yet
            </Chip>
          )}
          {g.where && (
            <Chip icon={Box} tone={g.fresh ? "text-component bg-component-subtle" : undefined}>
              {g.fresh ? `${g.where} · new` : g.where}
            </Chip>
          )}
          {mine && (
            <Chip icon={Check} tone="text-success bg-success-subtle">
              Yours
            </Chip>
          )}
        </div>
        <div className="pl-[30px]">
          <Rests rests={g.rests} />
        </div>
      </div>
    </li>
  );
}

function LineCard({ l, working, act }: { l: LineRow; working: boolean; act: (fn: () => Promise<void>) => void }) {
  const [more, setMore] = useState(false);
  const Icon = FIELD[l.field];
  const long = l.text.length > 160;
  return (
    <div className={clsx(card, EDGE[l.state], "flex flex-col gap-[6px] py-[10px] pl-[12px] pr-[10px]", l.state === "discarded" && "opacity-55")}>
      <div className="flex items-start gap-[8px]">
        <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <Chip icon={Icon}>{l.label}</Chip>
          <span className={clsx("text-body leading-[20px] text-fg", !more && "line-clamp-3", l.state === "discarded" && "line-through")} dir="auto">
            {l.text}
          </span>
          {long && (
            <button type="button" className="self-start text-micro font-medium text-fg-muted hover:text-fg" onClick={() => setMore(!more)}>
              {more ? "Less" : "More"}
            </button>
          )}
        </span>
        <Settle id={l.id} state={l.state} working={working} act={act} />
      </div>
      <Rests rests={l.rests} />
    </div>
  );
}

/** How the review stands, as one bar: accepted, discarded, still to settle. */
function ReviewStrip({ accepted, discarded, open }: { accepted: number; discarded: number; open: number }) {
  const total = accepted + discarded + open;
  if (!total) return null;
  const seg = (n: number, tone: string) => (n ? <span className={clsx("h-full", tone)} style={{ flexGrow: n }} /> : null);
  return (
    <div className="flex flex-col gap-[6px] rounded-lg bg-raised p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-center gap-[8px] text-caption">
        {open ? (
          <span className="flex items-center gap-[6px] font-medium text-fg">
            <QalamAIGlyph size={12} /> {open} to review
          </span>
        ) : (
          <span className="flex items-center gap-[6px] font-medium text-success">
            <Check size={13} strokeWidth={2.25} /> All settled
          </span>
        )}
        <span className="flex-1" />
        <span className="text-fg-subtle tnum">
          {accepted} accepted{discarded ? ` · ${discarded} discarded` : ""}
        </span>
      </div>
      <div role="img" aria-label={`${accepted} accepted, ${discarded} discarded, ${open} to review`} className="flex h-[6px] gap-[2px] overflow-hidden rounded-full">
        {seg(accepted, "bg-success")}
        {seg(discarded, "bg-fg-faint")}
        {seg(open, "bg-ai/45")}
      </div>
    </div>
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
  const t = tally(v);
  const mine = new Set(picked ?? goals.mine);
  const connected = (tools ?? []).filter((x) => x.tone === "ok");
  return (
    <Panel
      title={`${name} so far`}
      actions={
        <>
          {v.open.length > 0 && (
            <Button size="sm" disabled={working} onClick={() => act(() => acceptLines(v.open))}>
              <Check size={12} strokeWidth={2.25} /> Accept all · {v.open.length}
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
        <div className="flex flex-col items-center gap-[10px] px-[24px] py-[40px] text-center">
          <span className="flex gap-[6px]">
            {(["goals", "about", "product", "connected"] as const).map((k) => {
              const { icon: Icon, tone } = SECTION[k];
              return (
                <span key={k} className={clsx("grid size-[28px] place-items-center rounded-md", tone)}>
                  <Icon size={14} {...ICON} />
                </span>
              );
            })}
          </span>
          <p className="max-w-[240px] text-caption text-fg-subtle">{org ? "Goals, About and products show here as Qalam AI finds them." : "Your organization shows here once it has a name."}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-[18px] p-[12px]">
          {v.from === "proposal" && <ReviewStrip {...t} />}
          {v.goals.length > 0 && (
            <section aria-label="Goals" className="flex flex-col gap-[8px]">
              <SectionHead kind="goals" title="Goals" count={v.goals.length}>
                {v.from === "know" && <Chip>Not added yet</Chip>}
                {v.from === "proposal" && t.open > 0 && (
                  <Chip tone="text-ai bg-ai-subtle" lead={<QalamAIGlyph size={12} />}>
                    Proposed
                  </Chip>
                )}
              </SectionHead>
              <ul className="flex flex-col gap-[8px]">
                {v.goals.map((g) => (
                  <GoalCard key={g.key} g={g} mine={!!g.goalId && mine.has(g.goalId)} working={working} act={act} />
                ))}
              </ul>
            </section>
          )}
          {v.groups.map((g) => (
            <section key={g.key} aria-label={g.title} className="flex flex-col gap-[8px]">
              <SectionHead kind={g.key === "org" ? "about" : "product"} title={g.title}>
                {g.fresh && <Chip tone="text-component bg-component-subtle">New product</Chip>}
              </SectionHead>
              {g.lines.length ? g.lines.map((l) => <LineCard key={l.id} l={l} working={working} act={act} />) : <p className="pl-[30px] text-caption text-fg-subtle">Nothing written about it yet.</p>}
            </section>
          ))}
          {connected.length > 0 && (
            <section aria-label="Connected" className="flex flex-col gap-[8px]">
              <SectionHead kind="connected" title="Connected" count={connected.length} />
              <div className="flex flex-wrap gap-[6px]">
                {connected.map((c) => (
                  <span key={c.id} className={clsx(r.replyChip, "pointer-events-none h-[30px] pl-[5px]")}>
                    <ConnectorLogo id={c.id} decorative /> {c.label}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Panel>
  );
}
