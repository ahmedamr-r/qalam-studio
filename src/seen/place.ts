import type { MapStep } from "@/code/map";
import { namesStep } from "@/code/steps";
import { hashDistance, looksSame, nearPairs, platformOf, sharedNav, takenOrder, wordOverlap, wordsOn } from "./measure";
import { withSeenKeys } from "./seen-md";
import { MOVE_HOWS, SEEN_LIMITS, type MoveHow, type SeenAnswer, type SeenFlow, type SeenMap, type SeenMove, type SeenQuestion, type SeenScreen, type SeenText, type Shot, type ShotNote } from "./types";
import { boxOf, noteLine, onScreen, textOf } from "./words";

/*
 * Placing screenshots in flows (pure): what the call is sent (the screens kept, the new screenshots
 * with what was read off them, what code noticed, the goals, the code map's steps, the answers so
 * far) and what code keeps of its answer.
 * - Screenshots grouped as one screen in several states stay together only when their pictures or
 *   words are close, or a person said so; otherwise code asks.
 * - A move keeps the control that makes it only when the screen it leaves shows it, word for word;
 *   a tap whose control isn't shown is asked about, the screen's own controls as the choices.
 * - A screen shows a code map's step only when its words name the step (`namesStep`).
 * - Ids only from what was sent; a person's flows and screens aren't rewritten; their answers win.
 * Then the map as it would be: what's kept merged with what's proposed (`proposalOf`).
 */

/** A screenshot (asset:…) or a screen already kept (screen:<key>): what placing moves around. */
export type NodeRef = string;

export interface PlaceNode {
  ref: NodeRef;
  name: string;
  note?: ShotNote;
  screen?: SeenScreen;
  /** The words on it: a screenshot's, or each of a kept screen's. */
  texts: (SeenText | undefined)[];
  /** The picture it shows as. */
  shot: string;
}

