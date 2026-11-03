import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { setMe } from "@/goals/client";
import { onOrgChange } from "@/org/live";
import { currentOrg } from "@/org/client";
import { needsDb } from "@/org/needs";
import { scanNow, steerQuestions, steerScan } from "@/org/scan";
import { lineOf, LINE_MS, phaseOf, POSE_OF, readSoFar, scanProgress } from "@/onboarding/reading";
import { answerSaid, meFrom, pathOfShape, startQuestions, WHO_TITLE, type StartChoice, type StartPath, type StartQuestion } from "@/onboarding/start";
import { orgHref } from "@/projects/model";
import { peopleQuotes, type ScanSession } from "@/scan/session";
import { isOff } from "@/scan/steer";
import { Spinner } from "../controls";
import { r } from "../recipes";
import { readAgain, writeScanChat } from "./flow";
import { answerInput, choiceChip, Stage } from "./Stage";

/*
 * /o/<org>/start: the questions after the first answer, then the researcher at work while the scan
 * reads, then what it found, on to the canvas. The scan runs in the core: leaving goes on, and a
 * reload picks up where it's got to.
 */

const STEPS = 4;

const qIn = () => {
  const q = new URLSearchParams(window.location.search).get("q");
  return q === null ? null : Number(q);
};

function Question({ q, at, session, home, onDone, choices, loading }: { q: StartQuestion; at: number; session: ScanSession | null; home: string; onDone: (answer: string) => void; choices: readonly StartChoice[]; loading: boolean }) {
  const [text, setText] = useState("");
  return (
    <Stage pose={session ? POSE_OF[phaseOf(session)] : "reading"} line={q.line} home={home} dots={{ at: at + 2, of: STEPS }} title={q.title}>
      {(choices.length > 0 || loading) && (
        <div className="flex flex-wrap items-center gap-[8px]">
          {choices.map((c) => (
            <button key={c.label} type="button" className={choiceChip} onClick={() => onDone(c.label)}>
              {c.label}
            </button>
          ))}
          {loading && <span className="q-shimmer-text text-body text-fg-muted">Thinking of who it could be…</span>}
        </div>
      )}
      <form
        className="flex flex-col gap-[8px]"
        onSubmit={(e) => {
          e.preventDefault();
          onDone(text);
        }}
      >
        <input dir="auto" aria-label={q.title} className={answerInput} placeholder={q.placeholder} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
        <div className="mt-[8px] flex items-center justify-between gap-[8px]">
          <p className="text-caption text-fg-subtle">{q.id === "role" ? "I've started reading." : "I've started reading. This only says where to look first."}</p>
          <span className="flex shrink-0 items-center gap-[8px]">
            <button type="button" className={clsx(r.buttonSm, r.buttonGhost)} onClick={() => onDone("")}>
              Skip
            </button>
            <button type="submit" disabled={!text.trim()} className={clsx(r.button, r.buttonPrimary)}>
              Next
            </button>
          </span>
        </div>
      </form>
    </Stage>
  );
}

function Results({ s, canvas, onAgain }: { s: ScanSession; canvas: string; onAgain: () => void }) {
  // Best backed first, as the panel will list them; the scan itself keeps them in the order they were filed.
  const [ranked, setRanked] = useState<string[] | null>(null);
  useEffect(() => {
    if (s.state === "done") void needsDb.list().then((n) => setRanked(n.needs.map((x) => x.title)), () => setRanked(s.problems.map((p) => p.title)));
  }, [s.state, s.at]);
  const people = peopleQuotes(s.read);
  const said = people === 1 ? "1 quote" : `${people} quotes`;
  const n = s.problems.length;
  const phase = phaseOf(s);
  const line = lineOf(phase, 0);
  const pose = POSE_OF[phase];
  if (phase === "failed")
    return (
      <Stage pose={pose} line={line} home={canvas} title="It stopped before it finished">
        {s.error && <p className="text-body text-fg-muted">{s.error}</p>}
        <div className="flex items-center gap-[8px]">
          <button type="button" className={clsx(r.button, r.buttonPrimary)} onClick={onAgain}>
            Try again
          </button>
          <a href={canvas} className={clsx(r.button, r.buttonSecondary)}>
            Go to the canvas
          </a>
        </div>
      </Stage>
    );
  if (phase === "thin")
    return (
      <Stage pose={pose} line={line} home={canvas} title="I found little">
        <p className="text-body text-fg-muted">{n ? `${n === 1 ? "1 problem" : `${n} problems`} from ${said}, so I won't call it a pattern yet.` : "Nothing I could read spoke to this, so I won't call it a pattern."} On the canvas you can add what you already have, or try it worded another way.</p>
        <a href={canvas} className={clsx(r.button, r.buttonPrimary, "self-start")}>
          Go to the canvas
        </a>
      </Stage>
    );
  return (
    <Stage pose={pose} line={line} home={canvas} title={`${n} problems, from ${said}`}>
      <ol className="q-stagger flex flex-col gap-[8px]">
        {(ranked ?? []).slice(0, 3).map((title, i) => (
          <li key={title} className="flex gap-[10px] rounded-lg bg-raised px-[12px] py-[10px] text-body text-fg shadow-button">
            <span className="tnum text-fg-subtle">{i + 1}</span>
            {title}
          </li>
        ))}
      </ol>
      <p className="text-caption text-fg-muted">{s.target.kind === "product" && s.target.mine ? "Your own app's reviews count as your customers' words; the rest is what people say publicly." : "This is what people say publicly: a place to start, not proof."}</p>
      <a href={`${canvas}?panel=problems`} className={clsx(r.button, r.buttonPrimary, "self-start")}>
        See them
      </a>
    </Stage>
  );
}

