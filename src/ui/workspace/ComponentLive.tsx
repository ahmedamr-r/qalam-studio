import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ArrowUp, Diamond, MoveRight, TriangleAlert } from "lucide-react";
import { useStudio } from "@/doc/store";
import { dsIdForNode, getSystem, type DesignSystem } from "@/design-system/registry";
import { instancesOf } from "@/design-system/instances";
import { wholeDoc } from "@/doc/pages";
import { revealLayers } from "../pages";
import { Button } from "../controls";
import { r } from "../recipes";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { send, useChats } from "../ai/chats";
import { TurnView } from "../ai/turns";
import type { Chat, ChatTurn } from "../ai/chatTypes";
import { moveScreens, useEdits } from "./editing";
import { useWorkspace } from "./store";

/**
 * A component's link to the canvas, in the component library: its instances (which follow every
 * change to it at once), and asking AI to change it. The AI's proposal shows here and in the chat.
 */

/** Icon props for every lucide glyph here: 1.25px lines at any size. */
const ico = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** The newest "Tune" turn about this component in one of these systems, in any chat. */
function latestTurn(chats: Chat[], name: string, systemIds: string[]): { chatId: string; t: ChatTurn } | null {
  let best: { chatId: string; t: ChatTurn } | null = null;
  for (const c of chats)
    for (const t of c.turns)
      if (t.tool === "tune" && t.request.component === name && systemIds.includes(t.request.system?.id ?? "") && (!best || t.at > best.t.at)) best = { chatId: c.id, t };
  return best;
}

export function ComponentLive({ name, ds }: { name: string; ds: DesignSystem }) {
  const doc = useStudio((s) => s.doc);
  const forked = useEdits((s) => s.forked);
  const chats = useChats((s) => s.chats);
  const loaded = useChats((s) => s.loaded);
  const [text, setText] = useState("");
  const [moving, setMoving] = useState(false);

  // Instances on every page (never the Components page's drawings).
  const all = useMemo(() => {
    const whole = wholeDoc(doc);
    return instancesOf(whole, name).map((id) => ({ id, ds: dsIdForNode(whole, id) }));
  }, [doc, name]);
  const here = useMemo(() => all.filter((i) => i.ds === ds.id).map((i) => i.id), [all, ds.id]);
  // Instances on another system don't follow this one. Offer to move the screens of the system most
  // of them are on (the original, when this system is a copy made by editing it).
  const copiedFrom = forked && forked.to === ds.id ? forked.from : null;
  const { source, behind } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of all) if (i.ds !== ds.id) counts.set(i.ds, (counts.get(i.ds) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => (b[0] === copiedFrom ? 1 : 0) - (a[0] === copiedFrom ? 1 : 0) || b[1] - a[1])[0];
    return { source: top?.[0] ?? null, behind: top?.[1] ?? 0 };
  }, [all, ds.id, copiedFrom]);
  const found = useMemo(() => latestTurn(chats, name, copiedFrom ? [ds.id, copiedFrom] : [ds.id]), [chats, name, ds.id, copiedFrom]);
  const running = found?.t.status === "running";

  // AI changes to the built-in system land in a copy, like hand edits: show that copy here.
  const appliedTo = found?.t.outcome?.kind === "tune" ? found.t.outcome.applied?.systemId : undefined;
  const askedOf = found?.t.request.system?.id;
  useEffect(() => {
    if (appliedTo && askedOf === ds.id && appliedTo !== ds.id) useWorkspace.setState({ systemId: appliedTo });
  }, [appliedTo, askedOf, ds.id]);

  const ask = () => {
    const q = text.trim();
    if (q.length < 3 || running) return;
    void send({ tool: "tune", text: q, component: name, systemId: ds.id });
    setText("");
  };

  const select = () => {
    useWorkspace.getState().close();
    // The first one's page shows, with those on it selected.
    revealLayers(here);
  };

  const move = async () => {
    if (!source) return;
    setMoving(true);
    try {
      await moveScreens(source, ds.id);
    } finally {
      setMoving(false);
    }
  };

  return (
    <section className="flex flex-col gap-[12px] rounded-xl p-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex items-center gap-[8px] text-caption text-fg-muted">
        <Diamond size={14} {...ico} className="shrink-0 text-component" />
        <span className="min-w-0 flex-1">
          {here.length ? (
            <>
              <b className="font-medium text-fg tnum">
                {here.length} {here.length === 1 ? "instance" : "instances"}
              </b>{" "}
              on the canvas {here.length === 1 ? "follows" : "follow"} {name} in {ds.name}: every change here shows on {here.length === 1 ? "it" : "them"} at once. Instances you changed by hand keep your changes.
            </>
          ) : (
            <>No instances of {name} in {ds.name} on the canvas yet. Changes here reach every screen built with it.</>
          )}
        </span>
        {here.length > 0 && (
          <Button size="sm" variant="secondary" onClick={select}>
            Select
          </Button>
        )}
      </div>
      {behind > 0 && (
        <div className="flex items-center gap-[8px] rounded-lg bg-warning-subtle px-[10px] py-[8px] text-caption text-fg-muted">
          <TriangleAlert size={14} {...ico} className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            {behind} more {behind === 1 ? "instance is" : "instances are"} on {getSystem(source!)?.name ?? "the original system"}, so {behind === 1 ? "it doesn't" : "they don't"} change.
          </span>
          <Button size="sm" variant="secondary" disabled={moving} onClick={() => void move()}>
            <MoveRight size={12} {...ico} /> Move screens to {ds.name}
          </Button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
        // The Qalam AI composer look: the working ring replaces the focus edge while a change is drafted.
        data-busy={running || undefined}
        className="q-ai-ring flex items-end gap-[8px] rounded-xl bg-raised p-[6px] pl-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)] focus-within:shadow-focus-field"
      >
        <QalamAIGlyph size={14} className="mb-[9px] shrink-0" />
        <textarea
          rows={1}
          value={text}
          dir="auto"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          placeholder={running ? `Qalam AI is changing ${name}…` : `Ask Qalam AI to change ${name}…`}
          aria-label={`Ask Qalam AI to change ${name}`}
          className="max-h-[128px] min-h-[28px] flex-1 resize-none bg-transparent py-[5px] text-body text-fg outline-none placeholder:text-fg-faint focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={text.trim().length < 3 || running || !loaded}
          aria-label="Ask Qalam AI"
          title="Ask Qalam AI"
          className={clsx(r.buttonBase, r.buttonPrimary, "size-[28px] rounded-md")}
        >
          <ArrowUp size={16} absoluteStrokeWidth strokeWidth={1.75} />
        </button>
      </form>
      {found && <TurnView chatId={found.chatId} t={found.t} />}
    </section>
  );
}
