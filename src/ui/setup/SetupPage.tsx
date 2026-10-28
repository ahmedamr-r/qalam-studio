import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowRight, Check, RotateCcw, Square, Star, Target } from "lucide-react";
import { CHALLENGE_LABEL, DUMP_MAX_CHARS, MAX_DUMP_ROUNDS } from "@/discovery/dump";
import type { SourceRecord } from "@/discovery/sources";
import { currentOrg, type OrgRef } from "@/org/client";
import { useOrgContext } from "@/org/context";
import type { Product } from "@/org/context-md";
import { metricLine } from "@/goals/goals-md";
import { boardGoals, goalLines, pendingLines, type SetupField, type SetupLine, type SetupSession } from "@/org/setup";
import { orgHref, placeHref } from "@/projects/model";
import { feedback } from "@/commands/feedback";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { Button, Tag, Tip } from "../controls";
import { toQuestion } from "../ai/plan";
import { AnswersSummary, Questionnaire, qr } from "../ai/Questionnaire";
import { ErrorNote, Progress } from "../ai/common";
import type { FlowState } from "../ai/questionFlow";
import { r } from "../recipes";
import { PageFrame } from "../frame/PageFrame";
import { useCurrentOrg } from "../frame/store";
import { StepHeader } from "../welcome/StepHeader";
import { setupStep, type SetupStep } from "../welcome/steps";
import { Connect, Yours } from "./FirstSteps";
import { GoalsForm } from "./GoalsForm";
import { acceptLines, answerSetupRound, discardLines, openSetup, placeSetup, retrySetup, saveSetupRound, skipSetupRest, startBoard, startSetup, stopSetup, useSetup } from "./setup";

