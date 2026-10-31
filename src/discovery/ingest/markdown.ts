import type { TextBlock } from "../sources";
import { cleanText } from "./text";

/*
 * Markdown as plain text (pure): the marks go (headings, emphasis, quote bars, link targets), the
 * words stay in their order, so a quote of what someone said matches the way they said it. Its
 * shape is kept beside the words (`markdownShape`): its headings and list items, for the reader to
 * draw, as a PDF's is (./pdf.ts). A Google Doc comes from Drive as Markdown, so it reads the same.
 */

/** A line's inline marks taken off: links and images to their words, emphasis, code and HTML tags gone. */
function inline(s: string): string {
  return (
    s
      // Images and links: their words, not their targets.
      .replace(/!\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      .replace(/^[ \t]{0,3}\[[^\]]+\]:[ \t]+\S+.*$/gm, "")
      // Emphasis, strikethrough, inline code.
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1$2")
      .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, "$1$2")
      .replace(/~~(?=\S)([^~\n]*?\S)~~/g, "$1")
      .replace(/`([^`\n]+)`/g, "$1")
      // Markdown's escapes (Google Docs' export writes them), and inline HTML tags.
      .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
      .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>\n]*)?\/?>/gi, "")
  );
}

const unframe = (md: string) =>
  md
    .replace(/\r\n?/g, "\n")
    // Front matter.
    .replace(/^---\n[\s\S]*?\n---\n/, "");

export function markdownToText(md: string): string {
  // Code fences: keep what's inside. (Line starts use [ \t], never \s: that would eat blank lines.)
  const s = unframe(md).replace(/^[ \t]{0,3}(```|~~~)[^\n]*\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*$/gm, "$2");
  return cleanText(
    inline(
      s
        // Headings, quote bars (nested too), horizontal rules.
        .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
        .replace(/^([ \t]{0,3}>[ \t]?)+/gm, "")
        .replace(/^[ \t]{0,3}([-*_])([ \t]*\1){2,}[ \t]*$/gm, ""),
    ),
  );
}

type Kind = TextBlock["kind"] | "p";

const HEADING = /^[ \t]{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^([ \t]*)([-*+]|\d{1,3}[.)])[ \t]+(.*)$/;
const RULE = /^[ \t]{0,3}([-*_])([ \t]*\1){2,}[ \t]*$/;
const FENCE = /^[ \t]{0,3}(```|~~~)/;

/**
 * Markdown as plain text and its shape: headings (# as h1, ## as h2, deeper as h3) and list items
 * (a bullet's mark left out, a number kept), each a block of its own; a paragraph's lines kept as
 * they were written. Blocks are a blank line apart.
 */
export function markdownShape(md: string): { text: string; blocks: TextBlock[] } {
  const blocks: { kind: Kind; lines: string[] }[] = [];
  let cur: { kind: Kind; lines: string[] } | null = null;
  let fence: string | null = null;
  for (const raw of unframe(md).split("\n")) {
    const f = FENCE.exec(raw);
    if (f && (!fence || f[1] === fence)) {
      fence = fence ? null : f[1];
      cur = null;
      continue;
    }
    // Inside a code fence: lines as they are, a paragraph.
    if (fence) {
      if (cur?.kind !== "p") blocks.push((cur = { kind: "p", lines: [] }));
      cur.lines.push(raw);
      continue;
    }
    if (!raw.trim() || RULE.test(raw)) {
      cur = null;
      continue;
    }
    const h = HEADING.exec(raw);
    if (h) {
      blocks.push({ kind: h[1].length === 1 ? "h1" : h[1].length === 2 ? "h2" : "h3", lines: [h[2]] });
      cur = null;
      continue;
    }
    const line = raw.replace(/^([ \t]{0,3}>[ \t]?)+/, "");
    const item = ITEM.exec(line);
    if (item) {
      blocks.push((cur = { kind: "li", lines: [/\d/.test(item[2]) ? `${item[2]} ${item[3]}` : item[3]] }));
      continue;
    }
    // A list item's next line, indented under it; else the paragraph goes on, or one starts.
    if (cur && (cur.kind === "p" || (cur.kind === "li" && /^[ \t]+\S/.test(line)))) cur.lines.push(line.trim());
    else blocks.push((cur = { kind: "p", lines: [line.trim()] }));
  }

  let text = "";
  const out: TextBlock[] = [];
  for (const b of blocks) {
    const words = cleanText(inline(b.lines.join(b.kind === "p" ? "\n" : " ")));
    if (!words) continue;
    if (text) text += "\n\n";
    if (b.kind !== "p") out.push({ span: [text.length, text.length + words.length], kind: b.kind });
    text += words;
  }
  return { text, blocks: out };
}
