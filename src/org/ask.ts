import { callAI } from "@/ai/client";
import type { AskAnswer } from "@/hub/ask";
import { orgPath } from "./client";

/**
 * Ask the organization (server/ask.ts): Qalam AI answers from what the organization knows, and
 * code checks every quote before the answer comes back. `onActivity` hears what it's doing
 * (searching, reading a file) while it works.
 */
export async function askOrganization(question: string, o: { product?: string | null; onActivity?: (label: string) => void; signal?: AbortSignal } = {}): Promise<AskAnswer> {
  const { data } = await callAI<AskAnswer>(await orgPath("/ask"), { question, ...(o.product ? { product: o.product } : {}) }, undefined, o.signal, (e) => {
    if (e.type === "activity") o.onActivity?.(e.label);
  });
  return data;
}