/**
 * Setting the organization up, goals first, through one of two doors. "I know our goals": they
 * write them down (./GoalsForm.tsx). "Help me find them": a brain dump about the company (or its
 * website); Qalam AI says what it took from it, pushes back, asks up to three rounds of questions,
 * then proposes the goals (one tree, with their numbers), the About and the products line by line,
 * each with the words it rests on. Nothing is written until they accept a line. On the first run
 * (`?first=1`) it goes on to which goals are theirs and what to connect (`?step=`, ./FirstSteps.tsx);
 * otherwise each goal they accepted can start a board.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

const ORG_FIELD: Record<SetupField, string> = { audience: "Who we serve", context: "What we do", goals: "Goals", segments: "Segments" };
const PRODUCT_FIELD: Record<SetupField, string> = { audience: "Who it's for", context: "Context", goals: "Goals", segments: "Segments" };
const ORDER: SetupField[] = ["context", "audience", "goals", "segments"];

export default function SetupPage() {
  const [org, setOrg] = useState<OrgRef | null>(null);
  const source = useSetup((s) => s.source);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    void currentOrg().then(setOrg, () => {});
    const id = new URLSearchParams(window.location.search).get("source");
    void openSetup(id).finally(() => setOpened(true));
  }, []);

  // The address names the setup once there is one, so a reload comes back to it.
  useEffect(() => {
    if (!source) return;
    const u = new URL(window.location.href);
    if (u.searchParams.get("source") === source.id) return;
    u.searchParams.set("source", source.id);
    history.replaceState(null, "", u);
  }, [source]);

  useEffect(() => {
    document.title = org ? `Set up ${org.name} · Qalam` : "Qalam";
  }, [org]);

  const name = org?.name ?? "your organization";
  // The welcome's last three steps (?first=1): no sidebar yet, the steps on top, and a way out.
  const [first] = useState(() => new URLSearchParams(window.location.search).get("first") === "1");
  const [step] = useState(() => setupStep(window.location.search));
  const [door, setDoor] = useState<"know" | "find" | null>(null);
  // Goals in: the first run goes on to which are theirs; otherwise they're on the Goals page.
  const next = (to: SetupStep) => {
    const u = new URL(window.location.href);
    u.searchParams.set("step", to);
    window.location.assign(u.toString());
  };
  const goalsIn = () => (first ? next("yours") : window.location.assign(placeHref("goals")));
  return (
    <PageFrame
      place={null}
      focus={first}
      crumbs={[{ label: "Set up" }]}
      right={
        first && step !== "connect" ? (
          <a href={orgHref()} className={clsx(r.buttonSm, r.buttonGhost)}>
            Set up later
          </a>
        ) : undefined
      }
    >
      <div className={clsx(r.pageMain, "max-w-[680px] gap-[20px]")}>
        {first && <StepHeader at={step} />}
        {!opened ? null : step === "yours" ? (
          <Yours onNext={() => next("connect")} />
        ) : step === "connect" ? (
          <Connect />
        ) : source?.setup ? (
          <Session source={source} s={source.setup} org={name} first={first} onGoalsIn={goalsIn} />
        ) : door === "know" ? (
          <GoalsForm org={name} onBack={() => setDoor(null)} onDone={goalsIn} />
        ) : door === "find" ? (
          <Compose org={name} onBack={() => setDoor(null)} />
        ) : (
          <Doors org={name} onPick={setDoor} />
        )}
      </div>
    </PageFrame>
  );
}

// ---------------------------------------------------------------------------
// Two doors

/** Goals first: written down by someone who knows them, or found in what the team has. */
function Doors({ org, onPick }: { org: string; onPick: (door: "know" | "find") => void }) {
  const door = (id: "know" | "find", title: string, body: string) => (
    <button type="button" onClick={() => onPick(id)} className="q-item flex flex-col items-start gap-[6px] rounded-lg bg-panel p-[14px] text-left shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover">
      <span className="flex items-center gap-[6px] text-title font-medium text-fg">
        {title} <ArrowRight size={14} {...ICON} className="text-fg-subtle" />
      </span>
      <span className="text-body text-fg-muted">{body}</span>
    </button>
  );
  return (
    <section aria-labelledby="doors-title" className="flex flex-col gap-[14px]">
      <div className="flex flex-col gap-[6px]">
        <h1 id="doors-title" className="text-heading font-semibold text-fg">
          Start with {org}&apos;s goals
        </h1>
        <p className="text-body text-fg-muted">Everything in Qalam hangs off them: the problems worth solving are the ones that move a goal.</p>
      </div>
      <div className="grid gap-[12px] sm:grid-cols-2">
        {door("know", "I know our goals", "Write them down, the North Star first and the goals that feed it under it. Qalam AI asks only for what's missing: today's number, the target, by when.")}
        {door("find", "Help me find them", "Paste a strategy doc, OKRs or notes, or give your website. Qalam AI reads it, pushes back and asks, then proposes your goals and what the company is.")}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Writing it

function Compose({ org, onBack }: { org: string; onBack: () => void }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [reading, setReading] = useState<number | null>(null);
  const error = useSetup((s) => s.error);
  const over = text.length > DUMP_MAX_CHARS;
  const ready = !over && (text.trim().length >= 40 || /^\S+\.\S+/.test(url.trim()));
  const read = async () => {
    if (!ready || reading) return;
    setReading(Date.now());
    try {
      await startSetup({ text, url });
    } finally {
      setReading(null);
    }
  };
  return (
    <section aria-labelledby="setup-title" className="flex flex-col gap-[14px]">
      <div className="flex flex-col gap-[6px]">
        <h1 id="setup-title" className="text-heading font-semibold text-fg">
          Tell Qalam AI about {org}
        </h1>
        <p className="text-body text-fg-muted">
          A strategy doc, OKRs, notes, or just what you know, as it comes. Nothing is written until you accept it.{" "}
          <Tip label="What the company does, its products, who they're for, the goals you're moving, the numbers you watch. Qalam AI reads it, pushes back and asks before it proposes anything, line by line.">
            <span className="cursor-help underline decoration-dotted underline-offset-2">What to write</span>
          </Tip>
        </p>
      </div>
      <textarea
        aria-label="About the company"
        autoFocus
        dir="auto"
        rows={12}
        className={clsx(r.textarea, "min-h-[240px] text-body")}
        placeholder="We're a grocery delivery app in Dubai, mostly parents with young kids…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void read();
        }}
      />
      <label className="flex flex-col gap-[6px]">
        <span className="text-caption font-medium text-fg-muted">Or start from a web page, such as your website</span>
        <span className={clsx(r.field, "h-[32px]")}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" inputMode="url" className={clsx(r.fieldInput, "text-body")} />
        </span>
      </label>
      {error && <ErrorNote message={error} />}
      {reading && <Progress label={url.trim() ? "Reading the page" : "Reading what you wrote"} started={reading} tokens={0} />}
      <div className="flex items-center gap-[8px]">
        <span className={clsx("text-micro tnum", over ? "text-danger" : "text-fg-subtle")}>
          {text.length.toLocaleString()} / {DUMP_MAX_CHARS.toLocaleString()}
        </span>
        <span className="flex-1" />
        <button type="button" className={qr.textBtn} onClick={onBack}>
          Back
        </button>
        <Button disabled={!ready || !!reading} onClick={() => void read()} title={ready ? undefined : "Write a little more first, or give a web address"}>
          <QalamAIGlyph size={12} /> Read it
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The conversation

function Session({ source, s, org, first, onGoalsIn }: { source: SourceRecord; s: SetupSession; org: string; first: boolean; onGoalsIn: () => void }) {
  const busy = useSetup((u) => u.busy);
  const last = s.buckets.length - 1;
  const asking = s.phase === "asking" && !busy;
  return (
    <section aria-label={`Setting up ${org}`} className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[6px]">
        <h1 className="text-heading font-semibold text-fg">Setting up {org}</h1>
        <p className="text-caption text-fg-muted">From {source.origin ? `what you wrote and ${source.origin}` : "what you wrote"}. Nothing is written to the organization until you accept it.</p>
      </div>
      {s.understanding && (
        <div className={qr.card}>
          <span className={qr.caption}>
            <QalamAIGlyph size={12} /> What I took from it
          </span>
          <p className="text-body leading-[20px] text-fg" dir="auto">
            {s.understanding}
          </p>
        </div>
      )}
      {s.challenges.length > 0 && s.phase !== "review" && s.phase !== "done" && <Pushback source={source} s={s} />}
      {s.buckets.map((b, i) =>
        i < last || (i === last && (b.form.submitted || !asking)) ? (
          <div key={i} className="flex flex-col gap-[8px]">
            <AnswersSummary questions={b.questions.map(toQuestion)} answers={b.form.answers} label={`Your answers · round ${i + 1}`} />
            {b.analysis && (
              <div className={qr.card}>
                <span className={qr.caption}>
                  <QalamAIGlyph size={12} /> What I took from your answers
                </span>
                <p className="text-body leading-[20px] text-fg" dir="auto">
                  {b.analysis}
                </p>
              </div>
            )}
          </div>
        ) : null,
      )}
      {asking && last >= 0 && <Round key={`${source.id}:${last}`} s={s} />}
      {busy && (
        <div className="flex flex-col gap-[8px]">
          <Progress label={busy.label} started={busy.started} tokens={busy.tokens} />
          <Button variant="secondary" size="sm" className="self-start" onClick={stopSetup}>
            <Square size={10} fill="currentColor" {...ICON} /> Stop
          </Button>
        </div>
      )}
      {!busy && s.phase === "failed" && s.failed && (
        <div className="flex flex-col gap-[8px]">
          <ErrorNote message={s.failed.error === "Stopped." ? "You stopped Qalam AI before it finished." : `Qalam AI couldn't finish: ${s.failed.error}`} />
          <Button size="sm" className="self-start" onClick={retrySetup}>
            <RotateCcw size={12} {...ICON} /> Try again
          </Button>
        </div>
      )}
      {!busy && s.phase === "asking" && (
        <button type="button" className={clsx(qr.textBtn, "self-start")} onClick={() => void skipSetupRest()}>
          Skip the questions and propose now
        </button>
      )}
      {!busy && s.phase === "ready" && (
        <Button size="sm" className="self-start" onClick={() => void placeSetup()}>
          <QalamAIGlyph size={12} /> Propose the organization
        </Button>
      )}
      {(s.phase === "review" || s.phase === "done") && s.proposal && <Review source={source} s={s} org={org} first={first} onGoalsIn={onGoalsIn} />}
      {s.phase === "done" && !s.proposal?.lines.length && <p className="text-body text-fg-muted">Qalam AI found nothing it could set up from it. Fill in the organization by hand from its home.</p>}
    </section>
  );
}

/** Qalam AI's pushback: what doesn't hold up, and their words it's about. */
function Pushback({ source, s }: { source: SourceRecord; s: SetupSession }) {
  return (
    <section className="flex flex-col gap-[8px]" aria-label="Pushback">
      <span className="text-micro font-medium text-fg-subtle">Pushback</span>
      {s.challenges.map((c) => {
        const words = source.quotes.find((q) => q.id === c.quoteId);
        return (
          <div key={c.id} className={clsx(qr.inset, "flex flex-col gap-[6px] px-[12px] py-[10px]")}>
            <span className="self-start">
              <Tag>{CHALLENGE_LABEL[c.kind]}</Tag>
            </span>
            <p className="text-body leading-[20px] text-fg" dir="auto">
              {c.text}
            </p>
            {words && (
              <p className="line-clamp-2 text-caption text-fg-subtle" dir="auto">
                Your words: “{words.text}”
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Round({ s }: { s: SetupSession }) {
  const i = s.buckets.length - 1;
  const b = s.buckets[i];
  const [form, setForm] = useState<FlowState>(b.form);
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

// ---------------------------------------------------------------------------
// The proposals, line by line

interface Group {
  key: string;
  title: string;
  fresh: boolean;
  labels: Record<SetupField, string>;
  lines: SetupLine[];
}

/** The lines by where they go: the organization first, then each product (new ones as Qalam AI named them). */
function groupsOf(s: SetupSession, org: string, products: Product[]): Group[] {
  // Goals show first, as one tree (GoalLines).
  const lines = (s.proposal?.lines ?? []).filter((l) => l.field !== "goals");
  const ordered = (to: string) => lines.filter((l) => l.to === to).sort((a, b) => ORDER.indexOf(a.field) - ORDER.indexOf(b.field));
  const groups: Group[] = [{ key: "org", title: `About ${org}`, fresh: false, labels: ORG_FIELD, lines: ordered("org") }];
  for (const to of [...new Set(lines.map((l) => l.to))].filter((t) => t !== "org")) {
    const made = to.startsWith("new:") ? s.made?.[to.slice(4)] : to;
    const p = products.find((x) => x.id === made);
    const proposed = s.proposal?.products.find((x) => `new:${x.ref}` === to);
    groups.push({ key: to, title: p?.name ?? proposed?.name ?? "A product", fresh: to.startsWith("new:") && !p, labels: PRODUCT_FIELD, lines: ordered(to) });
  }
  return groups.filter((g) => g.lines.length);
}

/** Where a line goes, by name: the organization, or a product (a new one as Qalam AI named it). */
function placeName(to: string, s: SetupSession, products: Product[]): string {
  if (to === "org") return "The whole organization";
  const made = to.startsWith("new:") ? s.made?.[to.slice(4)] : to;
  const proposed = s.proposal?.products.find((x) => `new:${x.ref}` === to);
  return products.find((x) => x.id === made)?.name ?? (proposed ? `${proposed.name} · a new product` : "A product");
}

function Review({ source, s, org, first, onGoalsIn }: { source: SourceRecord; s: SetupSession; org: string; first: boolean; onGoalsIn: () => void }) {
  const { products } = useOrgContext();
  const [working, setWorking] = useState(false);
  const pending = pendingLines(s);
  const act = async (fn: () => Promise<void>) => {
    if (working) return;
    setWorking(true);
    try {
      await fn();
    } finally {
      setWorking(false);
    }
  };
  const groups = groupsOf(s, org, products);
  const decided = Object.values(s.decided ?? {});
  return (
    <section aria-label="What Qalam AI proposes" className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <span className="flex-1 text-caption text-fg-muted" dir="auto">
          {s.proposal!.summary}
        </span>
        {pending.length > 0 && (
          <>
            <Button variant="secondary" size="sm" disabled={working} onClick={() => void act(() => discardLines(pending.map((l) => l.id)))}>
              Discard all
            </Button>
            <Button size="sm" disabled={working} onClick={() => void act(() => acceptLines(pending.map((l) => l.id)))}>
              Accept all · {pending.length}
            </Button>
          </>
        )}
      </div>
      {goalLines(s.proposal!).length > 0 && (
        <section aria-label="Goals" className="flex flex-col gap-[8px] rounded-lg bg-panel p-[14px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <h2 className="text-title font-medium text-fg">Goals</h2>
          <ul className="flex flex-col gap-[6px]">
            {goalLines(s.proposal!).map(({ line, depth }, i) => (
              <LineRow
                key={line.id}
                line={line}
                depth={depth}
                label={
                  <span className="flex items-center gap-[6px]">
                    {i === 0 && !depth ? <Star size={12} {...ICON} /> : <Target size={12} {...ICON} />}
                    {[i === 0 && !depth && line.to === "org" ? "North Star" : null, placeName(line.to, s, products), line.metric ? [line.metric.name !== line.text ? line.metric.name : null, metricLine(line.metric)].filter(Boolean).join(": ") : "No number yet"].filter(Boolean).join(" · ")}
                  </span>
                }
                source={source}
                state={s.decided?.[line.id]}
                working={working}
                act={act}
              />
            ))}
          </ul>
        </section>
      )}
      {groups.map((g) => (
        <section key={g.key} aria-label={g.title} className="flex flex-col gap-[8px] rounded-lg bg-panel p-[14px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <div className="flex items-center gap-[8px]">
            <h2 className="text-title font-medium text-fg" dir="auto">
              {g.title}
            </h2>
            {g.fresh && <Tag tone="ai">New product</Tag>}
          </div>
          <ul className="flex flex-col gap-[6px]">
            {g.lines.map((l) => (
              <LineRow key={l.id} line={l} label={g.labels[l.field]} source={source} state={s.decided?.[l.id]} working={working} act={act} />
            ))}
          </ul>
        </section>
      ))}
      {s.phase === "done" && (first ? <GoalsIn org={org} accepted={decided.filter((d) => d === "accepted").length} onNext={onGoalsIn} /> : <Done s={s} org={org} accepted={decided.filter((d) => d === "accepted").length} />)}
    </section>
  );
}

function LineRow({ line, label, depth = 0, source, state, working, act }: { line: SetupLine; label: React.ReactNode; depth?: number; source: SourceRecord; state?: "accepted" | "discarded"; working: boolean; act: (fn: () => Promise<void>) => Promise<void> }) {
  const words = line.pieces.flatMap((id) => source.quotes.find((q) => q.id === id) ?? []);
  return (
    <li className={clsx(qr.inset, "flex flex-col gap-[6px] px-[12px] py-[10px]", state === "discarded" && "opacity-55")} style={depth ? { marginLeft: Math.min(depth, 4) * 20 } : undefined}>
      <div className="flex items-start gap-[10px]">
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-micro font-medium text-fg-subtle">{label}</span>
          <p className={clsx("text-body leading-[20px] text-fg", state === "discarded" && "line-through")} dir="auto">
            {line.text}
          </p>
        </div>
        {state ? (
          <span className="inline-flex h-[24px] shrink-0 items-center gap-[4px] text-caption text-fg-muted">
            {state === "accepted" ? (
              <>
                <Check size={12} {...ICON} /> Accepted
              </>
            ) : (
              "Discarded"
            )}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-[4px]">
            <button type="button" disabled={working} className={qr.textBtn} onClick={() => void act(() => discardLines([line.id]))}>
              Discard
            </button>
            <Button size="sm" variant="secondary" disabled={working} onClick={() => void act(() => acceptLines([line.id]))}>
              Accept
            </Button>
          </span>
        )}
      </div>
      {(words.length > 0 || line.answers.length > 0) && (
        <div className="flex flex-col gap-[2px] text-caption text-fg-subtle" aria-label="What it rests on">
          {words.map((q) => (
            <p key={q.id} className="line-clamp-2" dir="auto">
              Your words: “{q.text}”
            </p>
          ))}
          {line.answers.map((a, i) => (
            <p key={i} className="line-clamp-2" dir="auto">
              You answered “{a.question}”: {a.answer}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

/** Every line settled on the first run: on to which goals are theirs. */
function GoalsIn({ org, accepted, onNext }: { org: string; accepted: number; onNext: () => void }) {
  return (
    <section aria-label="Goals in" className="flex flex-col gap-[12px]">
      <h2 className="flex items-center gap-[8px] text-heading font-semibold text-fg">
        <span className="grid size-[22px] place-items-center rounded-full bg-success-subtle text-success">
          <Check size={13} strokeWidth={2.5} />
        </span>
        {accepted ? "Your goals are in" : "Nothing was written"}
      </h2>
      <p className="text-body text-fg-muted">{accepted ? `${accepted === 1 ? "1 line" : `${accepted} lines`} written to ${org}'s goals, About and products. What you wrote goes on the problem pages too.` : `You can add goals on the Goals page any time.`}</p>
      <Button className="self-start" onClick={onNext}>
        Next: which are yours
      </Button>
    </section>
  );
}

/**
 * Every line settled: All set, with what's next (OpenClaw ends its setup the same way): a board for
 * each goal they accepted, the inbox folder to drop material in, and Connections.
 */
function Done({ s, org, accepted }: { s: SetupSession; org: string; accepted: number }) {
  const goals = boardGoals(s);
  const { products } = useOrgContext();
  const ref = useCurrentOrg();
  const [starting, setStarting] = useState<string | null>(null);
  const inbox = ref ? `${ref.dir}/inbox` : null;
  return (
    <section aria-label="All set" className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[4px]">
        <h2 className="flex items-center gap-[8px] text-heading font-semibold text-fg">
          <span className="grid size-[22px] place-items-center rounded-full bg-success-subtle text-success">
            <Check size={13} strokeWidth={2.5} />
          </span>
          All set
        </h2>
        <p className="text-body text-fg-muted">{accepted ? `${accepted === 1 ? "1 line" : `${accepted} lines`} written to ${org}'s About and products.` : `Nothing was written to ${org}.`}</p>
      </div>
      <div className="flex flex-col gap-[6px]">
        <span className="text-micro font-medium text-fg-subtle">Next</span>
        {goals.map(({ line, product }) => (
          <div key={line.id} className={clsx(qr.inset, "flex items-center gap-[10px] px-[12px] py-[8px]")}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body text-fg" dir="auto">
                {line.text}
              </span>
              <span className="text-micro text-fg-subtle">{product ? (products.find((p) => p.id === product)?.name ?? "A product") : "The whole organization"}</span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={!!starting}
              onClick={() => {
                setStarting(line.id);
                void startBoard(line.id).catch(() => setStarting(null));
              }}
            >
              {s.boards?.[line.id] ? "Open its board" : starting === line.id ? "Starting…" : "Start a board"}
            </Button>
          </div>
        ))}
        {inbox && (
          <div className={clsx(qr.inset, "flex items-center gap-[10px] px-[12px] py-[8px]")}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body text-fg">Drop interviews and notes in the inbox</span>
              <span className="truncate font-mono text-micro text-fg-subtle">{inbox}</span>
            </span>
            <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(inbox).then(() => feedback("Copied the inbox's path", { kind: "success", id: "setup.inbox" }), () => {})}>
              Copy the path
            </Button>
          </div>
        )}
        <a href={placeHref("connections")} className={clsx(qr.inset, "flex items-center gap-[10px] px-[12px] py-[8px] hover:bg-hover")}>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-body text-fg">Connections</span>
            <span className="text-micro text-fg-subtle">Qalam AI, what it used, and This Mac</span>
          </span>
        </a>
      </div>
      <a href={orgHref()} className={clsx(r.button, r.buttonPrimary, "self-start")}>
        Go to {org}
      </a>
    </section>
  );
}
