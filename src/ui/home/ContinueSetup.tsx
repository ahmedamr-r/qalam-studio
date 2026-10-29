import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowRight } from "lucide-react";
import type { SourceRecord } from "@/discovery/sources";
import { useGoals } from "@/goals/client";
import type { OrgRef } from "@/org/client";
import { firstRunDb, type FirstRunView } from "@/org/first-run";
import { loadVoice } from "@/org/voice";
import { loadYou, useYou } from "@/org/you";
import { voiceSettled, type VoiceView } from "@/voice/model";
import { setupHref } from "@/projects/model";
import { NUQTA_PATH, PENCIL_PATH } from "../brand/pencil";
import { r } from "../recipes";
import { firstRunLeft, WELCOME_STEPS, type SetupStep } from "../welcome/steps";

/*
 * The home's card while the first run isn't finished here ("Set up later", or the window closed
 * part way): what's next, and Continue, which opens the setup at that step with what's done kept.
 * Where it stopped is read from what's kept (`firstRunLeft`); only Finish is saved. The picture is
 * the setup's own panels in small (steps, Qalam AI, so far), drawn as far as this one got.
 */

type Left = NonNullable<ReturnType<typeof firstRunLeft>>;

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** A brain dump about the organization still being set up (the newest). */
const settingUp = (sources: SourceRecord[]) => sources.filter((s) => s.setup && s.setup.phase !== "done").sort((a, b) => b.addedAt - a.addedAt)[0];

/** Where the first run picks up (null: finished; undefined: still finding out). */
export function useFirstRunLeft(sources: SourceRecord[]): Left | null | undefined {
  const name = useYou((y) => y.name);
  const youLoaded = useYou((y) => y.loaded);
  const goals = useGoals();
  const [run, setRun] = useState<FirstRunView | null>(null);
  const [voice, setVoice] = useState<VoiceView | null | undefined>(undefined);
  useEffect(() => {
    if (!useYou.getState().loaded) void loadYou().catch(() => {});
    void firstRunDb.view().then(setRun, () => setRun({ done: 0, picked: true }));
    void loadVoice().then(setVoice);
  }, []);
  if (!youLoaded || !goals.loaded || !run) return undefined;
  const you = !!name && !!goals.me;
  // Voice is only asked once who they are is in.
  if (run.done === null && you && voice === undefined) return undefined;
  return firstRunLeft({ you, voice: voice === undefined || voiceSettled(voice), goals: goals.goals.length, settingUp: !!settingUp(sources), picked: run.picked, finished: run.done !== null });
}

function nextLine(step: SetupStep, org: string, waiting: boolean): string {
  switch (step) {
    case "you":
      return `Next: who you are at ${org}, so Qalam AI asks you the right questions.`;
    case "voice":
      return "Next: talking instead of typing. It runs on this Mac, and nothing you say leaves it.";
    case "goals":
      return waiting ? "Qalam AI read what you wrote about it, and is waiting on you." : `Next: ${org}'s goals. Write them down, or let Qalam AI find them in a doc or your website.`;
    case "yours":
      return "Next: which goals are yours. Your home leads with them.";
    case "connect":
      return "Last: connect what your goals need. Qalam only reads from them.";
  }
}

