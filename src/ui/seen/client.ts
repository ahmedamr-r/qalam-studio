import { create } from "zustand";
import { putAsset } from "@/doc/assets";
import { orgFetch, orgJson } from "@/org/client";
import { onOrgChange } from "@/org/live";
import type { SeenEditBody } from "./edits";
import type { SeenMap, SeenReading, Shot } from "@/seen/types";

/*
 * What people see, in the window: a product's map and its reading (server/org/seen.ts), kept up to
 * date by `seen` events (a reading's progress comes to every window, this one's too). Screenshots
 * go in as assets first, then the reading starts on them; answers, the review's ticks and the
 * person's edits go back as they're made.
 */

export interface SeenView {
  map: SeenMap | null;
  reading: SeenReading | null;
  words: boolean;
}

interface SeenState {
  key: string | null;
  view: SeenView | null;
  adding: { count: number; done: number } | null;
  /** This round's answers so far. */
  answers: Record<string, string>;
  decided: Record<string, "accepted" | "discarded">;
  steps: Record<string, "accepted" | "discarded">;
  busy: boolean;
  error: string | null;
}

export const useSeen = create<SeenState>(() => ({ key: null, view: null, adding: null, answers: {}, decided: {}, steps: {}, busy: false, error: null }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const path = (key: string, rest = "") => `/seen/${encodeURIComponent(key)}${rest}`;

let stop: (() => void) | null = null;

/** Open a product's map and reading here, and follow them. */
export async function openSeen(key: string): Promise<void> {
  if (useSeen.getState().key !== key) useSeen.setState({ key, view: null, adding: null, answers: {}, decided: {}, steps: {}, error: null });
  stop?.();
  stop = onOrgChange((c) => {
    if (c.kind === "seen" && c.key === useSeen.getState().key) void reload();
  });
  await reload();
}

export function closeSeen() {
  stop?.();
  stop = null;
}

async function reload() {
  const key = useSeen.getState().key;
  if (!key) return;
  try {
    const view = await orgJson<SeenView>(path(key));
    if (useSeen.getState().key !== key) return;
    // A new round: its answers start empty.
    const was = useSeen.getState().view?.reading?.rounds.length ?? 0;
    useSeen.setState({ view, error: null, ...(view.reading && view.reading.rounds.length !== was ? { answers: {} } : {}) });
  } catch (e) {
    useSeen.setState({ error: message(e) });
  }
}

const IMAGE = /^image\/(png|jpeg|webp|gif)$/;
/** The largest screenshot kept (the server takes 16 MB). */
export const SHOT_MAX = 16 * 1024 * 1024;

/** Why a file can't be a screenshot here, or null. */
export function refuseShot(f: File): string | null {
  if (/heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)) return `${f.name} is HEIC: save it as PNG or JPEG first.`;
  if (!IMAGE.test(f.type)) return `${f.name} isn't a PNG, JPEG, WebP or GIF.`;
  if (f.size > SHOT_MAX) return `${f.name} is over 16 MB.`;
  return null;
}

/** Keep the screenshots, then start reading them (or add them to the reading under way). */
export async function addShots(files: File[]): Promise<void> {
  const key = useSeen.getState().key;
  if (!key || !files.length) return;
  const refused = files.map(refuseShot).filter((x): x is string => !!x);
  const ok = files.filter((f) => !refuseShot(f));
  useSeen.setState({ error: refused.length ? refused.slice(0, 3).join(" ") + (refused.length > 3 ? ` And ${refused.length - 3} more.` : "") : null });
  if (!ok.length) return;
  useSeen.setState({ adding: { count: ok.length, done: 0 } });
  const shots: Shot[] = [];
  try {
    // Three at a time.
    for (let k = 0; k < ok.length; k += 3) {
      const batch = ok.slice(k, k + 3);
      const refs = await Promise.all(batch.map((f) => putAsset(f)));
      batch.forEach((f, j) => shots.push({ ref: refs[j], name: f.name, modified: f.lastModified }));
      useSeen.setState({ adding: { count: ok.length, done: shots.length } });
    }
    const reading = await orgJson<SeenReading>(path(key, "/read"), { method: "POST", json: { shots } });
    useSeen.setState((s) => ({ adding: null, decided: {}, steps: {}, view: s.view ? { ...s.view, reading } : { map: null, reading, words: true } }));
  } catch (e) {
    useSeen.setState({ adding: null, error: message(e) });
  }
}

/** Answer the open question; the round goes back once every question has an answer. */
export function answer(question: string, text: string) {
  const t = text.trim();
  if (!t) return;
  useSeen.setState((s) => ({ answers: { ...s.answers, [question]: t.slice(0, 300) } }));
}

/** Take back an answer to change it. */
export function unanswer(question: string) {
  useSeen.setState((s) => {
    const { [question]: _, ...rest } = s.answers;
    return { answers: rest };
  });
}

/** Send this round's answers (`skip`: stop asking, show what's proposed). */
export async function sendAnswers(skip = false): Promise<void> {
  const { key, answers } = useSeen.getState();
  if (!key) return;
  useSeen.setState({ busy: true, error: null });
  try {
    await orgFetch(path(key, "/answer"), { method: "POST", json: { answers: Object.entries(answers).map(([question, answer]) => ({ question, answer })), skip } });
    await reload();
  } catch (e) {
    useSeen.setState({ error: message(e) });
  } finally {
    useSeen.setState({ busy: false });
  }
}

export function decide(flow: string, d: "accepted" | "discarded") {
  useSeen.setState((s) => ({ decided: { ...s.decided, [flow]: d } }));
}

export function decideStep(screen: string, d: "accepted" | "discarded") {
  useSeen.setState((s) => ({ steps: { ...s.steps, [screen]: d } }));
}

/** Put what's accepted in the product's map. */
export async function settle(): Promise<void> {
  const { key, decided, steps } = useSeen.getState();
  if (!key) return;
  useSeen.setState({ busy: true, error: null });
  try {
    await orgFetch(path(key, "/settle"), { method: "POST", json: { flows: decided, steps } });
    await reload();
  } catch (e) {
    useSeen.setState({ error: message(e) });
  } finally {
    useSeen.setState({ busy: false });
  }
}

/** Leave this reading: nothing goes in the map, the screenshots stay kept. */
export async function dropReading(): Promise<void> {
  const key = useSeen.getState().key;
  if (!key) return;
  try {
    await orgFetch(path(key, "/reading"), { method: "DELETE" });
    useSeen.setState({ answers: {}, decided: {}, steps: {} });
    await reload();
  } catch (e) {
    useSeen.setState({ error: message(e) });
  }
}

/** A person's change to the map: their words, a screen or flow taken out. */
export async function editSeen(edit: SeenEditBody): Promise<void> {
  const key = useSeen.getState().key;
  if (!key) return;
  try {
    const map = await orgJson<SeenMap | null>(path(key), { method: "PATCH", json: edit });
    useSeen.setState((s) => ({ view: s.view ? { ...s.view, map } : s.view }));
  } catch (e) {
    useSeen.setState({ error: message(e) });
  }
}

/** Every product's map (Evidence, the goal page). */
export const seenMaps = () => orgJson<SeenMap[]>("/seen");
