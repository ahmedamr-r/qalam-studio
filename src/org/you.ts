import { create } from "zustand";

/*
 * Who's on this computer: their name (this Mac's, ~/Qalam/.qalam/settings.json) and their position
 * at each organization (kept per organization on this computer, `.qalam/local`). The first run asks
 * both; goal setup hears them (`personLine`), so Qalam AI doesn't ask who they are and pitches its
 * questions to them. Neither is ever written into the organization's pages.
 */

export type Position = "founder" | "product-lead" | "pm" | "designer" | "engineer" | "other";

export const POSITIONS: readonly { value: Position; label: string; noun: string }[] = [
  { value: "founder", label: "Founder or CEO", noun: "a founder or CEO" },
  { value: "product-lead", label: "Head of product", noun: "the head of product" },
  { value: "pm", label: "Product manager", noun: "a product manager" },
  { value: "designer", label: "Designer", noun: "a designer" },
  { value: "engineer", label: "Engineer", noun: "an engineer" },
  { value: "other", label: "Other", noun: "" },
];

/** Their position at one organization: one of the list, or Other in their own words. */
export interface Me {
  position: Position;
  /** What they typed for Other, as typed. */
  title?: string;
}

export interface Person extends Me {
  name: string;
}

export const NAME_MAX = 80;
export const TITLE_MAX = 80;

const one = (s: string, max: number) => s.trim().replace(/\s+/g, " ").slice(0, max);

/** A position as sent: one of the list, and Other only with its words. */
export function meShape(x: unknown): Me | null {
  if (!x || typeof x !== "object") return null;
  const { position, title } = x as { position?: unknown; title?: unknown };
  if (!POSITIONS.some((p) => p.value === position)) return null;
  if (position !== "other") return { position: position as Position };
  const t = typeof title === "string" ? one(title, TITLE_MAX) : "";
  return t ? { position, title: t } : null;
}

export const nameShape = (x: unknown): string | null => (typeof x === "string" && one(x, NAME_MAX) ? one(x, NAME_MAX) : null);

/** The position in words: the list's label, or their own for Other. */
export const positionLabel = (m: Me) => (m.position === "other" ? (m.title ?? "Other") : POSITIONS.find((p) => p.value === m.position)!.label);

/** For Qalam AI: "Ahmed, a product manager"; Other as they wrote it. */
export function personLine(p: Person): string {
  const what = p.position === "other" ? p.title : POSITIONS.find((x) => x.value === p.position)!.noun;
  return what ? `${p.name}, ${what}` : p.name;
}

// ---------------------------------------------------------------------------
// This Mac's name, in the window

export const useYou = create<{ name: string | null; loaded: boolean }>(() => ({ name: null, loaded: false }));

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Qalam couldn't answer (${res.status})`);
  return (await res.json()) as T;
}

export async function loadYou(): Promise<void> {
  const v = await fetch("/api/you").then((r) => json<{ name: string | null }>(r));
  useYou.setState({ name: v.name, loaded: true });
}

export async function setYourName(name: string): Promise<void> {
  const v = await fetch("/api/you", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => json<{ name: string | null }>(r));
  useYou.setState({ name: v.name, loaded: true });
}
