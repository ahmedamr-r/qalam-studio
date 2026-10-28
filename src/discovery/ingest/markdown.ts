import { cleanText } from "./text";

/*
 * Markdown as plain text (pure): the marks go (headings, emphasis, quote bars, link targets), the
 * words stay in their order, so a quote of what someone said matches the way they said it.
 */

export function markdownToText(md: string): string {
  let s = md.replace(/\r\n?/g, "\n");
  // Front matter.
  s = s.replace(/^---\n[\s\S]*?\n---\n/, "");
  // Code fences: keep what's inside. (Line starts use [ \t], never \s: that would eat blank lines.)
  s = s.replace(/^[ \t]{0,3}(```|~~~)[^\n]*\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*$/gm, "$2");
  return cleanText(
    s
      // Headings, quote bars (nested too), horizontal rules.
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
      .replace(/^([ \t]{0,3}>[ \t]?)+/gm, "")
      .replace(/^[ \t]{0,3}([-*_])([ \t]*\1){2,}[ \t]*$/gm, "")
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
      // Inline HTML tags.
      .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>\n]*)?\/?>/gi, ""),
  );
}
