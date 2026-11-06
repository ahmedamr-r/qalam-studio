import { create } from "zustand";
import type { TermsEdit } from "@/terms/edit";
import { emptyTerms, type Terms } from "@/terms/types";
import { orgJson } from "./client";
import { onOrgChange } from "./live";

/*
 * The project's words (hub/terms.md) in the window: loaded once, then followed as they change
 * (the panel's edits, Qalam AI's proposals a person keeps, a hand edit of the file).
 */

interface TermsState {
  terms: Terms;
  loaded: boolean;
  error: string | null;
}

export const useTerms = create<TermsState>(() => ({ terms: emptyTerms(), loaded: false, error: null }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
let following: (() => void) | null = null;

export async function loadTerms(): Promise<void> {
  following ??= onOrgChange((c) => {
    if (c.kind === "terms") void loadTerms();
  });
  try {
    const r = await orgJson<{ terms: Terms }>("/terms");
    useTerms.setState({ terms: r.terms, loaded: true, error: null });
  } catch (e) {
    useTerms.setState({ loaded: true, error: message(e) });
  }
}

/** A term added, fixed or taken off; the store follows what the core kept. */
export async function editTerm(edit: TermsEdit): Promise<boolean> {
  useTerms.setState({ error: null });
  try {
    const r = await orgJson<{ terms: Terms }>("/terms", { method: "PUT", json: edit });
    useTerms.setState({ terms: r.terms });
    return true;
  } catch (e) {
    useTerms.setState({ error: message(e) });
    return false;
  }
}
