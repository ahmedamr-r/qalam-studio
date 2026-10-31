import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { PanelLeftClose } from "lucide-react";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { IconBtn } from "../controls";
import { Panel } from "../chat/Panels";
import { r } from "../recipes";
import { readerWidth } from "../sources/Reader";
import { useKnow } from "../setup/know";
import { useSetup, useSetupQuotes } from "../setup/setup";
import { CHAT_OPEN_AT, CHAT_W, closeRight, dockLayout, openChat, openRight, useDock, type DockItem } from "./dock";
import { useFirstRun } from "./flow";
import { GoalPanel } from "./GoalPanel";
import { PlacePanel } from "./PlacePanel";
import { act, useActing } from "./rows";
import { SetupCanvas } from "./SetupCanvas";
import { SourceReader } from "./SourceReader";
import { useSetupCanvas } from "./useSetupCanvas";
import type { CanvasNode } from "./canvas";

/*
 * The setup as one page: its canvas fills it, and everything else opens from it as a panel. Qalam
 * AI's chat docks on the left (open on a wide page, folded to a button otherwise); a source's reader,
 * a place's lines or a goal docks on the right, two at most side by side. A panel docks only while
 * the canvas keeps room to be read (./dock.ts); otherwise it's a drawer over the canvas.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;
const SIDE_W = 380;

/** How wide a right panel is: a source as the reader reads it, a place or a goal a little narrower. */
const widthOf = (item: DockItem, node: CanvasNode | undefined) => (item.kind === "source" ? readerWidth(node?.doc?.from) : SIDE_W);

export function CanvasPage({ chat, waiting = false, reviewing = false }: { chat: ReactNode; /** A question waits for them in the chat. */ waiting?: boolean; /** Qalam AI's proposal is being reviewed. */ reviewing?: boolean }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { canvas, empty, places } = useSetupCanvas();
  const dock = useDock();
  const working = useActing((s) => s.working);
  const [selected, setSelected] = useState<string | null>(null);
  const byId = new Map(canvas.nodes.map((n) => [n.id, n]));
  // A panel whose node went (a line left out, a door changed) closes.
  const right = dock.right.filter((x) => byId.has(x.id));
  const chatOpen = dock.chat ?? width >= CHAT_OPEN_AT;
  const layout = dockLayout(width, chatOpen, right.map((x) => ({ id: x.id, w: widthOf(x, byId.get(x.id)) })));

  // A panel opened beside another that no longer fits: the chat folds to its button if that makes room for both.
  const shown = layout.docked.length;
  useEffect(() => {
    if (layout.chat !== "dock" || shown >= Math.min(right.length, 2)) return;
    if (dockLayout(width, false, right.map((x) => ({ id: x.id, w: widthOf(x, byId.get(x.id)) }))).docked.length > shown) openChat(false);
  }, [right.map((x) => x.id).join("|")]);

  // As the review starts, a chat drawn over the canvas steps aside so the proposal shows.
  useEffect(() => {
    if (reviewing && layout.chat === "drawer") openChat(false);
  }, [reviewing]);

  const panelFor = (id: string) => {
    const item = right.find((x) => x.id === id);
    const node = byId.get(id);
    if (!item || !node) return null;
    const close = () => closeRight(id);
    if (item.kind === "place") {
      const place = places.find((p) => `place:${p.key}` === id);
      return place ? <PlacePanel place={place} canvas={canvas} onClose={close} /> : null;
    }
    if (item.kind === "goal") return <GoalPanel node={node} canvas={canvas} onClose={close} />;
    return <SourcePanel node={node} canvas={canvas} onClose={close} />;
  };

  const chatPanel = (
    <Panel
      label="Qalam AI"
      title={
        <span className="flex items-center gap-[8px]">
          <QalamAIGlyph size={14} /> Qalam AI
        </span>
      }
      actions={
        <IconBtn size="sm" label="Fold the chat" onClick={() => openChat(false)}>
          <PanelLeftClose size={14} {...ICON} />
        </IconBtn>
      }
      body={false}
      className="h-full"
    >
      {chat}
    </Panel>
  );

  return (
    <div ref={host} className={clsx(r.panelBackdrop, "relative flex")} style={{ display: "flex" }}>
      {layout.chat === "dock" && <div className="flex min-h-0 shrink-0" style={{ width: CHAT_W }}>{chatPanel}</div>}
      <section aria-label="Canvas" className={clsx(r.panelBox, "relative min-w-0 flex-1")}>
        <SetupCanvas
          canvas={canvas}
          selected={selected}
          onSelect={setSelected}
          onOpen={(n) => openRight({ kind: n.kind === "source" ? "source" : n.kind === "place" ? "place" : "goal", id: n.id })}
          working={working}
          act={act}
          empty={empty}
          bring={dock.focus}
        />
        {layout.chat === "closed" && (
          <button type="button" onClick={() => openChat(true)} className="q-item absolute left-[10px] top-[10px] z-10 inline-flex h-[32px] items-center gap-[6px] rounded-lg bg-raised px-[10px] text-caption font-medium text-fg shadow-floating hover:bg-hover">
            <QalamAIGlyph size={12} /> Qalam AI
            {waiting && <span aria-label="A question waits" className="size-[7px] rounded-full bg-ai" />}
          </button>
        )}
      </section>
      {layout.docked.map((id) => (
        <div key={id} className="flex min-h-0 shrink-0" style={{ width: widthOf(right.find((x) => x.id === id)!, byId.get(id)) }}>
          {panelFor(id)}
        </div>
      ))}
      {layout.chat === "drawer" && <div className="q-rise absolute bottom-[8px] left-[8px] top-[8px] z-20 flex w-[min(400px,calc(100%-16px))] shadow-floating">{chatPanel}</div>}
      {layout.drawer && <div className={r.panelDrawer}>{panelFor(layout.drawer)}</div>}
    </div>
  );
}

/** A source's reader, docked: at the know door their goals' own words, else the setup's text or the source itself. */
function SourcePanel({ node, canvas, onClose }: { node: CanvasNode; canvas: ReturnType<typeof useSetupCanvas>["canvas"]; onClose: () => void }) {
  const door = useFirstRun((s) => s.door);
  const source = useSetup((s) => s.source);
  const quotes = useSetupQuotes();
  const know = useKnow((s) => s.text);
  const setup = node.id === "src:know" ? { text: know, quotes: [], blocks: undefined } : door !== "problems" && source ? { text: source.text, quotes, blocks: source.blocks } : null;
  return (
    <section aria-label={`Reading ${node.title}`} className={clsx(r.panelBox, "relative w-full")}>
      <SourceReader key={node.id} node={node} canvas={canvas} setup={setup} onClose={onClose} className="min-h-0 flex-1 rounded-[inherit]" />
    </section>
  );
}
