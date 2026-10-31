import { useState } from "react";
import clsx from "clsx";
import { Check, Quote } from "lucide-react";
import { nanoid } from "nanoid";
import type { AskAnswer, AskClaim, AskUnknown } from "@/hub/ask";
import { claimStrip } from "@/hub/ask";
import type { TopicInfo } from "@/hub/topics";
import { topicsDb } from "@/org/topics";
import { topicHref } from "@/projects/model";
import type { PartData } from "../../chat/types";
import type { PartComponent } from "../../chat/ChatThread";
import { Progress } from "../../ai/common";
import { Button, Tag, Tip } from "../../controls";
import { Dots, StatusDot } from "../../viz";
import { r } from "../../recipes";
import { useTopics } from "../../topics/list";
import { useWords } from "../../frame/store";
import { turnOf, useCanvasChat } from "./store";

/*
 * What Qalam AI's messages in the canvas's chat draw (./CanvasChat.tsx): each part names its turn,
 * and reads the rest from the chat's store. An answer is Ask's: what's backed, by how much, the
 * claims with their quotes (every one found word for word where it says), what it couldn't back,
 * and what nobody knows yet, which can go on a problem's page as an open question.
 */

const plural = (k: number, one: string) => `${k} ${k === 1 ? one : `${one}s`}`;

/** Qalam AI at work on a turn: what it's doing now, and for how long. */
function WorkingPart({ data }: { data: PartData }) {
  const id = String(data.turn);
  const live = useCanvasChat((s) => s.live[id]);
  const said = useCanvasChat((s) => s.chat.turns.find((t) => t.id === id)?.said ?? "");
  const { org } = useWords();
  if (!live) return null;
  return (
    <div className="flex flex-col gap-[6px]">
      <Progress label={live.steps.at(-1) ?? `Looking through the ${org} for “${said.length > 60 ? `${said.slice(0, 59)}…` : said}”`} started={live.started} tokens={0} />
      {live.steps.length > 1 && (
        <ul className="flex flex-col gap-[2px] px-[2px] text-caption text-fg-subtle">
          {live.steps.slice(0, -1).map((s, i) => (
            <li key={i} className="truncate">
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnswerPart({ data }: { data: PartData }) {
  useCanvasChat((s) => s.chat);
  const t = turnOf(String(data.turn));
  const topics = useTopics();
  if (t?.job.kind !== "ask" || !t.job.answer) return null;
  const a = t.job.answer;
  const backed = a.claims.filter((c) => c.backed);
  const unbacked = a.claims.filter((c) => !c.backed);
  return (
    <article className="flex flex-col gap-[12px]">
      {a.answer ? <p className="text-body leading-[20px] text-fg">{a.answer}</p> : backed.length ? <p className="text-body text-fg-muted">Its summary said more than what it found shows, so it&apos;s left out.</p> : <p className="text-body text-fg-muted">Nothing the organization has backs an answer.</p>}
      <Strip a={a} secs={t.job.secs ?? 0} />
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
          <h4 className="text-caption font-medium text-fg-muted">I couldn&apos;t back these</h4>
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
          <ul className="flex flex-col gap-[8px]">
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
          Checked{secs ? ` · ${secs} s` : ""}
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
      {open &&
        c.support.map((s, i) => (
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
    <li className="flex flex-col items-start gap-[4px]">
      <span className="text-body text-fg">{u.question}</span>
      {u.why && <span className="text-caption text-fg-muted">{u.why}</span>}
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

export const PARTS: Record<string, PartComponent> = {
  working: WorkingPart,
  answer: AnswerPart,
};
