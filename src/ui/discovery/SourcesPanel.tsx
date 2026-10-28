import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowLeft, ClipboardPaste, ExternalLink, FileText, Globe, MessagesSquare, NotebookPen, Plug, Plus, Quote, Trash2, Upload, X } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import type { Doc } from "@/doc/schema";
import { newId } from "@/doc/factory";
import { aiStatus, type AIStatus } from "@/ai/client";
import { revealCard } from "@/discovery/ops";
import { allCards } from "@/discovery/tree";
import { QUOTE_KIND_LABEL, SOURCE_KIND_LABEL, fromSource, pageAt, unread, type SourceKind, type SourceQuote, type SourceRecord } from "@/discovery/sources";
import { ROLE_LABEL } from "@/discovery/dump";
import { awaitingRoles, clock, finishInterviewQuotes } from "@/discovery/transcript";
import { feedback } from "@/commands/feedback";
import { Button, IconBtn, Segmented, Select, Spinner, Tag } from "../controls";
import { r } from "../recipes";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { Progress } from "../ai/common";
import { confirmDialog } from "../surfaces/dialog";
import { getController } from "../CanvasView";
import { glideToLayer } from "./canvas";
import { ACCEPT } from "./ingest";
import { addSources, mapQuotes, readSources, stopSources, type AddInput } from "./import";
import { acceptAll, discardAll, useReview } from "./review";
import { dragQuote, dragSource } from "./drop";
import { addFromOrganization, openSource, removeSource, updateSource, useSources } from "./sources";
import { sourcesDb } from "@/discovery/db";
import { SpeakersLine, SpeakersStep } from "./SpeakersStep";
import { openBrainDump } from "./dump";

/*
 * The Sources tab of a Discovery board: the material customers' words come from (documents, web
 * pages, pasted notes, interviews' caption files, items from connected tools). Qalam AI picks out
 * what customers said and code keeps only quotes it finds word for word, highlighted in the
 * source. Drag a quote onto an opportunity or a solution to back it, or a source onto the board
 * for a note of it. Words can also be quoted by hand: select them in the source's text. An
 * interview first asks who is who: only participants are quoted.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const SMALL = { size: 12, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

const KIND_ICON: Record<SourceKind, typeof FileText> = { pdf: FileText, docx: FileText, markdown: FileText, text: FileText, paste: ClipboardPaste, url: Globe, connector: Plug, interview: MessagesSquare, dump: NotebookPen };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function SourcesPanel() {
  const focus = useSources((s) => s.open?.quoteId);
  const source = useSources((s) => (s.open ? s.list.find((x) => x.id === s.open!.id) : undefined));
  return source ? <SourceView key={source.id} source={source} focus={focus} /> : <SourceList />;
}

/** The panel header's own action: add a source. */
export function SourcesHeaderActions() {
  const adding = useSources((s) => s.adding);
  return (
    <IconBtn size="sm" label={adding ? "Close the form" : "Add a source"} active={adding} onClick={() => useSources.setState({ adding: !adding, open: null })}>
      <Plus {...ICON} />
    </IconBtn>
  );
}

// ---------------------------------------------------------------------------
// The list

