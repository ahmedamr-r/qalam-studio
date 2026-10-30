/*
 * What a call sends, for engines other than Claude (pure). Qalam's calls are written as text and
 * base64 image blocks; OpenAI's chat API takes text and image parts (an image as a data address),
 * and an agent's CLI takes the text on stdin with images as files. Anything else in a block (a
 * cache mark) is Claude's own and goes.
 */

export type Block = { type: string; text?: string; source?: { type?: string; media_type?: string; data?: string } };

export type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

const image = (b: Block): { media: string; data: string } | null => (b.type === "image" && b.source?.type === "base64" && b.source.data && b.source.media_type ? { media: b.source.media_type, data: b.source.data } : null);

/** The blocks as OpenAI chat parts: text as text, a base64 image as a data address. */
export function toChatParts(blocks: Block[]): ChatPart[] {
  const out: ChatPart[] = [];
  for (const b of blocks) {
    const img = image(b);
    if (img) out.push({ type: "image_url", image_url: { url: `data:${img.media};base64,${img.data}` } });
    else if (b.type === "text" && b.text) out.push({ type: "text", text: b.text });
  }
  return out;
}

/** Whether a call sends pictures (an engine whose model can't see them can't answer it). */
export const needsVision = (blocks: Block[]) => blocks.some((b) => !!image(b));

/** The blocks' text, in order (for an agent that reads its prompt on stdin), and their images apart. */
export function splitBlocks(blocks: Block[]): { text: string; images: { media: string; data: string }[] } {
  const images: { media: string; data: string }[] = [];
  const texts: string[] = [];
  for (const b of blocks) {
    const img = image(b);
    if (img) {
      images.push(img);
      texts.push(`[Image ${images.length}]`);
    } else if (b.type === "text" && b.text) texts.push(b.text);
  }
  return { text: texts.join("\n\n"), images };
}
