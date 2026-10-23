import { create } from "zustand";

/**
 * Which extraction draft the Tokens panel previews: a pointer to the chat turn that holds it (the
 * draft itself lives in the turn). Kept across reloads, like the draft.
 */

export interface PreviewPin {
  chatId: string;
  turnId: string;
}

const KEY = "qalam/extract-preview/v1";

function load(): PreviewPin | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    const p = raw ? (JSON.parse(raw) as PreviewPin) : null;
    return p && typeof p.chatId === "string" && typeof p.turnId === "string" ? p : null;
  } catch {
    return null;
  }
}

export const useExtractPreview = create<{ pin: PreviewPin | null }>(() => ({ pin: load() }));

function save(pin: PreviewPin | null) {
  useExtractPreview.setState({ pin });
  try {
    if (pin) window.localStorage.setItem(KEY, JSON.stringify(pin));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the pin lasts for this session */
  }
}

export const pinPreview = (pin: PreviewPin) => save(pin);

/** Stop previewing (only if `turnId`, when given, is the one previewed). */
export function unpinPreview(turnId?: string) {
  const cur = useExtractPreview.getState().pin;
  if (cur && (!turnId || cur.turnId === turnId)) save(null);
}
