import { connectorDef } from "@/connectors/catalog";
import { connectorOfOrigin } from "@/connectors/logos";
import type { SetupDoc } from "@/org/setup";
import { sourceLabel, type SourceRecord } from "./sources";

/*
 * Where a source's words came from, said the same way everywhere it's drawn (pure): the setup's
 * canvas and the board's sources lane. A brain dump the setup read is one source made of parts
 * (their own words, a page, each doc they brought), each with its span in the dump's text; a quote
 * belongs to the part its span starts in.
 */

/** The part of a dump a quote came from: the one its span starts in (-1: none, a part's header). */
export function partOf(docs: readonly Pick<SetupDoc, "span">[], q: { span: readonly [number, number] }): number {
  const at = q.span[0];
  return docs.findIndex((d) => !!d.span && at >= d.span[0] && at < d.span[1]);
}

/** A source's mark: a connector's id, else what it is ("said", "page", "computer", or the source's kind; a file read for a card is this computer's). */
export function markOf(source: Pick<SourceRecord, "kind" | "origin" | "dump">, part?: Pick<SetupDoc, "from"> | null): string {
  if (part) return part.from;
  if (source.kind === "dump" && source.dump?.file) return "computer";
  return connectorOfOrigin(source.origin) ?? source.kind;
}

const TYPE_WORD: Record<string, string> = { pdf: "PDF", doc: "Doc", docx: "Word", sheet: "Sheet", slides: "Slides", text: "Text", markdown: "Markdown", paste: "Text", image: "Picture" };

/** A part of a dump in words: "Your words", "Web page", "Google Drive · PDF · 12 pages". */
export function partLine(doc: Pick<SetupDoc, "from" | "type" | "pages"> | undefined): string {
  if (!doc) return "Source";
  if (doc.from === "said") return "Your words";
  if (doc.from === "page") return "Web page";
  const where = doc.from === "computer" ? "This computer" : (connectorDef(doc.from)?.label ?? doc.from);
  const kind = doc.type ? (TYPE_WORD[doc.type] ?? "") : "";
  return [where, kind, doc.pages ? `${doc.pages} pages` : ""].filter(Boolean).join(" · ");
}

/** A whole source in words: its connector's name, else its kind ("Interview", "PDF · 12 pages"). */
export function sourceLine(source: Pick<SourceRecord, "kind" | "origin" | "pages" | "answers" | "dump">): string {
  const via = connectorOfOrigin(source.origin);
  const pages = source.pages && source.pages.length > 1 ? `${source.pages.length} pages` : "";
  return [via ? (connectorDef(via)?.label ?? via) : sourceLabel(source), pages].filter(Boolean).join(" · ");
}
