import { BASES, BASIS_LABEL, isBasis } from "@/discovery/basis";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { create } from "zustand";
import { ChevronRight, File, FileSpreadsheet, FileText, Folder, Import, Plus, Presentation, Search, Settings2, Upload, X } from "lucide-react";
import type { LookedHit } from "@/connectors/look";
import { RECIPES, type Hit, type HitType } from "@/connectors/recipes";
import { ACCEPT } from "@/discovery/ingest/core";
import { connectorsDb, type ConnectorState } from "@/org/connectors";
import { placeHref } from "@/projects/model";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { ConnectorLogo } from "../brand/ConnectorLogo";
import { ConnectActions, type View } from "../connections/Connectors";
import { Button, Checkbox, IconBtn, Spinner } from "../controls";
import { Menu, MenuItem, MenuSeparator, SubMenu } from "../menu";
import { navigate } from "../nav";
import { r } from "../recipes";
import { ago } from "../time";
import { StatusDot } from "../viz";
import { attachFiles, attachHits, removeAttachment, setBasis, setVoice, sourcesFor, useAttach, wordCount, type DocRef, type SourceFit } from "./attach";

/*
 * Bringing docs into the chat box: its + (the tools that fit what Qalam AI asked, in a submenu, and
 * this computer), a picker over the box that browses a connector (what was opened lately, its
 * folders, a search) and connects it first when it isn't yet, and the picked docs as chips in the
 * box, each read as it's picked. Logic in ./attach.ts.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

// The connectors on this computer, asked once per window; Claude Code is asked which it has once too.
const useConnectors = create<{ view: View | null; checking: boolean }>(() => ({ view: null, checking: false }));
let asked = false;
export function useConnectorView() {
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

/** The box's +: the tools that fit, in a submenu (a picked one opens its picker above the box), this computer, and what else the surface offers. `manage` leads to Connections. */
export function SourceMenu({ fit, manage = false, children }: { fit: SourceFit; manage?: boolean; children?: ReactNode }) {
  const { view, setView } = useConnectorView();
  const [openId, setOpenId] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const list = view ? sourcesFor(fit, view.connectors) : [];
  const open = openId ? (view?.connectors.find((c) => c.id === openId) ?? null) : null;
  return (
    <Popover.Root open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
      <Popover.Anchor asChild>
        <span className="flex shrink-0">
          <Menu
            label="Add to the message"
            side="top"
            sideOffset={12}
            alignOffset={-6}
            className="w-[240px]"
            trigger={
              <button type="button" aria-label="Add docs" title="Add docs" className={r.iconButton}>
                <Plus {...ICON} size={16} />
              </button>
            }
          >
            {(!view || list.length > 0) && (
              <SubMenu
                label="Bring it from"
                icon={<Import {...ICON} />}
                trailing={
                  <span className="flex shrink-0 items-center gap-[4px]">
                    {list.slice(0, 2).map((c) => (
                      <ConnectorLogo key={c.id} id={c.id} size={16} decorative />
                    ))}
                  </span>
                }
              >
                <div className="w-[260px]">
                  {!view && <MenuItem disabled="Still asking which tools are here" onSelect={() => {}}>Finding your tools…</MenuItem>}
                  {list.map((c) => (
                    <MenuItem key={c.id} icon={<ConnectorLogo id={c.id} size={16} decorative />} onSelect={() => setOpenId(c.id)}>
                      <span className="flex items-center gap-[8px]">
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        <span className="inline-flex shrink-0 items-center gap-[4px] text-micro text-fg-subtle">
                          <StatusDot tone={c.tone} hollow={c.tone === "off"} />
                          {c.word}
                        </span>
                      </span>
                    </MenuItem>
                  ))}
                  {manage && (
                    <>
                      <MenuSeparator />
                      <MenuItem icon={<Settings2 {...ICON} />} onSelect={() => navigate(placeHref("connections"))}>
                        Manage connections
                      </MenuItem>
                    </>
                  )}
                </div>
              </SubMenu>
            )}
            <MenuItem icon={<Upload {...ICON} />} onSelect={() => file.current?.click()}>
              Upload from computer
            </MenuItem>
            {children && (
              <>
                <MenuSeparator />
                {children}
              </>
            )}
          </Menu>
        </span>
      </Popover.Anchor>
      {/* Outside the menu, which is gone by the time the file dialog answers. */}
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
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={12}
          alignOffset={-6}
          collisionPadding={12}
          aria-label={open ? `Pick from ${open.label}` : undefined}
          // Opening a folder replaces the row that had focus: that isn't leaving the picker. Escape, ×, Cancel or a click outside close it.
          onFocusOutside={(e) => e.preventDefault()}
          // The picker is the box's child in React's tree (a portal), so its search or token form's submit would reach the box and send the chat.
          onSubmit={(e) => e.stopPropagation()}
          className={clsx(r.popover, "flex max-h-[min(440px,calc(100vh-120px))] w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0")}
        >
          {open && <Picker key={open.id} c={open} onView={setView} onClose={() => setOpenId(null)} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Where the picker is: what was opened lately, a folder (the trail down to it), a search, Qalam AI's look, or nowhere yet (search only). */
type Place = { kind: "recent" } | { kind: "folder"; trail: { id: string | null; title: string }[] } | { kind: "search"; words: string; back: Place } | { kind: "look"; about: string; back: Place } | { kind: "none" };

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

/**
 * A connected tool to browse: what was opened lately, its folders or pages, a search, or Qalam AI
 * looking inside it. By default what's picked goes in the chat box; `onAdd` takes it instead, and
 * `about` is what Qalam AI looks for when nothing's typed.
 */
export function Browse({ c, onClose, onAdd, addLabel = "Add", about }: { c: ConnectorState; onClose: () => void; onAdd?: (hits: Hit[]) => void; addLabel?: string; about?: string }) {
  const recipe = RECIPES[c.id];
  // Drive through Google's own API has its folders and what was opened lately; a Notion token, the pages shared with it.
  const folders = c.via === "google" || !!recipe?.list;
  const recent = c.via === "google" || !!recipe?.recent || c.via === "token";
  const tops = (c.via !== "token" && recipe?.roots) || [{ id: null, title: TOP[c.id] ?? "Top" }];
  const top: Place = folders ? { kind: "folder", trail: [tops[0]] } : { kind: "none" };
  const [place, setPlace] = useState<Place>(recent ? { kind: "recent" } : top);
  const [words, setWords] = useState("");
  const [hits, setHits] = useState<LookedHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<string, Hit>>(new Map());
  const [again, setAgain] = useState(0);
  /** Qalam AI was asked with nothing to go on: the box takes what to look for. */
  const [asking, setAsking] = useState(false);
  /** How Qalam AI's look is going. */
  const [step, setStep] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const at = place.kind === "search" ? { query: place.words } : place.kind === "folder" ? { folder: place.trail[place.trail.length - 1].id } : place.kind === "recent" ? {} : null;
  const key = place.kind === "look" ? `look:${place.about}` : JSON.stringify(at);
  useEffect(() => {
    if (place.kind === "look") {
      const stop = new AbortController();
      setHits(null);
      setError(null);
      setStep(null);
      // Its picks come back ticked: nothing's read until they're added.
      connectorsDb.look(c.id, place.about, setStep, stop.signal).then(
        (x) => {
          if (stop.signal.aborted) return;
          setHits(x.hits);
          setPicked((m) => new Map([...m, ...x.hits.map((h): [string, Hit] => [h.id, h])]));
        },
        (e: unknown) => !stop.signal.aborted && setError(e instanceof Error ? e.message : String(e)),
      );
      return () => stop.abort();
    }
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

  const backOf = (p: Place) => (p.kind === "search" || p.kind === "look" ? p.back : p);
  const look = (what: string) => {
    setAsking(false);
    setPlace((p) => ({ kind: "look", about: what, back: backOf(p) }));
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    const w = words.trim();
    if (!w) return;
    if (asking) return look(w);
    setPlace((p) => ({ kind: "search", words: w, back: backOf(p) }));
  };
  const askAI = () => {
    const what = words.trim() || about?.trim();
    if (what) return look(what);
    setAsking(true);
    input.current?.focus();
  };
  const toggle = (h: Hit, on: boolean) =>
    setPicked((m) => {
      const next = new Map(m);
      if (on) next.set(h.id, h);
      else next.delete(h.id);
      return next;
    });
  const add = () => {
    if (onAdd) return onAdd([...picked.values()]);
    void attachHits(c, [...picked.values()]);
    onClose();
  };
  const crumbs = place.kind === "folder" && place.trail.length > 1 ? place.trail : tops;
  const isTrail = crumbs !== tops;
  const openFolder = (h: Hit) => setPlace((p) => ({ kind: "folder", trail: [...(p.kind === "folder" ? p.trail : [tops[0]]), { id: h.id, title: h.title }] }));
  const slow = c.via === "claude-code";

  return (
    <>
      <div className="flex shrink-0 flex-col gap-[6px] px-[10px] pt-[8px]">
        <form onSubmit={search} role="search">
          <label className={r.field}>
            <Search {...ICON} className="shrink-0 text-fg-subtle" />
            <input ref={input} autoFocus className={r.fieldInput} aria-label={`Search ${c.label}`} placeholder={asking ? "What should Qalam AI look for?" : `Search ${c.label}`} value={words} onChange={(e) => setWords(e.target.value)} />
            {(place.kind === "search" || place.kind === "look") && (
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
            <span className="min-w-0 truncate px-[4px] text-fg-muted">Results for “{place.words}”</span>
          ) : place.kind === "look" ? (
            <span className="min-w-0 truncate px-[4px] text-fg-muted">Qalam AI's picks for “{place.about}”</span>
          ) : (
            <>
              {recent && (
                <button type="button" aria-current={place.kind === "recent" || undefined} onClick={() => setPlace({ kind: "recent" })} className={clsx("rounded-sm px-[6px] py-[2px] hover:bg-hover", place.kind === "recent" ? "font-medium text-fg" : "text-fg-muted")}>
                  Recent
                </button>
              )}
              {folders &&
                crumbs.map((f, i) => {
                  // Deep in a folder: the trail back up. At the top: its places, side by side.
                  const here = place.kind === "folder" && (isTrail ? i === crumbs.length - 1 : place.trail[0].id === f.id);
                  return (
                    <span key={`${f.id}:${i}`} className="inline-flex items-center gap-[2px]">
                      {i > 0 && isTrail ? <ChevronRight {...ICON} size={12} className="text-fg-faint" /> : i === 0 && recent && <span aria-hidden className="mx-[4px] h-[12px] w-px bg-line" />}
                      <button
                        type="button"
                        aria-current={here || undefined}
                        onClick={() => setPlace({ kind: "folder", trail: isTrail ? crumbs.slice(0, i + 1) : [f] })}
                        className={clsx("max-w-[160px] truncate rounded-sm px-[6px] py-[2px] hover:bg-hover", here ? "font-medium text-fg" : "text-fg-muted")}
                      >
                        {f.title}
                      </button>
                    </span>
                  );
                })}
            </>
          )}
          <button type="button" onClick={askAI} className={clsx(r.replyChip, "ml-auto shrink-0")}>
            <QalamAIGlyph size={12} /> Let Qalam AI look
          </button>
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
              <Spinner size={12} /> <span className="q-shimmer-text">{(place.kind === "look" && step) || (slow ? `Asking ${c.label} through Claude Code…` : `Looking in ${c.label}…`)}</span>
            </span>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={clsx(r.skeleton, "h-[24px]")} aria-hidden />
            ))}
          </div>
        ) : !hits.length ? (
          <p className="p-[6px] text-caption text-fg-subtle">{place.kind === "none" ? `Search ${c.label} for the docs that explain it, or let Qalam AI look.` : place.kind === "look" ? "Qalam AI found nothing that fits. Browse, or search in your own words." : place.kind === "search" ? "Nothing found. Try other words." : place.kind === "folder" ? "Nothing in here." : "Nothing opened lately. Search instead."}</p>
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
                      onClick={() => openFolder(h)}
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
                <li key={h.id} className="flex flex-col rounded-md px-[6px] hover:bg-hover">
                  <span className="flex h-[30px] items-center gap-[4px]">
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
                    {h.opens && (
                      <IconBtn size="sm" label={`Open ${h.title}`} onClick={() => openFolder(h)}>
                        <ChevronRight {...ICON} />
                      </IconBtn>
                    )}
                  </span>
                  {h.why && <span className="truncate pb-[4px] pl-[22px] text-micro text-fg-subtle">{h.why}</span>}
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
          {picked.size ? `${addLabel} ${picked.size}` : addLabel}
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
/** The docs in the box, as chips. `voices`: each says whose words it holds (customers' or the person's own), and a click changes it. `kinds`: each can say what it rests on, else Qalam AI will tell. */
export function AttachmentChips({ voices = false, kinds = false }: { voices?: boolean; kinds?: boolean }) {
  const items = useAttach((s) => s.items);
  if (!items.length) return null;
  return (
    <ul aria-label="Docs to send" className="flex flex-wrap gap-[6px] px-[8px] pt-[8px]">
      {items.map((a) => (
        <li
          key={a.key}
          title={a.state === "failed" ? `${a.title}: ${a.why}` : a.title}
          className={clsx("inline-flex h-[26px] max-w-[360px] items-center gap-[6px] rounded-md bg-hover pl-[6px] pr-[1px] text-caption shadow-[inset_0_0_0_1px_var(--color-line-subtle)]", a.state === "failed" && "shadow-[inset_0_0_0_1px_var(--color-danger)]")}
        >
          <DocMark from={a.from} />
          <span className={clsx("min-w-[48px] truncate font-medium", a.state === "reading" ? "q-shimmer-text text-fg-muted" : "text-fg")}>{a.title}</span>
          {a.state === "reading" && a.step && <span className="shrink-0 text-fg-subtle tnum">{a.step}</span>}
          {a.state === "reading" ? <Spinner size={10} /> : a.state === "ready" ? <span className="shrink-0 text-fg-subtle tnum">{wordCount(a.ingested!.text).toLocaleString()} words</span> : <span className="shrink-0 text-danger">Can't read it</span>}
          {voices && a.state === "ready" && (
            <button
              type="button"
              aria-label={`${a.title} holds ${a.voice === "customers" ? "customers' words" : "your own words"}: change it`}
              title={a.voice === "customers" ? "Read as what customers said. Click if they're your own words" : "Read as your own thinking. Click if customers said it"}
              onClick={() => setVoice(a.key, a.voice === "customers" ? "own" : "customers")}
              className={clsx("shrink-0 rounded-sm px-[5px] text-micro font-medium leading-[18px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-active", a.voice === "customers" ? "text-fg" : "text-fg-muted")}
            >
              {a.voice === "customers" ? "Customers' words" : "Mine"}
            </button>
          )}
          {kinds && a.state === "ready" && (
            <select
              aria-label={`What ${a.title} is`}
              title="What it is. Left alone, Qalam AI reads it and tells you"
              value={a.basis ?? ""}
              onChange={(e) => setBasis(a.key, isBasis(e.target.value) ? e.target.value : undefined)}
              className={clsx("max-w-[132px] shrink-0 cursor-pointer appearance-none truncate rounded-sm bg-transparent px-[5px] text-micro font-medium leading-[18px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-active", a.basis ? "text-fg" : "text-fg-muted")}
            >
              <option value="">Qalam AI will tell</option>
              {BASES.map((b) => (
                <option key={b} value={b}>
                  {BASIS_LABEL[b]}
                </option>
              ))}
            </select>
          )}
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
