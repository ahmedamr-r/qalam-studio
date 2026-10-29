import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import { AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useAui, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { formatKeys } from "@/commands/registry";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { Kbd } from "../controls";
import { r } from "../recipes";
import type { ChatMessage, PartData } from "./types";

/*
 * A conversation with Qalam AI on assistant-ui's unstyled primitives, in Qalam's own look. The
 * surface owns the thread: it hands over messages worked out from what it keeps (an external
 * store), the parts it draws, and the composer (or a card in its place). Qalam AI's messages
 * carry the glyph; yours are the bubble on the right.
 */

export type PartComponent = ComponentType<{ data: PartData }>;

const toLike = (m: ChatMessage): ThreadMessageLike => ({
  id: m.id,
  role: m.role,
  content: m.parts.map((p) => (p.type === "text" ? { type: "text" as const, text: p.text } : { type: "data" as const, name: p.name, data: p.data })),
});

function Text({ text }: { text: string }) {
  return (
    <p className="text-body leading-[20px] text-fg" dir="auto">
      {text}
    </p>
  );
}

/** `pinned`: the footer stays at the bottom while the thread scrolls (a composer); a tall card in its place flows after the messages. */
export function ChatThread({ messages, running, onCancel, parts, footer, pinned = true, empty }: { messages: ChatMessage[]; running: boolean; onCancel?: () => void; parts: Record<string, PartComponent>; footer: ReactNode; pinned?: boolean; empty?: ReactNode }) {
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: running,
    convertMessage: toLike,
    // Sending goes through the composer's own form (./ChatThread's ChatComposer), which checks first.
    onNew: async () => {},
    ...(onCancel ? { onCancel: async () => onCancel() } : {}),
  });
  const components = useMemo(() => {
    const byName = Object.fromEntries(Object.entries(parts).map(([name, C]) => [name, ({ data }: { data: PartData }) => <C data={data} />]));
    return { Text, data: { by_name: byName, Fallback: () => null } };
  }, [parts]);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="relative flex h-full min-h-0 flex-col">
        <ThreadPrimitive.Viewport className={r.chatViewport}>
          {!messages.length && empty}
          <ThreadPrimitive.Messages>
            {({ message }) =>
              message.role === "user" ? (
                <MessagePrimitive.Root className="q-rise flex flex-col">
                  <div className={r.chatYou}>
                    <MessagePrimitive.Parts components={components} />
                  </div>
                </MessagePrimitive.Root>
              ) : (
                <MessagePrimitive.Root className="q-rise flex items-start gap-[10px]">
                  <span className="mt-[3px] grid size-[16px] shrink-0 place-items-center">
                    <QalamAIGlyph size={14} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
                    <MessagePrimitive.Parts components={components} />
                  </div>
                </MessagePrimitive.Root>
              )
            }
          </ThreadPrimitive.Messages>
          <ThreadPrimitive.ViewportFooter className={clsx(r.chatFooter, pinned && "sticky bottom-0")}>
            <ThreadPrimitive.ScrollToBottom className={clsx(r.iconButton, "absolute -top-[36px] left-1/2 -translate-x-1/2 bg-raised shadow-floating disabled:hidden")} aria-label="Scroll to the newest">
              <ArrowDown size={14} strokeWidth={1.5} />
            </ThreadPrimitive.ScrollToBottom>
            {footer}
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

const SEND = formatKeys({ key: "Enter" });
const SEND_LONG = formatKeys({ key: "Enter", meta: true });
const STOP = formatKeys({ key: "Escape" });

/**
 * The composer, inside a ChatThread. What it takes is the surface's to say: `check` answers why
 * the text can't go yet (shown under it, nothing is sent); `onSend` false puts the text back.
 * `draftKey` changing sets the text to `draft` (what they wrote comes back after Edit or Stop).
 */
export function ChatComposer({
  placeholder,
  label,
  submit,
  disabled,
  running,
  onStop,
  check,
  onSend,
  draft,
  draftKey,
  onKeyDown,
  hint,
}: {
  placeholder: string;
  label: string;
  submit: "enter" | "ctrlEnter";
  disabled: boolean;
  running: boolean;
  onStop?: () => void;
  check?: (text: string) => string | null;
  onSend: (text: string) => Promise<boolean> | boolean;
  draft?: string;
  draftKey: string;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>, setText: (t: string) => void) => void;
  hint?: ReactNode;
}) {
  const aui = useAui();
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    aui.composer.setText(draft ?? "");
    setProblem(null);
    if (!disabled) requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  }, [draftKey]);
  return (
    <div className="flex flex-col gap-[4px]">
      <ComposerPrimitive.Root
        className={r.composer}
        data-busy={running || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          if (disabled || running) return;
          const text = aui.composer.getState().text;
          if (!text.trim()) return;
          const why = check?.(text) ?? null;
          setProblem(why);
          if (why) return;
          aui.composer.setText("");
          void Promise.resolve(onSend(text)).then((ok) => {
            if (!ok && !aui.composer.getState().text) aui.composer.setText(text);
          });
        }}
      >
        <ComposerPrimitive.Input
          ref={input}
          aria-label={label}
          placeholder={placeholder}
          disabled={disabled}
          submitMode={submit}
          minRows={submit === "ctrlEnter" ? 3 : 1}
          maxRows={12}
          unstable_focusOnRunStart={false}
          cancelOnEscape={false}
          dir="auto"
          className={r.composerInput}
          onKeyDown={(e) => {
            if (running && e.key === "Escape") {
              e.preventDefault();
              onStop?.();
              return;
            }
            onKeyDown?.(e, (t) => aui.composer.setText(t));
          }}
        />
        <div className={r.composerBar}>
          <span className="flex min-w-0 flex-1 items-center gap-[6px] truncate text-micro text-fg-subtle">{hint}</span>
          {running ? (
            <button type="button" onClick={onStop} className={clsx(r.buttonBase, r.buttonPrimary, r.stopButton)}>
              Stop <Kbd keys={STOP} size="sm" onInverse />
            </button>
          ) : (
            <button type="submit" disabled={disabled} aria-label="Send" title={`Send (${(submit === "enter" ? SEND : SEND_LONG).join("")})`} className={clsx(r.iconButtonSm, "bg-inverse text-fg-inverse hover:bg-inverse/90 disabled:bg-hover disabled:text-fg-faint")}>
              <ArrowUp size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      </ComposerPrimitive.Root>
      {problem && <p className="px-[4px] text-caption text-danger">{problem}</p>}
    </div>
  );
}

/** Answers that act, under one of Qalam AI's messages. */
export function ReplyChips({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-[6px] pt-[2px]">{children}</div>;
}
