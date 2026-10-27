import { orgFetch, orgJson } from "@/org/client";
import type { Suggestion } from "@/ai/schemas";

export type Decision = "approved" | "rejected" | undefined;

/** A Detective suggestion with the designer's name and decision. */
export interface DetectiveRow extends Suggestion {
  key: string;
  finalName: string;
  decision: Decision;
}

// ---------------------------------------------------------------------------
// Naming decisions belong to the organization (design-systems/naming.json), so later suggestions
// follow the designer's style in every window. Loaded when a window opens (hydrateNaming), then
// read from memory.

export interface NamingDecision {
  value: string;
  intent: string;
  suggested: string;
  final: string;
}

let decisions: NamingDecision[] = [];
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export async function hydrateNaming() {
  decisions = await orgJson<NamingDecision[]>("/naming").catch(() => decisions);
}

export function loadDecisions(): NamingDecision[] {
  return decisions;
}

export function saveDecisions(list: NamingDecision[]) {
  decisions = list.slice(-40);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void orgFetch("/naming", { method: "PUT", json: decisions }).catch(() => {}), 300);
}

export function clearDecisions() {
  saveDecisions([]);
}
