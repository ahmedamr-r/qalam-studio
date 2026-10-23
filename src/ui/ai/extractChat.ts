import { studio } from "@/doc/store";
import type { DesignSystem } from "@/design-system/registry";
import { MAX_EXTRACT_IMAGES } from "@/design-system/extract-options";
import { chatById, newChat, openChat, send, useChats } from "./chats";
import { SAMPLE_DS_IMAGE, extractOutcomeOf, type ExtractPhase, type ShotInput } from "./extract";
import { useExtractPreview } from "./extractPreview";

/**
 * Extraction as seen from outside the chat: the Tokens and Design panels start one (the AI chat
 * opens and Qalam AI takes its first look at once), jump to one, or preview its draft.
 */

/** Start extracting from canvas images, files or the bundled sample, in the AI chat. */
export async function startExtractChat(input: { nodeIds?: string[]; files?: File[]; sample?: boolean }) {
  const { doc } = studio();
  let images: ShotInput[] = [];
  for (const id of input.nodeIds ?? []) {
    const n = doc.nodes[id];
    if (n?.type === "image") images.push({ src: n.src, name: n.name, nodeId: n.id });
  }
  for (const f of input.files ?? []) if (f.type.startsWith("image/")) images.push({ blob: f, name: f.name });
  if (input.sample) images = [{ blob: await (await fetch(SAMPLE_DS_IMAGE)).blob(), name: "Lumen Wallet (sample)" }];
  if (!images.length) return;
  studio().setAITab("extract");
  // A chat can run one request at a time.
  if (chatById(useChats.getState().activeId)?.turns.some((t) => t.status === "running")) newChat();
  await send({ tool: "extract", text: "", images: images.slice(0, MAX_EXTRACT_IMAGES), sample: !!input.sample });
}

/** Show an extraction turn in the AI chat. */
export function openExtractTurn(chatId: string, turnId: string) {
  openChat(chatId);
  studio().setAITab("extract");
  // After the thread has followed the conversation to its end.
  setTimeout(() => document.getElementById(`turn-${turnId}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
}

/** The draft the Tokens panel previews, while it's being made or waits for review. */
export function usePreviewedDraft(): { draft: DesignSystem; chatId: string; turnId: string; phase: ExtractPhase } | null {
  const pin = useExtractPreview((s) => s.pin);
  const t = useChats((s) => (pin ? s.chats.find((c) => c.id === pin.chatId)?.turns.find((x) => x.id === pin.turnId) : undefined));
  const o = extractOutcomeOf(t);
  return pin && o?.draft && (o.phase === "running" || o.phase === "draft") ? { draft: o.draft, chatId: pin.chatId, turnId: pin.turnId, phase: o.phase } : null;
}

/** The active chat has an extraction waiting for the designer's answers. */
export const useExtractAsking = () =>
  useChats((s) => !!s.chats.find((c) => c.id === s.activeId)?.turns.some((t) => t.status !== "running" && extractOutcomeOf(t)?.phase === "asking"));

/** The newest open extraction (asking, running or a draft) of a canvas image, in any chat. */
export function useExtractionOf(nodeId: string): { chatId: string; turnId: string; phase: ExtractPhase; running: boolean } | null {
  const key = useChats((s) => {
    for (const c of s.chats)
      for (let i = c.turns.length - 1; i >= 0; i--) {
        const t = c.turns[i];
        const o = extractOutcomeOf(t);
        if (t.tool !== "extract" || !t.request.source?.images?.some((im) => im.nodeId === nodeId)) continue;
        const phase = o?.phase ?? "scanning";
        if (phase === "saved" || phase === "discarded") continue;
        if (t.status === "stopped" || t.status === "error") continue;
        return `${c.id}|${t.id}|${phase}|${t.status === "running" ? 1 : 0}`;
      }
    return "";
  });
  if (!key) return null;
  const [chatId, turnId, phase, running] = key.split("|");
  return { chatId, turnId, phase: phase as ExtractPhase, running: running === "1" };
}
