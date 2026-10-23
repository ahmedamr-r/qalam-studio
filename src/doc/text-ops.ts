import type { TextNode, TextProps } from "./schema";
import { studio } from "./store";
import { fitText } from "./ops";

/**
 * Text shortcuts (⌘B, ⌥⌘L/T/R, ⇧⌘> …). Text is one style per layer, so each applies to whole
 * layers, the same way the Typography section does: a hand-set value detaches the type style.
 */

/** The weights every bundled family ships (Inter, Plus Jakarta Sans, IBM Plex Sans Arabic). */
export const TEXT_WEIGHTS = [400, 500, 600, 700] as const;

export const textIds = (ids: string[]) => {
  const doc = studio().doc;
  return ids.filter((id) => doc.nodes[id]?.type === "text" && !doc.nodes[id].locked);
};

/** `detach`: the edit changes what a type style sets (size, weight, line height, spacing). */
function editText(ids: string[], fn: (t: TextProps) => void, detach = true) {
  const targets = textIds(ids);
  if (!targets.length) return;
  studio().mutate((d) => {
    for (const id of targets) {
      const n = d.nodes[id] as TextNode;
      fn(n.text);
      if (detach) n.text.typeToken = undefined;
      fitText(n);
    }
  });
}

/** ⌘B: bold when any layer isn't bold yet, else back to regular. */
export function toggleBold(ids: string[]) {
  const doc = studio().doc;
  const bold = !textIds(ids).every((id) => (doc.nodes[id] as TextNode).text.fontWeight >= 700);
  editText(ids, (t) => void (t.fontWeight = bold ? 700 : 400));
  return bold;
}

/** Next weight up or down from `w`, within the bundled weights. */
export function stepWeight(w: number, dir: 1 | -1): number {
  if (dir > 0) return TEXT_WEIGHTS.find((x) => x > w) ?? TEXT_WEIGHTS[TEXT_WEIGHTS.length - 1];
  return [...TEXT_WEIGHTS].reverse().find((x) => x < w) ?? TEXT_WEIGHTS[0];
}

export type TextStep = "size" | "weight" | "line-height" | "letter-spacing";

/** ⇧⌘< > size, ⌥⌘< > weight, ⌥⇧< > line height, ⌥< > letter spacing. */
export function stepText(ids: string[], what: TextStep, dir: 1 | -1) {
  editText(ids, (t) => {
    if (what === "size") {
      const next = Math.max(1, t.fontSize + dir);
      // Keep the line height's ratio so the paragraph doesn't collapse or balloon.
      t.lineHeight = Math.max(1, Math.round((t.lineHeight / t.fontSize) * next));
      t.fontSize = next;
    } else if (what === "weight") t.fontWeight = stepWeight(t.fontWeight, dir);
    else if (what === "line-height") t.lineHeight = Math.max(1, t.lineHeight + dir);
    else t.letterSpacing = Math.round((t.letterSpacing + dir * 0.1) * 100) / 100;
  });
}

/**
 * ⌥⌘L / ⌥⌘T / ⌥⌘R: physical sides map onto Qalam's logical alignment, so "left" is the start of an
 * English paragraph and the end of an Arabic one. `dirOf` resolves a layer's direction.
 */
export function alignText(ids: string[], side: "left" | "center" | "right", dirOf: (t: TextProps) => "ltr" | "rtl") {
  editText(ids, (t) => {
    if (side === "center") t.align = "center";
    else {
      const rtl = dirOf(t) === "rtl";
      t.align = (side === "left") !== rtl ? "start" : "end";
    }
  }, false);
}

/** ⌘I: italic on for every layer, or off when all are italic already. */
export function toggleItalic(ids: string[]) {
  const doc = studio().doc;
  const on = !textIds(ids).every((id) => (doc.nodes[id] as TextNode).text.italic);
  editText(ids, (t) => {
    if (on) t.italic = true;
    else delete t.italic;
  }, false);
  return on;
}

/** ⌥⌘J: justify, or back to start-aligned when every layer is already justified. */
export function toggleJustify(ids: string[]) {
  const doc = studio().doc;
  const on = !textIds(ids).every((id) => (doc.nodes[id] as TextNode).text.align === "justify");
  editText(ids, (t) => void (t.align = on ? "justify" : "start"), false);
  return on;
}

/** ⌘U underline, ⇧⌘X strikethrough: on for every layer, or off when all have it already. */
export function toggleDecoration(ids: string[], kind: "underline" | "strikethrough") {
  const doc = studio().doc;
  const on = !textIds(ids).every((id) => (doc.nodes[id] as TextNode).text.decoration === kind);
  editText(ids, (t) => {
    if (on) t.decoration = kind;
    else delete t.decoration;
  }, false);
  return on;
}

const LIST_PREFIX = /^(?:[•◦▪-]|\d+[.)])\s+/;

/**
 * List markers for each line of `content`: add them (replacing the other kind), or take them off
 * when every non-empty line already has this kind. Empty lines are left alone.
 */
export function listLines(content: string, kind: "bullet" | "number"): string {
  const lines = content.split("\n");
  const filled = lines.filter((l) => l.trim());
  const mine = kind === "bullet" ? /^•\s+/ : /^\d+[.)]\s+/;
  const off = filled.length > 0 && filled.every((l) => mine.test(l));
  let i = 0;
  return lines
    .map((l) => {
      if (!l.trim()) return l;
      const bare = l.replace(LIST_PREFIX, "");
      if (off) return bare;
      i++;
      return kind === "bullet" ? `• ${bare}` : `${i}. ${bare}`;
    })
    .join("\n");
}

/** ⇧⌘8 bulleted, ⇧⌘7 numbered list. Text is one paragraph style per layer, so lists are markers in the text. */
export function toggleList(ids: string[], kind: "bullet" | "number") {
  editText(ids, (t) => void (t.content = listLines(t.content, kind)), false);
}
