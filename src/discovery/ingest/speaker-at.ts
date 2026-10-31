/*
 * Who said a quote, as the text names them (pure): the "Name:" its line starts with (how a sheet's
 * rows read, ./rows.ts, and how chats are written down), else the heading line above it that ends
 * in a colon ("Mariam, 29, New Cairo:"), within the same block of lines. Only a name: the first part
 * before a comma that has no digits and is a few words, never a label like "Chat 1" or "Rider 3".
 */

const MAX_NAME = 40;
/** How far up a heading may sit above the quote's line. */
const MAX_UP = 8;

/** A name out of a line's lead-in: its first comma part that's a few words and no digits. */
function nameIn(lead: string): string | undefined {
  for (const part of lead.split(",")) {
    const p = part.replace(/^[\s"'“‘(\-–—*•]+|[\s"'”’)]+$/g, "").trim();
    if (!p || /\d/.test(p) || p.length > MAX_NAME) continue;
    const words = p.split(/\s+/);
    if (words.length > 3 || !/\p{L}/u.test(p)) continue;
    return p;
  }
  return undefined;
}

/** The speaker of the words at `span` in `text`, when the text names them; else undefined. */
export function speakerAt(text: string, span: readonly [number, number]): string | undefined {
  const start = Math.max(0, Math.min(span[0], text.length));
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  // The line's own lead-in: "Ahmed S.: Riders put…", "Chat 1, rider Hoda: “I booked…”".
  const lead = text.slice(lineStart, start);
  const inline = /^(.{1,80}?):\s*["“‘']?\s*$/u.exec(lead);
  if (inline) return nameIn(inline[1]);
  // Only an opening quote mark or a bullet before the words: the line is the quote itself.
  if (lead.replace(/["“‘'*•\-–—\s]/g, "")) return undefined;
  // A heading above, in the same block: "Mariam, 29, New Cairo, rides daily to work:".
  const above = text.slice(0, lineStart).split("\n");
  above.pop();
  let seen = 0;
  let gap = false;
  for (let i = above.length - 1; i >= 0 && seen < MAX_UP; i--) {
    const line = above[i].trim();
    if (!line) {
      // Blank lines right under a heading are fine; one after other lines ends the block.
      if (seen) break;
      gap = true;
      continue;
    }
    seen++;
    if (/:\s*$/.test(line) && line.length <= 120) return nameIn(line.replace(/:\s*$/, ""));
    // Across a blank line, only a heading can name the quote's speaker.
    if (gap) break;
  }
  return undefined;
}