function SourceList() {
  const list = useSources((s) => s.list);
  const loaded = useSources((s) => s.loaded);
  const jobs = useSources((s) => s.jobs);
  const failed = useSources((s) => s.failed);
  const adding = useSources((s) => s.adding);
  const pending = Object.entries(jobs).filter(([id, j]) => j.phase === "reading" && !list.some((x) => x.id === id));
  const empty = loaded && !list.length && !pending.length;
  return (
    <div className="flex flex-col gap-[12px] px-[12px] pt-[4px] pb-[16px]">
      {empty && (
        <p className="text-caption leading-[18px] text-fg-muted">
          Bring in what customers said: interview notes, transcripts, support tickets, survey answers, a web page. Qalam AI picks out their words, code checks each quote against the source, and Qalam AI maps them to your tree for you to accept.
        </p>
      )}
      {(adding || empty) && <AddSource />}
      <Notice />
      {failed.map((f) => (
        <div key={f.id} role="alert" className="q-fade flex items-start gap-[8px] rounded-lg bg-danger-subtle py-[8px] pr-[4px] pl-[10px] text-caption text-danger">
          <span className="min-w-0 flex-1">
            <span className="font-medium">{f.title}</span>: {f.error}
          </span>
          <IconBtn size="sm" label="Dismiss" onClick={() => useSources.setState((s) => ({ failed: s.failed.filter((x) => x.id !== f.id) }))}>
            <X {...SMALL} />
          </IconBtn>
        </div>
      ))}
      {(pending.length > 0 || list.length > 0) && (
        <div role="list" aria-label="Sources" className="-mx-[4px] flex flex-col gap-[2px]">
          {pending.map(([id, j]) => (
            <div key={id} role="listitem" className={clsx(r.layerRow, "h-auto min-h-[40px] py-[6px] pl-[8px]")}>
              <Spinner size={12} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body text-fg">{j.title}</span>
                <span className="truncate text-micro text-fg-subtle">Reading…</span>
              </span>
            </div>
          ))}
          {list.map((s) => (
            <SourceRow key={s.id} source={s} quoting={jobs[s.id]?.phase === "quoting"} />
          ))}
        </div>
      )}
      <MapBar />
    </div>
  );
}

function metaOf(s: SourceRecord): string {
  const left = unread(s).length;
  const t = s.transcript;
  const talk = t ? [`${Math.max(1, Math.round(t.durationSec / 60))} min`, plural(t.speakers.length, "speaker")] : [];
  const pieces = s.kind === "dump" ? plural(s.quotes.length, "piece") : plural(s.quotes.length, "quote");
  return [SOURCE_KIND_LABEL[s.kind], ...talk, s.pages ? plural(s.pages.length, "page") : "", awaitingRoles(s) ? "Say who is who" : pieces, left && s.read.length ? `${left} unread` : ""].filter(Boolean).join(" · ");
}

function SourceRow({ source, quoting }: { source: SourceRecord; quoting: boolean }) {
  const Icon = KIND_ICON[source.kind];
  return (
    <div
      role="listitem"
      tabIndex={0}
      draggable
      onDragStart={(e) => dragSource(e, source.id, source.title)}
      onClick={() => openSource(source.id)}
      onKeyDown={(e) => e.key === "Enter" && openSource(source.id)}
      title="Open it · drag it onto the board for a note of it"
      className={clsx(r.layerRow, "h-auto min-h-[40px] cursor-default py-[6px] pl-[8px]")}
    >
      <Icon {...ICON} className={r.layerIcon} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body text-fg" dir="auto">
          {source.title}
        </span>
        <span className={clsx("truncate text-micro", quoting ? "q-shimmer-text text-fg-muted" : "text-fg-subtle")}>{quoting ? "Qalam AI is picking out quotes…" : metaOf(source)}</span>
      </span>
      <span className={r.layerTail} onClick={(e) => e.stopPropagation()}>
        <IconBtn size="sm" label="Remove it from this board" onClick={() => void confirmRemove(source)}>
          <Trash2 {...SMALL} />
        </IconBtn>
      </span>
    </div>
  );
}

async function confirmRemove(s: SourceRecord) {
  const ok = await confirmDialog({ title: `Remove “${s.title}” from this board?`, body: "It stays in the organization's sources, for other boards (and this one again). Its quotes stay on the cards they back.", confirmLabel: "Remove from board" });
  if (ok) void removeSource(s.id);
}

