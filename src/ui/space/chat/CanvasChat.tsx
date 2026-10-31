import { useEffect, useMemo, useRef } from "react";
import clsx from "clsx";
import { PanelLeftClose, SquarePen } from "lucide-react";
import { running, threadOf } from "@/space/chat";
import { QalamAIGlyph } from "../../brand/ai-glyph";
import { IconBtn } from "../../controls";
import { ChatComposer, ChatThread } from "../../chat/ChatThread";
import { toggleChat, useWords } from "../../frame/store";
import type { Space } from "../../frame/spaces";
import { ASK_EVENT, takeAskNext } from "../../org/ask-next";
import { PARTS } from "./parts";
import { ask, clearChat, openChat, stopTurn, useCanvasChat } from "./store";

/*
 * Qalam AI's chat on the left of a space's canvas, as Figma keeps its panel there: one box for
 * whatever they bring, the thread worked out from the canvas's turns (src/space/chat.ts), kept for
 * the canvas on this computer. ⌘\ folds it; a narrow window draws it over the canvas.
 */

export const CHAT_W = 360;

export function CanvasChat({ space, over }: { space: Space; over?: boolean }) {
  useEffect(() => void openChat(space), [space]);
  const chat = useCanvasChat((s) => s.chat);
  const loaded = useCanvasChat((s) => s.loaded);
  const messages = useMemo(() => threadOf(chat), [chat]);
  const busy = running(chat);
  const { org } = useWords();

  // A question asked from ⌘K (on this page or another) lands here and is asked.
  const asked = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    const take = (q: string | null) => q && void ask(q);
    if (!asked.current) take(takeAskNext());
    asked.current = true;
    const on = (e: Event) => take((e as CustomEvent<string>).detail);
    window.addEventListener(ASK_EVENT, on);
    return () => window.removeEventListener(ASK_EVENT, on);
  }, [loaded]);

  return (
    <section
      aria-label="Qalam AI"
      data-ask-bar
      className={clsx("flex shrink-0 flex-col border-r border-line-subtle bg-panel", over && "absolute inset-y-0 left-0 z-30 max-w-full shadow-floating")}
      style={{ width: CHAT_W }}
    >
      <header className="flex h-[40px] shrink-0 items-center gap-[8px] pr-[8px] pl-[16px]">
        <QalamAIGlyph size={14} />
        <h2 className="text-body font-medium text-fg">Qalam AI</h2>
        <span className="flex-1" />
        {chat.turns.length > 0 && (
          <IconBtn size="sm" label="New chat" onClick={clearChat}>
            <SquarePen size={14} absoluteStrokeWidth strokeWidth={1.25} />
          </IconBtn>
        )}
        <IconBtn size="sm" label="Hide Qalam AI" onClick={() => toggleChat(false)}>
          <PanelLeftClose size={14} absoluteStrokeWidth strokeWidth={1.25} />
        </IconBtn>
      </header>
      <div className="min-h-0 flex-1">
        <ChatThread
          messages={messages}
          running={!!busy}
          onCancel={() => busy && stopTurn(busy.id)}
          parts={PARTS}
          empty={
            loaded && (
              <div className="flex flex-col gap-[6px] pt-[8px]">
                <p className="text-body text-fg">Ask what your {org} knows.</p>
                <p className="text-caption text-fg-muted">Qalam AI answers from its problem pages, sources, boards and decisions, with the quotes each claim rests on.</p>
              </div>
            )
          }
          footer={
            <ChatComposer
              label={`Ask what your ${org} knows`}
              placeholder="Why do parents stop ordering?"
              submit="enter"
              disabled={!loaded}
              running={!!busy}
              onStop={() => busy && stopTurn(busy.id)}
              draftKey={`chat:${space ?? "org"}`}
              check={(t) => (t.trim().length < 3 ? "Write a little more." : null)}
              onSend={(t) => {
                void ask(t);
                return true;
              }}
            />
          }
        />
      </div>
    </section>
  );
}

/** The chat folded: a pill at the canvas's top-left brings it back. */
export function ChatPill() {
  return (
    <button type="button" onClick={() => toggleChat(true)} className="q-item absolute top-[12px] left-[12px] z-10 inline-flex h-[32px] items-center gap-[6px] rounded-lg bg-raised px-[10px] text-caption font-medium text-fg shadow-floating hover:bg-hover">
      <QalamAIGlyph size={12} /> Qalam AI
    </button>
  );
}
