import { useEffect, useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import { ArrowUp, Check, Plus, Quote, X } from "lucide-react";
import { nanoid } from "nanoid";
import { aiStatus } from "@/ai/client";
import type { AskAnswer, AskClaim, AskUnknown } from "@/hub/ask";
import type { TopicInfo } from "@/hub/topics";
import { askOrganization } from "@/org/ask";
import { claimStrip } from "@/hub/ask";
import { topicsDb } from "@/org/topics";
import { topicHref } from "@/projects/model";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { Button, IconBtn, Tag, Tip } from "../controls";
import { Dots, StatusDot } from "../viz";
import { r } from "../recipes";
import { AddToOrg } from "./AddToOrg";
import { ASK_EVENT, takeAskNext } from "./ask-next";
import { MicButton, speechInto } from "../voice/MicButton";

/**
 * Ask the organization, from its home: a question in plain words, and Qalam AI's answer from what
 * the organization knows (its topic pages, sources, boards and decisions), with what it rests on.
 * Every quote in it was found word for word where it says; a claim Qalam AI couldn't back says so.
 * What nobody knows yet can go on a topic page as an open question.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type State = { kind: "idle" } | { kind: "asking"; question: string; steps: string[]; started: number } | { kind: "answered"; answer: AskAnswer; secs: number } | { kind: "failed"; question: string; error: string };

export function AskBar({ product, topics }: { product: string | null; topics: TopicInfo[] | null }) {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [adding, setAdding] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const ask = async (e?: FormEvent, text?: string) => {
    e?.preventDefault();
    const q = (text ?? question).replace(/\s+/g, " ").trim();
    if (q.length < 3 || state.kind === "asking") return;
    if (!(await aiStatus()).ai) return setState({ kind: "failed", question: q, error: "Qalam AI isn't set up here, so it can't answer. The topic pages and Sources tab have what's known." });
    const c = new AbortController();
    ctrl.current = c;
    const started = Date.now();
    setState({ kind: "asking", question: q, steps: [], started });
    try {
      const answer = await askOrganization(q, {
        product,
        signal: c.signal,
        onActivity: (label) => setState((s) => (s.kind === "asking" ? { ...s, steps: [...s.steps, label].slice(-4) } : s)),
      });
      setState({ kind: "answered", answer, secs: Math.round((Date.now() - started) / 1000) });
    } catch (err) {
      setState((err as Error).name === "AbortError" ? { kind: "idle" } : { kind: "failed", question: q, error: message(err) });
    } finally {
      ctrl.current = null;
    }
  };

  // A question asked from ⌘K on another page (or this one) lands here and is asked.
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    const take = (q: string | null) => {
      if (!q) return;
      setQuestion(q);
      void askRef.current(undefined, q);
    };
    take(takeAskNext());
    const on = (e: Event) => take((e as CustomEvent<string>).detail);
    window.addEventListener(ASK_EVENT, on);
    return () => window.removeEventListener(ASK_EVENT, on);
  }, []);

  return (
    <section aria-label="Ask the organization" data-ask-bar className="flex flex-col gap-[10px]">
      <form onSubmit={(e) => void ask(e)} className="flex items-center gap-[8px] rounded-lg bg-panel py-[6px] pr-[6px] pl-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)] focus-within:shadow-[inset_0_0_0_1px_var(--color-line-strong)]">
        <QalamAIGlyph size={14} />
        <input
          ref={field}
          aria-label="Ask what your organization knows"
          className={clsx(r.fieldInput, "h-[28px] text-body")}
          placeholder="Ask what your organization knows: why do parents stop ordering?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={state.kind === "asking"}
        />
        {state.kind !== "asking" && <MicButton size="md" field={field} onText={speechInto(field, setQuestion)} />}
        {state.kind === "asking" ? (
          <Button variant="secondary" size="sm" onClick={() => ctrl.current?.abort()}>
            Stop
          </Button>
        ) : (
          <IconBtn label="Ask" disabled={question.trim().length < 3} onClick={() => void ask()}>
            <ArrowUp {...ICON} />
          </IconBtn>
        )}
        <IconBtn label={adding ? "Close" : "Add to the organization: interviews, tickets, notes, pages"} active={adding} onClick={() => setAdding(!adding)}>
          <Plus {...ICON} />
        </IconBtn>
      </form>
      {adding && <AddToOrg product={product} />}
      {state.kind === "asking" && (
        <div role="status" className="flex flex-col gap-[2px] px-[2px] text-caption text-fg-muted">
          <span>Qalam AI is looking through the organization for “{state.question}”…</span>
          {state.steps.map((s, i) => (
            <span key={i} className={clsx("truncate", i < state.steps.length - 1 && "text-fg-subtle")}>
              {s}
            </span>
          ))}
        </div>
      )}
      {state.kind === "failed" && <p className="px-[2px] text-caption text-fg-muted">Qalam AI couldn&apos;t answer “{state.question}”: {state.error}</p>}
      {state.kind === "answered" && <Answer a={state.answer} secs={state.secs} topics={topics} onClose={() => setState({ kind: "idle" })} />}
    </section>
  );
}

function Answer({ a, secs, topics, onClose }: { a: AskAnswer; secs: number; topics: TopicInfo[] | null; onClose: () => void }) {
  const backed = a.claims.filter((c) => c.backed);
  const unbacked = a.claims.filter((c) => !c.backed);
  return (
    <article className="flex flex-col gap-[14px] rounded-lg bg-panel px-[16px] py-[14px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <header className="flex items-start justify-between gap-[12px]">
        <h3 className="text-title font-medium text-fg">{a.question}</h3>
        <IconBtn size="sm" label="Close the answer" onClick={onClose}>
          <X {...ICON} />
        </IconBtn>
      </header>
      <Strip a={a} secs={secs} />
      {a.answer ? <p className="text-body text-fg">{a.answer}</p> : backed.length ? <p className="text-body text-fg-muted">Its summary said more than what it found shows, so it&apos;s left out.</p> : <p className="text-body text-fg-muted">Nothing the organization has backs an answer.</p>}
      {backed.length > 0 && (
        <section className="flex flex-col gap-[8px]">
          <h4 className="text-caption font-medium text-fg-muted">What it rests on</h4>
          <ul className="flex flex-col gap-[10px]">
            {backed.map((c, i) => (
              <ClaimRow key={i} c={c} />
            ))}
          </ul>
        </section>
      )}
      {unbacked.length > 0 && (
        <section className="flex flex-col gap-[6px]">
          <h4 className="text-caption font-medium text-fg-muted">Qalam AI couldn&apos;t back these</h4>
          <ul className="flex flex-col gap-[4px]">
            {unbacked.map((c, i) => (
              <li key={i} className="text-caption text-fg-subtle">
                {c.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      {a.unknowns.length > 0 && (
        <section className="flex flex-col gap-[6px]">
          <h4 className="text-caption font-medium text-fg-muted">What nobody knows yet</h4>
          <ul className="flex flex-col gap-[6px]">
            {a.unknowns.map((u, i) => (
              <UnknownRow key={i} u={u} topics={topics} />
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** The answer at a glance: what's backed, by how much, what isn't, and what nobody knows. */
function Strip({ a, secs }: { a: AskAnswer; secs: number }) {
  const n = claimStrip(a);
  const plural = (k: number, one: string) => `${k} ${k === 1 ? one : `${one}s`}`;
  return (
    <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px] text-caption tnum">
      <span className="inline-flex items-center gap-[6px] text-fg">
        <StatusDot tone={n.backed ? "ok" : "off"} />
        {plural(n.backed, "claim")} backed
      </span>
      {n.quotes > 0 && (
        <span className="inline-flex items-center gap-[6px] text-fg-muted">
          <Dots count={n.sources} label={plural(n.sources, "source")} />
          {plural(n.quotes, "quote")} · {plural(n.sources, "source")}
        </span>
      )}
      {n.unbacked > 0 && <span className="text-warning">{n.unbacked} not backed</span>}
      {n.unknowns > 0 && <span className="text-fg-muted">{plural(n.unknowns, "open question")}</span>}
      <Tip label={`${a.how === "agent" ? "Qalam AI searched the organization's folder" : "Qalam AI read what the organization's search found"}. Every quote was found word for word where it says.`}>
        <span className="ml-auto inline-flex items-center gap-[4px] text-fg-subtle">
          <Check size={12} absoluteStrokeWidth strokeWidth={1.5} />
          Checked · {secs} s
        </span>
      </Tip>
    </div>
  );
}

