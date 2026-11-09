import { create } from "zustand";
import type { BusinessEdit } from "@/business/edit";
import { emptyBusiness, type Business } from "@/business/types";
import { orgJson } from "./client";
import { onOrgChange } from "./live";

/*
 * How the business works (business.md) in the window: loaded once, then followed as it changes (a
 * line Qalam AI noted from someone's answer, the page's edits, a hand edit of the file).
 */

interface BusinessState {
  business: Business;
  loaded: boolean;
  error: string | null;
}

export const useBusiness = create<BusinessState>(() => ({ business: emptyBusiness(), loaded: false, error: null }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
let following: (() => void) | null = null;

export async function loadBusiness(): Promise<void> {
  following ??= onOrgChange((c) => {
    if (c.kind === "business") void loadBusiness();
  });
  try {
    const r = await orgJson<{ business: Business }>("/business");
    useBusiness.setState({ business: r.business, loaded: true, error: null });
  } catch (e) {
    useBusiness.setState({ loaded: true, error: message(e) });
  }
}

/** A line added, fixed, kept as theirs or taken off; the store follows what the core kept. */
export async function editBusinessLine(edit: BusinessEdit): Promise<boolean> {
  useBusiness.setState({ error: null });
  try {
    const r = await orgJson<{ business: Business }>("/business", { method: "PUT", json: edit });
    useBusiness.setState({ business: r.business });
    return true;
  } catch (e) {
    useBusiness.setState({ error: message(e) });
    return false;
  }
}
