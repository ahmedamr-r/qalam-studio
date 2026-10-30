import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import clsx from "clsx";
import * as Tooltip from "@radix-ui/react-tooltip";
import { DUMP_MAX_CHARS, MAX_DUMP_ROUNDS } from "@/discovery/dump";
import { useGoals } from "@/goals/client";
import { readOutline } from "@/goals/outline";
import { pendingLines } from "@/org/setup";
import { useVoice } from "@/org/voice";
import { positionLabel, useYou } from "@/org/you";
import { voiceOffer } from "@/voice/model";
import { orgHref } from "@/projects/model";
import { QalamAIGlyph, QalamMark } from "../brand";
import { toQuestion } from "../ai/plan";
import { Questionnaire } from "../ai/Questionnaire";
import { initialFlow, type FlowState } from "../ai/questionFlow";
import { ChatComposer, ChatThread } from "../chat/ChatThread";
import { Panel, PanelLayout, StepList, useWide, WIDE } from "../chat/Panels";
import { PageFrame } from "../frame/PageFrame";
import { useFrame } from "../frame/store";
import { r } from "../recipes";
import Toasts from "../toast";
import { answerKnown, readKnown, saveKnownForm, useKnow } from "../setup/know";
import { answerSetupRound, saveSetupRound, startSetup, stopSetup, useSetup } from "../setup/setup";
import { nameOrg, openSoFar, sendProblems, startIdea, startSetupPage, startWelcome, useFirstRun, type FirstRun } from "./flow";
import { PARTS } from "./parts";
import { SoFar } from "./SoFarPanel";
import { askOf, isAddress, stepsOf, threadOf, type EngineState, type ThreadInput } from "./thread";

/*
 * The first run as a conversation with Qalam AI in panels, like Intercom's setup: the steps down
 * the left, the chat in the middle, and what the organization has so far on the right, where
 * Qalam AI's proposals are accepted. The welcome (/welcome) and the setup page (/o/<org>/setup)
 * are the same surface: the thread is read from what's kept (./thread.ts), so the setup page
 * carries on the conversation the welcome started, and a reload shows it as it was.
 */

function engineState(route: FirstRun["route"], e: FirstRun["engine"]): EngineState {
  const test = e.test ?? e.view?.test ?? null;
  if (route === "setup") return test?.ok ? "ready" : !e.view || e.view.ready ? "unknown" : "problem";
  if (e.checking) return e.view ? "testing" : "looking";
  if (test?.ok) return "ready";
  if (e.skipped) return "skipped";
  return e.view || e.error ? "problem" : "looking";
}

function useThreadInput(): ThreadInput {
  const fr = useFirstRun();
  const know = useKnow();
  const setup = useSetup();
  const mine = useGoals((g) => g.mine);
  const me = useGoals((g) => g.me);
  const goals = useGoals((g) => g.goals.length);
  const yourName = useYou((y) => y.name);
  const voice = useVoice((v) => v.view);
  const session = setup.source?.setup ?? null;
  return {
    route: fr.route,
    mode: fr.mode,
    first: fr.route === "welcome" || fr.first,
    orgName: fr.org?.name ?? null,
    shape: fr.shape,
    engine: engineState(fr.route, fr.engine),
    naming: { name: fr.naming.name, busy: fr.naming.busy, error: fr.naming.error },
    // On your own there's no position to say.
    person: yourName && me ? (me.position === "solo" ? yourName : `${yourName} · ${positionLabel(me)}`) : null,
    voice: voice ? { offer: voiceOffer(voice), chosen: voice.chosen } : null,
    step: fr.step,
    door: fr.door,
    goals,
    opened: fr.route === "welcome" || fr.opened,
    know: { phase: know.phase, sent: know.sent, answered: know.answered, added: know.added, error: know.error, goals: know.goals.length, questions: know.questions.length },
    find: {
      session,
      pending: !!setup.pending,
      error: setup.error,
      open: session?.proposal ? pendingLines(session).length : 0,
      accepted: Object.values(session?.decided ?? {}).filter((d) => d === "accepted").length,
    },
    problems: fr.problems,
    idea: fr.idea,
    busy: setup.busy ? { label: setup.busy.label } : fr.working,
    picked: (fr.picked ?? mine).length,
  };
}

