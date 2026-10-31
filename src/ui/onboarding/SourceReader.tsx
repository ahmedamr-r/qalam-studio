import { useEffect, useState } from "react";
import { sourcesDb } from "@/discovery/db";
import type { SourceQuote, SourceRecord, TextBlock } from "@/discovery/sources";
import { topicsDb } from "@/org/topics";
import { Reader, type Back } from "../sources/Reader";
import { backsOf, type Canvas, type CanvasNode } from "./canvas";

/*
 * A source read over the canvas: where it came from (its connector, kind, when, a link to open it
 * there), what it backs as chips, and its words with exactly the quotes behind each problem and goal
 * marked, each in its card's colour. A chip marks only its own words. A doc inside the setup's brain
 * dump shows its own part of the text; at the problems door the source is loaded, and each problem
 * page's quotes from it come from the page's citations.
 */

interface Backing {
  node: CanvasNode;
  quotes: string[];
}

/** The words to read and what they back: the setup's own text, or the problems door's source loaded. */
function useReading(node: CanvasNode, canvas: Canvas, setup: { text: string; quotes: readonly SourceQuote[]; blocks?: readonly TextBlock[] } | null) {
  const [loaded, setLoaded] = useState<{ source: SourceRecord; backs: Backing[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const problemsDoor = !setup && !!node.sourceId;
  useEffect(() => {
    if (!problemsDoor) return;
    let live = true;
    setLoaded(null);
    const pages = canvas.edges.filter((e) => e.from === node.id).flatMap((e) => canvas.nodes.find((n) => n.id === e.to && n.pageId) ?? []);
    void (async () => {
      try {
        const source = await sourcesDb.get(node.sourceId!);
        const views = await Promise.all(pages.map((p) => topicsDb.get(p.pageId!).catch(() => null)));
        // Each page's quotes from this source, as its lines cite them.
        const backs = pages.map((p, i) => ({ node: p, quotes: Object.values(views[i]?.cited ?? {}).flatMap((c) => (c.source === source.id && c.ref.startsWith("hub:quote:") ? [c.ref.slice("hub:quote:".length)] : [])) }));
        if (live) setLoaded({ source, backs });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [node.id, node.sourceId, problemsDoor]);
  if (setup) return { text: setup.text, quotes: setup.quotes, pages: undefined, blocks: setup.blocks, range: node.doc?.span, backs: backsOf(canvas, node.id), loading: false, error: null };
  if (loaded) return { text: loaded.source.text, quotes: loaded.source.quotes, pages: loaded.source.pages, blocks: loaded.source.blocks, range: undefined, backs: loaded.backs, loading: false, error: null };
  return { text: "", quotes: [] as readonly SourceQuote[], pages: undefined, blocks: undefined, range: undefined, backs: [] as Backing[], loading: !error, error };
}

/** The setup's reader: the shared one, over the canvas, with what the source backs on it. */
export function SourceReader({ node, canvas, setup, onClose, className }: { node: CanvasNode; canvas: Canvas; setup: { text: string; quotes: readonly SourceQuote[]; blocks?: readonly TextBlock[] } | null; onClose: () => void; className?: string }) {
  const r = useReading(node, canvas, setup);
  const backs = r.backs.map((b): Back => ({ id: b.node.id, kind: b.node.kind === "problem" ? "problem" : "goal", title: b.node.title, quotes: b.quotes }));
  return <Reader title={node.title} doc={node.doc} text={r.text} quotes={r.quotes} pages={r.pages} blocks={r.blocks} range={r.range} backs={backs} loading={r.loading} error={r.error} onClose={onClose} className={className ?? "absolute inset-0 z-10"} />;
}
