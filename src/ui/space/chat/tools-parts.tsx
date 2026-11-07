import clsx from "clsx";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { Candidate, ToolRun } from "@/connectors/everywhere";
import { toolNames } from "@/discovery/next";
import { lab } from "@/lab";
import { topicHref } from "@/projects/model";
import type { ToolsJob } from "@/space/chat";
import type { PartData } from "../../chat/types";
import { ReplyChips } from "../../chat/ChatThread";
import { ConnectorLogo } from "../../brand/ConnectorLogo";
import { QalamAIGlyph } from "../../brand/ai-glyph";
import { Progress } from "../../ai/common";
import { Button, Checkbox, Spinner } from "../../controls";
import { useLookTools } from "../../discovery/tools";
import { r } from "../../recipes";
import { useTopics } from "../../topics/list";
import { StatusDot } from "../../viz";
import { ask, bringFound, leaveFound, lookAgain, lookInTools, tickFound, turnOf, useCanvasChat } from "./store";

/*
 * A look in every connected tool, in the canvas's chat (src/connectors/everywhere.ts): the button
 * under Ask's answer, each tool's searcher as it goes, what they found grouped by tool for the person
 * to tick (Qalam AI's picks ticked, with the passage that answers it where code read one, a chart
 * with its numbers as the tool gave them), and where the ones brought in went.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ICON = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

function useTools(id: unknown): { id: string; job: ToolsJob } | null {
  useCanvasChat((s) => s.chat);
  const t = turnOf(String(id));
  return t?.job.kind === "tools" ? { id: t.id, job: t.job } : null;
}

const quoted = (words: readonly string[]) => words.map((w) => `“${w}”`).join(", ");
const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const day = (at: string) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
};

/** Under Ask's answer: the same question looked for in every connected tool. */
export function LookToolsPart({ data }: { data: PartData }) {
  const id = String(data.turn);
  const t = useCanvasChat((s) => s.chat.turns.find((x) => x.id === id));
  const looked = useCanvasChat((s) => s.chat.turns.some((x) => x.job.kind === "tools" && x.job.from === id));
  const tools = useLookTools();
  if (!lab("everywhere") || t?.job.kind !== "ask" || looked || !tools?.length) return null;
  return (
    <ReplyChips>
      <button type="button" className={r.replyChip} onClick={() => void lookInTools(null, t.said, { from: t.id })}>
        <span className="inline-flex items-center -space-x-[3px]" aria-hidden>
          {tools.slice(0, 3).map((x) => (
            <ConnectorLogo key={x.id} id={x.id} size={16} decorative />
          ))}
        </span>
        Look in {toolNames(tools.map((x) => x.label))}
      </button>
    </ReplyChips>
  );
}

/** What a searcher is doing, or how it went, in a line. */
export function runLine(run: ToolRun): string {
  switch (run.state) {
    case "searching":
      return run.searched.length ? `Searching for ${quoted(run.searched.slice(-2))}${run.slow ? ", through Claude Code" : ""}…` : "Working out what to search for…";
    case "picking":
      return `Picking from ${plural(run.seen, "result")}…`;
    case "reading":
      return run.holds === "charts" ? "Reading the charts' numbers…" : "Reading the top picks…";
    case "done":
      return run.picked ? `${plural(run.picked, "pick")} from ${plural(run.seen, "result")}` : run.seen ? `Nothing that fits in ${plural(run.seen, "result")}` : "Nothing on it";
    case "late":
      return "It took too long: what it found by then";
    case "failed":
      return `Couldn't: ${run.why ?? "it didn't answer"}`;
    case "stopped":
      return "Stopped";
  }
}

const going = (run: ToolRun) => run.state === "searching" || run.state === "picking" || run.state === "reading";

function RunLine({ run }: { run: ToolRun }) {
  return (
    <li className="flex min-w-0 items-center gap-[8px] text-caption">
      <ConnectorLogo id={run.tool} size={16} decorative />
      <span className="shrink-0 font-medium text-fg">{run.label}</span>
      <span className={clsx("min-w-0 truncate", run.state === "failed" ? "text-danger" : "text-fg-muted")} title={runLine(run)}>
        {runLine(run)}
      </span>
      {going(run) ? <Spinner size={12} /> : run.state === "done" && run.picked ? <StatusDot tone="ok" /> : null}
    </li>
  );
}

