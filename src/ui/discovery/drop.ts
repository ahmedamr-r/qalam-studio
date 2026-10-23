import type { DragEvent } from "react";
import { studio } from "@/doc/store";
import type { Pt } from "@/doc/geometry";
import { treeRootOf } from "@/doc/board";
import { useGhosts } from "@/doc/ghosts";
import { feedback } from "@/commands/feedback";
import { cardAt } from "@/engine/ost-tools";
import { cardOf, updateCardIn } from "@/discovery/ops";
import { SOURCE_KIND_LABEL, citation, hasQuote, quotable, quoteEvidence } from "@/discovery/sources";
import { makeSourceNote, makeSticky } from "@/discovery/sticky";
import { useDiscovery } from "./store";
import { sourceOf } from "./sources";
import { addSources } from "./import";

/*
 * Dragging from the Sources tab onto the board: a quote onto an opportunity or a solution attaches
 * it as evidence (one undo step); onto the empty board it becomes a sticky. A source becomes a
 * source note where it's dropped. Files dropped on a board are added as sources.
 */

export const QUOTE_MIME = "application/x-qalam-quote";
export const SOURCE_MIME = "application/x-qalam-source";

export function dragQuote(e: DragEvent, sourceId: string, quoteId: string, text: string) {
  e.dataTransfer.setData(QUOTE_MIME, JSON.stringify({ sourceId, quoteId }));
  e.dataTransfer.setData("text/plain", text);
  e.dataTransfer.effectAllowed = "copy";
}

export function dragSource(e: DragEvent, sourceId: string, title: string) {
  e.dataTransfer.setData(SOURCE_MIME, JSON.stringify({ sourceId }));
  e.dataTransfer.setData("text/plain", title);
  e.dataTransfer.effectAllowed = "copy";
}

const carries = (e: DragEvent, mime: string) => Array.from(e.dataTransfer.types).includes(mime);
const fileDrag = (e: DragEvent) => Array.from(e.dataTransfer.items).some((i) => i.kind === "file" && !i.type.startsWith("image/"));

function read<T>(e: DragEvent, mime: string): T | null {
  try {
    return JSON.parse(e.dataTransfer.getData(mime)) as T;
  } catch {
    return null;
  }
}

/** A tree Qalam AI's proposals are drawn over (its real cards are under the ghost). */
const covered = (id: string) => {
  const root = treeRootOf(studio().doc, id);
  return !!root && useGhosts.getState().list.some((g) => g.covers === root);
};

function setTarget(t: { target: string; ok: boolean } | null) {
  const cur = useDiscovery.getState().quoteDrop;
  if (cur?.target !== t?.target || cur?.ok !== t?.ok) useDiscovery.setState({ quoteDrop: t });
}

export const clearDropTarget = () => setTarget(null);

/** Attach a source's quote to a card, as the builder's own choice (one undo step). */
export function attachQuote(cardId: string, sourceId: string, quoteId: string): boolean {
  const s = sourceOf(sourceId);
  const q = s?.quotes.find((x) => x.id === quoteId);
  const card = cardOf(studio().doc, cardId);
  if (!s || !q || !card) return false;
  if (!quotable(card)) {
    feedback("Quotes back opportunities and solutions", { id: "discovery.quote" });
    return false;
  }
  if (hasQuote(card, s.id, q.span)) {
    feedback("That quote is already on the card", { id: "discovery.quote" });
    return false;
  }
  studio().mutate((d) => updateCardIn(d, cardId, (c) => void c.evidence.push(quoteEvidence(s, q, "user"))));
  feedback(`Quote attached to “${card.title.length > 48 ? `${card.title.slice(0, 47)}…` : card.title}”`, { kind: "success", id: "discovery.quote" });
  return true;
}

/** Over a board: true when the drag is the board's own (a quote, a source, files to read). */
export function boardDragOver(e: DragEvent, world: Pt): boolean {
  if (carries(e, QUOTE_MIME)) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const id = cardAt(studio().doc, world);
    setTarget(id ? { target: id, ok: quotable(cardOf(studio().doc, id) ?? undefined) && !covered(id) } : null);
    return true;
  }
  if (carries(e, SOURCE_MIME) || fileDrag(e)) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    return true;
  }
  return false;
}

export function boardDrop(e: DragEvent, world: Pt): boolean {
  setTarget(null);
  const s = studio();
  if (carries(e, QUOTE_MIME)) {
    e.preventDefault();
    const ref = read<{ sourceId: string; quoteId: string }>(e, QUOTE_MIME);
    const src = sourceOf(ref?.sourceId);
    const q = src?.quotes.find((x) => x.id === ref?.quoteId);
    if (!ref || !src || !q) return true;
    const id = cardAt(s.doc, world);
    if (id) {
      if (covered(id)) feedback("Accept or discard Qalam AI's proposals for this tree first", { id: "discovery.quote" });
      else attachQuote(id, ref.sourceId, ref.quoteId);
      return true;
    }
    // On the empty board: the words on a sticky, with where they're from.
    const { frame, text } = makeSticky(world);
    text.text = { ...text.text, content: `“${q.text}”\n— ${citation({ page: q.page, speaker: q.speaker }, src.title)}` };
    s.mutate((d) => {
      d.nodes[frame.id] = frame;
      d.nodes[text.id] = text;
      d.roots.push(frame.id);
    });
    s.select([frame.id]);
    return true;
  }
  if (carries(e, SOURCE_MIME)) {
    e.preventDefault();
    const src = sourceOf(read<{ sourceId: string }>(e, SOURCE_MIME)?.sourceId);
    if (!src) return true;
    const n = src.quotes.length;
    const { frame, texts } = makeSourceNote(world, src, `${SOURCE_KIND_LABEL[src.kind]}${n ? ` · ${n} ${n === 1 ? "quote" : "quotes"}` : ""}`);
    s.mutate((d) => {
      d.nodes[frame.id] = frame;
      for (const t of texts) d.nodes[t.id] = t;
      d.roots.push(frame.id);
    });
    s.select([frame.id]);
    return true;
  }
  const files = Array.from(e.dataTransfer.files).filter((f) => !f.type.startsWith("image/"));
  if (files.length) {
    e.preventDefault();
    s.setLeftTab("sources");
    void addSources(files.map((file) => ({ kind: "file", file })));
    return true;
  }
  return false;
}
