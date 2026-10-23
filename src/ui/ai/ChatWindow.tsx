import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import clsx from "clsx";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, History, Info, Minus, Pencil, Play, Plus } from "lucide-react";
import { studio, useStudio } from "@/doc/store";
import { dispatchKeyDown, matchKey } from "@/commands/registry";
import { IconBtn } from "../controls";
import { r } from "../recipes";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../menu";
import { refocusAfterMenu } from "./menuRow";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { newChat, openChat, recordTurn, renameChat, send, startChats, useActiveChat, useChats } from "./chats";
import type { Chat } from "./chatTypes";
import Composer, { CHAT_KEYS, composerDraft, stopActive } from "./Composer";
import { TurnView } from "./turns";
import ChatList from "./ChatList";
import { useAIStatus } from "./common";
import { chatWindowBottom, toolbarInset, useChatFrame } from "./chatFrame";
import { useProjectType } from "@/projects/mode";
import BoardComposer from "../discovery/BoardComposer";
import ServingBanner from "../discovery/ServingBanner";

/**
 * Qalam AI's chat, floating over the canvas just above the tool bar (like brilliant.design's
 * playground): the conversation, with the chat history in a column it can show. Every request is
 * a turn in the open chat, and later ones build on earlier ones. While Qalam AI works, its cursor
 * on the canvas shows what it's building and the composer carries the illumination ring.
 *
 * It stays mounted: closed, it is `inert` and hidden by the q-chat transition (transform and
 * opacity only), which rises out of the tool bar's Qalam AI button. "/" opens it through the
 * registry's `ai.chat`; Esc stops a run, then minimizes.
 */

const MIN_H = 320;
const DEFAULT_H = 520;
const MAX_W = 760;
const STORE_KEY = "qalam/chat-window/v1";

interface Saved {
  height?: number;
  list?: boolean;
}

function readSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Saved;
  } catch {
    return {};
  }
}

function writeSaved(patch: Saved) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...readSaved(), ...patch }));
  } catch {
    /* storage unavailable */
  }
}

export default function ChatWindow() {
  // A Discovery board's chat holds Qalam AI's work on the tree (drafts, hand-offs); it starts from the cards.
  const board = useProjectType() === "discovery";
  const open = useStudio((s) => s.chatOpen);
  const chat = useActiveChat();
  const ref = useRef<HTMLElement>(null);
  const [room, setRoom] = useState({ w: 1200, h: 800 });
  const [height, setHeight] = useState(DEFAULT_H);
  const [list, setList] = useState(false);
  const [originX, setOriginX] = useState<number | null>(null);
  const bottom = chatWindowBottom();

  useEffect(() => {
    startChats();
    const saved = readSaved();
    if (saved.height) setHeight(saved.height);
    if (saved.list) setList(true);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __qalamChat: unknown }).__qalamChat = { chats: useChats, recordTurn, send };
  }, []);

  // The canvas area it floats in (resizes with the side panels and the browser).
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => setRoom({ w: parent.clientWidth, h: parent.clientHeight }));
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  const h = Math.max(Math.min(MIN_H, room.h - bottom - 16), Math.min(height, room.h - bottom - 16));
  const w = Math.min(MAX_W, room.w - 32);
  const narrow = w < 600;
  const showList = list && !narrow;

  // Rise out of the tool bar's Qalam AI button: the transform origin sits above it.
  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    const btn = document.querySelector<HTMLElement>('[data-region="toolbar"] [aria-label^="Qalam AI"]');
    if (!el || !btn) return setOriginX(null);
    const b = btn.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    // The box is scaled (.97) around its current origin while closed; its centre doesn't move.
    const left = box.left + box.width / 2 - w / 2;
    setOriginX(Math.round(Math.max(0, Math.min(w, b.left + b.width / 2 - left))));
  }, [open, w]);

  // Tell the canvas overlays (critique card, cursors, camera follow) how much of the bottom it covers.
  useEffect(() => {
    useChatFrame.setState({ bottom: open ? bottom + h + 8 : toolbarInset() });
  }, [open, h, bottom]);
  useEffect(() => () => useChatFrame.setState({ bottom: toolbarInset() }), []);

  const toggleList = () => {
    const next = !showList;
    setList(next);
    writeSaved({ list: next });
  };

  return (
    <section
      ref={ref}
      aria-label="Qalam AI chat"
      data-open={open ? "" : undefined}
      inert={!open}
      onKeyDown={(e) => {
        // Keys typed here never reach the canvas's shortcuts (Delete, arrows, V, F…); app-wide
        // commands (⌘K, ⌘\, ⌘S, F6…) still run, as they do from any other field.
        e.stopPropagation();
        if (dispatchKeyDown(e.nativeEvent, "field")) return;
        // Esc in an open menu closes the menu (its content is portaled outside this box), and while
        // one of the chat's menus is open Esc belongs to it even when focus stayed in the composer.
        if (!e.currentTarget.contains(e.target as Node) || document.querySelector('[data-radix-popper-content-wrapper] > [data-state="open"]')) return;
        const native = e.nativeEvent;
        if (matchKey(native, CHAT_KEYS.stop) && stopActive()) e.preventDefault();
        else if (matchKey(native, CHAT_KEYS.minimize)) studio().setChatOpen(false);
      }}
      className={clsx(r.floating, "q-chat absolute left-1/2 z-[9] flex -translate-x-1/2 overflow-hidden bg-panel")}
      style={{ bottom, width: w, height: h, ...(originX !== null ? ({ "--origin-x": `${originX}px` } as CSSProperties) : {}) }}
    >
      <TopEdge height={h} onResize={setHeight} onDone={(v) => writeSaved({ height: v })} />
      {showList && <ChatList onCollapse={toggleList} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header chat={chat} history={showList} onHistory={narrow ? undefined : toggleList} />
        {!board && <ServingBanner />}
        <Thread chat={chat} />
        {board ? (
          <BoardComposer />
        ) : (
          <>
            {!chat?.turns.length && <Starters />}
            <Composer />
          </>
        )}
      </div>
    </section>
  );
}

