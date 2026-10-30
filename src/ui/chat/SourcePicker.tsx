import { useEffect, useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { create } from "zustand";
import { ChevronDown, ChevronRight, File, FileSpreadsheet, FileText, Folder, Presentation, Search, Upload, X } from "lucide-react";
import { RECIPES, type Hit, type HitType } from "@/connectors/recipes";
import { ACCEPT } from "@/discovery/ingest/core";
import { connectorsDb, type ConnectorState } from "@/org/connectors";
import { ConnectorLogo } from "../brand/ConnectorLogo";
import { ConnectActions, type View } from "../connections/Connectors";
import { Button, Checkbox, IconBtn, MenuItem, MenuLabel, Spinner } from "../controls";
import { r } from "../recipes";
import { ago } from "../time";
import { StatusDot } from "../viz";
import { attachFiles, attachHits, removeAttachment, sourcesFor, useAttach, wordCount, type DocRef, type SourceFit } from "./attach";

/*
 * Bringing docs into the chat box: a row of the sources that fit what Qalam AI asked (two connectors,
 * this computer, and the rest under More), a picker over the box that browses a connector (what was
 * opened lately, its folders, a search) and connects it first when it isn't yet, and the picked docs
 * as chips in the box, each read as it's picked. Logic in ./attach.ts.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

// The connectors on this computer, asked once per window; Claude Code is asked which it has once too.
const useConnectors = create<{ view: View | null; checking: boolean }>(() => ({ view: null, checking: false }));
let asked = false;
function useConnectorView() {
  const { view, checking } = useConnectors();
  useEffect(() => {
    if (asked) return;
    asked = true;
    void connectorsDb.list().then(
      (v) => {
        useConnectors.setState({ view: v });
        if (v.checkedAt !== null) return;
        useConnectors.setState({ checking: true });
        void connectorsDb
          .check()
          .then((x) => useConnectors.setState({ view: x }))
          .catch(() => {})
          .finally(() => useConnectors.setState({ checking: false }));
      },
      () => {
        asked = false;
      },
    );
  }, []);
  return { view, checking, setView: (v: View) => useConnectors.setState({ view: v }) };
}

/** "Bring it from" in the box: the sources that fit, this computer, More; a picked connector opens its picker above the box. */
export function SourceRow({ fit }: { fit: SourceFit }) {
  const { view, setView } = useConnectorView();
  const [openId, setOpenId] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const list = view ? sourcesFor(fit, view.connectors) : [];
  const open = openId ? (view?.connectors.find((c) => c.id === openId) ?? null) : null;
  const pick = (c: ConnectorState) => {
    setMore(false);
    setOpenId(c.id);
  };
  return (
    <Popover.Root open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
      <Popover.Anchor asChild>
        <div role="group" aria-label="Bring it from" className="flex flex-wrap items-center gap-[6px] border-b border-line-subtle px-[10px] py-[8px]">
          <span className="mr-[2px] text-micro text-fg-subtle">Bring it from</span>
          {!view && <span className={clsx(r.skeleton, "h-[24px] w-[140px]")} aria-hidden />}
          {list.slice(0, 2).map((c) => (
            <button key={c.id} type="button" className={r.composerPill} aria-expanded={openId === c.id} onClick={() => pick(c)}>
              <ConnectorLogo id={c.id} size={16} decorative />
              {c.label}
            </button>
          ))}
          <button type="button" className={r.composerPill} onClick={() => file.current?.click()}>
            <Upload {...ICON} size={12} />
            This computer
          </button>
          <input
            ref={file}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) attachFiles(files);
            }}
          />
          {list.length > 2 && (
            <Popover.Root open={more} onOpenChange={setMore}>
              <Popover.Trigger asChild>
                <button type="button" className={r.composerPill}>
                  More <ChevronDown {...ICON} size={12} />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content side="top" align="start" sideOffset={6} collisionPadding={12} className={clsx(r.menu, "w-[240px]")}>
                  <MenuLabel>Bring it from</MenuLabel>
                  {list.map((c) => (
                    <MenuItem key={c.id} icon={<ConnectorLogo id={c.id} size={16} decorative />} onSelect={() => pick(c)}>
                      <span className="flex items-center gap-[8px]">
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        <span className="inline-flex shrink-0 items-center gap-[4px] text-micro text-fg-subtle">
                          <StatusDot tone={c.tone} hollow={c.tone === "off"} />
                          {c.word}
                        </span>
                      </span>
                    </MenuItem>
                  ))}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label={open ? `Pick from ${open.label}` : undefined}
          // Opening a folder replaces the row that had focus: that isn't leaving the picker. Escape, ×, Cancel or a click outside close it.
          onFocusOutside={(e) => e.preventDefault()}
          className={clsx(r.popover, "flex max-h-[min(440px,calc(100vh-120px))] w-[var(--radix-popover-trigger-width)] min-w-[320px] flex-col overflow-hidden p-0")}
        >
          {open && <Picker key={open.id} c={open} onView={setView} onClose={() => setOpenId(null)} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Where the picker is: what was opened lately, a folder (the trail down to it), a search, or nowhere yet (search only). */
type Place = { kind: "recent" } | { kind: "folder"; trail: { id: string | null; title: string }[] } | { kind: "search"; words: string; back: Place } | { kind: "none" };

const TOP: Record<string, string> = { drive: "My Drive" };

function Picker({ c, onView, onClose }: { c: ConnectorState; onView: (v: View) => void; onClose: () => void }) {
  const connected = !!c.via && c.tone === "ok";
  return (
    <>
      <header className="flex h-[40px] shrink-0 items-center gap-[8px] border-b border-line-subtle pl-[12px] pr-[6px]">
        <ConnectorLogo id={c.id} size={20} decorative />
        <h2 className="min-w-0 flex-1 truncate text-body font-medium text-fg">{c.label}</h2>
        <span className="inline-flex shrink-0 items-center gap-[6px] text-micro text-fg-subtle">
          <StatusDot tone={c.tone} hollow={c.tone === "off"} />
          {c.word}
        </span>
        <IconBtn size="sm" label="Close" onClick={onClose}>
          <X {...ICON} />
        </IconBtn>
      </header>
      {connected ? <Browse c={c} onClose={onClose} /> : <ConnectFirst c={c} onView={onView} />}
    </>
  );
}

function ConnectFirst({ c, onView }: { c: ConnectorState; onView: (v: View) => void }) {
  const { checking } = useConnectors();
  const can = c.canSignIn || c.canToken || c.claudeCode?.status === "connected" || !!c.ownApp;
  return (
    <div className="flex flex-col gap-[10px] p-[12px]">
      <p className="text-caption text-fg-muted">{can ? `Connect ${c.label} to pick from it. Qalam only reads what you pick.` : checking ? "Asking Claude Code which connectors it has…" : `Add ${c.label} to Claude Code (claude.ai → Settings → Connectors), then check again.`}</p>
      <div className="flex flex-col gap-[8px]">
        <ConnectActions c={c} onView={onView} />
      </div>
      {!can && !checking && (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => {
            useConnectors.setState({ checking: true });
            void connectorsDb
              .check()
              .then(onView)
              .catch(() => {})
              .finally(() => useConnectors.setState({ checking: false }));
          }}
        >
          Check again
        </Button>
      )}
    </div>
  );
}

const TYPE_ICON: Record<HitType, typeof File> = { folder: Folder, doc: FileText, pdf: FileText, sheet: FileSpreadsheet, slides: Presentation, text: FileText, other: File };

function Browse({ c, onClose }: { c: ConnectorState; onClose: () => void }) {
  const recipe = RECIPES[c.id];
  const folders = !!recipe?.list && c.via !== "token";
  const recent = !!recipe?.recent || c.via === "token";
  const top: Place = folders ? { kind: "folder", trail: [{ id: null, title: TOP[c.id] ?? "Top" }] } : { kind: "none" };
  const [place, setPlace] = useState<Place>(recent ? { kind: "recent" } : top);
  const [words, setWords] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<string, Hit>>(new Map());
  const [again, setAgain] = useState(0);
  const at = place.kind === "search" ? { query: place.words } : place.kind === "folder" ? { folder: place.trail[place.trail.length - 1].id } : place.kind === "recent" ? {} : null;
  const key = JSON.stringify(at);
  useEffect(() => {
    if (!at) return setHits([]);
    let live = true;
    setHits(null);
    setError(null);
    connectorsDb.browse(c.id, at, again > 0).then(
      (x) => live && setHits(x.hits),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [c.id, key, again]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    const w = words.trim();
    if (!w) return;
    setPlace((p) => ({ kind: "search", words: w, back: p.kind === "search" ? p.back : p }));
  };
  const toggle = (h: Hit, on: boolean) =>
    setPicked((m) => {
      const next = new Map(m);
      if (on) next.set(h.id, h);
      else next.delete(h.id);
      return next;
    });
  const add = () => {
    void attachHits(c, [...picked.values()]);
    onClose();
  };
  const slow = c.via === "claude-code";

  return (
    <>
      <div className="flex shrink-0 flex-col gap-[6px] px-[10px] pt-[8px]">
        <form onSubmit={search} role="search">
          <label className={r.field}>
            <Search {...ICON} className="shrink-0 text-fg-subtle" />
            <input autoFocus className={r.fieldInput} aria-label={`Search ${c.label}`} placeholder={`Search ${c.label}`} value={words} onChange={(e) => setWords(e.target.value)} />
            {place.kind === "search" && (
              <IconBtn
                size="sm"
                label="Clear the search"
                onClick={() => {
                  setWords("");
                  setPlace(place.back);
                }}
              >
                <X {...ICON} />
              </IconBtn>
            )}
          </label>
        </form>
        <nav aria-label="Where" className="flex min-h-[24px] flex-wrap items-center gap-[2px] text-caption">
          {place.kind === "search" ? (
            <span className="px-[4px] text-fg-muted">Results for “{place.words}”</span>
          ) : (
            <>
              {recent && (
                <button type="button" aria-current={place.kind === "recent" || undefined} onClick={() => setPlace({ kind: "recent" })} className={clsx("rounded-sm px-[6px] py-[2px] hover:bg-hover", place.kind === "recent" ? "font-medium text-fg" : "text-fg-muted")}>
                  Recent
                </button>
              )}
              {folders &&
                (place.kind === "folder" ? place.trail : (top as Extract<Place, { kind: "folder" }>).trail.slice(0, 1)).map((f, i, trail) => (
                  <span key={`${f.id}:${i}`} className="inline-flex items-center gap-[2px]">
                    {i > 0 ? <ChevronRight {...ICON} size={12} className="text-fg-faint" /> : recent && <span aria-hidden className="mx-[4px] h-[12px] w-px bg-line" />}
                    <button
                      type="button"
                      aria-current={(place.kind === "folder" && i === trail.length - 1) || undefined}
                      onClick={() => setPlace({ kind: "folder", trail: place.kind === "folder" ? place.trail.slice(0, i + 1) : [f] })}
                      className={clsx("max-w-[160px] truncate rounded-sm px-[6px] py-[2px] hover:bg-hover", place.kind === "folder" && i === trail.length - 1 ? "font-medium text-fg" : "text-fg-muted")}
                    >
                      {f.title}
                    </button>
                  </span>
                ))}
            </>
          )}
        </nav>
      </div>
      <div className="min-h-[120px] flex-1 overflow-y-auto overflow-x-hidden px-[6px] pb-[6px]">
        {error ? (
          <div className="flex flex-col items-start gap-[6px] p-[6px]">
            <p className="text-caption text-danger">{error}</p>
            <Button size="sm" variant="secondary" onClick={() => setAgain((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : hits === null ? (
          <div className="flex flex-col gap-[6px] p-[6px]" aria-busy>
            <span className="inline-flex items-center gap-[6px] text-caption text-fg-muted">
              <Spinner size={12} /> <span className="q-shimmer-text">{slow ? `Asking ${c.label} through Claude Code…` : `Looking in ${c.label}…`}</span>
            </span>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={clsx(r.skeleton, "h-[24px]")} aria-hidden />
            ))}
          </div>
        ) : !hits.length ? (
          <p className="p-[6px] text-caption text-fg-subtle">{place.kind === "none" ? `Search ${c.label} for the docs that explain it.` : place.kind === "search" ? "Nothing found. Try other words." : place.kind === "folder" ? "This folder is empty." : "Nothing opened lately. Search instead."}</p>
        ) : (
          <ul aria-label={`In ${c.label}`} className="flex flex-col">
            {hits.map((h) => {
              const Icon = TYPE_ICON[h.type ?? "doc"];
              const when = h.at && Number.isFinite(Date.parse(h.at)) ? ago(Date.parse(h.at)) : null;
              if (h.folder)
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => setPlace((p) => ({ kind: "folder", trail: [...(p.kind === "folder" ? p.trail : (top as Extract<Place, { kind: "folder" }>).trail), { id: h.id, title: h.title }] }))}
                      className="q-item flex h-[30px] w-full items-center gap-[8px] rounded-md px-[6px] text-left text-body text-fg hover:bg-hover"
                    >
                      <Icon {...ICON} className="shrink-0 text-fg-subtle" />
                      <span className="min-w-0 flex-1 truncate">{h.title}</span>
                      <ChevronRight {...ICON} className="shrink-0 text-fg-faint" />
                    </button>
                  </li>
                );
              if (h.type === "other")
                return (
                  <li key={h.id} title="Qalam can't read this kind of file" className="flex h-[30px] items-center gap-[8px] px-[6px] text-body text-fg-faint">
                    <span className="size-[14px] shrink-0" />
                    <Icon {...ICON} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{h.title}</span>
                  </li>
                );
              return (
                <li key={h.id} className="flex h-[30px] items-center rounded-md px-[6px] hover:bg-hover">
                  <Checkbox
                    className="min-w-0 flex-1"
                    checked={picked.has(h.id)}
                    onChange={(on) => toggle(h, on)}
                    label={
                      <span className="flex min-w-0 flex-1 items-center gap-[8px] text-body text-fg">
                        <Icon {...ICON} className="shrink-0 text-fg-subtle" />
                        <span className="min-w-0 flex-1 truncate">{h.title}</span>
                        {when && <span className="shrink-0 text-micro text-fg-subtle tnum">{when}</span>}
                      </span>
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="flex shrink-0 items-center gap-[8px] border-t border-line-subtle px-[10px] py-[8px]">
        <span className="min-w-0 flex-1 truncate text-micro text-fg-subtle">{picked.size ? `${picked.size} picked` : "Qalam reads only what you pick."}</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" disabled={!picked.size} onClick={add}>
          {picked.size ? `Add ${picked.size}` : "Add"}
        </Button>
      </footer>
    </>
  );
}

/** A doc's mark: its connector's logo, or a file. */
function DocMark({ from }: { from: string }) {
  return from === "computer" ? <FileText {...ICON} size={13} className="shrink-0 text-fg-subtle" /> : <ConnectorLogo id={from} size={16} decorative />;
}

/** The picked docs in the box: reading, how long, or why not; × leaves one out. */
export function AttachmentChips() {
  const items = useAttach((s) => s.items);
  if (!items.length) return null;
  return (
    <ul aria-label="Docs to send" className="flex flex-wrap gap-[6px] px-[10px] pb-[2px]">
      {items.map((a) => (
        <li
          key={a.key}
          title={a.state === "failed" ? `${a.title}: ${a.why}` : a.title}
          className={clsx("inline-flex h-[26px] max-w-[280px] items-center gap-[6px] rounded-md bg-hover pl-[6px] pr-[1px] text-caption shadow-[inset_0_0_0_1px_var(--color-line-subtle)]", a.state === "failed" && "shadow-[inset_0_0_0_1px_var(--color-danger)]")}
        >
          <DocMark from={a.from} />
          <span className={clsx("min-w-0 truncate font-medium", a.state === "reading" ? "q-shimmer-text text-fg-muted" : "text-fg")}>{a.title}</span>
          {a.state === "reading" ? <Spinner size={10} /> : a.state === "ready" ? <span className="shrink-0 text-fg-subtle tnum">{wordCount(a.ingested!.text).toLocaleString()} words</span> : <span className="shrink-0 text-danger">Can't read it</span>}
          <IconBtn size="sm" label={`Leave out ${a.title}`} onClick={() => removeAttachment(a.key)} className="size-[22px]">
            <X {...ICON} size={12} />
          </IconBtn>
        </li>
      ))}
    </ul>
  );
}

/** The docs a message carried, under it in the thread. */
export function DocsSent({ docs }: { docs: readonly DocRef[] }) {
  return (
    <ul aria-label="Docs" className="flex flex-wrap justify-end gap-[6px]">
      {docs.map((d, i) => (
        <li key={`${d.from}:${d.title}:${i}`} className="inline-flex h-[24px] max-w-[260px] items-center gap-[6px] rounded-md bg-hover px-[6px] text-caption text-fg shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <DocMark from={d.from} />
          <span className="min-w-0 truncate">{d.title}</span>
        </li>
      ))}
    </ul>
  );
}
