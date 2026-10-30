import { studio, type AITab, type LeftTab, type Tool, type ViewOptions } from "@/doc/store";
import type { TextNode } from "@/doc/schema";
import { deleteNodes, duplicate, frameSelection, reorderMany, topLevelOf } from "@/doc/ops";
import { makeFrame } from "@/doc/factory";
import { alignNodes, canAlign, distributeNodes, tidyUp, type AlignKind } from "@/doc/align";
import { copySelection, cutSelection, hasClipboard, pasteClipboard, pasteToReplace } from "@/doc/clipboard";
import { addAutoLayout, removeAutoLayout, stepInFlow } from "@/doc/autolayout-ops";
import { childrenOf, frameStep, inverseOf, matchingOf, parentsOf, selectAllAtLevel, siblingStep } from "@/doc/select";
import { detachInstances, instanceRootOf, removeFill, removeStroke, resizeBy, swapFillStroke, toggleLocked, toggleVisible } from "@/doc/layer-ops";
import { alignText, stepText, textIds, toggleBold, toggleDecoration, toggleItalic, toggleJustify, toggleList, type TextStep } from "@/doc/text-ops";
import { groupSelection, isGroup, resizeToFit, ungroupSelection } from "@/doc/group";
import { flipNodes } from "@/doc/transform";
import { copyProps, hasProps, pasteProps } from "@/doc/props-clipboard";
import { selectionBounds } from "@/doc/geometry";
import { resolvedDirection } from "@/engine/text";
import { canEditVector, useVectorEdit } from "@/engine/vector-state";
import { placeImages } from "@/ui/images";
import { copySelectionPNG, exportDocJSON, exportSelectionPNG, openDocJSON, pickImages } from "@/ui/exporter";
import { kb, keysText, registerCommands, type Command, type CommandCategory, type KeySpec } from "./registry";
import { commandCanvas } from "./canvas";
import { feedback } from "./feedback";
import { openPalette, toggleShortcuts, useSurfaces } from "./surfaces";
import { cycleRegion } from "./regions";
import { isDiscovery, projectType } from "@/projects/mode";
import { COMPONENTS_PAGE, onComponentsPage } from "@/doc/pages";
// The pages runtime reaches the canvas, which loads the commands: imported when a page command runs.
const pages = () => import("@/ui/pages");
import { openPrototype } from "@/ui/prototype/store";
import { rightTab, setRightTab, type RightTab } from "@/ui/prototype/panel";

/**
 * Every Figma Design shortcut (UI3, macOS), mapped to Qalam. Entries Qalam can't do carry
 * `unavailable` so the shortcuts panel can list them dimmed; gestures carry `gesture` keycaps.
 * Source: research/figma-shortcuts.md. Labels follow Figma's wording where it fits.
 */

const SOON = "Coming soon";
const s = studio;
const sel = () => studio().selection;
const canvas = () => commandCanvas();

const needSelection = () => (sel().length ? true : "Select a layer first");
const needCanvas = () => (canvas() ? true : "The canvas isn't ready yet");
const needClip = () => (hasClipboard() ? true : "Copy a layer first");
const editable = () => {
  const { doc } = s();
  return topLevelOf(doc, sel()).filter((id) => !doc.nodes[id].locked);
};
const needEditable = () => (editable().length ? true : sel().length ? "The selection is locked" : "Select a layer first");

/** While a text layer is being edited, text commands apply to it; otherwise to the selected text layers. */
const textTargets = () => (s().editingTextId ? [s().editingTextId!] : sel());
const needText = () => (textIds(textTargets()).length ? true : "Select a text layer");

const tool = (t: Tool, label: string, keys: KeySpec[], extra: Partial<Command> = {}): Command => ({
  id: `tool.${t}`,
  label,
  category: "tools",
  keys,
  run: () => {
    s().setEditingText(null);
    s().setTool(t);
  },
  checked: () => s().tool === t,
  ...extra,
});

const flag = (key: keyof ViewOptions, id: string, label: string, keys: KeySpec[], extra: Partial<Command> = {}): Command => ({
  id,
  label,
  category: "view",
  keys,
  run: () => {
    const on = !s().view[key];
    s().setView({ [key]: on });
    feedback(`${label.replace(/^Show\/hide |^Show /, "")} ${on ? "on" : "off"}`, { id: `view.${key}` });
  },
  checked: () => s().view[key],
  ...extra,
});

const panel = (tab: LeftTab, id: string, label: string, keys: KeySpec[]): Command => ({
  id,
  label,
  category: "panels",
  keys,
  run: () => s().setLeftTab(tab),
  checked: () => s().leftOpen && s().leftTab === tab,
});

/** The first control of a right-panel tab: the layer name in Design, the first link or button in Prototype. */
const FIRST_CONTROL: Record<RightTab, string> = {
  design: "[data-design-panel] input, [data-design-panel] button, input[aria-label='Layer name']",
  prototype: "[data-prototype-panel] button, [data-prototype-panel] input, [data-prototype-panel] select",
};

/** Show a right-panel tab and put the cursor in it (once a tab that wasn't showing has drawn). */
const showRight = (tab: RightTab) => {
  const was = rightTab();
  setRightTab(tab);
  const focus = () => document.querySelector<HTMLElement>(FIRST_CONTROL[tab])?.focus();
  if (was === tab) focus();
  else requestAnimationFrame(focus);
};

/** Prototype commands: a Discovery board has no screens to play. */
const canPrototype = () =>
  isDiscovery() ? "Not on a Discovery board" : onComponentsPage(s().doc) ? "Go to a page with screens" : s().doc.roots.some((id) => s().doc.nodes[id]?.type === "frame") ? true : "Add a screen first";

/** Entries that are part of Figma but not of Qalam (or not yet). */
const notOnBoard = () => (isDiscovery() ? "Not on a Discovery board" : true);
const na = (id: string, label: string, category: CommandCategory, keys: KeySpec[] | null, reason: string, extra: Partial<Command> = {}): Command => ({
  id,
  label,
  category,
  ...(keys ? { keys } : {}),
  run: () => {},
  unavailable: reason,
  ...extra,
});

