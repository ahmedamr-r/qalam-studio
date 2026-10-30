import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { MoreHorizontal, Plus, Quote } from "lucide-react";
import { nanoid } from "nanoid";
import { feedback } from "@/commands/feedback";
import { dayOf } from "@/decisions/model";
import { KIND_LABEL } from "@/discovery/kinds";
import type { OstKind } from "@/discovery/types";
import { quoted, SECTIONS, SECTION_HEADING, TOPIC_KIND_LABEL, type Topic, type TopicLine, type TopicSection } from "@/hub/topics";
import { ConflictError, currentOrg, type OrgRef } from "@/org/client";
import { useOrgContext } from "@/org/context";
import { onOrgChange } from "@/org/live";
import { topicsDb, type CitedPiece, type TopicView } from "@/org/topics";
import { projectHref, spaceHref } from "@/projects/model";
import { Button, Tip } from "../controls";
import { Menu, MenuItem, MenuSeparator, SubMenu } from "../menu";
import { r } from "../recipes";
import { confirmDialog, promptDialog } from "../surfaces/dialog";
import { PageFrame } from "../frame/PageFrame";
import { useItemSpace } from "../frame/useSpace";
import { QalamAIGlyph } from "../brand";
import { NeedStrip } from "./NeedStrip";
import { Drafts } from "./Drafts";
import { BearsOn } from "./BearsOn";
import { ago } from "../time";
import { Dictated } from "../voice/MicButton";
import { navigate } from "../nav";