/** Drag the top edge to make the window taller or shorter; double-click to reset. Never animated. */
function TopEdge({ height, onResize, onDone }: { height: number; onResize: (h: number) => void; onDone: (h: number) => void }) {
  const start = useRef<{ y: number; h: number } | null>(null);
  const last = useRef(height);
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the chat"
      aria-valuenow={height}
      aria-valuemin={MIN_H}
      tabIndex={0}
      className="group absolute inset-x-0 top-0 z-10 h-[6px] cursor-row-resize outline-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, h: height };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        last.current = Math.max(MIN_H, Math.round(start.current.h + start.current.y - e.clientY));
        onResize(last.current);
      }}
      onPointerUp={() => {
        if (!start.current) return;
        start.current = null;
        onDone(last.current);
      }}
      onDoubleClick={() => {
        onResize(DEFAULT_H);
        onDone(DEFAULT_H);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        // Keep the canvas from nudging the selection too.
        e.preventDefault();
        e.stopPropagation();
        const h = Math.max(MIN_H, height + (e.key === "ArrowUp" ? 16 : -16));
        onResize(h);
        onDone(h);
      }}
    >
      <div className="mx-auto mt-[2px] h-[2px] w-[40px] rounded-full bg-transparent transition-colors duration-fast group-hover:bg-line-strong group-hover:duration-0 group-focus-visible:bg-focus" />
    </div>
  );
}

function Header({ chat, history, onHistory }: { chat: Chat | null; history: boolean; onHistory?: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={r.chatHeader}>
      <QalamAIGlyph size={16} className="shrink-0" />
      <h2 className={clsx(r.chatTitle, "shrink-0")}>Qalam AI</h2>
      {editing && chat ? (
        <input
          autoFocus
          defaultValue={chat.title}
          aria-label="Chat name"
          className="h-[24px] min-w-0 flex-1 rounded-md bg-field px-[6px] text-caption font-medium text-fg shadow-focus-field outline-none focus-visible:outline-none"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            renameChat(chat.id, e.currentTarget.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(false);
            }
          }}
        />
      ) : (
        <ThreadSwitcher chat={chat} onRename={() => setEditing(true)} onAll={onHistory && !history ? onHistory : undefined} />
      )}
      <span className="flex-1" />
      <AboutButton />
      {onHistory && (
        <IconBtn size="sm" label={history ? "Hide chat history" : "Chat history"} active={history} onClick={onHistory}>
          <History size={14} absoluteStrokeWidth strokeWidth={1.25} />
        </IconBtn>
      )}
      <IconBtn size="sm" label="Minimize" command="ai.minimize" onClick={() => studio().setChatOpen(false)}>
        <Minus size={14} absoluteStrokeWidth strokeWidth={1.25} />
      </IconBtn>
    </div>
  );
}