/** Tab puts a goal under the one above it; Shift-Tab takes it back out (never while composing). */
function indent(e: KeyboardEvent<HTMLTextAreaElement>, setText: (t: string) => void) {
  if (e.key !== "Tab" || e.nativeEvent.isComposing) return;
  e.preventDefault();
  const el = e.currentTarget;
  const [from, to] = [el.selectionStart, el.selectionEnd];
  const start = el.value.lastIndexOf("\n", from - 1) + 1;
  const next = e.shiftKey ? el.value.slice(0, start) + el.value.slice(start).replace(/^ {1,2}/, "") : `${el.value.slice(0, start)}  ${el.value.slice(start)}`;
  const moved = next.length - el.value.length;
  setText(next);
  requestAnimationFrame(() => el.setSelectionRange(Math.max(start, from + moved), Math.max(start, to + moved)));
}

function FindRound() {
  const source = useSetup((s) => s.source);
  const s = source?.setup;
  const i = (s?.buckets.length ?? 1) - 1;
  const b = s?.buckets[i];
  const [form, setForm] = useState<FlowState | null>(b?.form ?? null);
  if (!b || !form) return null;
  return (
    <Questionnaire
      title={i === 0 ? "Before Qalam AI proposes anything" : `Round ${i + 1} of up to ${MAX_DUMP_ROUNDS}`}
      questions={b.questions.map(toQuestion)}
      state={form}
      onChange={(f) => {
        setForm(f);
        saveSetupRound(f);
      }}
      onSubmit={(f) => void answerSetupRound(f)}
      review={{ submitLabel: "Send answers" }}
    />
  );
}

function KnowRound() {
  const k = useKnow();
  const [form, setForm] = useState<FlowState>(() => k.form ?? initialFlow(k.questions));
  return (
    <Questionnaire
      title="Only what's missing"
      questions={k.questions}
      state={form}
      onChange={(f) => {
        setForm(f);
        saveKnownForm(f);
      }}
      onSubmit={(f) => void answerKnown(f)}
      review={{ submitLabel: "Send answers" }}
    />
  );
}

