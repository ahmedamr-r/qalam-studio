/**
 * Playing a prototype without a screen: the compiled module (the exact code Prototype mode plays,
 * transpiled the same way) run headless — taps go through its own `step`, scrolls through its
 * scroll marks, and what shows is its own screens and parts rendered to text. Recipes' scenarios
 * and the prototyping agent's checks run here, so a total is checked by the code that shows it.
 */
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import type { Doc, SubRef } from "@/doc/schema";
import { compilePrototype, type CompileOptions } from "@/codegen/compile";
import { evaluate, transpile } from "@/ui/prototype/runtime";
import { layerAddress } from "./items";
import { refLayer } from "./walk";

/** A layer to tap: where it is (a part of the screen, a spec path) and its layer name ("Increase", "Chip/Drinks"); or a layer inside the component there, by role (a dish row's +). */
export interface TapTarget {
  part?: string;
  path?: string;
  name?: string;
  sub?: SubRef;
}

interface State {
  screen: string;
  open: string[];
  data: Record<string, unknown>;
  ctx: Record<string, string>;
  app: Record<string, unknown>;
  scrollTo?: { y: number; n: number };
  held?: number;
}

interface Module {
  initial: (screen: string) => State;
  step: (s: State, a: Record<string, unknown>) => State;
  TAPS: Record<string, { rule: string; it?: string }[]>;
  SCREENS: Record<string, { Screen: ComponentType<Record<string, unknown>> }>;
  PARTS: Record<string, Record<string, { Part: ComponentType<Record<string, unknown>>; kind: string }>>;
}

export interface Played {
  state: State;
  /** The screen (and what's open over it) as text. */
  text: () => string;
  /** Text of one part, or of the screen alone. */
  textOf: (part?: string) => string;
  /** Tap a layer; false when nothing there does anything. */
  tap: (t: TapTarget) => boolean;
  /** Scroll the screen to `y`, of the `max` it can (as far as it likes, by default). */
  scroll: (y: number, max?: number) => void;
  back: () => void;
  warnings: string[];
}

const noop = () => {};
const plain = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** Compile a document's prototype and play it from `start` (a screen key) or where it starts. */
export function playPrototype(doc: Doc, opts: CompileOptions & { start?: string } = {}): Played {
  const r = compilePrototype(doc, opts);
  const mod = evaluate(transpile(r.code)) as unknown as Module;
  const startKey = opts.start ?? r.screens.find((s) => s.id === r.start)?.key ?? r.screens[0]?.key;
  const p: Played = {
    state: mod.initial(startKey),
    warnings: r.warnings,
    textOf: (part) => {
      const s = p.state;
      if (part) {
        const def = mod.PARTS[s.screen]?.[part];
        return def ? plain(renderToString(createElement(def.Part, { act: noop, s }))) : "";
      }
      const { Screen } = mod.SCREENS[s.screen];
      return plain(renderToString(createElement(Screen, { act: noop, go: noop, s, open: s.open })));
    },
    text: () => [p.textOf(), ...p.state.open.filter((x) => mod.PARTS[p.state.screen]?.[x]?.kind !== "bar").map((x) => p.textOf(x))].join(" | "),
    tap: (t) => {
      const s = p.state;
      let want = { path: t.path, name: t.name };
      if (t.sub) {
        // Found in the design by role, then tapped where it is.
        const id = r.screens.find((x) => x.key === s.screen)?.id;
        const route = id ? doc.proto?.routes?.[id] : undefined;
        const layer = id && route ? refLayer(doc, id, route, t) : null;
        if (!layer) return false;
        want = { path: layerAddress(doc, layer), name: doc.nodes[layer].name };
      }
      const hit = Object.entries(mod.TAPS).find(([k]) => {
        const [screen, part, path, name] = k.split("|");
        return screen === s.screen && part === (t.part ?? "") && (want.path === undefined || path === want.path) && (want.name === undefined || name === want.name);
      });
      if (!hit) return false;
      for (const run of hit[1]) p.state = mod.step(p.state, { do: "run", rule: run.rule, it: run.it });
      return true;
    },
    scroll: (y, max) => {
      p.state = mod.step(p.state, { do: "scrolled", y, max });
    },
    back: () => {
      p.state = mod.step(p.state, { do: "back" });
    },
  };
  return p;
}
