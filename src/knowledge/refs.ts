/**
 * Stable names for every fact (pure). A ref survives reloads and renames, so a decision recorded
 * today still points at the fact it used. Single-value facts are named by their slot; items in a
 * list (rules, dos, principles) by a hash of their text, since the lists carry no ids.
 */

/** FNV-1a over the text with whitespace collapsed, in base 36: the same words give the same hash. */
export function factHash(text: string): string {
  const s = text.replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Keys for a list's items, `prefix#hash`; the same text twice gets `~2`, `~3` in order. */
export function listKeys(prefix: string, items: string[]): string[] {
  const seen = new Map<string, number>();
  return items.map((t) => {
    const base = `${prefix}#${factHash(t)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  });
}

const normUrl = (url: string) => url.trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

export const ref = {
  summary: "brief:summary",
  answer: (id: string) => `brief:answer:${id}`,
  screenGoal: (frameId: string) => `brief:screen:${frameId}`,
  verdict: (frameId: string) => `brief:verdict:${frameId}`,
  ds: (systemId: string, key: string) => `ds:${systemId}:${key}`,
  naming: (n: { value: string; final: string }) => `mem:naming:${factHash(`${n.value}|${n.final}`)}`,
  research: (turnId: string) => `research:${turnId}`,
  source: (url: string) => `source:${normUrl(url)}`,
  chat: (turnId: string) => `chat:${turnId}`,
  decision: (id: string) => `decision:${id}`,
  token: (path: string) => `token:${path}`,
  component: (name: string) => `component:${name}`,
  screen: (frameId: string) => `screen:${frameId}`,
  system: (id: string) => `system:${id}`,
};

/** A ref's namespace ("brief", "ds", "mem", "decision", "token"…). */
export const refNs = (r: string) => r.slice(0, r.indexOf(":"));

/** The system and fact key of a `ds:` ref (system ids never contain ":"). */
export function dsKeyOf(r: string): { systemId: string; key: string } | null {
  if (!r.startsWith("ds:")) return null;
  const i = r.indexOf(":", 3);
  return i < 0 ? null : { systemId: r.slice(3, i), key: r.slice(i + 1) };
}

/** The id after a ref's namespace (`decision:abc` → `abc`, `brief:answer:a1` → `answer:a1`). */
export const refId = (r: string) => r.slice(r.indexOf(":") + 1);