export function Onboarding({ route }: { route: "welcome" | "setup" }) {
  useEffect(() => {
    if (route === "welcome") startWelcome(window.location.search);
    else void startSetupPage(window.location.search);
  }, [route]);
  const fr = useFirstRun();
  const source = useSetup((s) => s.source);
  const knowText = useKnow((s) => s.text);
  const input = useThreadInput();
  const messages = useMemo(() => threadOf(input), [JSON.stringify(input)]);
  const ask = askOf(input);
  const steps = stepsOf(input);
  const wide = useWide(WIDE);
  const lastDump = useRef("");
  const running = !!input.busy || fr.naming.busy;
  const first = route === "welcome" || fr.first;
  const name = fr.org?.name;

  // The address names the setup once there is one, so a reload comes back to it.
  useEffect(() => {
    if (!source) return;
    const u = new URL(window.location.href);
    if (u.searchParams.get("source") === source.id) return;
    u.searchParams.set("source", source.id);
    history.replaceState(null, "", u);
  }, [source?.id]);

  // Proposals are reviewed in So far: on a narrow window it opens by itself.
  const reviewing = source?.setup?.phase === "review";
  useEffect(() => {
    if (reviewing) openSoFar(true);
  }, [reviewing]);

  const title = route === "welcome" ? (fr.mode === "verify" ? "Check the setup" : fr.mode === "new" ? "A new organization" : "Welcome to Qalam") : `Set up ${name ?? "your organization"}`;
  useEffect(() => {
    document.title = `${title} · Qalam`;
  }, [title]);

  // Not the first run: the sidebar folds to its rail here, so the three panels fit.
  useEffect(() => {
    if (route === "setup" && fr.opened && !fr.first) useFrame.setState({ sidebar: "rail" });
  }, [route, fr.opened, fr.first]);

  const footer: ReactNode =
    ask.kind === "questions" ? (
      ask.scope === "find" ? (
        <FindRound key={`${source?.id}:${source?.setup?.buckets.length}`} />
      ) : (
        <KnowRound key={ask.key} />
      )
    ) : (
      <ChatComposer
        label={
          ask.kind === "name" ? (fr.shape === "solo" ? "The project's name" : "The organization's name") : ask.kind === "outline" ? "Your goals" : ask.kind === "dump" ? (fr.shape === "solo" ? "About the idea" : "About the company") : ask.kind === "problems" ? "What customers said" : ask.kind === "idea" ? "The idea" : "Message"
        }
        placeholder={ask.placeholder}
        submit={ask.submit}
        disabled={ask.kind === "none"}
        running={running}
        onStop={stopSetup}
        draftKey={ask.key}
        draft={ask.kind === "outline" ? knowText : ask.kind === "dump" ? lastDump.current : ""}
        onKeyDown={ask.kind === "outline" ? indent : undefined}
        hint={ask.kind === "outline" ? "Tab puts a goal under the one above · ⌘↵ sends" : ask.kind === "dump" || ask.kind === "problems" ? "A web address alone reads the page · ⌘↵ sends" : ask.kind === "idea" ? "⌘↵ sends" : null}
        check={(t) => {
          if (ask.kind === "name") return t.trim().length > 80 ? "Keep it under 80 characters." : null;
          if (ask.kind === "outline") return readOutline(t).length ? null : "Write a goal first.";
          if (ask.kind === "dump" || ask.kind === "problems" || ask.kind === "idea") {
            if (t.length > DUMP_MAX_CHARS) return `That's over ${DUMP_MAX_CHARS.toLocaleString()} characters: paste the most useful part.`;
            if (ask.kind === "idea" ? t.trim().length < 40 : !isAddress(t) && t.trim().length < 40) return ask.kind === "idea" ? "Write a few sentences more: what it does, who it's for, and why." : "Write a few sentences more, or give a web address.";
          }
          return null;
        }}
        onSend={async (t) => {
          if (ask.kind === "name") return nameOrg(t.trim());
          if (ask.kind === "outline") {
            void readKnown(t);
            return true;
          }
          if (ask.kind === "dump") {
            lastDump.current = t;
            void startSetup(isAddress(t) ? { text: "", url: t.trim() } : { text: t, url: "" });
            return true;
          }
          if (ask.kind === "problems") {
            void sendProblems(t);
            return true;
          }
          if (ask.kind === "idea") {
            void startIdea(t);
            return true;
          }
          return false;
        }}
      />
    );

  const open = source?.setup?.proposal ? pendingLines(source.setup).length : 0;
  const layout = (
    <PanelLayout
      left={
        <Panel title={first ? "Setting up" : "Goals"} body={false}>
          <StepList steps={steps} />
        </Panel>
      }
      center={
        <Panel
          label="Qalam AI"
          title={
            <span className="flex items-center gap-[8px]">
              <QalamAIGlyph size={14} /> Qalam AI
            </span>
          }
          actions={
            !wide && (
              <button type="button" className={clsx(r.buttonSm, r.buttonGhost)} onClick={() => openSoFar(!fr.soFarOpen)} aria-expanded={fr.soFarOpen}>
                So far{open ? <span className="text-fg-subtle tnum"> · {open}</span> : null}
              </button>
            )
          }
          body={false}
        >
          <div className="min-h-0 flex-1">
            <ChatThread messages={messages} running={running} onCancel={stopSetup} parts={PARTS} footer={footer} pinned={ask.kind !== "questions"} />
          </div>
        </Panel>
      }
      right={<SoFar />}
      rightOpen={fr.soFarOpen}
      onRightOpen={openSoFar}
    />
  );

  if (route === "setup" && fr.opened && !fr.first)
    return (
      <PageFrame place={null} crumbs={[{ label: "Set up" }]} fill>
        {layout}
      </PageFrame>
    );
  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      <div className="grid h-screen grid-rows-[var(--topbar-h)_minmax(0,1fr)] overflow-hidden bg-app text-fg" style={{ "--toolbar-h": "104px" } as CSSProperties}>
        <header className={r.topBar}>
          <a href={route === "welcome" && fr.mode === "first" ? "/welcome" : orgHref()} aria-label="Qalam" className={r.brandCell}>
            <QalamMark size={20} />
          </a>
          <span className="truncate text-body font-medium text-fg">{title}</span>
          <span className="flex-1" />
          {route === "setup" && fr.step !== "connect" && (
            <a href={orgHref()} className={clsx(r.buttonSm, r.buttonGhost, "mr-[10px]")}>
              Set up later
            </a>
          )}
        </header>
        <div className="relative min-h-0">
          {layout}
          <Toasts />
        </div>
      </div>
    </Tooltip.Provider>
  );
}