/** Each tool's searcher as it goes. */
export function ToolsLookingPart({ data }: { data: PartData }) {
  const x = useTools(data.turn);
  const live = useCanvasChat((s) => (x ? s.live[x.id] : undefined));
  if (!x) return null;
  const { job } = x;
  return (
    <div className="flex flex-col gap-[8px]">
      <Progress label={job.runs.length ? `Looking in ${toolNames(job.runs.map((r) => r.label))}` : "Looking in your tools"} started={live?.started ?? Date.now()} tokens={0} />
      {job.runs.length > 0 && (
        <ul className="flex flex-col gap-[4px] px-[2px]" aria-label="Each tool as it goes">
          {job.runs.map((run) => (
            <RunLine key={run.tool} run={run} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FoundRow({ c, on, onTick }: { c: Candidate; on: boolean; onTick: (on: boolean) => void }) {
  const title = (
    <span className="flex min-w-0 flex-1 items-center gap-[8px]">
      <span className="min-w-0 flex-1 truncate text-body text-fg" dir="auto">
        {c.hit.title}
      </span>
      {c.hit.at && <span className="shrink-0 text-micro text-fg-subtle tnum">{day(c.hit.at)}</span>}
    </span>
  );
  return (
    <li className="flex flex-col rounded-md px-[6px] hover:bg-hover">
      <span className="flex min-h-[28px] items-center gap-[4px]">
        <Checkbox className="min-w-0 flex-1" checked={on} onChange={onTick} label={title} />
        {c.hit.url && (
          <a href={c.hit.url} target="_blank" rel="noreferrer" className="grid size-[20px] shrink-0 place-items-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg" aria-label={`Open “${c.hit.title}”`}>
            <ArrowUpRight {...ICON} />
          </a>
        )}
      </span>
      <span className="flex flex-col gap-[2px] pb-[5px] pl-[22px]">
        {c.numbers?.length ? (
          <span className="tnum text-caption text-fg" dir="auto">
            {c.numbers.map((n) => `${n.label}: ${n.value.toLocaleString()}`).join(" · ")}
          </span>
        ) : null}
        {c.passages?.length ? (
          <span className="line-clamp-3 text-caption text-fg-muted" dir="auto">
            “{c.passages[0]}”
          </span>
        ) : c.hit.snippet ? (
          <span className="line-clamp-2 text-caption text-fg-subtle" dir="auto">
            {c.hit.snippet}
          </span>
        ) : null}
        {c.why && (
          <span className="inline-flex items-center gap-[4px] text-micro text-fg-subtle" dir="auto">
            <QalamAIGlyph size={12} /> {c.why}
          </span>
        )}
        {c.also?.length ? <span className="text-micro text-fg-subtle">Also in {c.also.join(", ")}</span> : null}
      </span>
    </li>
  );
}

/** Why a tool's finds are shown with none ticked. */
function unpicked(run: ToolRun): string {
  if (run.state === "late") return "It took too long, so these weren't picked: tick what fits.";
  if (run.state === "failed") return `It stopped partway (${run.why ?? "it didn't answer"}), so these weren't picked: tick what fits.`;
  return "Nothing it found seemed to fit, so none are ticked: tick any that does.";
}

/** One tool's finds: its picks, then what its search found that it left, folded. */
function ToolGroup({ id, run, picks, more, ticked }: { id: string; run: ToolRun; picks: Candidate[]; more: Candidate[]; ticked: ReadonlySet<string> }) {
  const tick = (c: Candidate) => (on: boolean) => tickFound(id, c.key, on);
  if (!picks.length && !more.length)
    return (
      <p className="flex items-center gap-[6px] px-[2px] text-caption text-fg-subtle">
        <ConnectorLogo id={run.tool} size={16} decorative /> {run.label}: {run.state === "failed" ? `couldn't, ${run.why ?? "it didn't answer"}` : run.state === "stopped" ? "stopped" : run.seen ? "nothing that fits" : "nothing on it"}
      </p>
    );
  return (
    <section className="flex flex-col gap-[2px]" aria-label={`Found in ${run.label}`}>
      <h4 className="flex min-w-0 items-center gap-[6px] px-[2px] text-caption">
        <ConnectorLogo id={run.tool} size={16} decorative />
        <span className="shrink-0 font-medium whitespace-nowrap text-fg">Found in {run.label}</span>
        {run.searched.length > 0 && (
          <span className="min-w-0 truncate text-micro text-fg-subtle" title={`Searched for ${quoted(run.searched)}`}>
            searched {quoted(run.searched)}
          </span>
        )}
      </h4>
      {!picks.length && <p className="px-[2px] text-micro text-fg-subtle">{unpicked(run)}</p>}
      {picks.length > 0 && (
        <ul className="flex flex-col">
          {picks.map((c) => (
            <FoundRow key={c.key} c={c} on={ticked.has(c.key)} onTick={tick(c)} />
          ))}
        </ul>
      )}
      {more.length > 0 &&
        (picks.length ? (
          <details className="q-fold group/more">
            <summary className="flex cursor-pointer list-none items-center gap-[4px] px-[6px] py-[2px] text-micro text-fg-subtle hover:text-fg">
              <ChevronDown {...ICON} className="transition-[rotate] duration-fast group-open/more:rotate-180" />
              {plural(more.length, "more it found", "more it found")}
            </summary>
            <ul className="flex flex-col">
              {more.map((c) => (
                <FoundRow key={c.key} c={c} on={ticked.has(c.key)} onTick={tick(c)} />
              ))}
            </ul>
          </details>
        ) : (
          <ul className="flex flex-col">
            {more.map((c) => (
              <FoundRow key={c.key} c={c} on={ticked.has(c.key)} onTick={tick(c)} />
            ))}
          </ul>
        ))}
    </section>
  );
}

/** What the tools found, grouped by tool, for them to tick and bring in. */
export function ToolsFoundPart({ data }: { data: PartData }) {
  const x = useTools(data.turn);
  if (!x?.job.found) return null;
  const { id, job } = x;
  const found = job.found!;
  const ticked = new Set(job.ticked ?? []);
  const had = found.filter((c) => c.inSources);
  const count = found.filter((c) => ticked.has(c.key) && !c.inSources).length;
  const any = found.some((c) => !c.inSources);
  return (
    <div className="flex flex-col gap-[10px]">
      <p className="text-caption text-fg-muted">
        I looked in {toolNames(job.runs.map((r) => r.label))} for “{short(job.about)}”{job.secs ? ` · ${job.secs} s` : ""}. {any ? "Tick what to bring in; nothing's taken in until you do." : "None of them had anything new on it."}
      </p>
      {job.runs.map((run) => (
        <ToolGroup key={run.tool} id={id} run={run} picks={found.filter((c) => c.tool === run.tool && c.picked && !c.inSources)} more={found.filter((c) => c.tool === run.tool && !c.picked && !c.inSources)} ticked={ticked} />
      ))}
      {had.length > 0 && (
        <p className="px-[2px] text-caption text-fg-subtle" dir="auto">
          In your sources already: {had.map((c) => `“${short(c.hit.title, 40)}”`).join(", ")}
        </p>
      )}
      {any && (
        <div className="flex flex-wrap items-center gap-[6px]">
          <Button size="sm" disabled={!count} onClick={() => void bringFound(id)}>
            {count ? `Bring in ${count}` : "Bring in"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => leaveFound(id)}>
            Leave them
          </Button>
          {job.card && <span className="text-micro text-fg-subtle">Placed only under “{short(job.card.title, 40)}”</span>}
        </div>
      )}
    </div>
  );
}

/** Where the ones brought in went, and the question asked again with them in. */
export function ToolsBroughtPart({ data }: { data: PartData }) {
  const x = useTools(data.turn);
  const topics = useTopics();
  if (!x?.job.brought) return null;
  const { job } = x;
  const b = job.brought!;
  const pages = b.pages.flatMap((p) => {
    const t = topics?.find((y) => y.id === p);
    return t && t.kind === "need" ? [t] : [];
  });
  const question = job.from && turnOf(job.from)?.job.kind === "ask";
  return (
    <div className="flex flex-col gap-[8px]">
      <p className="text-body text-fg" dir="auto">
        {b.added.length ? `I took in ${plural(b.added.length, "item")}: ${b.added.map((t) => `“${short(t, 40)}”`).join(", ")}.` : "Nothing new was taken in."}
        {b.skipped.length ? ` ${b.skipped.length === 1 ? `“${short(b.skipped[0], 40)}” was` : `${b.skipped.length} were`} in your sources already.` : ""}
      </p>
      {b.failed.map((f) => (
        <p key={f.title} className="text-caption text-fg-subtle" dir="auto">
          I couldn&apos;t take “{short(f.title, 40)}”: {f.why}
        </p>
      ))}
      {pages.length > 0 && (
        <>
          <p className="text-caption text-fg-muted">{pages.length === 1 ? "It went into this problem's page:" : "They went into these problems' pages:"}</p>
          <ul className="flex flex-col gap-[4px]">
            {pages.map((p) => (
              <li key={p.id}>
                <a href={topicHref(p.id)} className="q-item flex min-w-0 items-center rounded-md bg-raised px-[10px] py-[6px] text-body text-fg shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover" dir="auto">
                  <span className="truncate">{p.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {b.added.length > 0 && question && (
        <ReplyChips>
          <button type="button" className={r.replyChip} onClick={() => void ask(turnOf(job.from!)!.said)}>
            <QalamAIGlyph size={12} /> Ask again with them in
          </button>
        </ReplyChips>
      )}
    </div>
  );
}

/** The same look again. */
export function ToolsAgainPart({ data }: { data: PartData }) {
  const x = useTools(data.turn);
  if (!x) return null;
  return (
    <ReplyChips>
      <button type="button" className={r.replyChip} onClick={() => lookAgain(x.id)}>
        Look again
      </button>
    </ReplyChips>
  );
}