/** The organization's sources this board doesn't use yet: another board's interviews, a brain dump on the home. */
function FromOrganization() {
  const board = useSources((s) => s.projectId);
  const [list, setList] = useState<SourceRecord[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void sourcesDb
      .all()
      .then((all) => live && setList(all.filter((x) => !(x.boards ?? []).includes(board ?? "")).sort((a, b) => b.addedAt - a.addedAt)))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [board]);
  if (!list) return <Spinner />;
  if (!list.length) return <p className="text-caption text-fg-muted">Every source in the organization is on this board already.</p>;
  return (
    <ul className="flex max-h-[280px] flex-col gap-[2px] overflow-y-auto">
      {list.map((x) => (
        <li key={x.id} className="flex items-center gap-[8px] rounded-md px-[6px] py-[4px] hover:bg-hover">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-caption text-fg">{x.title}</span>
            <span className="truncate text-micro text-fg-subtle">
              {SOURCE_KIND_LABEL[x.kind]} · {x.quotes.length} {x.quotes.length === 1 ? "quote" : "quotes"}
            </span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={!!adding}
            onClick={() => {
              setAdding(x.id);
              void addFromOrganization(x.id)
                .then(() => {
                  setList((l) => l?.filter((y) => y.id !== x.id) ?? null);
                  useSources.setState({ adding: false, open: { id: x.id } });
                })
                .catch(() => feedback("Couldn't add it to this board", { kind: "error", id: "discovery.sources" }))
                .finally(() => setAdding(null));
            }}
          >
            {adding === x.id ? "Adding…" : "Add"}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** What the last run has to say, with what to do about it. */
function Notice() {
  const notice = useSources((s) => s.notice);
  const busy = useSources((s) => s.busy);
  if (!notice) return null;
  return (
    <div className="flex flex-col gap-[6px] rounded-lg bg-muted px-[10px] py-[8px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]" role="status">
      <span>{notice.text}</span>
      <div className="flex gap-[6px]">
        {notice.action === "read" && !busy && (
          <Button size="sm" variant="secondary" onClick={() => void keepReading()}>
            Keep reading
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => useSources.setState({ notice: null })}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

async function keepReading(ids?: string[]) {
  useSources.setState({ notice: null });
  const list = useSources.getState().list.filter((s) => (!ids || ids.includes(s.id)) && unread(s).length);
  const found = await readSources(list.map((s) => s.id));
  if (found) void mapQuotes({ sourceIds: list.map((s) => s.id) });
}

/** The foot of the list: Qalam AI's proposals waiting, the run in progress, or "Map quotes to the tree". */
function MapBar() {
  const proposals = useReview((s) => (s.origin?.kind === "sources" ? s.proposals.length : 0));
  const mapping = useSources((s) => s.mapping);
  const busy = useSources((s) => s.busy);
  const quotes = useSources((s) => s.list.reduce((n, x) => n + (x.kind === "dump" ? 0 : x.quotes.length), 0));
  const hasTree = useStudio((s) => s.doc.roots.some((id) => s.doc.nodes[id]?.meta.ost));
  if (proposals)
    return (
      <div className="flex flex-col gap-[8px] rounded-lg bg-ai-subtle px-[10px] py-[10px]" role="status">
        <span className="flex items-start gap-[8px] text-caption text-fg">
          <QalamAIGlyph size={14} className="mt-[2px] shrink-0" />
          <span>
            Qalam AI proposes {plural(proposals, "change")} to the tree. They&apos;re on the board, faded: accept or discard each there, or all of them here.
          </span>
        </span>
        <div className="flex gap-[6px] pl-[22px]">
          <Button size="sm" onClick={acceptAll}>
            Accept all
          </Button>
          <Button size="sm" variant="secondary" onClick={discardAll}>
            Discard all
          </Button>
        </div>
      </div>
    );
  if (mapping)
    return (
      <div className="flex flex-col gap-[8px]">
        <Progress tokens={mapping.tokens} started={mapping.started} label="Qalam AI is mapping quotes to your tree…" />
        <Button size="sm" variant="secondary" className="self-start" onClick={stopSources}>
          Stop
        </Button>
      </div>
    );
  if (busy)
    return (
      <Button size="sm" variant="secondary" className="self-start" onClick={stopSources}>
        Stop reading
      </Button>
    );
  if (!quotes || !hasTree) return null;
  return (
    <Button size="sm" variant="secondary" className="self-start" onClick={() => void mapQuotes()}>
      <QalamAIGlyph size={12} /> Map quotes to the tree
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Adding a source

type Mode = "file" | "url" | "paste" | "tool" | "org";

/** What a source can come from: files, a web page, pasted text, a connected tool. Shared with the start sheet. */
export function AddSource({ onAdd, compact }: { onAdd?: (inputs: AddInput[]) => void; compact?: boolean }) {
  const [mode, setMode] = useState<Mode>("file");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [request, setRequest] = useState("");
  const [tool, setTool] = useState("");
  const [status, setStatus] = useState<AIStatus | null>(null);
  useEffect(() => void aiStatus().then(setStatus), []);
  // Connected tools (MCP servers, Tavily among them); the built-in web search has the Page tab.
  const tools = (status?.connectors ?? []).filter((c) => c.kind !== "web");
  const add = (inputs: AddInput[]) => {
    if (onAdd) return onAdd(inputs);
    useSources.setState({ adding: false });
    void addSources(inputs);
  };
  const modes: { value: Mode; label: string }[] = [
    { value: "file", label: "Files" },
    { value: "url", label: "Page" },
    { value: "paste", label: "Text" },
    ...(tools.length ? [{ value: "tool" as const, label: "Tool" }] : []),
    // On a board: the organization's other sources (interviews another board read, say).
    ...(onAdd ? [] : [{ value: "org" as const, label: "Organization" }]),
  ];
  return (
    <section aria-label="Add a source" className={clsx("flex flex-col gap-[8px]", !compact && "rounded-lg p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]")}>
      <Segmented label="Add from" value={mode} options={modes} onChange={setMode} />
      {mode === "file" && <DropZone onFiles={(files) => add(files.map((file) => ({ kind: "file", file })))} />}
      {mode === "org" && <FromOrganization />}
      {mode === "url" && (
        <form
          className="flex flex-col gap-[6px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!/^https?:\/\/\S+\.\S+/i.test(url.trim())) return;
            add([{ kind: "url", url: url.trim() }]);
            setUrl("");
          }}
        >
          <label className={r.field}>
            <Globe {...SMALL} className="shrink-0 text-fg-subtle" />
            <input className={r.fieldInput} type="url" inputMode="url" aria-label="Web page address" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <p className="text-micro text-fg-subtle">A public page, PDF or Google Doc (shared with “Anyone with the link”).</p>
          <Button size="sm" type="submit" className="self-start" disabled={!/^https?:\/\/\S+\.\S+/i.test(url.trim())}>
            Read the page
          </Button>
        </form>
      )}
      {mode === "paste" && (
        <div className="flex flex-col gap-[6px]">
          <textarea aria-label="Text to add" className={clsx(r.textarea, "text-body")} rows={compact ? 4 : 6} value={text} placeholder="Paste interview notes, a transcript, survey answers…" onChange={(e) => setText(e.target.value)} />
          <Button
            size="sm"
            className="self-start"
            disabled={text.trim().length < 20}
            onClick={() => {
              add([{ kind: "paste", text }]);
              setText("");
            }}
          >
            Add the text
          </Button>
        </div>
      )}
      {mode === "tool" && (
        <div className="flex flex-col gap-[6px]">
          <Select ariaLabel="Connected tool" value={tool || tools[0]?.id || ""} options={tools.map((t) => ({ value: t.id, label: t.label }))} onChange={setTool} />
          <textarea aria-label="What to bring in" className={clsx(r.textarea, "text-body")} rows={2} value={request} placeholder="The September customer interviews" onChange={(e) => setRequest(e.target.value)} />
          <p className="text-micro text-fg-subtle">Qalam AI finds and opens them with the tool; what the tool returns is kept word for word.</p>
          <Button
            size="sm"
            className="self-start"
            disabled={request.trim().length < 3}
            onClick={() => {
              const t = tools.find((x) => x.id === (tool || tools[0]?.id));
              if (!t) return;
              add([{ kind: "connector", connectors: [t.id], request: request.trim(), label: t.label }]);
              setRequest("");
            }}
          >
            Bring them in
          </Button>
        </div>
      )}
    </section>
  );
}

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(files);
  };
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  return (
    <div
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
      className={clsx("flex flex-col items-center gap-[8px] rounded-lg px-[12px] py-[16px] text-center [border:1px_dashed_var(--color-line-strong)]", over ? "bg-selection-subtle" : "bg-muted")}
    >
      <Upload {...ICON} className="text-fg-subtle" />
      <span className="text-caption text-fg-muted">Drop PDF, Word, Markdown, text or caption files (.vtt, .srt)</span>
      <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>
        Choose files…
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One source

/** Cards that carry a source's quotes, by the quote's place in the source. */
function cardsByQuote(doc: Doc, sourceId: string) {
  const m = new Map<string, { id: string; title: string; against: boolean }[]>();
  for (const { id, card } of allCards(doc))
    for (const e of card.evidence) {
      if (!fromSource(e) || e.sourceId !== sourceId || !e.span) continue;
      const k = `${e.span[0]}:${e.span[1]}`;
      m.set(k, [...(m.get(k) ?? []), { id, title: card.title || "Untitled", against: e.stance === "against" }]);
    }
  return m;
}

function showCard(id: string) {
  revealCard(id);
  studio().select([id]);
  const c = getController();
  if (c) requestAnimationFrame(() => glideToLayer(c, id));
}

function SourceView({ source, focus }: { source: SourceRecord; focus?: string }) {
  const [tab, setTab] = useState<"quotes" | "text">(focus ? "text" : "quotes");
  useEffect(() => {
    if (focus) setTab("text");
  }, [focus]);
  const quoting = useSources((s) => s.jobs[source.id]?.phase === "quoting");
  const busy = useSources((s) => s.busy);
  const doc = useStudio((s) => s.doc);
  const onCards = useMemo(() => cardsByQuote(doc, source.id), [doc, source.id]);
  const web = source.origin && /^https?:/i.test(source.origin) ? source.origin : null;
  const left = useMemo(() => unread(source).length, [source]);
  const quotes = source.quotes;
  const [changing, setChanging] = useState(false);
  const roles = awaitingRoles(source) || changing;
  // A brain dump's pieces are the builder's own words, cut by what they are to the tree.
  const dump = source.kind === "dump";
  return (
    <div className="flex flex-col gap-[10px] px-[12px] pt-[2px] pb-[16px]">
      <div className="flex items-start gap-[4px]">
        <IconBtn size="sm" label="All sources" onClick={() => useSources.setState({ open: null })}>
          <ArrowLeft {...SMALL} />
        </IconBtn>
        <div className="flex min-w-0 flex-1 flex-col gap-[2px] pt-[3px]">
          <h3 className="text-body leading-[18px] font-semibold text-fg" dir="auto">
            {source.title}
          </h3>
          <span className="text-micro text-fg-subtle">{metaOf(source)}{source.truncated ? " · only its start was kept" : ""}</span>
        </div>
        {web && (
          <IconBtn size="sm" label="Open the page" onClick={() => window.open(web, "_blank", "noopener,noreferrer")}>
            <ExternalLink {...SMALL} />
          </IconBtn>
        )}
        <IconBtn size="sm" label="Remove it from this board" onClick={() => void confirmRemove(source)}>
          <Trash2 {...SMALL} />
        </IconBtn>
      </div>
      {dump && (
        <Button size="sm" variant="secondary" className="self-start" onClick={() => openBrainDump({ sourceId: source.id })}>
          <QalamAIGlyph size={12} /> Continue with Qalam AI
        </Button>
      )}
      {source.transcript && (roles ? <SpeakersStep source={source} onDone={changing ? () => setChanging(false) : undefined} /> : <SpeakersLine t={source.transcript} onChange={() => setChanging(true)} />)}
      <Segmented
        label="Show"
        value={tab}
        options={[
          { value: "quotes", label: `${dump ? "Pieces" : "Quotes"} · ${quotes.length}` },
          { value: "text", label: "Text" },
        ]}
        onChange={(t) => {
          setTab(t);
          if (t === "quotes") useSources.setState((s) => (s.open ? { open: { id: s.open.id } } : {}));
        }}
      />
      {quoting && <p className="q-shimmer-text text-caption text-fg-muted">Qalam AI is picking out what customers said…</p>}
      {tab === "quotes" ? (
        <div className="flex flex-col gap-[8px]">
          {quotes.length > 0 && <p className="text-micro text-fg-subtle">{dump ? "Your own words, by what they are to the tree. Drag one onto a card to rest it on them." : "Drag a quote onto a problem or a solution to back it."}</p>}
          {!quotes.length && !quoting && !awaitingRoles(source) && (
            <p className="text-caption text-fg-muted">
              {dump ? "No pieces yet. Select words in the text to keep them yourself." : <>No quotes yet. {source.read.length ? "Qalam AI found no customer's words in what it read." : ""} Select words in the text to quote them yourself.</>}
            </p>
          )}
          {quotes.map((q) => (
            <QuoteCard key={q.id} source={source} q={q} cards={onCards.get(`${q.span[0]}:${q.span[1]}`) ?? []} onShow={() => openSource(source.id, q.id)} />
          ))}
          {left > 0 && !busy && !awaitingRoles(source) && (
            <Button size="sm" variant="secondary" className="self-start" onClick={() => void keepReading([source.id])}>
              <QalamAIGlyph size={12} /> {source.read.length ? `Keep reading (${plural(left, "part")} left)` : "Find quotes"}
            </Button>
          )}
        </div>
      ) : (
        <SourceText source={source} focus={focus} />
      )}
    </div>
  );
}

function QuoteCard({ source, q, cards, onShow }: { source: SourceRecord; q: SourceQuote; cards: { id: string; title: string; against: boolean }[]; onShow: () => void }) {
  const meta: ReactNode[] = [q.time ? clock(q.time[0]) : null, q.speaker, q.page ? `p. ${q.page}` : null, q.addedBy === "user" ? "Picked by you" : null].filter(Boolean);
  return (
    <figure
      draggable
      onDragStart={(e) => dragQuote(e, source.id, q.id, q.text)}
      className="group relative flex cursor-grab flex-col gap-[6px] rounded-lg bg-muted py-[8px] pr-[28px] pl-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)] active:cursor-grabbing"
    >
      <blockquote className="flex gap-[6px] text-caption leading-[18px] text-fg" dir="auto">
        <Quote size={12} className="mt-[3px] shrink-0 text-fg-subtle" />
        <span>{q.text}</span>
      </blockquote>
      <figcaption className="flex flex-wrap items-center gap-x-[6px] gap-y-[4px] pl-[18px] text-micro text-fg-subtle">
        <Tag>{source.kind === "dump" ? ROLE_LABEL[q.role ?? "context"] : QUOTE_KIND_LABEL[q.kind]}</Tag>
        {meta.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
        <button type="button" className="font-medium underline decoration-fg/20 underline-offset-2 hover:text-fg" onClick={onShow}>
          Show in the text
        </button>
      </figcaption>
      {cards.length > 0 && (
        <div className="flex flex-wrap gap-[4px] pl-[18px]">
          {cards.map((c) => (
            <button key={c.id} type="button" onClick={() => showCard(c.id)} className="q-item inline-flex h-[20px] max-w-full items-center rounded-sm bg-active px-[6px] text-micro font-medium text-fg-muted hover:text-fg" title="Show the card">
              <span className="truncate">
                {c.against ? "Against" : "On"} “{c.title}”
              </span>
            </button>
          ))}
        </div>
      )}
      <span className="absolute top-[4px] right-[4px] hidden group-hover:block">
        <IconBtn size="sm" label="Remove the quote from the source" onClick={() => void updateSource(source.id, (s) => ({ ...s, quotes: s.quotes.filter((x) => x.id !== q.id), needs: s.needs.map((n) => ({ ...n, quoteIds: n.quoteIds.filter((id) => id !== q.id) })) }))}>
          <X {...SMALL} />
        </IconBtn>
      </span>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// A source's text, its quotes highlighted; selected words can be quoted by hand.

interface Segment {
  start: number;
  end: number;
  quote?: string;
  /** A page starts here (PDF). */
  page?: number;
}

/** The text cut where quotes (and pages) begin and end. */
function segmentsOf(s: SourceRecord): Segment[] {
  const marks = s.quotes.flatMap((q) => (q.parts ?? [q.span]).map(([a, b]) => ({ a, b, id: q.id }))).sort((x, y) => x.a - y.a);
  const cuts = new Set<number>([0, s.text.length, ...marks.flatMap((m) => [m.a, m.b]), ...(s.pages ?? [])]);
  const at = [...cuts].filter((c) => c >= 0 && c <= s.text.length).sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < at.length - 1; i++) {
    const [start, end] = [at[i], at[i + 1]];
    if (start === end) continue;
    const m = marks.find((x) => x.a <= start && end <= x.b);
    const page = s.pages && s.pages.length > 1 ? s.pages.indexOf(start) : -1;
    out.push({ start, end, ...(m ? { quote: m.id } : {}), ...(page >= 0 ? { page: page + 1 } : {}) });
  }
  return out;
}

/** A position in the text from a point in the rendered segments. */
function offsetIn(node: Node | null, offset: number): number | null {
  if (!node || node.nodeType !== 3) return null;
  const host = node.parentElement?.closest<HTMLElement>("[data-start]");
  return host ? Number(host.dataset.start) + offset : null;
}

const SourceText = memo(function SourceText({ source, focus }: { source: SourceRecord; focus?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const segments = useMemo(() => segmentsOf(source), [source]);
  const [pick, setPick] = useState<{ start: number; end: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (focus) ref.current?.querySelector(`[data-quote="${focus}"]`)?.scrollIntoView({ block: "center" });
  }, [focus, segments]);

  const onSelect = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !ref.current) return setPick(null);
    const a = offsetIn(sel.anchorNode, sel.anchorOffset);
    const b = offsetIn(sel.focusNode, sel.focusOffset);
    if (a === null || b === null) return setPick(null);
    let start = Math.min(a, b);
    let end = Math.max(a, b);
    while (start < end && /\s/.test(source.text[start])) start++;
    while (end > start && /\s/.test(source.text[end - 1])) end--;
    if (end - start < 8 || end - start > 1200 || source.quotes.some((q) => q.span[0] < end && start < q.span[1])) return setPick(null);
    const box = sel.getRangeAt(0).getBoundingClientRect();
    const host = ref.current.getBoundingClientRect();
    setPick({ start, end, x: Math.max(0, Math.min(host.width - 140, box.left - host.left)), y: box.bottom - host.top + 6 });
  };

  const keep = () => {
    if (!pick) return;
    const picked: SourceQuote = { id: newId(), text: source.text.slice(pick.start, pick.end), span: [pick.start, pick.end], ...(pageAt(source.pages, pick.start) ? { page: pageAt(source.pages, pick.start) } : {}), kind: "need", ...(source.kind === "dump" ? { role: "context" as const } : {}), addedBy: "user", at: Date.now() };
    window.getSelection()?.removeAllRanges();
    setPick(null);
    // In an interview, only a participant's words, within one person's turns (and who said them, when).
    const [q] = source.transcript ? (awaitingRoles(source) ? [] : finishInterviewQuotes(source, [picked])) : [picked];
    if (!q) return feedback(awaitingRoles(source) ? "Say who is who first: only participants' words are quoted" : "Only a participant's words can be quoted, from one person's turns", { id: "discovery.quote" });
    void updateSource(source.id, (s) => ({ ...s, quotes: [...s.quotes, q].sort((x, y) => x.span[0] - y.span[0]) }));
    openSource(source.id, q.id);
  };

  return (
    <div className="relative">
      <div ref={ref} onMouseUp={onSelect} onKeyUp={onSelect} className="text-caption leading-[19px] break-words whitespace-pre-wrap text-fg select-text" dir="auto">
        {segments.map((s) => (
          <span key={s.start}>
            {s.page && (
              <span aria-hidden className="mt-[10px] mb-[4px] block text-micro font-medium text-fg-subtle select-none">
                Page {s.page}
              </span>
            )}
            {s.quote ? (
              <mark data-start={s.start} data-quote={s.quote} className={clsx("rounded-[2px] text-fg", s.quote === focus ? "bg-selection-subtle shadow-[0_0_0_1px_var(--color-selection)]" : "bg-selection-subtle")}>
                {source.text.slice(s.start, s.end)}
              </mark>
            ) : (
              <span data-start={s.start}>{source.text.slice(s.start, s.end)}</span>
            )}
          </span>
        ))}
      </div>
      {pick && (
        <button
          type="button"
          className="q-pop absolute z-10 inline-flex h-[24px] items-center gap-[6px] rounded-md bg-elevated px-[8px] text-caption font-medium text-fg shadow-popover"
          style={{ left: pick.x, top: pick.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={keep}
        >
          <Quote {...SMALL} /> Keep as a quote
        </button>
      )}
    </div>
  );
});