/** Mouse gestures: listed with keycaps, never dispatched. */
const gesture = (id: string, label: string, category: CommandCategory, caps: string[], extra: Partial<Command> = {}): Command => ({
  id,
  label,
  category,
  gesture: caps,
  hidden: true,
  run: () => {},
  ...extra,
});

const align = (how: AlignKind, label: string, key: string): Command => ({
  id: `arrange.align-${how}`,
  label,
  category: "arrange",
  keys: [kb(`⌥${key}`)],
  run: () => alignNodes(sel(), how),
  enabled: () => (canAlign(sel()) ? true : "Select 2+ layers, or one inside a frame"),
});

const textStep = (what: TextStep, dir: 1 | -1, label: string, mods: string, keywords: string[]): Command => ({
  id: `text.${what}-${dir > 0 ? "up" : "down"}`,
  label,
  category: "text",
  keys: [kb(`${mods}${dir > 0 ? "." : ","}`, dir > 0 ? ">" : "<")],
  run: () => stepText(textTargets(), what, dir),
  enabled: needText,
  repeat: true,
  inText: true,
  keywords,
});

/** A binding that also works while editing text (Figma zooms with ⌘= / ⌘- / ⌘0 there). */
const alsoInText = (spec: KeySpec): KeySpec => ({ ...spec, inText: true });

const ARROWS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};
const arrowKeys = (mods: string) => [kb(`${mods}←`), kb(`${mods}→`), kb(`${mods}↑`), kb(`${mods}↓`)];

/** Arrow keys move layers (or step them through their auto layout); ⇧ moves by 10. */
function nudge(key: string | undefined, step: number) {
  const a = key ? ARROWS[key] : undefined;
  if (!a) return;
  const ids = editable();
  if (!ids.length) return;
  if (stepInFlow(ids, key!.slice(5).toLowerCase() as "left" | "right" | "up" | "down")) return;
  s().mutate((d) => {
    for (const id of ids) {
      d.nodes[id].x += a.dx * step;
      d.nodes[id].y += a.dy * step;
    }
  });
}

// Opacity keys: 1–9 = 10–90 %, 0 = 100 %, two digits within 400 ms = that exact percentage ("0" "0" = 0 %).
export interface OpacityKeys {
  digits: string;
  at: number;
}

/** One opacity key press: the opacity it sets and the buffer for the next press. */
export function opacityStep(buf: OpacityKeys, digit: string, at: number): { value: number; buf: OpacityKeys } {
  const second = buf.digits.length === 1 && at - buf.at < 400;
  const value = second ? Number(buf.digits + digit) / 100 : digit === "0" ? 1 : Number(digit) / 10;
  return { value, buf: { digits: second ? "" : digit, at } };
}

let opacityBuffer: OpacityKeys = { digits: "", at: -Infinity };
function opacityKey(digit: string, at: number) {
  const ids = editable();
  if (!ids.length) return;
  // Timed by when the key went down, not when it was handled: a slow frame mustn't split "4" "5".
  const step = opacityStep(opacityBuffer, digit, at);
  opacityBuffer = step.buf;
  const value = step.value;
  s().mutate((d) => {
    for (const id of ids) d.nodes[id].opacity = value;
  });
  feedback(`Opacity ${Math.round(value * 100)}%`, { id: "shape.opacity" });
}

/** Moves the camera to the next frame in reading order; `keepZoom` pans only (Home / End). */
function goToFrame(dir: 1 | -1, keepZoom: boolean) {
  const c = canvas();
  const { doc } = s();
  const id = frameStep(doc, sel(), dir);
  if (!c || !id) return;
  s().select([id]);
  if (!keepZoom) return c.glideToFit([id]);
  const b = selectionBounds(doc, [id])!;
  const cam = s().camera;
  c.glideTo({ zoom: cam.zoom, x: b.x + b.w / 2 - c.viewport.w / 2 / cam.zoom, y: b.y + b.h / 2 - c.viewport.h / 2 / cam.zoom });
}

const AI_TOOLS: [AITab, string, string[]][] = [
  ["generate", "Generate screens", ["create", "compose", "design"]],
  ["critique", "Critique", ["review", "feedback", "heuristics"]],
  ["audit", "Audit", ["lint", "accessibility", "check"]],
  ["import", "Detective", ["import", "screenshot", "rebuild"]],
  ["direction", "Direction", ["translate", "rtl", "arabic", "localize"]],
  ["tune", "Tune system", ["tokens", "design system"]],
  ["extract", "Extract system", ["tokens", "design system", "screenshots"]],
  ["component", "Add component from a screenshot", ["component", "library", "screenshot", "import", "pattern"]],
];

