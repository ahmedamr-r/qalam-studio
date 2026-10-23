import { cleanText } from "./text";

/*
 * A web page as text, in the browser (DOMParser: nothing in it runs or loads). The page's main
 * content (its <main>, or its one <article>) when it marks one, else the whole body; without
 * navigation, scripts, styles and forms. Blocks become paragraphs, so quotes keep their sentences.
 */

const DROP =
  "script,style,noscript,template,svg,canvas,iframe,object,embed,video,audio,form,button,select,input,textarea,nav,aside,footer,dialog," +
  "[role=navigation],[role=banner],[role=contentinfo],[role=search],[role=dialog],[aria-hidden=true],[hidden]";

const BLOCKS = new Set([
  "ADDRESS", "ARTICLE", "BLOCKQUOTE", "DD", "DETAILS", "DIV", "DL", "DT", "FIGCAPTION", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6",
  "HEADER", "HR", "LI", "MAIN", "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL",
]);

/** The element holding the page's own content. */
function contentRoot(doc: Document): Element {
  const main = doc.querySelector("main, [role=main]");
  if (main && (main.textContent ?? "").trim().length > 200) return main;
  const articles = doc.querySelectorAll("article");
  if (articles.length === 1 && (articles[0].textContent ?? "").trim().length > 200) return articles[0];
  return doc.body ?? doc.documentElement;
}

/** The text of an element, a paragraph per block. */
function blocksOf(root: Element): string {
  const out: string[] = [];
  let line = "";
  const flush = () => {
    const t = line.replace(/[ \t\n\r\f\v ]+/g, " ").trim();
    if (t) out.push(t);
    line = "";
  };
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      line += n.nodeValue ?? "";
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    if (el.tagName === "BR") return flush();
    if (el.tagName === "PRE") {
      flush();
      const t = (el.textContent ?? "").replace(/\s+$/g, "");
      if (t.trim()) out.push(t);
      return;
    }
    const block = BLOCKS.has(el.tagName);
    if (block) flush();
    if (el.tagName === "LI") line += "- ";
    for (const c of Array.from(el.childNodes)) walk(c);
    if (block) flush();
  };
  walk(root);
  flush();
  return out.join("\n\n");
}

export function htmlToText(html: string): { title: string; text: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute("content")?.trim() ?? "";
  const title = (meta('meta[property="og:title"]') || doc.title || doc.querySelector("h1")?.textContent || "").replace(/\s+/g, " ").trim();
  for (const el of Array.from(doc.querySelectorAll(DROP))) el.remove();
  const root = contentRoot(doc);
  // A site's own header (logo, menu) when the whole body is read; a header inside the content stays.
  if (root === doc.body) for (const h of Array.from(doc.body.querySelectorAll("header"))) if (!h.closest("main, article, [role=main]")) h.remove();
  return { title, text: cleanText(blocksOf(root)) };
}
