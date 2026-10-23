import type { Suggestion } from "@/ai/schemas";

export type Decision = "approved" | "rejected" | undefined;

/** A Detective suggestion with the designer's name and decision. */
export interface DetectiveRow extends Suggestion {
  key: string;
  finalName: string;
  decision: Decision;
}

// ---------------------------------------------------------------------------
// Naming decisions persist per browser so later suggestions follow the designer's style.

const DECISIONS_KEY = "ds-studio/naming-decisions/v1";

export interface NamingDecision {
  value: string;
  intent: string;
  suggested: string;
  final: string;
}

export function loadDecisions(): NamingDecision[] {
  try {
    return JSON.parse(localStorage.getItem(DECISIONS_KEY) ?? "[]") as NamingDecision[];
  } catch {
    return [];
  }
}

export function saveDecisions(list: NamingDecision[]) {
  try {
    localStorage.setItem(DECISIONS_KEY, JSON.stringify(list.slice(-40)));
  } catch {
    /* best effort */
  }
}

export function clearDecisions() {
  try {
    localStorage.removeItem(DECISIONS_KEY);
  } catch {
    /* ignore */
  }
}