/** "· Rewards tiers ⌄": the open chat, with the recent ones to switch to, a new chat and rename. */
function ThreadSwitcher({ chat, onRename, onAll }: { chat: Chat | null; onRename: () => void; onAll?: () => void }) {
  const chats = useChats((s) => s.chats);
  const recent = chats.filter((c) => !c.archived).slice(0, 8);
  const trigger = useRef<HTMLButtonElement>(null);
  // A pointer pick leaves focus on the switcher, as before, so the next key stays in the chat.
  const pick = (fn: () => void) => () => {
    fn();
    refocusAfterMenu(() => trigger.current);
  };
  return (
    <Menu
      label="Chats"
      className="w-[248px]"
      trigger={
        <button
          ref={trigger}
          type="button"
          aria-haspopup="menu"
          className={clsx(r.chatThread, "q-item min-w-0 rounded-md py-[2px] pr-[2px] hover:text-fg data-[state=open]:text-fg")}
          onDoubleClick={() => chat && onRename()}
          title={chat ? "Switch chats · double-click to rename" : undefined}
        >
          <span className="truncate">{chat?.title ?? "New chat"}</span>
          <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className="q-chevron shrink-0" />
        </button>
      }
    >
      <MenuItem icon={<Plus absoluteStrokeWidth strokeWidth={1.25} />} onSelect={pick(newChat)}>
        New chat
      </MenuItem>
      {chat && (
        <MenuItem icon={<Pencil absoluteStrokeWidth strokeWidth={1.25} />} onSelect={onRename}>
          Rename
        </MenuItem>
      )}
      {recent.length > 0 && (
        <>
          <MenuSeparator />
          <MenuLabel>Recent</MenuLabel>
          {recent.map((c) => (
            <MenuItem key={c.id} checked={c.id === chat?.id} onSelect={pick(() => openChat(c.id))}>
              <span className="flex min-w-0 items-center gap-[6px]">
                <span className="min-w-0 truncate">{c.title}</span>
                {c.turns.some((t) => t.status === "running") && <QalamAIGlyph size={12} className="q-breathe shrink-0" />}
              </span>
            </MenuItem>
          ))}
        </>
      )}
      {onAll && (
        <>
          <MenuSeparator />
          <MenuItem icon={<History absoluteStrokeWidth strokeWidth={1.25} />} onSelect={pick(onAll)}>
            All chats and archive
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function AboutButton() {
  const status = useAIStatus();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" aria-label="About Qalam AI" className={r.iconButtonSm}>
          <Info size={14} absoluteStrokeWidth strokeWidth={1.25} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="end" sideOffset={6} collisionPadding={8} className={clsx(r.popover, "w-[272px] p-[12px] text-caption text-fg-muted")}>
          {status?.ai ? (
            <>
              <p className="flex items-center gap-[6px] text-body font-semibold text-fg">
                <QalamAIGlyph size={14} /> Qalam AI
              </p>
              <p className="mt-[4px]">{status.backend === "cli" ? "Runs through your local CLI login." : "The key stays on the server."}</p>
              {status.model && <p className="mt-[4px] font-mono text-micro text-fg-subtle">{status.model}</p>}
            </>
          ) : (
            <p>No AI configured on this deployment: requests replay recorded samples, and the linter runs locally.</p>
          )}
          <p className="mt-[8px] text-micro text-fg-subtle">Everything in a chat is remembered, so you can follow up (“make the second one denser”) until you start a new chat.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Thread({ chat }: { chat: Chat | null }) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const status = useAIStatus();
  const turns = chat?.turns ?? [];
  // Turns already there when a chat opens appear at once; only turns added while it's open rise in.
  const known = useRef<{ chat: string | null; ids: Set<string> }>({ chat: null, ids: new Set() });
  if (known.current.chat !== (chat?.id ?? null)) known.current = { chat: chat?.id ?? null, ids: new Set(turns.map((t) => t.id)) };

  // Follow the conversation: jump to a new turn, and keep up as the running one grows (its steps
  // and chips update outside this component) unless the designer has scrolled up to read.
  useEffect(() => {
    pinned.current = true;
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.id, turns.length]);
  useEffect(() => {
    const el = box.current;
    const inner = content.current;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [chat?.id, turns.length > 0]);

  return (
    <div
      ref={box}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      {status && !status.ai && (
        <div className="mx-[14px] mt-[14px] flex items-start gap-[8px] rounded-lg bg-muted px-[12px] py-[8px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <Info size={14} absoluteStrokeWidth strokeWidth={1.25} className="mt-[1px] shrink-0 text-fg-subtle" />
          <span>
            AI isn&apos;t configured on this deployment (no <code className="font-mono text-micro text-fg">ANTHROPIC_API_KEY</code>). Generate replays a recorded answer on the canvas, other tools use samples, and the linter runs locally.
          </span>
        </div>
      )}
      {turns.length ? (
        <div ref={content} className="flex flex-col gap-[18px] px-[14px] pt-[14px] pb-[10px]">
          {turns.map((t) => (
            <TurnView key={t.id} chatId={chat!.id} t={t} fresh={!known.current.ids.has(t.id)} />
          ))}
        </div>
      ) : (
        <div className="flex h-full flex-col justify-end gap-[6px] px-[16px] pb-[12px]">
          <QalamAIGlyph size={18} className="mb-[4px]" />
          <p className="text-display font-semibold text-fg">What should Qalam AI design?</p>
          <p className="max-w-[440px] text-body text-fg-muted">Describe a screen and watch it being built on the canvas, or pick another tool below: critique, extract a design system, add a component from a screenshot, name tokens, audit, tune.</p>
        </div>
      )}
    </div>
  );
}

const REPLAYS = ["Food order tracking"];
const EXAMPLES = ["Ride booking confirmation", "Wallet top-up with saved cards", "Empty past orders", "Restaurant menu with offers"];

/** Suggestions above the composer of a new chat: recorded runs to replay, and briefs to try. */
function Starters() {
  return (
    <div className="q-stagger flex shrink-0 items-center gap-[6px] overflow-x-auto px-[14px] pb-[10px] ds-noscrollbar">
      <span className="shrink-0 pr-[2px] text-micro font-medium text-fg-subtle" style={{ "--i": 0 } as CSSProperties}>
        Replays
      </span>
      {REPLAYS.map((label, i) => (
        <button
          key={label}
          type="button"
          onClick={() => void send({ tool: "generate", text: label, replay: true })}
          title="Replay a recorded answer: watch it being built on the canvas"
          className="q-item q-press inline-flex h-[24px] shrink-0 items-center gap-[6px] rounded-md bg-muted px-[8px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-active hover:text-fg"
          style={{ "--i": i + 1 } as CSSProperties}
        >
          <Play size={10} className="fill-current text-fg-subtle" /> {label}
        </button>
      ))}
      <span className="shrink-0 pr-[2px] pl-[6px] text-micro font-medium text-fg-subtle" style={{ "--i": REPLAYS.length + 1 } as CSSProperties}>
        Try
      </span>
      {EXAMPLES.map((ex, i) => (
        <button
          key={ex}
          type="button"
          onClick={() => {
            studio().setAITab("generate");
            composerDraft.set(ex);
          }}
          className="q-item q-press inline-flex h-[24px] shrink-0 items-center rounded-md px-[8px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover hover:text-fg"
          style={{ "--i": REPLAYS.length + 2 + i } as CSSProperties}
        >
          {ex}
        </button>
      ))}
    </div>
  );
}
