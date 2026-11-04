/*
 * Markdown as blocks to draw (pure): the part of it a brief uses, read line by line. Nothing in it
 * becomes HTML, so whatever a file holds is only ever words. A link goes only to a web address.
 */

export type MdInline = { t: "text"; v: string } | { t: "strong"; v: string } | { t: "em"; v: string } | { t: "code"; v: string } | { t: "link"; v: string; href: string };

export interface MdItem {
  text: string;
  /** A task: done or not. */
  task?: boolean;
}

export type MdBlock = { t: "heading"; level: number; text: string } | { t: "p"; text: string } | { t: "list"; ordered: boolean; items: MdItem[] } | { t: "quote"; text: string } | { t: "code"; text: string } | { t: "rule" };

export function mdBlocks(text: string): MdBlock[] {
  const out: MdBlock[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out.push({ t: "code", text: code.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ t: "heading", level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ t: "rule" });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) q.push(lines[i].replace(/^>\s?/, ""));
      out.push({ t: "quote", text: q.join(" ") });
      continue;
    }
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
    if (item.test(line)) {
      const ordered = /\d/.test(item.exec(line)![1]);
      const items: MdItem[] = [];
      for (; i < lines.length; i++) {
        const m = item.exec(lines[i]);
        if (!m) {
          // A list runs on over one blank line when the next line is another of its items; a wrapped line joins the item.
          if (!lines[i].trim() && item.test(lines[i + 1] ?? "") && /\d/.test(item.exec(lines[i + 1])![1]) === ordered) continue;
          if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) {
            items[items.length - 1].text += ` ${lines[i].trim()}`;
            continue;
          }
          break;
        }
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(m[2]);
        items.push(task ? { text: task[2], task: task[1] !== " " } : { text: m[2] });
      }
      out.push({ t: "list", ordered, items });
      continue;
    }
    const p: string[] = [];
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || /^(#{1,6}\s|>|```)/.test(l) || item.test(l)) break;
      p.push(l.trim());
    }
    if (!p.length) {
      // A line nothing above took and paragraphs can't start with: never a line lost, never a loop.
      p.push(line.trim());
      i++;
    }
    out.push({ t: "p", text: p.join(" ") });
  }
  return out;
}

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\p{L}\p{N}*])\*([^*\s][^*]*)\*(?![\p{L}\p{N}*])/gu;

export function mdInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let at = 0;
  const words = (v: string) => v && out.push({ t: "text", v });
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    words(text.slice(at, i));
    at = i + m[0].length;
    if (m[1]) out.push({ t: "strong", v: m[1] });
    else if (m[2]) out.push({ t: "code", v: m[2] });
    else if (m[3]) {
      if (/^https?:\/\//i.test(m[4])) out.push({ t: "link", v: m[3], href: m[4] });
      else out.push({ t: "text", v: m[3] });
    } else if (m[5]) out.push({ t: "em", v: m[5] });
  }
  words(text.slice(at));
  return out;
}

/** A list item that's a quote with where it came from: “…” (place). Drawn as a quote; a brief is full of them. */
export function quoteItem(text: string): { words: string; from: string } | null {
  const m = /^“(.+)”\s*\((.+)\)$/.exec(text.trim());
  return m ? { words: m[1], from: m[2] } : null;
}