/**
 * One topic page: what the organization knows about a need, a kind of customer or a product, what
 * it believes, what speaks against it and what nobody knows yet. Each line shows the pieces it rests
 * on (hover one for its words, click to open it where it lives), how many quotes back it, and what's
 * been said against it. People add, edit, move and remove lines; a line they edit is theirs, and
 * Qalam AI never rewrites it. Below: the cards on boards that rest on the same pieces, and what
 * changed. The page is a Markdown file in the organization's folder (hub/topics).
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

const EMPTY: Record<TopicSection, string> = {
  know: "Nothing customers said, or a test showed, yet.",
  believe: "What the team thinks, before customers show it.",
  against: "Nothing speaks against it yet.",
  open: "No open questions.",
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function TopicPage({ id }: { id: string }) {
  const [view, setView] = useState<TopicView | null>(null);
  const [missing, setMissing] = useState(false);
  const [org, setOrg] = useState<OrgRef | null>(null);
  const [adding, setAdding] = useState<TopicSection | null>(null);
  const version = useRef<string | null>(null);
  const saving = useRef(0);
  const { products } = useOrgContext();

  const load = useCallback(() => {
    void topicsDb.get(id).then(
      (v) => {
        if (!v) return setMissing(true);
        version.current = v.topic.version;
        setView(v);
      },
      () => setMissing(true),
    );
  }, [id]);
  // The tab names the page, and gives the title back when the page goes (moving in place, src/ui/nav.ts).
  const title = view?.topic.title;
  useEffect(() => {
    if (!title) return;
    const was = document.title;
    document.title = `${title} · Qalam`;
    return () => void (document.title = was);
  }, [title]);

  useEffect(() => {
    load();
    void currentOrg().then(setOrg, () => {});
    // Qalam AI filed something, another window changed it, or the file was edited on disk.
    return onOrgChange((c) => {
      if (c.kind === "topic" && c.id === id) {
        if (c.removed) setMissing(true);
        else if (!saving.current) load();
      }
      if (c.kind === "org") void currentOrg().then(setOrg, () => {});
    });
  }, [id, load]);

  // The space it shows in: the tab's, else its product's when it has one (src/ui/frame/spaces.ts).
  const space = useItemSpace(view?.topic.products ?? null);

  if (missing)
    return (
      <div className="fixed inset-0 grid place-items-center bg-app text-fg">
        <div className="flex w-[320px] flex-col items-center gap-[12px] text-center">
          <p className="text-title font-medium">This page isn&apos;t here</p>
          <p className="text-body text-fg-muted">It was deleted, or its file moved out of the organization&apos;s folder.</p>
          <a className={clsx(r.button, r.buttonSecondary)} href={spaceHref(space, "problems")}>
            Back to the problems
          </a>
        </div>
      </div>
    );
  if (!view)
    return (
      <PageFrame place="problems" crumbs={[{ label: "Problems", href: spaceHref(space, "problems") }]} space={space}>
        <div />
      </PageFrame>
    );
  const t = view.topic;

  /** Save the page as changed here; a change made elsewhere meanwhile wins, and the page shows it. */
  const save = async (next: Topic) => {
    setView((v) => (v ? { ...v, topic: { ...v.topic, ...next } } : v));
    saving.current++;
    try {
      version.current = await topicsDb.put(next, version.current);
    } catch (e) {
      feedback(e instanceof ConflictError ? "The page changed elsewhere meanwhile: it's shown as it is now" : `Couldn't save the page: ${message(e)}`, { kind: "error", id: "topics.save" });
    } finally {
      saving.current--;
      load();
    }
  };
  const change = (fn: (t: Topic) => void) => {
    const next = structuredClone(t) as Topic;
    fn(next);
    void save(next);
  };
  const lineAt = (next: Topic, lid: string) => next.lines.find((l) => l.id === lid);
  const now = () => Date.now();

  const addLine = (section: TopicSection, text: string) => change((n) => void n.lines.push({ id: nanoid(10), section, text, by: "person", cites: [], from: [], at: now() }));
  const editLine = (lid: string, text: string) =>
    change((n) => {
      const l = lineAt(n, lid);
      if (!l || l.text === text) return;
      // Edited by hand: the person's now, so Qalam AI never rewrites it.
      Object.assign(l, { text, by: "person" });
    });
  const moveLine = (lid: string, section: TopicSection) =>
    change((n) => {
      const l = lineAt(n, lid);
      if (l) Object.assign(l, { section, by: "person" });
    });
  const removeLine = (l: TopicLine) =>
    change((n) => {
      n.lines = n.lines.filter((x) => x.id !== l.id);
      n.history.unshift({ at: now(), text: `Removed “${quoted(l.text)}”.` });
    });
  const resolve = (lid: string, did: string) =>
    change((n) => {
      const l = lineAt(n, lid);
      if (!l) return;
      l.disputes = (l.disputes ?? []).filter((d) => d.id !== did);
      if (!l.disputes.length) delete l.disputes;
      n.history.unshift({ at: now(), text: `Resolved what was said against “${quoted(l.text, 120)}”.` });
    });
  const rename = async () => {
    const title = await promptDialog({ title: "Rename page", defaultValue: t.title, confirmLabel: "Rename", validate: (v) => (v.trim() ? null : "Name it") });
    if (title?.trim() && title.trim() !== t.title) change((n) => void (n.title = title.trim().replace(/\s+/g, " ").slice(0, 100)));
  };
  const remove = async () => {
    const ok = await confirmDialog({ title: `Delete “${t.title}”?`, body: "The page is removed from the organization's folder. The sources and boards its lines rest on stay as they are.", confirmLabel: "Delete page", danger: true });
    if (!ok) return;
    await topicsDb.remove(t.id);
    navigate(spaceHref(space, t.kind === "need" ? "problems" : "evidence"));
  };

  const productNames = t.products.map((p) => products.find((x) => x.id === p)?.name).filter(Boolean) as string[];
  return (
    <PageFrame place={t.kind === "need" ? "problems" : "evidence"} crumbs={[t.kind === "need" ? { label: "Problems", href: spaceHref(space, "problems") } : { label: "Evidence", href: spaceHref(space, "evidence") }, { label: t.title }]} space={space}>
        <div className={clsx(r.pageMain, "max-w-[760px]")}>
          <div className="flex flex-col gap-[8px]">
            <div className="flex items-start justify-between gap-[12px]">
              <h1 className="text-display font-semibold text-fg">{t.title}</h1>
              <Menu
                label="Page actions"
                align="end"
                className="w-[180px]"
                trigger={
                  <button type="button" aria-label="Page actions" className={clsx(r.iconButton, "shrink-0")}>
                    <MoreHorizontal {...ICON} />
                  </button>
                }
              >
                <MenuItem onSelect={() => void rename()}>Rename…</MenuItem>
                <MenuSeparator />
                <MenuItem danger onSelect={() => void remove()}>
                  Delete page…
                </MenuItem>
              </Menu>
            </div>
            <p className="text-caption text-fg-muted">{[TOPIC_KIND_LABEL[t.kind], ...(productNames.length ? productNames : ["Whole organization"]), `updated ${ago(t.updatedAt)}`].join(" · ")}</p>
            {t.intro && <p className="whitespace-pre-wrap text-body text-fg-muted">{t.intro}</p>}
          </div>

          {t.kind === "need" && view.summary && <NeedStrip s={view.summary} shows={view.shows} />}
          {t.kind === "need" && <Drafts topic={t.id} board={boardOf(view)} />}

          {SECTIONS.map((s) => {
            const lines = t.lines.filter((l) => l.section === s);
            return (
              <section key={s} aria-labelledby={`section-${s}`} className="flex flex-col gap-[8px]">
                <div className="flex items-center justify-between gap-[12px]">
                  <h2 id={`section-${s}`} className="text-title font-medium">
                    {SECTION_HEADING[s]}
                    {lines.length > 0 && <span className="ml-[6px] text-caption font-normal text-fg-subtle">{lines.length}</span>}
                  </h2>
                  <button type="button" onClick={() => setAdding(s)} className={clsx(r.buttonSm, r.buttonGhost)}>
                    <Plus size={12} absoluteStrokeWidth strokeWidth={1.25} />
                    Add
                  </button>
                </div>
                {t.intros?.[s] && <p className="whitespace-pre-wrap text-caption text-fg-muted">{t.intros[s]}</p>}
                {lines.length || adding === s ? (
                  <ul className="flex flex-col divide-y divide-line-subtle rounded-lg bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
                    {lines.map((l) => (
                      <LineRow key={l.id} l={l} view={view} onEdit={(text) => editLine(l.id, text)} onMove={(to) => moveLine(l.id, to)} onRemove={() => removeLine(l)} onResolve={(d) => resolve(l.id, d)} />
                    ))}
                    {adding === s && (
                      <li className="px-[12px] py-[10px]">
                        <LineInput
                          initial=""
                          placeholder={s === "open" ? "A question nothing answers yet" : "One sentence"}
                          onSave={(text) => {
                            setAdding(null);
                            addLine(s, text);
                          }}
                          onCancel={() => setAdding(null)}
                        />
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="text-caption text-fg-subtle">{EMPTY[s]}</p>
                )}
              </section>
            );
          })}

          {t.kind === "need" && <BearsOn need={t.id} />}

          <section aria-labelledby="shows" className="flex flex-col gap-[8px]">
            <h2 id="shows" className="text-title font-medium">
              Shows up on
            </h2>
            {view.shows.length ? (
              <ul className="flex flex-col divide-y divide-line-subtle rounded-lg bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
                {view.shows.map((c) => (
                  <li key={c.ref}>
                    <a href={`${projectHref({ id: c.board, type: "discovery" })}?card=${encodeURIComponent(c.card)}`} className="q-item flex flex-col gap-[2px] px-[12px] py-[10px] hover:bg-hover">
                      <span className="text-body text-fg">{c.title}</span>
                      <span className="text-caption text-fg-muted">
                        {[KIND_LABEL[c.kind as OstKind] ?? "Card", `on ${c.boardName ?? "a board"}`, c.shared ? `rests on ${c.shared} of the pieces this page cites` : "named like this page"].join(" · ")}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-caption text-fg-subtle">No card on a board rests on what this page cites yet.</p>
            )}
          </section>

          {t.notes && <p className="whitespace-pre-wrap text-caption text-fg-muted">{t.notes}</p>}

          {!!t.history.length && (
            <section aria-labelledby="history" className="flex flex-col gap-[8px]">
              <h2 id="history" className="text-title font-medium">
                History
              </h2>
              <ul className="flex flex-col gap-[4px]">
                {t.history.map((h, i) => (
                  <li key={i} className="flex gap-[10px] text-caption">
                    <span className="w-[84px] shrink-0 text-fg-subtle tnum">{h.at ? dayOf(h.at) : ""}</span>
                    <span className="text-fg-muted">{h.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="flex items-center gap-[6px] text-caption text-fg-subtle">
            <Tip label="Qalam AI keeps a line only when the pieces it cites were sent to it and the words it quotes are in them. Edit a line and it's yours: Qalam AI won't rewrite it, only say what speaks against it.">
              <span className="inline-flex cursor-help items-center gap-[4px]">
                <QalamAIGlyph size={12} />
                Every line is checked
              </span>
            </Tip>
            {org ? <span className="truncate">· {t.file}</span> : null}
          </p>
        </div>
    </PageFrame>
  );
}

function LineRow({ l, view, onEdit, onMove, onRemove, onResolve }: { l: TopicLine; view: TopicView; onEdit: (text: string) => void; onMove: (to: TopicSection) => void; onRemove: () => void; onResolve: (dispute: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const backing = backingOf(l.cites, view);
  // What it rests on: the pieces it cites, or where it came from when it cites none.
  const n = l.cites.length || l.from.length;
  return (
    <li className="flex flex-col gap-[6px] px-[12px] py-[8px]">
      <div className="flex items-start gap-[8px]">
        {editing ? (
          <div className="min-w-0 flex-1">
            <LineInput
              initial={l.text}
              onSave={(text) => {
                setEditing(false);
                onEdit(text);
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <p className="min-w-0 flex-1 py-[2px] text-body text-fg">{l.text}</p>
        )}
        {l.by === "qalam" && (
          <Tip label="Qalam AI's line: kept only because what it cites says so">
            <span className="mt-[6px] shrink-0">
              <QalamAIGlyph size={12} />
            </span>
          </Tip>
        )}
        {n > 0 && (
          <Tip label={open ? "Hide what it rests on" : (backing ?? "What it rests on")}>
            <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={clsx(r.chip, "mt-[2px] shrink-0 hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg")}>
              <Quote size={10} absoluteStrokeWidth strokeWidth={1.25} />
              <span className="tnum">{n}</span>
            </button>
          </Tip>
        )}
        <Menu
          label="Line actions"
          align="end"
          className="w-[180px]"
          trigger={
            <button type="button" aria-label="Line actions" className={clsx(r.iconButtonSm, "shrink-0")}>
              <MoreHorizontal {...ICON} />
            </button>
          }
        >
          <MenuItem onSelect={() => setEditing(true)}>Edit…</MenuItem>
          <SubMenu label="Move to" checks>
            {SECTIONS.map((s) => (
              <MenuItem key={s} checked={l.section === s} onSelect={() => l.section !== s && onMove(s)}>
                {SECTION_HEADING[s]}
              </MenuItem>
            ))}
          </SubMenu>
          <MenuSeparator />
          <MenuItem danger onSelect={onRemove}>
            Remove
          </MenuItem>
        </Menu>
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-[6px]">
          <Cites refs={l.cites} from={l.from} view={view} />
          {backing && <span className="text-micro text-fg-subtle">{backing}</span>}
        </div>
      )}
        {l.disputes?.map((d) => (
          <div key={d.id} className="flex items-start gap-[8px] rounded-md bg-warning-subtle px-[8px] py-[6px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
              <p className="text-caption text-fg">
                <span className="font-medium text-warning">{d.by === "qalam" ? "Qalam AI found this against it" : "Disputed"}:</span> {d.text}
              </p>
              <div className="flex flex-wrap items-center gap-[6px]">
                <Cites refs={d.cites} from={d.from} view={view} />
              </div>
            </div>
            <button type="button" onClick={() => onResolve(d.id)} className={clsx(r.buttonSm, r.buttonGhost, "shrink-0")}>
              Resolve
            </button>
          </div>
        ))}
        {l.more?.trim() && <p className="whitespace-pre-wrap text-caption text-fg-muted">{l.more.trim()}</p>}
    </li>
  );
}

/** "3 quotes from 2 sources": what backs a line, counted by code (only when more than one). */
/** The board that has the problem as a card (the one sharing most of its words), where its drafts are reviewed. */
function boardOf(view: TopicView): { board: string; card: string; name: string } | null {
  const s = view.shows.find((x) => x.kind === "opportunity");
  return s ? { board: s.board, card: s.card, name: s.boardName ?? "its board" } : null;
}

function backingOf(refs: string[], view: TopicView): string | null {
  const quotes = refs.map((ref) => view.cited[ref]).filter((p): p is CitedPiece => !!p && (customers(p) || (p.type === "evidence" && p.sub === "quote")));
  if (quotes.length < 2) return null;
  const sources = new Set(quotes.map((p) => p.source ?? p.title ?? p.ref));
  return `${quotes.length} quotes${sources.size > 1 ? ` from ${sources.size} sources` : ""}`;
}

/** Where a piece opens: a quote in its source on a board that uses it, a card on its board. */
function hrefOf(p: CitedPiece, view: TopicView): string | null {
  if ((p.type === "quote" || p.type === "need") && p.source) {
    const board = view.sources[p.source]?.boards[0];
    return board ? `${projectHref({ id: board, type: "discovery" })}?source=${encodeURIComponent(p.source)}` : null;
  }
  if (p.board) return `${projectHref({ id: p.board, type: "discovery" })}${p.card ? `?card=${encodeURIComponent(p.card)}` : ""}`;
  return null;
}

/** Customers' own words (a brain dump's pieces are the team's). */
const customers = (p: CitedPiece) => p.type === "quote" && !p.sub?.startsWith("dump:");

function labelOf(p: CitedPiece, view: TopicView): string {
  const source = p.source ? (view.sources[p.source]?.title ?? p.title) : p.title;
  if (p.type === "quote" && !customers(p)) return `The team · ${source ?? "a brain dump"}`;
  if (p.type === "quote") return [p.speaker, source].filter(Boolean).join(" · ") || "A quote";
  if (p.type === "decision") return `Decision · ${p.title ?? ""}`.trim();
  if (p.type === "need") return `Need in ${source ?? "a source"}`;
  if (p.type === "assumption") return "An assumption";
  return p.title ?? (p.type === "context" ? "About the product" : "A piece");
}

function Cites({ refs, from, view }: { refs: string[]; from: string[]; view: TopicView }) {
  const known = refs.map((ref) => view.cited[ref]).filter((p): p is CitedPiece => !!p);
  // Without the search index here, the names written with the line.
  if (!known.length) return from.length ? <span className="text-caption text-fg-subtle">{from.join(" · ")}</span> : null;
  const gone = refs.length - known.length;
  // Pieces that show as the same name (two of one person's quotes) are one chip; hover shows each.
  const groups = new Map<string, CitedPiece[]>();
  for (const p of known) groups.set(labelOf(p, view), [...(groups.get(labelOf(p, view)) ?? []), p]);
  return (
    <>
      {[...groups].map(([label, list]) => {
        const p = list[0];
        const href = hrefOf(p, view);
        const chip = (
          <>
            {customers(p) && <Quote size={10} absoluteStrokeWidth strokeWidth={1.5} className="shrink-0" />}
            <span className="truncate">{label}</span>
            {list.length > 1 && <span className="shrink-0 text-fg-subtle tnum">· {list.length}</span>}
          </>
        );
        const cls = "inline-flex h-[20px] max-w-[260px] items-center gap-[4px] rounded-sm bg-hover px-[6px] text-micro text-fg-muted";
        const words = (x: CitedPiece) => (x.type === "quote" ? `“${clip(x.text, list.length > 1 ? 160 : 300)}”` : clip(x.text, 300));
        return (
          <Tip
            key={p.ref}
            label={
              <span className="flex flex-col gap-[4px] whitespace-normal py-[2px] font-normal">
                {list.slice(0, 4).map((x) => (
                  <span key={x.ref}>{words(x)}</span>
                ))}
              </span>
            }
          >
            {href ? (
              <a href={href} className={clsx(cls, "hover:text-fg")}>
                {chip}
              </a>
            ) : (
              <span tabIndex={0} className={cls}>
                {chip}
              </span>
            )}
          </Tip>
        );
      })}
      {gone > 0 && <span className="text-micro text-fg-subtle">{gone === 1 ? "1 piece is gone" : `${gone} pieces are gone`}</span>}
    </>
  );
}

function LineInput({ initial, placeholder, onSave, onCancel }: { initial: string; placeholder?: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(initial.length, initial.length);
  }, [initial]);
  const done = () => {
    const v = text.replace(/\s+/g, " ").trim();
    if (v) onSave(v);
    else onCancel();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      done();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <div className="flex flex-col gap-[6px]">
      <Dictated field={ref} set={setText}>
        <textarea ref={ref} rows={2} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} className={r.textarea} />
      </Dictated>
      <div className="flex justify-end gap-[6px]">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={done}>
          Save
        </Button>
      </div>
    </div>
  );
}
