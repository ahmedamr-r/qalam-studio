import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PERSONAS } from "./personas";
import { startPlan } from "@/onboarding/start";
import { routeOf } from "@/space/route";

/**
 * Checks before a run, with no model call: this folder is committed and the repo is public, so nothing
 * here may name a word on the private list (kept outside Git); each persona's ids must hold; and each
 * opener is walked through what the app does with it first, which is the paper walk.
 */

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

export function lint(root: string): string[] {
  const out: string[] = [];
  const denyFile = path.resolve(".qalam-dev/stress/private/denylist.txt");
  const deny = existsSync(denyFile) ? readFileSync(denyFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean) : [];
  if (!deny.length) out.push(`No private list at ${denyFile}: nothing was checked against one.`);
  for (const f of walk(root)) {
    const text = readFileSync(f, "utf8").toLowerCase();
    for (const d of deny) if (text.includes(d.toLowerCase())) out.push(`${path.relative(root, f)} names a word on the private list.`);
  }
  for (const p of PERSONAS) {
    const facts = new Set(p.facts.map((f) => f.id));
    for (const x of p.flips) if (!facts.has(x.fact)) out.push(`${p.id}: a flip names no fact (${x.fact})`);
    if (p.behavior.contradicts && !facts.has(p.behavior.contradicts.fact)) out.push(`${p.id}: a contradiction names no fact`);
    for (const f of p.facts) if (p.opener.includes(f.value)) out.push(`${p.id}: ${f.id} is in the opener already`);
    if (!p.facts.some((f) => f.mustLearn)) out.push(`${p.id}: nothing it must learn`);
    if (!p.traps.length) out.push(`${p.id}: no trap`);
    for (const d of p.docs ?? []) if (!existsSync(path.join(root, "fixtures", d))) out.push(`${p.id}: no fixture ${d}`);
  }
  return out;
}

/** What the app does with each first message: the chat's route, and what the start page's one box makes of it. */
export function paperWalk() {
  return PERSONAS.map((p) => {
    const chat = routeOf({ text: p.opener, docs: [] });
    const start = startPlan(p.opener, []);
    return { id: p.id, title: p.title, path: p.path, chat: chat?.job ?? "none", firstRun: start ? start.turns.map((t) => t.mode).join(" + ") : "turned away", project: start?.name ?? "", whose: start ? `${start.whose.shape}${start.whose.mine ? ", theirs" : ""}` : "" };
  });
}