function ClaimRow({ c }: { c: AskClaim }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-[6px]">
      <div className="flex items-start gap-[8px]">
        <span className="min-w-0 flex-1 text-body text-fg">{c.text}</span>
        {c.support.length > 0 && (
          <button type="button" aria-expanded={open} aria-label={open ? "Hide the quotes" : "Show the quotes"} onClick={() => setOpen((o) => !o)} className={clsx(r.chip, "mt-[2px] shrink-0 hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg")}>
            <Quote size={10} absoluteStrokeWidth strokeWidth={1.25} />
            <span className="tnum">{c.support.length}</span>
          </button>
        )}
      </div>
      {open && c.support.map((s, i) => (
        <figure key={i} className="flex flex-col gap-[2px] rounded-md bg-muted px-[10px] py-[6px]">
          <blockquote className="flex gap-[6px] text-caption text-fg" dir="auto">
            <Quote size={12} className="mt-[2px] shrink-0 text-fg-subtle" />
            <span>{s.words.length > 400 ? `${s.words.slice(0, 399).trimEnd()}…` : s.words}</span>
          </blockquote>
          <figcaption className="pl-[18px] text-micro text-fg-subtle">
            {s.href ? (
              <a href={s.href} className="underline decoration-fg/20 underline-offset-2 hover:text-fg">
                {s.label}
              </a>
            ) : (
              s.label
            )}
          </figcaption>
        </figure>
      ))}
    </li>
  );
}

function UnknownRow({ u, topics }: { u: AskUnknown; topics: TopicInfo[] | null }) {
  const [added, setAdded] = useState(false);
  const page = u.topic ? topics?.find((t) => t.id === u.topic) : undefined;
  const add = async () => {
    const v = page ? await topicsDb.get(page.id) : null;
    if (!v) return;
    const t = v.topic;
    // The team asked for it to go there: it's their open question now.
    await topicsDb.put({ ...t, lines: [...t.lines, { id: nanoid(10), section: "open", text: u.question, by: "person", cites: [], from: [], at: Date.now() }] }, t.version);
    setAdded(true);
  };
  return (
    <li className="flex items-start justify-between gap-[10px]">
      <span className="flex flex-col gap-[2px]">
        <span className="text-body text-fg">{u.question}</span>
        {u.why && <span className="text-caption text-fg-muted">{u.why}</span>}
      </span>
      {page &&
        (added ? (
          <Tag>
            Added to{" "}
            <a href={topicHref(page.id)} className="underline">
              {page.title}
            </a>
          </Tag>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => void add()}>
            Add to “{page.title.length > 28 ? `${page.title.slice(0, 27)}…` : page.title}”
          </Button>
        ))}
    </li>
  );
}