function AtWork({ s, now, canvas }: { s: ScanSession; now: number; canvas: string }) {
  const phase = phaseOf(s);
  const name = s.target.kind === "product" ? s.target.name || "your product" : "your idea";
  const so = readSoFar(s);
  const steps = s.steps.filter((x) => x !== "Starting" && !x.startsWith("Keeping ")).slice(-5);
  const apps = s.competitors.filter((c) => !isOff(s.steer, c.name));
  const counts = [so.places ? `${so.places} ${so.places === 1 ? "place" : "places"}` : "", so.reviews ? `${so.reviews} reviews` : ""].filter(Boolean).join(" · ");
  return (
    <Stage pose={POSE_OF[phase]} line={lineOf(phase, now - s.at)} home={canvas} title={`Reading what people say about ${name}`}>
      <div className="h-[6px] overflow-hidden rounded-full bg-fg/10" role="progressbar" aria-label="Reading">
        <div className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${scanProgress(s, now) * 100}%` }} />
      </div>
      <ul className="flex flex-col gap-[6px]">
        {steps.map((x, i) => (
          <li key={`${i}:${x}`} className={clsx("flex items-center gap-[8px] text-body", i === steps.length - 1 ? "text-fg" : "text-fg-subtle")}>
            <span className="grid w-[14px] shrink-0 place-items-center">{i === steps.length - 1 ? <Spinner size={12} /> : "✓"}</span>
            <span className="truncate">{x}</span>
          </li>
        ))}
      </ul>
      {apps.length > 0 && (
        <div className="flex flex-wrap items-center gap-[6px]">
          <span className="text-caption text-fg-muted">What people use today:</span>
          {apps.map((c) => (
            <button key={c.name} type="button" className="q-item inline-flex h-[24px] items-center gap-[6px] rounded-md bg-raised px-[8px] text-caption text-fg shadow-button hover:bg-elevated" aria-label={`Leave ${c.name} out`} title="Not what you meant? Leave it out." onClick={() => void steerScan({ off: [c.name] }).catch(() => {})}>
              {c.name} <span className="text-fg-subtle">×</span>
            </button>
          ))}
        </div>
      )}
      {counts && <p className="tnum text-caption text-fg-muted">{counts}</p>}
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className="text-caption text-fg-subtle">Usually a few minutes. It keeps reading if you leave.</p>
        <a href={canvas} className={clsx(r.buttonSm, r.buttonGhost)}>
          Go to the canvas
        </a>
      </div>
    </Stage>
  );
}

export default function Reading() {
  const [session, setSession] = useState<ScanSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [path, setPath] = useState<StartPath>("idea");
  const [org, setOrg] = useState<string | null>(null);
  const [question, setQuestion] = useState<number | null>(qIn);
  const [who, setWho] = useState<{ options: string[]; loading: boolean }>({ options: [], loading: false });
  const [now, setNow] = useState(() => Date.now());
  const askedWho = useRef(false);

  useEffect(() => {
    const refresh = () => void scanNow().then((s) => (setSession(s), setLoaded(true)), () => setLoaded(true));
    refresh();
    void currentOrg().then((o) => (setOrg(o.id), setPath(pathOfShape(o.shape))));
    const stop = onOrgChange((c) => {
      if (c.kind === "scan") refresh();
    });
    // Should an announcement be missed, it still catches up.
    const poll = setInterval(refresh, 5000);
    const tick = setInterval(() => setNow(Date.now()), Math.min(1000, LINE_MS));
    const back = () => setQuestion(qIn());
    window.addEventListener("popstate", back);
    return () => {
      stop();
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("popstate", back);
    };
  }, []);

  const questions = startQuestions(path);
  const canvas = orgHref(org);
  const asking = question !== null && question < questions.length && (!session || session.state === "reading");
  const q = asking ? questions[question] : null;

  // Who it could be for, drawn from their idea; they can type before it comes.
  useEffect(() => {
    if (q?.id !== "who" || !session || askedWho.current) return;
    askedWho.current = true;
    setWho({ options: [], loading: true });
    void steerQuestions(session.target).then(
      (all) => setWho({ options: all.find((x) => x.title === WHO_TITLE)?.options.map((o) => o.label) ?? [], loading: false }),
      () => setWho({ options: [], loading: false }),
    );
  }, [q?.id, !!session]);

  // Nothing to read and nothing running here: the canvas is where to be.
  useEffect(() => {
    if (loaded && !session && org) window.location.replace(orgHref(org));
  }, [loaded, !!session, org]);

  if (!session || !org) return <div className="min-h-screen bg-app" />;

  const answered = (answer: string) => {
    if (!q) return;
    const me = meFrom(q, answer);
    if (me) void setMe(me).catch(() => {});
    const said = answerSaid(q, answer);
    if (said.length)
      void steerScan({ said })
        .then((next) => (next ? writeScanChat(session.target, next, next.steer?.said) : undefined))
        .catch(() => {});
    const next = question! + 1;
    const u = new URL(window.location.href);
    u.searchParams.set("q", String(next));
    history.pushState(null, "", u);
    setQuestion(next);
  };

  if (q) return <Question key={q.id} q={q} at={question!} session={session} home={canvas} onDone={answered} choices={q.id === "who" ? who.options.map((label) => ({ label })) : q.choices} loading={q.id === "who" && who.loading} />;
  if (session.state === "reading") return <AtWork s={session} now={now} canvas={canvas} />;
  return <Results s={session} canvas={canvas} onAgain={() => void readAgain(session).then(setSession, () => {})} />;
}
