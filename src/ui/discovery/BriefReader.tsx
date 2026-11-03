import { Copy, RotateCcw, ScrollText, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LaneItem } from "@/discovery/lane";
import { studio } from "@/doc/store";
import { getBrief, removeBrief } from "@/org/briefs";
import { IconBtn } from "../controls";
import { Markdown } from "../chat/Markdown";
import { r } from "../recipes";
import { glideToLayer, onCanvasReady } from "./canvas";
import { loadBriefs } from "./briefs";
import { useDiscovery } from "./store";

/*
 * A card's brief, read in place of the right panel: its tile on the canvas opens it. The file stays the
 * brief (hub/briefs/), so an edit made there shows here; Copy takes it as it is for a coding agent.
 */

const close = () => useDiscovery.setState({ reading: null });
const KIND: Record<string, string> = { outcome: "Goal", opportunity: "Problem", solution: "Solution" };
const when = (at: number) => (at ? new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

export default function BriefReader({ item }: { item: LaneItem }) {
  const id = item.brief!.id;
  const card = item.brief!.card;
  const [b, setB] = useState<Awaited<ReturnType<typeof getBrief>> | null>(null);
  const [gone, setGone] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setGone(false);
    void getBrief(id)
      .then((x) => live && setB(x))
      .catch(() => live && setGone(true));
    return () => {
      live = false;
    };
  }, [id, item.title, item.line]);

  const copy = () => {
    if (!b) return;
    void navigator.clipboard.writeText(b.body).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };
  const again = () => void import("../space/chat/store").then((m) => m.briefFor(card));
  const remove = () => {
    void removeBrief(id).then(() => {
      close();
      return loadBriefs();
    });
  };
  const goToCard = () => {
    studio().select([card]);
    close();
    onCanvasReady((c) => glideToLayer(c, card));
  };

  return (
    <section aria-label="Brief" className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-line-subtle">
      <header className="flex shrink-0 flex-col gap-[8px] border-b border-line-subtle px-[20px] py-[12px]">
        <div className="flex items-start gap-[10px]">
          <span aria-hidden className="mt-[2px] grid size-[24px] shrink-0 place-items-center rounded-md bg-muted text-fg-muted">
            <ScrollText size={14} absoluteStrokeWidth strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 dir="auto" className="text-title font-medium text-fg">
              {b?.meta.title ?? item.title}
            </h1>
            <p className="truncate text-micro text-fg-subtle">
              Brief{b ? ` · ${when(b.meta.at)}` : ""}
              {b?.meta.file ? ` · ${b.meta.file}` : ""}
            </p>
          </div>
          <IconBtn label="Close" onClick={close}>
            <X size={14} absoluteStrokeWidth strokeWidth={1.5} />
          </IconBtn>
        </div>
        <div className="flex flex-wrap items-center gap-[6px]">
          <button type="button" disabled={!b} className={r.replyChipPrimary} onClick={copy}>
            <Copy size={12} absoluteStrokeWidth strokeWidth={1.5} />
            {copied ? "Copied" : "Copy for your coding agent"}
          </button>
          <button type="button" className="inline-flex h-[28px] items-center gap-[6px] rounded-md px-[8px] text-caption text-fg-muted hover:bg-hover hover:text-fg" onClick={goToCard}>
            {KIND[b?.meta.kind ?? ""] ? `Its ${KIND[b!.meta.kind].toLowerCase()}` : "Its card"}
          </button>
          <span className="ms-auto flex items-center gap-[2px]">
            <IconBtn label="Write it again" onClick={again}>
              <RotateCcw size={14} absoluteStrokeWidth strokeWidth={1.5} />
            </IconBtn>
            <IconBtn label="Take it off the canvas" onClick={remove}>
              <Trash2 size={14} absoluteStrokeWidth strokeWidth={1.5} />
            </IconBtn>
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[20px] py-[16px]">
        {gone ? <p className="text-body text-fg-muted">This brief's file has gone.</p> : b ? <Markdown text={b.body} hideTitle /> : <div className="h-[120px] animate-pulse rounded-lg bg-muted" aria-hidden />}
      </div>
    </section>
  );
}