export interface PlaceSent {
  text: string;
  /** By call id: s1… new screenshots, e1… screens kept. */
  nodes: Map<string, PlaceNode>;
  /** f1… flows kept. */
  flows: Map<string, SeenFlow>;
  /** g1… goals. */
  goals: Map<string, string>;
  /** c1… a code map's steps. */
  steps: Map<string, { ref: string; step: MapStep }>;
  /** The new screenshots a small picture goes with, in order. */
  thumbs: { id: string; ref: string }[];
  /** The person's answers so far, as words the lines may use. */
  said: string;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const screenNode = (key: string) => `screen:${key}`;
const pairKey = (a: string, b: string) => [a, b].sort().join("|");
const moveKey = (from: string, to: string) => `${from}>${to}`;

export const SAME_SCREEN = "Same screen";
export const NOT_SAME = "Different screens";

/** What the person's answers settle: screenshots they said are (or aren't) one screen, the control they said makes a move. */
export function answersOf(answers: SeenAnswer[]): { same: Map<string, boolean>; via: Map<string, string>; said: string } {
  const same = new Map<string, boolean>();
  const via = new Map<string, string>();
  for (const a of answers) {
    const ab = a.about;
    if (ab && "same" in ab && (a.answer === SAME_SCREEN || a.answer === NOT_SAME)) same.set(pairKey(...ab.same), a.answer === SAME_SCREEN);
    else if (ab && "move" in ab && a.answer.trim() && a.answer.length <= SEEN_LIMITS.label) via.set(moveKey(ab.move.from, ab.move.to), a.answer.trim());
  }
  return { same, via, said: answers.map((a) => `${a.ask} ${a.answer}`).join("\n") };
}

export interface PlaceInput {
  /** The product, the organization and the goals, in words (`contextFor`, `goalsText`). */
  context: string;
  before: SeenMap | null;
  shots: Shot[];
  notes: Record<string, ShotNote>;
  /** The words on every screenshot here: the new ones and the kept screens'. */
  texts: ReadonlyMap<string, SeenText | undefined>;
  goals: { id: string; title: string }[];
  /** A code map's flows for the product, their steps refs as `stepRef` names them. */
  code: { flow: string; ref: string; step: MapStep }[];
  answers: SeenAnswer[];
}

/** What a placing call is sent. */
export function placeMaterial(i: PlaceInput): PlaceSent {
  const nodes = new Map<string, PlaceNode>();
  const flows = new Map<string, SeenFlow>();
  const goals = new Map<string, string>();
  const steps = new Map<string, { ref: string; step: MapStep }>();
  const idOf = new Map<NodeRef, string>();
  const out = [i.context.trim(), ""];

  const kept = i.before?.screens ?? [];
  if (kept.length) {
    out.push("Screens already kept (id · name · kind · what it's for):");
    for (const s of kept.slice(0, SEEN_LIMITS.screens)) {
      const id = `e${nodes.size + 1}`;
      nodes.set(id, { ref: screenNode(s.key), name: s.name, screen: s, texts: s.shots.map((x) => i.texts.get(x)), shot: s.shots[0] });
      idOf.set(screenNode(s.key), id);
      out.push(`- ${id} · ${one(s.name)} · ${s.kind}${s.does ? ` · ${one(s.does)}` : ""}${s.can.length ? ` · you can: ${s.can.map((c) => `“${c.label}”`).join(", ")}` : ""}`);
    }
    out.push("");
  }
  if (i.before?.flows.length) {
    out.push("Flows already kept (id · name · aim: its screens in order):");
    for (const f of i.before.flows.slice(0, SEEN_LIMITS.flows)) {
      const id = `f${flows.size + 1}`;
      flows.set(id, f);
      out.push(`- ${id} · ${one(f.name)} · ${one(f.aim)}: ${f.steps.map((s) => idOf.get(screenNode(s)) ?? s).join(" → ")}${f.by === "you" ? " (a person's: leave it as it is)" : ""}`);
    }
    out.push("");
  }

  const order = takenOrder(i.shots);
  const byRef = new Map(i.shots.map((s) => [s.ref, s]));
  out.push("New screenshots, in the order they were taken (id · file · name · kind · what it's for):");
  const thumbs: PlaceSent["thumbs"] = [];
  for (const ref of order.slice(0, SEEN_LIMITS.shots)) {
    const s = byRef.get(ref)!;
    const n = i.notes[ref];
    const id = `s${thumbs.length + 1}`;
    nodes.set(id, { ref, name: n?.name ?? s.name, ...(n ? { note: n } : {}), texts: [i.texts.get(ref)], shot: ref });
    idOf.set(ref, id);
    thumbs.push({ id, ref });
    out.push(`- ${id} · ${one(s.name).slice(0, 80)} · ${n ? `${one(n.name)} · ${n.kind}${n.does ? ` · ${one(n.does)}` : ""}` : "(not read)"}`);
    if (n?.state) out.push(`  Shows: ${one(n.state)}`);
    if (n?.can.length) out.push(`  You can: ${n.can.map((c) => `“${c.label}”${c.does ? ` (${one(c.does)})` : ""}`).join(", ")}`);
    if (n?.nav.length) out.push(`  Navigation: ${n.nav.map((x) => `“${x}”`).join(", ")}`);
  }
  out.push("");

  // What code noticed: the hints, never the answer.
  const texts = new Map<string, SeenText | undefined>();
  for (const [id, n] of nodes) texts.set(id, n.texts.find(Boolean));
  const near = nearPairs(texts).slice(0, 20);
  const nav = sharedNav([...thumbs.map((t) => i.texts.get(t.ref))]);
  const sizes = thumbs.map((t) => i.texts.get(t.ref)).filter((t): t is SeenText => !!t);
  out.push("What code noticed:");
  for (const p of near) out.push(`- ${p.a} and ${p.b} look like one screen: their pictures differ in ${p.distance} of 64 bits, ${Math.round(p.overlap * 100)}% of their words are the same.`);
  if (nav.length) out.push(`- Navigation on most screens: ${nav.map((x) => `“${x}”`).join(", ")}`);
  if (sizes.length) out.push(`- Taken on a ${platformOf(sizes[0].w, sizes[0].h)}.`);
  if (!near.length && !nav.length && !sizes.length) out.push("- Nothing: this Mac didn't read the screenshots.");
  out.push("");

  if (i.goals.length) {
    out.push("Goals (id · goal):");
    for (const g of i.goals) {
      const id = `g${goals.size + 1}`;
      goals.set(id, g.id);
      out.push(`- ${id} · ${one(g.title)}`);
    }
    out.push("");
  }
  if (i.code.length) {
    out.push("Steps the product's code map lists (id · flow · step · the screen's file):");
    for (const c of i.code.slice(0, 60)) {
      const id = `c${steps.size + 1}`;
      steps.set(id, { ref: c.ref, step: c.step });
      out.push(`- ${id} · ${one(c.flow)} · ${one(c.step.title)} · ${c.step.file}`);
    }
    out.push("");
  }
  const said = answersOf(i.answers).said;
  if (i.answers.length) {
    out.push("The person's answers so far:");
    for (const a of i.answers) out.push(`- ${one(a.ask)} → ${one(a.answer)}`);
    out.push("");
  }
  return { text: out.join("\n").trim(), nodes, flows, goals, steps, thumbs, said };
}

// ---------------------------------------------------------------------------
// What code keeps of the answer

export interface PlacedFlow extends Omit<SeenFlow, "key" | "steps" | "moves" | "by" | "at"> {
  /** The flow kept before that it updates. */
  was?: string;
  steps: NodeRef[];
  moves: (Omit<SeenMove, "from" | "to"> & { from: NodeRef; to: NodeRef })[];
}

export interface PlaceKept {
  /** Nodes that show one screen, each group's first its usual look. Every node is in one. */
  groups: NodeRef[][];
  /** What a screenshot shows, when it's a screen's other state. */
  states: Record<string, string>;
  flows: PlacedFlow[];
  /** The code step a node shows. */
  code: Record<NodeRef, string>;
  questions: SeenQuestion[];
  ready: boolean;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown) => (Array.isArray(v) ? v : []);

/**
 * What code keeps of a placing answer. `last` says no round follows: nothing more is asked, and a
 * move whose control isn't shown stays as it is ("how isn't shown"). `dropped` hears what's left out.
 */
export function sanitizePlace(raw: unknown, m: PlaceSent, o: { answers: SeenAnswer[]; last?: boolean }, dropped?: (why: string, item: unknown) => void): PlaceKept {
  const r = rec(raw);
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  const settled = answersOf(o.answers);
  const node = (id: unknown) => (typeof id === "string" ? m.nodes.get(id.trim()) : undefined);
  const asked = new Set(o.answers.map((a) => (a.about ? JSON.stringify(a.about) : a.ask)));
  const codeSame: SeenQuestion[] = [];
  const codeMoves: SeenQuestion[] = [];
  const ask = (q: Omit<SeenQuestion, "id" | "by">, into: SeenQuestion[]) => {
    const k = q.about ? JSON.stringify(q.about) : q.ask;
    if (o.last || asked.has(k) || [...codeSame, ...codeMoves].some((x) => JSON.stringify(x.about) === k)) return;
    into.push({ ...q, id: "", by: "code" });
  };

  // One screen in several states: kept when the pictures or words are close, or the person said so.
  const parent = new Map<NodeRef, NodeRef>();
  const find = (x: NodeRef): NodeRef => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const words = new Map([...m.nodes.values()].map((n) => [n.ref, wordsOn(n.texts.find(Boolean))]));
  for (const g of list(r.same)) {
    const members = list(g).map(node).filter((n): n is PlaceNode => !!n);
    if (members.length < 2) {
      drop("a group of fewer than two screens sent", g);
      continue;
    }
    const [first, ...rest] = members;
    for (const n of rest) {
      const said = settled.same.get(pairKey(first.ref, n.ref));
      const close = looksSame({ distance: hashDistance(first.texts.find(Boolean)?.dhash, n.texts.find(Boolean)?.dhash), overlap: wordOverlap(words.get(first.ref)!, words.get(n.ref)!) });
      if (said === false) drop("the person said these are different screens", [first.ref, n.ref]);
      else if (said || close) parent.set(find(n.ref), find(first.ref));
      else {
        drop("grouped as one screen, but their pictures and words differ", [first.ref, n.ref]);
        ask({ ask: `Are “${first.name}” and “${n.name}” one screen, in two states?`, why: "They read as one screen to me, but their pictures and words differ more than one screen's states usually do.", shots: [first.shot, n.shot], marks: [], options: [SAME_SCREEN, NOT_SAME], about: { same: [first.ref, n.ref] } }, codeSame);
      }
    }
  }
  // The person's "same screen" stands even when the answer didn't group them again.
  for (const [k, same] of settled.same) {
    const [a, b] = k.split("|");
    if (same && [...m.nodes.values()].some((n) => n.ref === a) && [...m.nodes.values()].some((n) => n.ref === b)) parent.set(find(b), find(a));
  }
  const groupsBy = new Map<NodeRef, NodeRef[]>();
  for (const n of m.nodes.values()) groupsBy.set(find(n.ref), [...(groupsBy.get(find(n.ref)) ?? []), n.ref]);
  // A group's usual look: a kept screen when it has one, else its first screenshot.
  const groups = [...groupsBy.values()].map((g) => [...g].sort((a, b) => Number(b.startsWith("screen:")) - Number(a.startsWith("screen:"))));

  const states: Record<string, string> = {};
  for (const s of list(r.states).map(rec)) {
    const n = node(s.id);
    if (!n || n.screen) {
      drop("a state of a screenshot not sent", s);
      continue;
    }
    const line = noteLine(s.shows, n.texts, settled.said, 200);
    if (line) states[n.ref] = line;
    else drop("a state whose words aren't on the screen", s);
  }

  // Flows.
  const flows: PlacedFlow[] = [];
  const nodeTexts = (refs: NodeRef[]) => refs.flatMap((ref) => [...m.nodes.values()].find((n) => n.ref === ref)?.texts ?? []);
  const byRef = new Map([...m.nodes.values()].map((n) => [n.ref, n]));
  for (const x of list(r.flows)) {
    if (flows.length >= SEEN_LIMITS.flows) {
      drop("over the limit", x);
      continue;
    }
    const f = rec(x);
    const was = typeof f.id === "string" ? m.flows.get(f.id.trim()) : undefined;
    if (was?.by === "you") {
      drop("a person's flow: it stays as they left it", x);
      continue;
    }
    const steps = list(f.steps)
      .map(node)
      .filter((n): n is PlaceNode => !!n)
      .map((n) => n.ref)
      .slice(0, SEEN_LIMITS.steps);
    if (new Set(steps.map(find)).size < 2) {
      drop("fewer than two screens sent", x);
      continue;
    }
    const texts = nodeTexts(steps);
    const name = noteLine(f.name, texts, settled.said, 80);
    if (!name) {
      drop("its name holds a word or number not on its screens", x);
      continue;
    }
    const moves: PlacedFlow["moves"] = [];
    const seen = new Set<string>();
    const addMove = (from: PlaceNode, to: PlaceNode, how: MoveHow, via?: unknown) => {
      const k = moveKey(from.ref, to.ref);
      if (seen.has(k) || find(from.ref) === find(to.ref) || moves.length >= SEEN_LIMITS.moves) return;
      seen.add(k);
      const theirs = settled.via.get(k);
      const shown = theirs ?? (via ? from.texts.map((t) => onScreen(via, t, SEEN_LIMITS.label)).find(Boolean) : null);
      if (via && !shown) drop("a move whose control isn't on the screen it leaves", { from: from.ref, to: to.ref, via });
      moves.push({ from: from.ref, to: to.ref, ...(shown ? { via: shown } : {}), how });
      if (!shown && (how === "tap" || how === "type" || how === "swipe")) {
        const labels = (from.note?.can ?? from.screen?.can ?? []).map((c) => c.label).slice(0, 4);
        ask({ ask: `On “${from.name}”, what takes you to “${to.name}”?`, why: "The screenshots don't show which control leads there.", shots: [from.shot, to.shot], marks: [], options: labels.length >= 2 ? labels : [], about: { move: { from: from.ref, to: to.ref } } }, codeMoves);
      }
    };
    for (const mv of list(f.moves).map(rec)) {
      const from = node(mv.from);
      const to = node(mv.to);
      if (!from || !to) {
        drop("a move between screens not sent", mv);
        continue;
      }
      const how = typeof mv.how === "string" && (MOVE_HOWS as readonly string[]).includes(mv.how) ? (mv.how as MoveHow) : "tap";
      addMove(from, to, how, typeof mv.via === "string" && mv.via.trim() && mv.via !== "none" ? mv.via : undefined);
    }
    // Every step leads to the next.
    for (let k = 1; k < steps.length; k++) addMove(byRef.get(steps[k - 1])!, byRef.get(steps[k])!, "tap");
    const line = (v: unknown, max = 200) => (v === undefined || v === null || v === "" ? undefined : (noteLine(v, texts, settled.said, max) ?? undefined));
    const aim = line(f.aim, 120) ?? "";
    const entry = line(f.entry);
    const note = line(f.note, SEEN_LIMITS.line);
    const notShown = list(f.notShown)
      .map((n) => line(n))
      .filter((n): n is string => !!n)
      .slice(0, SEEN_LIMITS.notShown);
    const goal = typeof f.goal === "string" ? m.goals.get(f.goal.trim()) : undefined;
    flows.push({ ...(was ? { was: was.key } : {}), name, aim, ...(goal ? { goal } : {}), steps, moves, ...(entry ? { entry } : {}), notShown, ...(note ? { note } : {}) });
  }

  // Code steps a screen shows: only when its words name the step.
  const code: Record<NodeRef, string> = {};
  for (const c of list(r.code).map(rec)) {
    const n = node(c.screen);
    const s = typeof c.step === "string" ? m.steps.get(c.step.trim()) : undefined;
    if (!n || !s) {
      drop(!n ? "a screen not sent" : "a step not sent", c);
      continue;
    }
    if (!namesStep(`${n.name} ${n.texts.map(textOf).join(" ")}`, s.step)) {
      drop("the screen's words don't name the step", c);
      continue;
    }
    code[n.ref] = s.ref;
  }

  // Qalam AI's questions: about screens sent, their words on the screens they point at.
  const theirs: SeenQuestion[] = [];
  for (const q of list(r.questions).map(rec)) {
    if (o.last) break;
    const about = list(q.shots)
      .map(node)
      .filter((n): n is PlaceNode => !!n)
      .slice(0, 4);
    if (!about.length) {
      drop("a question about no screen sent", q);
      continue;
    }
    const texts = about.flatMap((n) => n.texts);
    const text = noteLine(q.ask, texts, settled.said, 300);
    const why = noteLine(q.why, texts, settled.said, 300);
    if (!text || !why || asked.has(text)) {
      drop(!text || !why ? "a question whose words aren't on its screens" : "asked before", q);
      continue;
    }
    const options = list(q.options)
      .filter((x): x is string => typeof x === "string" && !!x.trim())
      .map((x) => one(x).slice(0, 80))
      .slice(0, 4);
    const marks: SeenQuestion["marks"] = [];
    for (const w of list(q.words).map(rec)) {
      const n = node(w.id);
      if (!n || !about.includes(n)) continue;
      for (const t of n.texts) {
        const words = onScreen(w.words, t);
        const box = words ? boxOf(words, t) : null;
        if (words && box) {
          marks.push({ shot: n.shot, words, box });
          break;
        }
      }
    }
    theirs.push({ id: "", ask: text, why, shots: about.map((n) => n.shot), marks, options: options.length >= 2 ? options : [], by: "qalam" });
  }

  const questions = [...codeSame, ...theirs, ...codeMoves].slice(0, SEEN_LIMITS.questions).map((q, k) => ({ ...q, id: `q${k + 1}` }));
  return { groups, states, flows, code, questions, ready: r.ready === true && !questions.length };
}

// ---------------------------------------------------------------------------
// The map as it would be

/**
 * The map with what's proposed: each group a screen (a kept one gains the new screenshots as its
 * states; a new one takes what was read off its first), each flow over the screens (a flow kept
 * before and not answered for stays as it was), keys kept where they hold. Also the code steps
 * proposed for screens that have none yet.
 */
export function proposalOf(before: SeenMap | null, kept: PlaceKept, i: { key: string; product: string | null; notes: Record<string, ShotNote>; shots: Shot[]; now: number }): { map: SeenMap; steps: Record<string, string> } {
  const names = new Map(i.shots.map((s) => [s.ref, s.name]));
  const old = new Map((before?.screens ?? []).map((s) => [screenNode(s.key), s]));
  const screenOf = new Map<NodeRef, string>();
  const screens: (Omit<SeenScreen, "key"> & { key: string })[] = [];
  const proposedSteps = new Map<string, string>();
  let n = 0;
  for (const g of kept.groups) {
    const keptScreens = g.filter((ref) => old.has(ref)).map((ref) => old.get(ref)!);
    const shots = g.filter((ref) => !old.has(ref));
    let screen: Omit<SeenScreen, "key"> & { key: string };
    if (keptScreens.length) {
      const [base, ...others] = keptScreens;
      const all = [...base.shots, ...others.flatMap((s) => s.shots), ...shots];
      const states: Record<string, string> = { ...Object.assign({}, ...others.map((s) => s.states)), ...base.states };
      for (const s of [...others.flatMap((o) => o.shots), ...shots]) if (!states[s]) states[s] = kept.states[s] ?? i.notes[s]?.state ?? "";
      screen = { ...base, shots: [...new Set(all)], states: Object.fromEntries(Object.entries(states).filter(([, v]) => v)) };
    } else {
      const [main, ...rest] = shots;
      const note = i.notes[main];
      const states: Record<string, string> = {};
      for (const s of rest) {
        const st = kept.states[s] ?? i.notes[s]?.state;
        if (st) states[s] = st;
      }
      screen = {
        key: `~n${++n}`,
        name: note?.name ?? (names.get(main) ?? "Screen").replace(/\.[a-z0-9]+$/i, ""),
        shots,
        states,
        kind: note?.kind ?? "other",
        ...(note?.does ? { does: note.does } : {}),
        ...(note?.on ? { on: note.on } : {}),
        can: note?.can ?? [],
        nav: note?.nav ?? [],
        ...(note?.design ? { design: note.design } : {}),
        by: "qalam",
        at: i.now,
      };
    }
    for (const ref of g) screenOf.set(ref, screen.key);
    const step = g.map((ref) => kept.code[ref]).find(Boolean);
    if (step && !screen.step) proposedSteps.set(screen.key, step);
    screens.push(screen);
  }
  // Screens kept before that weren't sent stay as they are.
  for (const s of before?.screens ?? [])
    if (!screenOf.has(screenNode(s.key))) {
      screens.push(s);
      screenOf.set(screenNode(s.key), s.key);
    }

  const flows: (Omit<SeenFlow, "key"> & { key?: string })[] = [];
  const answeredFor = new Set(kept.flows.map((f) => f.was).filter(Boolean));
  const moved = (key: string) => screenOf.get(screenNode(key)) ?? key;
  for (const f of before?.flows ?? []) {
    if (answeredFor.has(f.key)) continue;
    // A flow kept before follows its screens into the screen they're now part of.
    const steps = f.steps.map(moved).filter((s, k, a) => s !== a[k - 1]);
    const moves = f.moves.map((mv) => ({ ...mv, from: moved(mv.from), to: moved(mv.to) })).filter((mv) => mv.from !== mv.to);
    if (new Set(steps).size >= 2) flows.push({ ...f, steps, moves });
  }
  for (const f of kept.flows) {
    const steps = f.steps.map((ref) => screenOf.get(ref)!).filter((s, k, a) => s && s !== a[k - 1]);
    if (new Set(steps).size < 2) continue;
    const moves: SeenMove[] = [];
    for (const mv of f.moves) {
      const from = screenOf.get(mv.from);
      const to = screenOf.get(mv.to);
      if (!from || !to || from === to || moves.some((x) => x.from === from && x.to === to)) continue;
      moves.push({ ...mv, from, to });
    }
    const { was, ...rest } = f;
    flows.push({ ...rest, ...(was ? { key: was } : {}), steps, moves, by: "qalam", at: i.now });
  }

  const keyed = withSeenKeys(screens, flows, before ?? undefined);
  const steps: Record<string, string> = {};
  for (const [k, v] of proposedSteps) steps[keyed.renamed.get(k) ?? k] = v;
  return { map: { key: i.key, product: i.product, readAt: i.now, screens: keyed.screens, flows: keyed.flows, gone: before?.gone ?? [] }, steps };
}
