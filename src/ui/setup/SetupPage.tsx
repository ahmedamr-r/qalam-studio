import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, RotateCcw, Square } from "lucide-react";
import { CHALLENGE_LABEL, DUMP_MAX_CHARS, MAX_DUMP_ROUNDS } from "@/discovery/dump";
import type { SourceRecord } from "@/discovery/sources";
import { currentOrg, type OrgRef } from "@/org/client";
import { useOrgContext } from "@/org/context";
import type { Product } from "@/org/context-md";
import { boardGoals, pendingLines, type SetupField, type SetupLine, type SetupSession } from "@/org/setup";
import { orgHref } from "@/projects/model";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { Button, Tag } from "../controls";
import { toQuestion } from "../ai/plan";
import { AnswersSummary, Questionnaire, qr } from "../ai/Questionnaire";
import { ErrorNote, Progress } from "../ai/common";
import type { FlowState } from "../ai/questionFlow";
import { r } from "../recipes";
import { PageFrame } from "../frame/PageFrame";
import { acceptLines, answerSetupRound, discardLines, openSetup, placeSetup, retrySetup, saveSetupRound, skipSetupRest, startBoard, startSetup, stopSetup, useSetup } from "./setup";

/**
 * Setting the organization up from a brain dump about it: they write what the company does, its
 * products, who they're for and the goals they're moving (or point at its website); Qalam AI says
 * what it took from it, pushes back, asks up to three rounds of questions, then proposes the
 * organization's About and its products line by line, each with the words it rests on. Nothing is
 * written until they accept a line. Then each goal they accepted can start a board.
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
  return (
    <PageFrame place={null} crumbs={[{ label: "Set up" }]}>
      <div className={clsx(r.pageMain, "max-w-[680px] gap-[20px]")}>
        {!opened ? null : source?.setup ? <Session source={source} s={source.setup} org={name} /> : <Compose org={name} />}
      </div>
    </PageFrame>
  );
}

// ---------------------------------------------------------------------------
// Writing it

function Compose({ org }: { org: string }) {
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
          What the company does, its products, who they&apos;re for, the goals you&apos;re moving, the numbers you watch: as it comes. Qalam AI reads it, pushes back and asks before anything is written. You accept each line it proposes.
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
        <a href={orgHref()} className={qr.textBtn}>
          Skip for now
        </a>
        <Button disabled={!ready || !!reading} onClick={() => void read()} title={ready ? undefined : "Write a little more first, or give a web address"}>
          <QalamAIGlyph size={12} /> Read it
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The conversation

function Session({ source, s, org }: { source: SourceRecord; s: SetupSession; org: string }) {
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
      {(s.phase === "review" || s.phase === "done") && s.proposal && <Review source={source} s={s} org={org} />}
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
  const lines = s.proposal?.lines ?? [];
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

function Review({ source, s, org }: { source: SourceRecord; s: SetupSession; org: string }) {
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
      {s.phase === "done" && <Done s={s} org={org} accepted={decided.filter((d) => d === "accepted").length} />}
    </section>
  );
}

function LineRow({ line, label, source, state, working, act }: { line: SetupLine; label: string; source: SourceRecord; state?: "accepted" | "discarded"; working: boolean; act: (fn: () => Promise<void>) => Promise<void> }) {
  const words = line.pieces.flatMap((id) => source.quotes.find((q) => q.id === id) ?? []);
  return (
    <li className={clsx(qr.inset, "flex flex-col gap-[6px] px-[12px] py-[10px]", state === "discarded" && "opacity-55")}>
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

/** Every line settled: what's set up, and a board for each goal they accepted. */
function Done({ s, org, accepted }: { s: SetupSession; org: string; accepted: number }) {
  const goals = boardGoals(s);
  const { products } = useOrgContext();
  const [starting, setStarting] = useState<string | null>(null);
  return (
    <section aria-label="Set up" className="flex flex-col gap-[12px]">
      <p className="text-body text-fg-muted">
        {accepted ? `${org} is set up: ${accepted === 1 ? "1 line" : `${accepted} lines`} written to its About and products. What you wrote goes on the topic pages too.` : `Nothing was written to ${org}.`}
      </p>
      {goals.length > 0 && (
        <div className="flex flex-col gap-[6px]">
          <span className="text-micro font-medium text-fg-subtle">Start a board for a goal</span>
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
        </div>
      )}
      <a href={orgHref()} className={clsx(r.button, r.buttonPrimary, "self-start")}>
        Go to {org}
      </a>
    </section>
  );
}
