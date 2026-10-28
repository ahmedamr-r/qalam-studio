import { useEffect, useState } from "react";
import clsx from "clsx";
import { ChartLine, Check, Code, Copy, MessagesSquare, Search, X } from "lucide-react";
import { feedback } from "@/commands/feedback";
import type { Hit } from "@/connectors/recipes";
import type { OstMetric } from "@/discovery/types";
import { changeGoal } from "@/goals/client";
import type { Gap } from "@/goals/gaps";
import type { Job } from "@/goals/jobs";
import type { Goal } from "@/goals/types";
import { codeDb } from "@/org/code";
import { connectorsDb, type ConnectorState } from "@/org/connectors";
import { jobsDb } from "@/org/jobs";
import { placeHref, topicHref } from "@/projects/model";
import { QalamAIGlyph } from "../brand";
import { Button, Checkbox, Tip } from "../controls";
import { MetricSource } from "../numbers/MetricSource";
import { AddToOrg } from "../org/AddToOrg";
import { r } from "../recipes";
import { StatusDot } from "../viz";

/**
 * "What we don't know yet" on a goal's page: what code finds missing (its number, where it stands,
 * the problems behind it, who has them, their open questions), each with the job planned to find
 * out, and "Plan jobs" (Qalam AI). Qalam runs what it can here: a search in a connected tool (the
 * person picks what to bring in) or the number from PostHog. A talk is handed over: the questions,
 * who to ask, and a place to drop the notes. Done jobs say what came of them.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const SMALL = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const KIND_ICON = { search: Search, numbers: ChartLine, talk: MessagesSquare, "read-code": Code } as const;
const DONE_SHOWN = 5;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function Unknowns({ goal, gaps, jobs, onChanged }: { goal: Goal; gaps: Gap[]; jobs: Job[]; onChanged: () => void }) {
  const [planning, setPlanning] = useState<string | null>(null);
  const [planned, setPlanned] = useState<{ added: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tools, setTools] = useState<ConnectorState[] | null>(null);
  // Whether a product's code is read here: a read-code job can run.
  const [hasCode, setHasCode] = useState(false);
  useEffect(() => {
    void connectorsDb.list().then((v) => setTools(v.connectors), () => setTools([]));
    void codeDb.view().then((v) => setHasCode(v.repos.length > 0), () => {});
  }, []);

  const todo = jobs.filter((j) => j.status === "todo");
  const done = jobs.filter((j) => j.status === "done");
  const forGap = new Map(todo.filter((j) => j.gap).map((j) => [j.gap!, j]));
  const openGaps = new Set(gaps.map((g) => g.key));
  // Jobs that close no gap that's open now: worth doing all the same.
  const others = todo.filter((j) => !j.gap || !openGaps.has(j.gap));

  const plan = async () => {
    setPlanning("Qalam AI is planning how to find out");
    setPlanned(null);
    try {
      setPlanned(await jobsDb.plan(goal.id, setPlanning));
      onChanged();
    } catch (e) {
      feedback(`Qalam AI couldn't plan them: ${message(e)}`, { kind: "error", id: "goal.jobs" });
    } finally {
      setPlanning(null);
    }
  };
  const change = async (j: Job, patch: { status: Job["status"]; outcome?: string }) => {
    await jobsDb.change(j.id, patch).catch((e) => feedback(`Couldn't change it: ${message(e)}`, { kind: "error", id: "goal.job" }));
    if (open === j.id) setOpen(null);
    onChanged();
  };

  const row = (j: Job) => <JobRow key={j.id} job={j} goal={goal} tools={tools} hasCode={hasCode} open={open === j.id} onOpen={() => setOpen(open === j.id ? null : j.id)} onChange={(p) => void change(j, p)} onChanged={onChanged} />;

  return (
    <section aria-labelledby="unknowns" className="flex flex-col gap-[10px]">
      <div className="flex flex-wrap items-end justify-between gap-[12px]">
        <div className="flex flex-col gap-[2px]">
          <h2 id="unknowns" className="text-title font-medium">
            What we don&apos;t know yet
          </h2>
          <p className="max-w-[560px] text-caption text-fg-subtle">Each job finds one out: Qalam runs the searches and reads the numbers, and hands over the questions to ask.</p>
        </div>
        <Button variant="secondary" size="sm" disabled={!!planning} onClick={() => void plan()}>
          <QalamAIGlyph size={12} /> {planning ? "Planning…" : todo.length ? "Plan more jobs" : "Plan jobs"}
        </Button>
      </div>
      {planning && <p className="q-shimmer-text text-caption text-fg-muted">{planning}…</p>}
      {planned && !planning && <p className="text-caption text-fg-muted">{planned.added ? `${plural(planned.added, "job")} planned.` : "Nothing new to plan: the jobs here cover it."}</p>}
      {gaps.length || others.length ? (
        <ul className="flex flex-col rounded-lg bg-panel py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          {gaps.map((g) => (
            <li key={g.key} className="flex flex-col gap-[2px] px-[12px] py-[8px]">
              <span className="flex items-start gap-[10px]">
                <span className="pt-[6px]">
                  <StatusDot tone="off" hollow />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-body text-fg">{g.title}</span>
                  {g.kind === "open-question" && g.page && (
                    <a href={topicHref(g.page)} className="text-micro text-fg-subtle hover:text-fg hover:underline">
                      An open question on its problem page
                    </a>
                  )}
                </span>
              </span>
              {forGap.has(g.key) && <ul className="pl-[17px]">{row(forGap.get(g.key)!)}</ul>}
            </li>
          ))}
          {others.length > 0 && (
            <li className="flex flex-col gap-[2px] px-[12px] py-[8px]">
              {gaps.length > 0 && <span className="text-micro font-medium text-fg-subtle">Also worth doing</span>}
              <ul>{others.map(row)}</ul>
            </li>
          )}
        </ul>
      ) : (
        <p className="rounded-lg bg-panel px-[14px] py-[12px] text-body text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">Nothing obvious is missing. Plan jobs can still find what would make the problems behind it surer.</p>
      )}
      {done.length > 0 && (
        <div className="flex flex-col gap-[4px]">
          <span className="text-micro font-medium text-fg-subtle">Done</span>
          <ul className="flex flex-col gap-[2px]">
            {done.slice(0, DONE_SHOWN).map((j) => (
              <li key={j.id} className="group/done flex items-start gap-[8px] text-caption">
                <Check {...SMALL} className="mt-[3px] shrink-0 text-success" />
                <span className="min-w-0 flex-1">
                  <span className="text-fg">{j.title}</span>
                  {j.outcome && <span className="text-fg-muted"> · {j.outcome}</span>}
                  {j.results.length > 0 && j.kind === "talk" && <span className="text-fg-muted"> · {plural(j.results.length, "note")} in</span>}
                </span>
                <button type="button" onClick={() => void change(j, { status: "todo" })} className="shrink-0 text-micro text-fg-subtle opacity-0 hover:text-fg group-hover/done:opacity-100 focus-visible:opacity-100">
                  Not done
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** A job: what it is, why, and the one thing to do with it (run it, connect its tool first, hand it over). */
function JobRow({ job, goal, tools, hasCode, open, onOpen, onChange, onChanged }: { job: Job; goal: Goal; tools: ConnectorState[] | null; hasCode: boolean; open: boolean; onOpen: () => void; onChange: (p: { status: Job["status"]; outcome?: string }) => void; onChanged: () => void }) {
  const Icon = KIND_ICON[job.kind];
  const tool = job.connector ? tools?.find((t) => t.id === job.connector) : undefined;
  const connected = tool?.tone === "ok";
  const action =
    job.kind === "read-code" && !hasCode ? (
      <a href={placeHref("connections")} className={clsx(r.buttonSm, r.buttonGhost)}>
        Connect the code
      </a>
    ) : (job.kind === "search" || job.kind === "numbers") && tools && !connected ? (
      <a href={placeHref("connections")} className={clsx(r.buttonSm, r.buttonGhost)}>
        Connect {tool?.label ?? job.connector}
      </a>
    ) : (
      <Button size="sm" variant={open ? "ghost" : "secondary"} disabled={!tools && job.kind !== "talk"} onClick={onOpen}>
        {open ? "Close" : job.kind === "talk" ? "Hand it over" : "Run it"}
      </Button>
    );
  return (
    <li className="group/job flex flex-col gap-[6px] py-[6px]">
      <div className="flex items-start gap-[10px]">
        <Icon {...ICON} className="mt-[3px] shrink-0 text-fg-subtle" />
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-body text-fg">{job.title}</span>
          <span className="flex items-start gap-[6px] text-caption text-fg-muted">
            {job.by === "qalam" && <QalamAIGlyph size={12} className="mt-[2px] shrink-0" />}
            <span>{job.why}</span>
          </span>
          {job.kind === "talk" && job.results.length > 0 && <span className="text-micro text-fg-subtle">{plural(job.results.length, "note")} in</span>}
        </span>
        <span className="flex shrink-0 items-center gap-[4px]">
          {action}
          <Tip label="Not worth doing">
            <button type="button" aria-label="Not worth doing" onClick={() => onChange({ status: "dropped" })} className={clsx(r.iconButton, "opacity-0 group-hover/job:opacity-100 focus-visible:opacity-100")}>
              <X {...ICON} />
            </button>
          </Tip>
        </span>
      </div>
      {open && (
        <div className="ml-[24px] flex flex-col gap-[8px] rounded-md bg-muted px-[10px] py-[8px]">
          {job.kind === "search" && tool && <SearchRun job={job} tool={tool} onDone={onChanged} />}
          {job.kind === "numbers" && <NumbersRun job={job} goal={goal} onDone={(outcome) => onChange({ status: "done", outcome })} />}
          {job.kind === "talk" && <TalkRun job={job} goal={goal} onDone={() => onChange({ status: "done" })} />}
          {job.kind === "read-code" && <CodeRun job={job} onDone={onChanged} />}
        </div>
      )}
      {job.kind === "read-code" && job.questions?.[0] && !open && <p className="ml-[24px] text-caption text-fg-subtle">{hasCode ? "Qalam AI answers it from the product's code" : "Qalam AI answers it from the product's code, once it's connected"}: {job.questions[0]}</p>}
    </li>
  );
}

