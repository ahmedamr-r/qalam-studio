import { useState } from "react";
import clsx from "clsx";
import { Archive, ArchiveRestore, ChevronDown, PanelLeftClose, Plus, Trash2 } from "lucide-react";
import { IconBtn } from "../controls";
import { r } from "../recipes";
import { confirmDialog } from "../surfaces/dialog";
import { archiveChat, deleteChat, newChat, openChat, useChats } from "./chats";
import { useAgents } from "./agents";
import { agentColor } from "./AgentCursors";
import type { Chat } from "./chatTypes";

/**
 * The chat window's history column: every chat, newest first, a bar in the agent's colour on those
 * Qalam AI is working in and a dot on those that finished while you were elsewhere. Archived chats
 * sit at the bottom.
 */
export default function ChatList({ onCollapse }: { onCollapse: () => void }) {
  const chats = useChats((s) => s.chats);
  const activeId = useChats((s) => s.activeId);
  const [showArchived, setShowArchived] = useState(false);
  const live = chats.filter((c) => !c.archived);
  const archived = chats.filter((c) => c.archived);

  return (
    <nav aria-label="Chats" className="q-fade flex w-[208px] shrink-0 flex-col border-r border-line-subtle bg-app">
      <div className="flex h-[44px] shrink-0 items-center gap-[2px] border-b border-line-subtle pr-[8px] pl-[14px]">
        <span className="flex-1 text-caption font-semibold text-fg">Chats</span>
        <IconBtn size="sm" label="New chat" onClick={newChat}>
          <Plus size={14} absoluteStrokeWidth strokeWidth={1.25} />
        </IconBtn>
        <IconBtn size="sm" label="Hide chat history" onClick={onCollapse}>
          <PanelLeftClose size={14} absoluteStrokeWidth strokeWidth={1.25} />
        </IconBtn>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[6px] py-[6px]">
        {!activeId && <Row title="New chat" active onOpen={() => {}} />}
        {live.map((c) => (
          <ChatRow key={c.id} chat={c} active={c.id === activeId} />
        ))}
        {!live.length && activeId && <p className="px-[8px] py-[8px] text-caption text-fg-subtle">No chats yet.</p>}
      </div>
      <div className="shrink-0 border-t border-line-subtle px-[6px] py-[4px]">
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          aria-expanded={showArchived}
          className="q-item flex h-[28px] w-full items-center gap-[4px] rounded-md px-[8px] text-left text-caption font-medium text-fg-subtle hover:bg-hover hover:text-fg-muted"
        >
          <span className="flex-1">
            Archived<span className="tnum">{archived.length ? ` · ${archived.length}` : ""}</span>
          </span>
          <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className="q-chevron" />
        </button>
        {showArchived && (
          <div className="q-fade max-h-[128px] overflow-y-auto">
            {archived.length ? archived.map((c) => <ChatRow key={c.id} chat={c} active={c.id === activeId} />) : <p className="px-[8px] py-[4px] text-caption text-fg-subtle">No archived chats</p>}
          </div>
        )}
      </div>
    </nav>
  );
}

function ChatRow({ chat, active }: { chat: Chat; active: boolean }) {
  const agent = useAgents((s) => s.agents.find((a) => a.chatId === chat.id));
  const running = chat.turns.some((t) => t.status === "running");
  return (
    <Row
      title={chat.title}
      active={active}
      running={running ? (agent ? agentColor(agent.color) : "var(--color-ai)") : undefined}
      unread={!!chat.unread && !active}
      onOpen={() => openChat(chat.id)}
      actions={
        <>
          <IconBtn size="sm" label={chat.archived ? "Restore" : "Archive"} onClick={() => archiveChat(chat.id, !chat.archived)}>
            {chat.archived ? <ArchiveRestore size={14} absoluteStrokeWidth strokeWidth={1.25} /> : <Archive size={14} absoluteStrokeWidth strokeWidth={1.25} />}
          </IconBtn>
          <IconBtn
            size="sm"
            label="Delete"
            className="hover:bg-danger-subtle hover:text-danger"
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Delete this chat?",
                body: (
                  <>
                    <b className="font-medium text-fg">“{chat.title}”</b> and its history go away. The screens it made stay on the canvas.
                  </>
                ),
                confirmLabel: "Delete chat",
                danger: true,
              });
              if (ok) deleteChat(chat.id);
            }}
          >
            <Trash2 size={14} absoluteStrokeWidth strokeWidth={1.25} />
          </IconBtn>
        </>
      }
    />
  );
}

function Row({ title, active, running, unread, onOpen, actions }: { title: string; active: boolean; running?: string; unread?: boolean; onOpen: () => void; actions?: React.ReactNode }) {
  return (
    <div className={clsx("q-item group/row relative flex h-[28px] items-center rounded-md", active ? r.selectedRow : "text-fg-muted hover:bg-hover hover:text-fg")}>
      {running && <span aria-hidden className="q-breathe absolute top-[7px] bottom-[7px] left-[2px] w-[2px] rounded-full" style={{ background: running }} />}
      <button type="button" onClick={onOpen} className="flex h-full min-w-0 flex-1 items-center gap-[6px] rounded-md pr-[4px] pl-[10px] text-left" aria-current={active ? "true" : undefined}>
        {unread && <span className="size-[6px] shrink-0 rounded-full bg-fg" aria-label="New reply" />}
        <span className={clsx("truncate text-body", (active || unread) && "font-medium text-fg")}>{title}</span>
      </button>
      {actions && <div className="hidden shrink-0 items-center pr-[2px] group-focus-within/row:flex group-hover/row:flex">{actions}</div>}
    </div>
  );
}