export function ContinueSetup({ org, left, sources }: { org: OrgRef; left: Left; sources: SourceRecord[] }) {
  const waiting = settingUp(sources);
  const href = `${setupHref()}?first=1&step=${left.step}${left.step === "goals" && waiting ? `&source=${waiting.id}` : ""}`;
  return (
    <section aria-labelledby="continue-setup" className="q-rise flex flex-col gap-[16px] rounded-lg bg-panel p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)] sm:flex-row sm:items-center">
      <a href={href} tabIndex={-1} aria-hidden className="flex h-[140px] shrink-0 justify-center overflow-hidden rounded-md bg-app shadow-[inset_0_0_0_1px_var(--color-line-subtle)] sm:w-[248px]">
        <SetupPicture done={left.done} />
      </a>
      <div className="flex min-w-0 flex-col items-start gap-[6px] px-[6px] pb-[6px] sm:py-[6px] sm:pr-[16px]">
        <span className="text-caption text-fg-subtle tnum">
          Setup · {left.done} of {left.of} done
        </span>
        <h2 id="continue-setup" className="text-heading font-medium text-fg">
          Finish setting up {org.name}
        </h2>
        <p className="max-w-[520px] text-body text-fg-muted">{nextLine(left.step, org.name, !!waiting)} What you&apos;ve done is kept.</p>
        <a href={href} className={clsx(r.button, r.buttonPrimary, "mt-[6px]")}>
          Continue setup <ArrowRight {...ICON} />
        </a>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The picture

/** Each step's label as a bar's width, in the steps panel. */
const BAR = [28, 24, 12, 18, 18, 18, 26];
const GOALS_AT = WELCOME_STEPS.findIndex((s) => s.id === "goals");

/** The setup's three panels on the backdrop: steps done ticked, the one now ringed, goals dashed until they're in. */
function SetupPicture({ done }: { done: number }) {
  const goalsIn = done > GOALS_AT;
  return (
    <svg width={248} height={140} viewBox="0 0 248 140" aria-hidden className="shrink-0">
      {/* Steps */}
      <rect x={10.5} y={10.5} width={62} height={140} rx={6} className="fill-panel stroke-line" />
      {BAR.map((w, i) => {
        const y = 18 + i * 15;
        const state = i < done ? "done" : i === done ? "now" : "next";
        return (
          <g key={i}>
            {state === "now" && <rect x={14} y={y} width={55} height={12} rx={3} className="fill-active" />}
            {state === "done" && (
              <>
                <circle cx={20} cy={y + 6} r={3.25} className="fill-success" />
                <path d={`M18.4 ${y + 6.1} 19.5 ${y + 7.2} 21.6 ${y + 4.9}`} fill="none" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" className="stroke-app" />
              </>
            )}
            {state === "now" && (
              <>
                <circle cx={20} cy={y + 6} r={5.25} fill="none" strokeWidth={1} className="q-breathe stroke-accent" />
                <circle cx={20} cy={y + 6} r={3.25} className="fill-fg" />
              </>
            )}
            {state === "next" && <circle cx={20} cy={y + 6} r={2.75} fill="none" strokeWidth={1} className="stroke-line-strong" />}
            <rect x={27} y={y + 4.5} width={w} height={3} rx={1.5} className={state === "now" ? "fill-fg" : state === "done" ? "fill-fg-subtle" : "fill-fg-faint"} opacity={state === "next" ? 0.6 : 1} />
          </g>
        );
      })}
      <rect x={16} y={128} width={50} height={2} rx={1} className="fill-active" />
      <rect x={16} y={128} width={(50 * done) / BAR.length} height={2} rx={1} className="fill-fg-muted" />

      {/* Qalam AI */}
      <rect x={78.5} y={10.5} width={110} height={140} rx={6} className="fill-panel stroke-line" />
      <g transform="translate(85 14.5) scale(0.3)">
        <path fillRule="evenodd" d={PENCIL_PATH} className="fill-ai" />
        <path d={NUQTA_PATH} className="fill-ai" />
      </g>
      <rect x={96} y={17.5} width={26} height={3} rx={1.5} className="fill-fg-muted" />
      <path d="M79 26.5H188" className="stroke-line-subtle" />
      <rect x={86} y={34} width={72} height={3} rx={1.5} className="fill-fg-subtle" opacity={0.7} />
      <rect x={86} y={40} width={50} height={3} rx={1.5} className="fill-fg-subtle" opacity={0.7} />
      <rect x={134} y={49} width={46} height={12} rx={4} className="fill-active" />
      <rect x={140} y={53.5} width={28} height={3} rx={1.5} className="fill-fg-muted" />
      <rect x={86} y={68} width={82} height={3} rx={1.5} className="fill-fg-subtle" opacity={0.7} />
      <rect x={86} y={74} width={58} height={3} rx={1.5} className="fill-fg-subtle" opacity={0.7} />
      <rect x={86} y={83} width={36} height={11} rx={3} className="fill-inverse" />
      <rect x={91} y={87} width={26} height={3} rx={1.5} className="fill-fg-inverse" />
      <rect x={126.5} y={83.5} width={42} height={10} rx={3} fill="none" className="stroke-line-strong" />
      <rect x={132} y={87} width={31} height={3} rx={1.5} className="fill-fg-subtle" />
      <rect x={84.5} y={110.5} width={98} height={22} rx={5} className="fill-field stroke-line" />
      <rect x={90} y={116} width={1.25} height={10} className="q-caret fill-accent" />
      <rect x={95} y={119.5} width={44} height={3} rx={1.5} className="fill-fg-faint" />

      {/* So far */}
      <rect x={194.5} y={10.5} width={64} height={140} rx={6} className="fill-panel stroke-line" />
      <rect x={201} y={17.5} width={30} height={3} rx={1.5} className="fill-fg-muted" />
      <path d="M195 26.5H248" className="stroke-line-subtle" />
      {[
        { x: 201, y: 33, w: 40 },
        { x: 207, y: 46, w: 34 },
        { x: 207, y: 59, w: 30 },
        { x: 213, y: 72, w: 28 },
      ].map((g, i) =>
        goalsIn ? (
          <g key={i}>
            {i === 0 ? (
              <path d={`M${g.x + 3} ${g.y + 1.5}l.9 1.9 2.1.3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.4 2.1-.3Z`} className="fill-fg" />
            ) : (
              <circle cx={g.x + 3} cy={g.y + 4.5} r={2} fill="none" strokeWidth={1} className="stroke-fg-subtle" />
            )}
            <rect x={g.x + 9} y={g.y + 3} width={g.w - 9} height={3} rx={1.5} className={i === 0 ? "fill-fg-muted" : "fill-fg-subtle"} />
          </g>
        ) : (
          <rect key={i} x={g.x + 0.5} y={g.y + 0.5} width={g.w} height={8} rx={2.5} fill="none" strokeDasharray="2 2" className="stroke-line-strong" />
        ),
      )}
      {[201, 213, 225, 237].map((x) => (
        <rect key={x} x={x + 0.5} y={92.5} width={9} height={9} rx={2.5} fill="none" strokeDasharray="2 1.5" className="stroke-line-strong" />
      ))}
    </svg>
  );
}