/** A search in the job's tool: change the words if you like, pick what to bring in, and Qalam takes it in and links it to the goals. */
function SearchRun({ job, tool, onDone }: { job: Job; tool: ConnectorState; onDone: () => void }) {
  const [query, setQuery] = useState(job.query ?? "");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const viaClaudeCode = tool.via === "claude-code";
  const search = async () => {
    setBusy(viaClaudeCode ? `Searching ${tool.label} through Claude Code, about a minute` : `Searching ${tool.label}`);
    setError(null);
    try {
      const found = await jobsDb.search(job.id, query);
      setHits(found);
      setPicked(new Set(found.slice(0, 5).map((h) => h.id)));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  const takeIn = async () => {
    const list = (hits ?? []).filter((h) => picked.has(h.id));
    setBusy(`Bringing in ${plural(list.length, "item")}`);
    setError(null);
    try {
      await jobsDb.takeIn(job.id, list, setBusy);
      onDone();
    } catch (e) {
      setError(message(e));
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-[6px]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        className="flex items-center gap-[6px]"
      >
        <span className={clsx(r.field, "flex-1")}>
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`Search ${tool.label}`} className={r.fieldInput} />
        </span>
        <Button type="submit" size="sm" variant="secondary" disabled={!!busy || !query.trim()}>
          Search {tool.label}
        </Button>
      </form>
      {hits && (
        <>
          {hits.length ? (
            <ul className="flex max-h-[280px] flex-col overflow-y-auto">
              {hits.map((h) => (
                <li key={h.id}>
                  <Checkbox
                    checked={picked.has(h.id)}
                    onChange={(on) => setPicked((s) => (on ? new Set([...s, h.id]) : new Set([...s].filter((x) => x !== h.id))))}
                    label={
                      <span className="flex min-w-0 flex-col py-[2px]">
                        <span className="truncate text-caption text-fg">{h.title}</span>
                        {h.snippet && <span className="line-clamp-2 text-micro text-fg-subtle">{h.snippet}</span>}
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-caption text-fg-muted">Nothing in {tool.label} for those words. Try others.</p>
          )}
          {hits.length > 0 && (
            <Button size="sm" className="self-start" disabled={!!busy || !picked.size} onClick={() => void takeIn()}>
              Bring in {plural(picked.size, "item")}
            </Button>
          )}
        </>
      )}
      {busy && <p className="q-shimmer-text text-caption text-fg-muted">{busy}…</p>}
      {error && <p className="text-caption text-danger">{error}</p>}
    </div>
  );
}

/** The goal's number from a saved PostHog insight: once read, the goal shows where it stands, and the job is done. */
function NumbersRun({ job, goal, onDone }: { job: Job; goal: Goal; onDone: (outcome: string) => void }) {
  const m: OstMetric = goal.metric ?? { name: "", direction: "increase", baseline: null, current: null, target: null };
  const read = (next: OstMetric) => {
    if (next.current === null || !next.source) return;
    // The first reading is where it started, when nothing says otherwise.
    const first = m.baseline === null && m.current === null;
    const metric: OstMetric = { ...next, name: next.name || next.source.label || "", ...(first ? { baseline: next.current } : {}) };
    void changeGoal(goal.id, { metric }).then(
      () => onDone(`Read ${next.current} from PostHog${next.source?.label ? ` · ${next.source.label}` : ""}${first ? ", where it starts" : ""}`),
      (e) => feedback(`Couldn't save the number: ${message(e)}`, { kind: "error", id: "goal.metric" }),
    );
  };
  return <MetricSource m={m} onChange={read} query={job.query} open />;
}

/** A question for the product's code: Qalam AI reads it, and the answer stands only where the code says it. */
function CodeRun({ job, onDone }: { job: Job; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy("Qalam AI is reading the code");
    setError(null);
    try {
      setAnswer((await codeDb.answer(job.id, setBusy)).text);
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-[6px]">
      <span className="text-caption text-fg">{job.questions?.[0]}</span>
      {answer === undefined && !busy && (
        <Button size="sm" className="self-start" onClick={() => void run()}>
          Read the code for it
        </Button>
      )}
      {busy && <p className="q-shimmer-text text-caption text-fg-muted">{busy}…</p>}
      {answer === null && <p className="text-caption text-fg-muted">Qalam AI couldn&apos;t point to the code that answers it.</p>}
      {answer && <p className="text-caption text-fg-muted">{answer}</p>}
      {error && <p className="text-caption text-danger">{error}</p>}
    </div>
  );
}

/** A job handed over: the questions to ask and who to ask, and a place for the notes when they come back. */
function TalkRun({ job, goal, onDone }: { job: Job; goal: Goal; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const questions = job.questions ?? [];
  const copy = () =>
    void navigator.clipboard.writeText(questions.map((q, i) => `${i + 1}. ${q}`).join("\n")).then(
      () => setCopied(true),
      () => feedback("Couldn't copy them.", { kind: "error", id: "goal.job.copy" }),
    );
  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-col gap-[4px]">
        <span className="flex items-center justify-between gap-[8px]">
          <span className="text-micro font-medium text-fg-subtle">What to ask</span>
          <Button size="sm" variant="ghost" onClick={copy}>
            <Copy {...SMALL} /> {copied ? "Copied" : "Copy"}
          </Button>
        </span>
        <ol className="flex list-decimal flex-col gap-[2px] pl-[18px] text-caption text-fg">
          {questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </div>
      <div className="flex flex-col gap-[4px]">
        <span className="text-micro font-medium text-fg-subtle">Who to ask</span>
        {job.who?.length ? (
          <ul className="flex flex-col gap-[2px] text-caption">
            {job.who.map((w) => (
              <li key={`${w.kind}:${w.name}`} className="text-fg">
                {w.kind === "segment" && w.id ? (
                  <a href={topicHref(w.id)} className="hover:underline">
                    {w.name}
                  </a>
                ) : (
                  w.name
                )}
                <span className="text-fg-subtle"> · {w.kind === "segment" ? "a segment" : w.kind === "person" ? "named in your material" : "inside the team"}</span>
                {w.why && <span className="text-fg-muted"> · {w.why}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption text-fg-muted">Your material names no one for this yet: pick who to ask.</p>
        )}
      </div>
      <AddToOrg product={goal.product} job={job.id} hint="When you've talked to them: notes, a transcript or a recording. Qalam AI files what was said and links it to the goals." />
      <Button size="sm" variant="secondary" className="self-start" onClick={onDone}>
        Mark it done
      </Button>
    </div>
  );
}