export const CATALOG: Command[] = [
  // ---------------------------------------------------------------- essential
  {
    id: "essential.actions",
    label: "Actions…",
    category: "essential",
    keys: [kb("⌘K"), kb("⌘/"), kb("⌘P")],
    run: () => openPalette(),
    context: "global",
    keywords: ["command palette", "search", "quick actions", "commands"],
    hidden: true,
  },
  {
    id: "essential.shortcuts",
    label: "Keyboard shortcuts",
    category: "essential",
    keys: [kb("⌃⇧/", "?")],
    run: () => toggleShortcuts(),
    checked: () => useSurfaces.getState().shortcuts,
    context: "global",
    keywords: ["help", "keys", "cheat sheet"],
  },
  {
    id: "ai.chat",
    label: "Ask Qalam AI",
    category: "ai",
    keys: [kb("/")],
    run: () => s().focusChat(),
    keywords: ["chat", "assistant", "prompt", "cursor chat"],
  },
  ...AI_TOOLS.map(([tab, label, keywords]): Command => ({
    id: `ai.${tab}`,
    label: `Qalam AI: ${label}`,
    category: "ai",
    run: () => s().setAITab(tab),
    keywords,
  })),

  // ---------------------------------------------------------------- tools
  tool("select", "Move", [kb("v")], { keywords: ["select", "pointer", "arrow"] }),
  tool("hand", "Hand", [kb("h")], { keywords: ["pan"] }),
  tool("scale", "Scale", [kb("k")], { keywords: ["resize proportionally"] }),
  tool("frame", "Frame", [kb("f"), kb("a")], { keywords: ["artboard", "screen"] }),
  na("tool.section", "Section", "tools", [kb("⇧S")], "Qalam has no sections: top-level frames are screens"),
  na("tool.slice", "Slice", "tools", [kb("s")], "Export layers from the Design panel instead"),
  tool("rect", "Rectangle", [kb("r")], { keywords: ["box", "shape"] }),
  tool("line", "Line", [kb("l")]),
  tool("arrow", "Arrow", [kb("⇧L")]),
  tool("ellipse", "Ellipse", [kb("o")], { keywords: ["circle", "oval"] }),
  tool("polygon", "Polygon", [], { keywords: ["triangle", "shape"] }),
  tool("star", "Star", [], { keywords: ["shape"] }),
  {
    id: "tool.place-image",
    label: "Place image…",
    category: "tools",
    keys: [kb("⇧⌘K")],
    run: async () => {
      const files = await pickImages();
      if (!files.length) return;
      const ids = await placeImages(files);
      canvas()?.glideToFit(ids);
    },
    keywords: ["import", "picture", "photo", "upload"],
  },
  tool("pen", "Pen", [kb("p")], { keywords: ["vector", "path", "bezier", "draw"] }),
  tool("pencil", "Pencil", [kb("⇧P")], { keywords: ["freehand", "draw", "sketch"] }),
  tool("text", "Text", [kb("t")], { keywords: ["type", "label"] }),
  na("tool.comment", "Comment", "tools", [kb("c")], "Qalam has no comments"),
  {
    id: "tool.eyedropper",
    label: "Pick color",
    category: "tools",
    keys: [kb("i"), kb("⌃C")],
    winKeys: [kb("i")],
    run: async () => {
      const hex = await canvas()?.pickColor();
      if (!hex) return;
      const ids = editable();
      if (ids.length) {
        s().mutate((d) => ids.forEach((id) => void (d.nodes[id].fill = { color: hex })));
        return feedback(`Fill set to ${hex}`, { id: "tool.eyedropper" });
      }
      // Nothing selected: keep the colour for pasting into a field.
      void navigator.clipboard?.writeText(hex).catch(() => {});
      feedback(`Copied ${hex}`, { id: "tool.eyedropper" });
    },
    enabled: needCanvas,
    keywords: ["eyedropper", "color picker", "sample"],
  },
  {
    id: "tool.resources",
    label: "Assets",
    category: "tools",
    keys: [kb("⇧I")],
    run: () => s().setLeftTab("components"),
    keywords: ["resources", "components", "insert", "library"],
  },
  {
    id: "tool.focus-toolbar",
    label: "Focus next region",
    category: "tools",
    keys: [kb("F6"), kb("⇧F6")],
    run: ({ event }) => void cycleRegion(event?.shiftKey ? -1 : 1),
    context: "global",
    keywords: ["accessibility", "toolbar", "panels", "keyboard navigation"],
  },

  // ---------------------------------------------------------------- view
  flag("uiHidden", "view.toggle-ui", "Show/hide UI", [kb("⌘\\")], {
    category: "essential",
    run: () => {
      const hide = !s().view.uiHidden;
      s().setView({ uiHidden: hide });
      if (hide) feedback(`Press ${keysText("view.toggle-ui")} to bring the UI back`, { id: "view.uiHidden" });
    },
    context: "global",
    keywords: ["hide interface", "presentation", "focus"],
  }),
  flag("rulers", "view.rulers", "Rulers", [kb("⇧R")]),
  flag("outlines", "view.outlines", "Outlines", [kb("⇧⌘O")], { keywords: ["wireframe", "outline mode"] }),
  flag("pixelPreview", "view.pixel-preview", "Pixel preview", [kb("⌃P")], { winKeys: [kb("⌃⌥P")], keywords: ["1x", "retina", "real pixels"] }),
  flag("pixelGrid", "view.pixel-grid", "Pixel grid", [kb("⌘'"), kb("⇧'")]),
  flag("snapToPixels", "view.snap-pixels", "Snap to pixel grid", [kb("⇧⌘'")]),
  flag("layoutGrids", "view.layout-grids", "Layout guides", [kb("⌃G"), kb("⇧G")], { winKeys: [kb("⌃⇧4"), kb("⇧G")], keywords: ["layout grids", "columns"] }),
  flag("agentCursors", "view.agent-cursors", "Qalam AI cursors", [kb("⌥⌘\\")], { keywords: ["multiplayer cursors", "agents"] }),
  flag("routeParts", "view.route-parts", "Prototype parts and wires", [], { keywords: ["prototype", "connections", "noodles", "sheets", "overlays", "states", "routes"] }),
  flag("sources", "view.sources", "Sources and wires", [], { keywords: ["sources", "evidence", "lane", "wires", "connections", "where it came from"] }),
  {
    id: "view.minimize-ui",
    label: "Minimize UI",
    category: "view",
    keys: [kb("⇧⌘\\")],
    run: () => s().setLeftOpen(!s().leftOpen),
    checked: () => !s().leftOpen,
    context: "global",
    keywords: ["collapse panels"],
  },
  na("view.comments", "Show/hide comments", "view", [kb("⇧C")], "Qalam has no comments"),
  na("view.dev-mode", "Dev Mode", "view", [kb("⇧D")], "Qalam has no Dev Mode"),
  na("view.collapse-layers", "Collapse layers", "view", [kb("⌥L")], SOON),

  // ---------------------------------------------------------------- panels
  panel("layers", "panels.layers", "Show Layers", [kb("⌥1")]),
  panel("components", "panels.assets", "Show Assets", [kb("⌥2")]),
  panel("tokens", "panels.tokens", "Show Tokens", [kb("⌥3")]),
  panel("knowledge", "panels.knowledge", "Show Library", [kb("⌥4")]),
  {
    id: "panels.design",
    label: "Show Design panel",
    category: "panels",
    keys: [kb("⌥8")],
    run: () => showRight("design"),
    checked: () => isDiscovery() || rightTab() === "design",
    keywords: ["properties", "inspector"],
  },
  {
    id: "panels.prototype",
    label: "Show Prototype panel",
    category: "panels",
    keys: [kb("⌥9")],
    run: () => showRight("prototype"),
    enabled: () => (isDiscovery() ? "Not on a Discovery board" : true),
    checked: () => !isDiscovery() && rightTab() === "prototype",
    keywords: ["interactions", "links", "states", "tracks", "flow", "smart animate", "transition"],
  },
  na("panels.code", "Show Code panel", "panels", [kb("⌥0")], "Qalam has no Dev Mode"),
  {
    id: "panels.design-prototype",
    label: "Switch Design / Prototype",
    category: "panels",
    keys: [kb("⇧E")],
    run: () => setRightTab(rightTab() === "design" ? "prototype" : "design"),
    enabled: () => (isDiscovery() ? "Not on a Discovery board" : true),
    keywords: ["tab", "interactions", "properties"],
  },

  // ---------------------------------------------------------------- zoom
  {
    id: "zoom.in",
    label: "Zoom in",
    category: "zoom",
    // "+" shows bare, like Figma's menus (= and ⇧= are the same key on most layouts).
    keys: [kb("=", "+"), kb("⇧=", "+"), alsoInText(kb("⌘=")), alsoInText(kb("⇧⌘=", "+")), kb("Num+"), alsoInText(kb("⌘Num+"))],
    run: () => canvas()?.zoomStep(2),
    enabled: needCanvas,
    repeat: true,
  },
  {
    id: "zoom.out",
    label: "Zoom out",
    category: "zoom",
    keys: [kb("-"), alsoInText(kb("⌘-")), kb("Num-"), alsoInText(kb("⌘Num-"))],
    run: () => canvas()?.zoomStep(0.5),
    enabled: needCanvas,
    repeat: true,
  },
  { id: "zoom.100", label: "Zoom to 100%", category: "zoom", keys: [kb("⇧0"), alsoInText(kb("⌘0"))], run: () => canvas()?.zoomKeyTo(1), enabled: needCanvas, keywords: ["actual size", "reset zoom"] },
  { id: "zoom.fit", label: "Zoom to fit", category: "zoom", keys: [kb("⇧1")], run: () => canvas()?.glideToFit(), enabled: needCanvas, keywords: ["show all", "overview"] },
  {
    id: "zoom.selection",
    label: "Zoom to selection",
    category: "zoom",
    keys: [kb("⇧2")],
    run: () => canvas()?.glideToFit(sel()),
    enabled: () => (canvas() ? needSelection() : "The canvas isn't ready yet"),
  },
  {
    id: "zoom.next-frame",
    label: "Zoom to next frame",
    category: "zoom",
    keys: [kb("n")],
    run: () => goToFrame(1, false),
    enabled: () => (s().doc.roots.length ? true : "Add a frame first"),
    repeat: true,
  },
  {
    id: "zoom.prev-frame",
    label: "Zoom to previous frame",
    category: "zoom",
    keys: [kb("⇧N")],
    run: () => goToFrame(-1, false),
    enabled: () => (s().doc.roots.length ? true : "Add a frame first"),
    repeat: true,
  },
  { id: "zoom.next-frame-pan", label: "Go to next frame", category: "zoom", keys: [kb("End")], run: () => goToFrame(1, true), enabled: () => (s().doc.roots.length ? true : "Add a frame first"), repeat: true },
  { id: "zoom.prev-frame-pan", label: "Go to previous frame", category: "zoom", keys: [kb("Home")], run: () => goToFrame(-1, true), enabled: () => (s().doc.roots.length ? true : "Add a frame first"), repeat: true },
  // Pages: the Components page comes last in Screens projects.
  { id: "page.prev", label: "Previous page", category: "zoom", keys: [kb("PgUp")], run: () => void pages().then((m) => m.stepPage(-1, projectType() === "screens")), enabled: notOnBoard, keywords: ["page up"] },
  { id: "page.next", label: "Next page", category: "zoom", keys: [kb("PgDn")], run: () => void pages().then((m) => m.stepPage(1, projectType() === "screens")), enabled: notOnBoard, keywords: ["page down"] },
  { id: "page.add", label: "Add page", category: "file", run: () => void pages().then((m) => m.newPage()), enabled: notOnBoard, keywords: ["new page", "pages"] },
  {
    id: "page.components",
    label: "Go to Components page",
    category: "zoom",
    run: () => void pages().then((m) => m.goToPage(COMPONENTS_PAGE)),
    enabled: () => (projectType() === "screens" ? true : "Screens projects have a Components page"),
    keywords: ["library", "components", "design system", "pages"],
  },
  gesture("zoom.tool", "Zoom tool: click to zoom in, ⌥-click out, drag a box", "zoom", ["Hold Z"]),
  gesture("zoom.scroll", "Zoom with scroll or pinch", "zoom", ["⌘", "Scroll"]),

  // ---------------------------------------------------------------- text
  {
    id: "text.edit",
    label: "Edit text",
    category: "text",
    keys: [kb("↵")],
    run: () => s().setEditingText(sel()[0]),
    enabled: () => (sel().length === 1 && s().doc.nodes[sel()[0]]?.type === "text" && !s().doc.nodes[sel()[0]].locked ? true : "Select a text layer"),
    hidden: true,
  },
  {
    id: "text.exit",
    label: "Stop editing text",
    category: "text",
    keys: [kb("Esc"), kb("⌘↵")],
    run: () => s().setEditingText(null),
    context: "text-edit",
    hidden: true,
  },
  { id: "text.bold", label: "Bold", category: "text", keys: [kb("⌘B")], run: () => void toggleBold(textTargets()), enabled: needText, inText: true, keywords: ["weight"] },
  {
    id: "text.italic",
    label: "Italic",
    category: "text",
    keys: [kb("⌘I")],
    run: () => void toggleItalic(textTargets()),
    enabled: needText,
    checked: () => !!(s().doc.nodes[textTargets()[0]] as TextNode | undefined)?.text?.italic,
    inText: true,
    keywords: ["slant", "oblique"],
  },
  ...(["underline", "strikethrough"] as const).map(
    (kind): Command => ({
      id: `text.${kind}`,
      label: kind === "underline" ? "Underline" : "Strikethrough",
      category: "text",
      keys: [kind === "underline" ? kb("⌘U") : kb("⇧⌘X")],
      run: () => void toggleDecoration(textTargets(), kind),
      enabled: needText,
      checked: () => (s().doc.nodes[textTargets()[0]] as TextNode | undefined)?.text?.decoration === kind,
      inText: true,
      keywords: kind === "underline" ? ["decoration"] : ["decoration", "line through", "strike"],
    }),
  ),
  ...(["left", "center", "right"] as const).map(
    (side): Command => ({
      id: `text.align-${side}`,
      label: `Text align ${side}`,
      category: "text",
      keys: [kb(side === "left" ? "⌥⌘L" : side === "center" ? "⌥⌘T" : "⌥⌘R")],
      run: () => alignText(textTargets(), side, resolvedDirection),
      enabled: needText,
      checked: () => {
        const n = s().doc.nodes[textTargets()[0]] as TextNode | undefined;
        if (n?.type !== "text") return false;
        if (side === "center") return n.text.align === "center";
        const rtl = resolvedDirection(n.text) === "rtl";
        return n.text.align === ((side === "left") !== rtl ? "start" : "end");
      },
      inText: true,
    }),
  ),
  {
    id: "text.align-justify",
    label: "Text align justified",
    category: "text",
    keys: [kb("⌥⌘J")],
    run: () => void toggleJustify(textTargets()),
    enabled: needText,
    checked: () => (s().doc.nodes[textTargets()[0]] as TextNode | undefined)?.text?.align === "justify",
    inText: true,
  },
  textStep("size", 1, "Increase font size", "⇧⌘", ["bigger", "larger"]),
  textStep("size", -1, "Decrease font size", "⇧⌘", ["smaller"]),
  textStep("weight", 1, "Increase font weight", "⌥⌘", ["bolder"]),
  textStep("weight", -1, "Decrease font weight", "⌥⌘", ["lighter"]),
  textStep("line-height", 1, "Increase line height", "⌥⇧", ["leading"]),
  textStep("line-height", -1, "Decrease line height", "⌥⇧", ["leading"]),
  textStep("letter-spacing", 1, "Increase letter spacing", "⌥", ["tracking", "kerning"]),
  textStep("letter-spacing", -1, "Decrease letter spacing", "⌥", ["tracking", "kerning"]),
  { id: "text.bulleted-list", label: "Bulleted list", category: "text", keys: [kb("⇧⌘8")], run: () => toggleList(textTargets(), "bullet"), enabled: needText, inText: true, keywords: ["bullets", "unordered"] },
  { id: "text.numbered-list", label: "Numbered list", category: "text", keys: [kb("⇧⌘7")], run: () => toggleList(textTargets(), "number"), enabled: needText, inText: true, keywords: ["numbers", "ordered"] },
  na("text.link", "Create link", "text", [kb("⇧⌘U")], "Text in Qalam has no links"),
  // The text editor is a plain textarea, so every paste there already matches the style.
  { id: "text.paste-match-style", label: "Paste and match style", category: "text", keys: [kb("⌥⇧⌘V")], run: () => {}, context: "text-edit", native: true, hidden: true },

  // ---------------------------------------------------------------- shape
  {
    id: "shape.remove-fill",
    label: "Remove fill",
    category: "shape",
    keys: [kb("⌥/")],
    run: () => void (removeFill(editable()) || feedback("Nothing to remove: text and icons keep their colour", { id: "shape.remove-fill" })),
    enabled: needEditable,
  },
  {
    id: "shape.remove-stroke",
    label: "Remove stroke",
    category: "shape",
    keys: [kb("⇧/")],
    run: () => void removeStroke(editable()),
    enabled: needEditable,
  },
  { id: "shape.swap-fill-stroke", label: "Swap fill and stroke", category: "shape", keys: [kb("⇧X")], run: () => void swapFillStroke(editable()), enabled: needEditable },
  na("shape.outline-stroke", "Outline stroke", "shape", [kb("⌥⌘O")], SOON),
  na("shape.flatten", "Flatten", "shape", [kb("⌘E")], SOON),
  na("shape.union", "Union selection", "shape", [kb("⌥⇧U")], SOON, { keywords: ["boolean"] }),
  na("shape.subtract", "Subtract selection", "shape", [kb("⌥⇧S")], SOON, { keywords: ["boolean"] }),
  na("shape.intersect", "Intersect selection", "shape", [kb("⌥⇧I")], SOON, { keywords: ["boolean"] }),
  na("shape.exclude", "Exclude selection", "shape", [kb("⌥⇧E")], SOON, { keywords: ["boolean"] }),
  na("shape.mask", "Use as mask", "shape", [kb("⌃⌘M")], SOON, { winKeys: [kb("⌃⌥M")] }),
  gesture("shape.opacity", "Set opacity (1 = 10%, 0 = 100%, two digits = exact)", "shape", ["0", "–", "9"], { hidden: false }),
  {
    id: "shape.opacity-digit",
    label: "Set opacity",
    category: "shape",
    keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((d) => kb(d)),
    run: ({ event }) => opacityKey(event?.code.slice(5) ?? "0", event?.timeStamp ?? performance.now()),
    enabled: needEditable,
    hidden: true,
  },

  // ---------------------------------------------------------------- vector editing (handled by the vector tools)
  {
    id: "vector.edit",
    label: "Edit object",
    category: "vector",
    keys: [kb("↵")],
    run: () => void useVectorEdit.getState().enter(sel()[0]),
    enabled: () => (sel().length === 1 && canEditVector(sel()[0]) ? true : "Select a vector layer"),
    keywords: ["edit points", "vector edit mode"],
  },
  gesture("vector.pen-constrain", "Pen: constrain to 45°", "vector", ["⇧", "Drag"]),
  gesture("vector.pen-break-handle", "Pen: break handle symmetry", "vector", ["⌥", "Drag"]),
  gesture("vector.bend", "Bend (in edit mode)", "vector", ["Hold ⌘"]),
  na("vector.lasso", "Lasso select points", "vector", [kb("q")], SOON, { context: "vector-edit", hidden: true }),
  { id: "vector.paint", label: "Paint bucket", category: "vector", keys: [kb("⇧B")], run: () => {}, context: "vector-edit", hidden: true },
  { id: "vector.join", label: "Join selection", category: "vector", keys: [kb("⌘J")], run: () => {}, context: "vector-edit", hidden: true },
  { id: "vector.smooth-join", label: "Smooth join selection", category: "vector", keys: [kb("⇧⌘J")], run: () => {}, context: "vector-edit", hidden: true },
  { id: "vector.delete-heal", label: "Delete and heal", category: "vector", keys: [kb("⇧⌫")], run: () => {}, context: "vector-edit", hidden: true },

  // ---------------------------------------------------------------- selection
  { id: "select.all", label: "Select all", category: "selection", keys: [kb("⌘A")], run: () => s().select(selectAllAtLevel(s().doc, sel())) },
  { id: "select.inverse", label: "Select inverse", category: "selection", keys: [kb("⇧⌘A")], run: () => s().select(inverseOf(s().doc, sel())), enabled: needSelection },
  {
    id: "select.matching",
    label: "Select matching layers",
    category: "selection",
    keys: [kb("⌥⌘A")],
    run: () => {
      const ids = matchingOf(s().doc, sel());
      s().select(ids);
      feedback(ids.length === 1 ? "No other matching layers" : `${ids.length} matching layers`, { id: "select.matching" });
    },
    enabled: needSelection,
    keywords: ["same", "similar", "select all with"],
  },
  {
    id: "select.none",
    label: "Deselect all",
    category: "selection",
    keys: [kb("Esc")],
    // Like Figma: Esc first puts down the current tool, then lets go of the selection.
    run: () => (s().tool !== "select" ? s().setTool("select") : s().select([])),
    hidden: true,
  },
  {
    id: "select.children",
    label: "Select children",
    category: "selection",
    keys: [kb("↵")],
    run: () => s().select(childrenOf(s().doc, sel())),
    enabled: () => (sel().some((id) => s().doc.nodes[id]?.children.length) ? true : "Select a frame with layers in it"),
  },
  {
    id: "select.parent",
    label: "Select parent",
    category: "selection",
    keys: [kb("⇧↵"), kb("\\")],
    run: () => s().select(parentsOf(s().doc, sel())),
    enabled: () => (sel().some((id) => s().doc.nodes[id]?.parentId) ? true : "Select a layer inside a frame"),
  },
  { id: "select.next-sibling", label: "Select next layer", category: "selection", keys: [kb("⇥")], run: () => s().select(siblingStep(s().doc, sel(), 1)), repeat: true },
  { id: "select.prev-sibling", label: "Select previous layer", category: "selection", keys: [kb("⇧⇥")], run: () => s().select(siblingStep(s().doc, sel(), -1)), repeat: true },
  gesture("select.deep-click", "Deep select", "selection", ["⌘", "Click"]),
  gesture("select.shift-click", "Add to selection", "selection", ["⇧", "Click"]),
  gesture("select.deep-marquee", "Deep select within marquee", "selection", ["⌘", "Drag"]),
  na("select.layer-menu", "Select layer menu", "selection", null, SOON, { gesture: ["⌘", "Right-click"] }),
  na("select.keyboard-box", "Keyboard box selection", "selection", [kb("⌥Space")], SOON),

  // ---------------------------------------------------------------- cursor
  gesture("cursor.pan", "Pan", "cursor", ["Space", "Drag"]),
  na("cursor.measure", "Measure distance to selection", "cursor", null, SOON, { gesture: ["⌥", "Hover"] }),
  gesture("cursor.duplicate-drag", "Duplicate while dragging", "cursor", ["⌥", "Drag"]),
  gesture("cursor.constrain-move", "Move along one axis", "cursor", ["⇧", "Drag"]),
  gesture("cursor.resize-center", "Resize from center", "cursor", ["⌥", "Drag"]),
  gesture("cursor.resize-proportional", "Resize proportionally", "cursor", ["⇧", "Drag"]),
  gesture("cursor.draw-square", "Draw with 1:1 ratio", "cursor", ["⇧", "Drag"]),
  gesture("cursor.draw-center", "Draw from center", "cursor", ["⌥", "Drag"]),
  gesture("cursor.move-while-drawing", "Reposition while drawing", "cursor", ["Space", "Drag"]),
  gesture("cursor.ignore-snapping", "Ignore smart guides", "cursor", ["⌃", "Drag"]),
  gesture("cursor.prevent-nesting", "Don't nest into frames (hold at the drop)", "cursor", ["Drag", "Space"]),
  na("cursor.ignore-constraints", "Ignore constraints", "cursor", null, "Qalam has no constraints", { gesture: ["⌘", "Drag"] }),
  na("cursor.rotate-snap", "Rotate in 15° steps", "cursor", null, SOON, { gesture: ["⇧", "Drag"] }),
  na("cursor.crop-image", "Crop image", "cursor", null, SOON, { gesture: ["⌥", "Double-click"] }),
  gesture("cursor.scrub", "Scrub a number field", "cursor", ["Drag label"]),

  // ---------------------------------------------------------------- edit
  { id: "edit.undo", label: "Undo", category: "edit", keys: [kb("⌘Z")], run: () => s().undo(), enabled: () => (s().past.length ? true : "Nothing to undo"), repeat: true },
  {
    id: "edit.redo",
    label: "Redo",
    category: "edit",
    keys: [kb("⇧⌘Z")],
    winKeys: [kb("⇧⌘Z"), kb("⌘Y")],
    run: () => s().redo(),
    enabled: () => (s().future.length ? true : "Nothing to redo"),
    repeat: true,
  },
  // Clipboard keys stay native: the copy/cut/paste events after them carry the system clipboard.
  { id: "edit.copy", label: "Copy", category: "edit", keys: [kb("⌘C")], run: () => copySelection(), enabled: needSelection, native: true },
  {
    id: "edit.cut",
    label: "Cut",
    category: "edit",
    keys: [kb("⌘X")],
    run: () => {
      canvas()?.noteCut();
      cutSelection();
    },
    enabled: needEditable,
    native: true,
  },
  {
    id: "edit.paste",
    label: "Paste",
    category: "edit",
    keys: [kb("⌘V")],
    run: ({ source }) => {
      if (source === "keyboard") return; // the paste event places images or layers
      if (!hasClipboard()) return feedback("Nothing to paste: copy a layer first", { id: "edit.paste" });
      pasteClipboard();
    },
    native: true,
  },
  {
    id: "edit.paste-over",
    label: "Paste over selection",
    category: "edit",
    keys: [kb("⇧⌘V")],
    run: ({ source }) => {
      if (source === "keyboard") return canvas()?.notePasteOver();
      if (!hasClipboard()) return feedback("Nothing to paste: copy a layer first", { id: "edit.paste" });
      pasteClipboard({ over: true });
    },
    native: true,
  },
  {
    id: "edit.paste-replace",
    label: "Paste to replace",
    category: "edit",
    keys: [kb("⇧⌘R")],
    run: () => void pasteToReplace(),
    enabled: () => (needClip() === true ? needEditable() : needClip()),
  },
  { id: "edit.duplicate", label: "Duplicate", category: "edit", keys: [kb("⌘D")], run: () => duplicate(sel()), enabled: needSelection, repeat: true },
  { id: "edit.delete", label: "Delete", category: "edit", keys: [kb("⌫"), kb("⌦")], run: () => deleteNodes(editable()), enabled: needEditable },
  {
    id: "edit.copy-png",
    label: "Copy as PNG",
    category: "edit",
    keys: [kb("⇧⌘C")],
    run: async () => {
      const ok = await copySelectionPNG();
      feedback(ok ? "Copied as PNG" : "Couldn't copy: the browser blocked the clipboard", { kind: ok ? "success" : "error", id: "edit.copy-png" });
    },
    enabled: needSelection,
    keywords: ["image", "screenshot"],
  },
  {
    id: "edit.copy-properties",
    label: "Copy properties",
    category: "edit",
    keys: [kb("⌥⌘C")],
    run: () => void (copyProps(sel()) && feedback("Properties copied", { id: "edit.copy-properties" })),
    enabled: needSelection,
    keywords: ["style", "format painter"],
  },
  {
    id: "edit.paste-properties",
    label: "Paste properties",
    category: "edit",
    keys: [kb("⌥⌘V")],
    run: () => void pasteProps(editable()),
    enabled: () => (hasProps() ? needEditable() : `Copy a layer's properties first (${keysText("edit.copy-properties")})`),
    keywords: ["style", "format painter", "apply"],
  },
  {
    id: "edit.rename",
    label: "Rename",
    category: "edit",
    keys: [kb("⌘R")],
    run: () => {
      s().setLeftTab("layers");
      s().setRenaming(sel()[0]);
    },
    enabled: () => (sel().length ? true : "Select a layer first"),
  },
  na("edit.find", "Find", "edit", [kb("⌘F")], SOON, { keywords: ["search layers"] }),
  {
    id: "edit.export",
    label: "Export selection as PNG",
    category: "edit",
    keys: [kb("⇧⌘E")],
    run: () => {
      const n = exportSelectionPNG();
      if (n) feedback(n === 1 ? "Exported 1 PNG" : `Exported ${n} PNGs`, { kind: "success", id: "edit.export" });
    },
    enabled: needSelection,
    keywords: ["download", "png", "image"],
  },
  na("edit.save-version", "Save to version history", "edit", [kb("⌥⌘S")], "Qalam saves as you work; there's no version history"),
  {
    id: "edit.save",
    label: "Save",
    category: "file",
    keys: [kb("⌘S")],
    run: () => feedback("Saved automatically", { kind: "success", id: "edit.save" }),
    context: "global",
    hidden: true,
  },
  na("edit.copy-link", "Copy link to selection", "edit", null, "Qalam layers have no links", { gesture: ["⌘", "L"] }),
  { id: "edit.nudge", label: "Nudge", category: "edit", keys: arrowKeys(""), run: ({ event }) => nudge(event?.key, 1), enabled: needEditable, repeat: true, hidden: true },
  { id: "edit.nudge-big", label: "Nudge 10px", category: "edit", keys: arrowKeys("⇧"), run: ({ event }) => nudge(event?.key, 10), enabled: needEditable, repeat: true, hidden: true },
  {
    id: "edit.resize",
    label: "Resize (⌘→ wider, ⌘↓ taller)",
    category: "edit",
    keys: [...arrowKeys("⌘"), ...arrowKeys("⇧⌘")],
    run: ({ event }) => {
      const a = event ? ARROWS[event.key] : undefined;
      const step = event?.shiftKey ? 10 : 1;
      if (a) resizeBy(editable(), a.dx * step, a.dy * step);
    },
    enabled: needEditable,
    repeat: true,
    hidden: true,
  },

  // ---------------------------------------------------------------- transform
  { id: "transform.flip-h", label: "Flip horizontal", category: "transform", keys: [kb("⇧H")], run: () => void flipNodes(editable(), "h"), enabled: needEditable, keywords: ["mirror"] },
  { id: "transform.flip-v", label: "Flip vertical", category: "transform", keys: [kb("⇧V")], run: () => void flipNodes(editable(), "v"), enabled: needEditable, keywords: ["mirror"] },
  na("transform.rotate", "Rotate", "transform", [kb("⌥⌘↑"), kb("⌥⌘↓")], SOON),

  // ---------------------------------------------------------------- arrange
  { id: "arrange.bring-forward", label: "Bring forward", category: "arrange", keys: [kb("⌘]")], run: () => reorderMany(sel(), "forward"), enabled: needSelection, repeat: true },
  { id: "arrange.send-backward", label: "Send backward", category: "arrange", keys: [kb("⌘[")], run: () => reorderMany(sel(), "backward"), enabled: needSelection, repeat: true },
  { id: "arrange.bring-front", label: "Bring to front", category: "arrange", keys: [kb("⌥⌘]")], winKeys: [kb("⇧⌘]")], run: () => reorderMany(sel(), "front"), enabled: needSelection },
  { id: "arrange.send-back", label: "Send to back", category: "arrange", keys: [kb("⌥⌘[")], winKeys: [kb("⇧⌘[")], run: () => reorderMany(sel(), "back"), enabled: needSelection },
  align("left", "Align left", "A"),
  align("right", "Align right", "D"),
  align("top", "Align top", "W"),
  align("bottom", "Align bottom", "S"),
  align("hcenter", "Align horizontal centers", "H"),
  align("vcenter", "Align vertical centers", "V"),
  {
    id: "arrange.distribute-h",
    label: "Distribute horizontal spacing",
    category: "arrange",
    keys: [kb("⌃⌥H")],
    winKeys: [kb("⌥⇧H")],
    run: () => distributeNodes(sel(), "h"),
    enabled: () => (topLevelOf(s().doc, sel()).length >= 3 ? true : "Select 3+ layers"),
  },
  {
    id: "arrange.distribute-v",
    label: "Distribute vertical spacing",
    category: "arrange",
    keys: [kb("⌃⌥V")],
    winKeys: [kb("⌥⇧V")],
    run: () => distributeNodes(sel(), "v"),
    enabled: () => (topLevelOf(s().doc, sel()).length >= 3 ? true : "Select 3+ layers"),
  },
  {
    id: "arrange.tidy-up",
    label: "Tidy up",
    category: "arrange",
    keys: [kb("⌃⌥T")],
    // Ctrl+Alt+T is text align center there.
    winKeys: [],
    run: () => void tidyUp(sel()),
    enabled: () => (topLevelOf(s().doc, sel()).length >= 2 ? true : "Select 2+ layers"),
    keywords: ["grid", "arrange", "spacing", "even"],
  },
  {
    id: "arrange.group",
    label: "Group selection",
    category: "arrange",
    keys: [kb("⌘G")],
    run: () => void groupSelection(sel()),
    enabled: needSelection,
    keywords: ["combine"],
  },
  {
    id: "arrange.ungroup",
    label: "Ungroup selection",
    category: "arrange",
    keys: [kb("⇧⌘G"), kb("⌘⌫")],
    run: () => void ungroupSelection(sel()),
    enabled: () => (sel().some((id) => s().doc.nodes[id]?.type === "frame" && s().doc.nodes[id].children.length) ? true : "Select a group or a frame with layers"),
    keywords: ["remove frame", "release", "split"],
  },
  {
    id: "arrange.frame-selection",
    label: "Frame selection",
    category: "arrange",
    keys: [kb("⌥⌘G")],
    run: () => frameSelection(sel(), (b) => makeFrame({ ...b, name: "Frame", fill: null })),
    enabled: needSelection,
    keywords: ["wrap", "group"],
  },
  {
    id: "arrange.hide",
    label: "Show/hide selection",
    category: "arrange",
    keys: [kb("⇧⌘H")],
    run: () => void toggleVisible(sel()),
    enabled: needSelection,
    keywords: ["visibility", "hide", "show"],
  },
  {
    id: "arrange.lock",
    label: "Lock/unlock selection",
    category: "arrange",
    keys: [kb("⇧⌘L")],
    run: () => void toggleLocked(sel()),
    enabled: needSelection,
  },
  {
    id: "arrange.resize-to-fit",
    label: "Resize to fit",
    category: "arrange",
    keys: [kb("⌥⇧⌘R")],
    run: () => void (resizeToFit(sel()) || feedback("Already fits its content", { id: "arrange.resize-to-fit" })),
    enabled: () => (sel().some((id) => { const n = s().doc.nodes[id]; return n?.type === "frame" && !isGroup(n) && n.children.length > 0; }) ? true : "Select a frame with layers in it"),
    keywords: ["hug", "shrink", "fit content"],
  },

  // ---------------------------------------------------------------- auto layout
  { id: "autolayout.add", label: "Add auto layout", category: "auto-layout", keys: [kb("⇧A")], run: () => addAutoLayout(sel()), enabled: needSelection, keywords: ["stack", "flex"] },
  { id: "autolayout.remove", label: "Remove auto layout", category: "auto-layout", keys: [kb("⌥⇧A")], run: () => removeAutoLayout(sel()), enabled: needSelection },
  na("autolayout.suggest", "Suggest auto layout", "auto-layout", [kb("⌃⇧A")], "Ask Qalam AI instead", { winKeys: [] }),

  // ---------------------------------------------------------------- components
  na("components.create", "Create component", "components", [kb("⌥⌘K")], SOON),
  {
    id: "components.detach",
    label: "Detach instance",
    category: "components",
    keys: [kb("⌥⌘B")],
    run: () => {
      const n = detachInstances(sel());
      feedback(n === 1 ? "Instance detached" : `${n} instances detached`, { kind: "success", id: "components.detach" });
    },
    enabled: () => (sel().some((id) => instanceRootOf(s().doc, id)) ? true : "Select a component instance"),
    keywords: ["unlink", "break"],
  },
  na("components.swap", "Swap instance", "components", null, "Place a new instance from Assets instead", { gesture: ["⌥", "Drag"] }),

  // ---------------------------------------------------------------- prototype & Dev Mode
  {
    id: "prototype.present",
    label: "Present",
    category: "view",
    keys: [kb("⌥⌘↵")],
    run: () => openPrototype(),
    enabled: canPrototype,
    keywords: ["prototype", "play", "preview", "animate", "motion", "code", "tsx"],
  },
  {
    id: "prototype.preview",
    label: "Preview prototype",
    category: "view",
    keys: [kb("⇧Space")],
    run: () => openPrototype(),
    enabled: canPrototype,
    keywords: ["prototype", "play", "present"],
  },

  // ---------------------------------------------------------------- file
  { id: "file.open", label: "Open document JSON…", category: "file", run: () => openDocJSON(), keywords: ["import", "load"] },
  { id: "file.export-json", label: "Export document JSON", category: "file", run: () => exportDocJSON(), keywords: ["download", "save", "backup"] },
];

/** Figma's "Essential" tab: the shortcuts everyone should know, drawn from the other tabs. */
export const ESSENTIAL: string[] = [
  "essential.actions",
  "essential.shortcuts",
  "view.toggle-ui",
  "tool.eyedropper",
  "ai.chat",
  "tool.select",
  "tool.frame",
  "tool.pen",
  "tool.text",
  "zoom.fit",
  "edit.duplicate",
  "arrange.frame-selection",
  "autolayout.add",
];

registerCommands(CATALOG);
