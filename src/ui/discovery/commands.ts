import { feedback } from "@/commands/feedback";
import { getCommand, kb, registerCommands, setCommandGuard, type Command } from "@/commands/registry";
import { studio } from "@/doc/store";
import { isNote, isOstCard, treeRootOf } from "@/doc/board";
import { worldBounds } from "@/doc/geometry";
import { deleteNodes, topLevelOf } from "@/doc/ops";
import { addCardIn, addChild, addSibling, cardOf, deleteKeepIn, makeCardNode, newCard, reorderCardIn, setStage, setTargetIn, toggleCollapsed, updateCardIn } from "@/discovery/ops";
import { neighbor, type Dir } from "@/discovery/navigate";
import { allCards } from "@/discovery/tree";
import { isAssumed } from "@/discovery/evidence";
import { CHILD_KINDS, KIND_LABEL, KIND_NOUN, STAGES, canHold } from "@/discovery/kinds";
import type { OstKind } from "@/discovery/types";
import { commandCanvas } from "@/commands/canvas";
import { useDiscovery } from "./store";
import { startTitleEdit } from "./editing";
import { useSources } from "./sources";
import { mapQuotes } from "./import";
import { acceptAll, discardAll, reviewing } from "./review";
import { placeFor } from "./draft";
import { openBrainDump } from "./dump";
import { openCompare } from "./CompareView";
import { copyBoardSummary } from "./summary";
import { canCompare } from "@/discovery/compare";

/*
 * Discovery's commands, registered when a Discovery board boots (a page holds one project, so
 * Screens projects never see them). Keys a Figma command also has (⇥, ↵, arrows, ⌫, ⌘R) carry a
 * priority: they win while a tree card is selected and fall through to the Figma command otherwise.
 * The guard turns off what would break a card's place in the tree (resize, group, align, auto layout…).
 */

const s = studio;
const sel = () => s().selection;
const cards = () => sel().filter((id) => isOstCard(s().doc.nodes[id]));
/** The one card selected (nothing else). */
const oneCard = () => (sel().length === 1 && cards().length === 1 ? cards()[0] : null);
const lastCard = () => cards()[cards().length - 1] ?? null;
const needCard = () => (cards().length ? true : "Select a card");
const needOneCard = () => (oneCard() ? true : "Select one card");
const ofKind = (k: OstKind) => () => (oneCard() && cardOf(s().doc, oneCard())?.kind === k ? true : `Select ${KIND_NOUN[k]}`);

const PRIORITY = 1;
const PLURAL: Record<OstKind, string> = { outcome: "outcomes", opportunity: "opportunities", solution: "solutions", test: "tests" };

/** Scroll a card into view if a new or chosen one is off screen (zoom stays). */
export function keepOnScreen(id: string) {
  requestAnimationFrame(() => {
    const c = commandCanvas();
    const { doc, camera } = s();
    if (!c || !doc.nodes[id]) return;
    const b = worldBounds(doc, id);
    const m = 72 / camera.zoom;
    const vw = c.viewport.w / camera.zoom;
    const vh = c.viewport.h / camera.zoom;
    let { x, y } = camera;
    if (b.x < x + m) x = b.x - m;
    else if (b.x + b.w > x + vw - m) x = b.x + b.w + m - vw;
    if (b.y < y + m) y = b.y - m;
    else if (b.y + b.h > y + vh - m) y = b.y + b.h + m - vh;
    if (x !== camera.x || y !== camera.y) c.panTo({ x, y, zoom: camera.zoom }, 200);
  });
}

/** A new card made by a key or a button: select it and start typing its title (one undo step with it). */
function created(id: string | null, undo: () => void, why: string) {
  if (!id) {
    undo();
    feedback(why, { id: "discovery.add" });
    return;
  }
  s().select([id]);
  startTitleEdit(id, true);
  keepOnScreen(id);
}

export function addChildCard(parent: string, kind?: OstKind) {
  const c = cardOf(s().doc, parent);
  if (!c) return;
  s().beginTx();
  // Adding under a folded card unfolds it.
  if (c.collapsed) s().mutate((d) => updateCardIn(d, parent, (k) => void delete k.collapsed));
  const id = addChild(parent, kind);
  created(id, () => s().cancelTx(), CHILD_KINDS[c.kind].length ? `${KIND_LABEL[c.kind]} cards hold ${CHILD_KINDS[c.kind].map((k) => PLURAL[k]).join(" and ")}` : "Tests hold no other cards");
}

export function addSiblingCard(of: string) {
  s().beginTx();
  created(addSibling(of), () => s().cancelTx(), "Tests hold no other cards");
}

function walk(dir: Dir) {
  const from = lastCard();
  if (!from) return;
  const next = neighbor(s().doc, from, dir);
  if (!next) return;
  s().select([next]);
  keepOnScreen(next);
}

function deleteSelected() {
  const doc = s().doc;
  const ids = topLevelOf(doc, sel()).filter((id) => !doc.nodes[id].locked);
  let n = 0;
  const count = (id: string) => {
    if (isOstCard(doc.nodes[id])) n++;
    doc.nodes[id]?.children.forEach(count);
  };
  ids.forEach(count);
  deleteNodes(ids);
  if (n) feedback(n === 1 ? "Deleted 1 card" : `Deleted ${n} cards`, { id: "discovery.delete" });
}

const stageCommands = (): Command[] =>
  (Object.keys(STAGES) as OstKind[]).flatMap((kind) =>
    STAGES[kind].map(
      (st): Command => ({
        id: `discovery.stage.${st.value}`,
        label: `${KIND_LABEL[kind]} stage: ${st.label}`,
        category: "discovery",
        keywords: ["stage", "status", st.label.toLowerCase(), kind],
        enabled: () => (cards().length && cards().every((id) => cardOf(s().doc, id)?.kind === kind) ? true : `Select ${KIND_NOUN[kind]}`),
        checked: () => cards().length > 0 && cards().every((id) => cardOf(s().doc, id)?.stage === st.value),
        run: () => {
          if (st.value === "target") return makeTarget();
          setStage(cards(), st.value);
        },
      }),
    ),
  );

function makeTarget() {
  const id = oneCard();
  if (!id) return;
  let was: string | null = null;
  s().mutate((d) => void (was = setTargetIn(d, id)));
  if (was !== null) feedback(was ? `Target moved from “${was}”` : "Target moved", { id: "discovery.target" });
}

const addKind = (k: OstKind): Command => ({
  id: `discovery.add-${k}`,
  label: `Add ${KIND_NOUN[k]}`,
  category: "discovery",
  keywords: ["add", "new", k],
  enabled: () => {
    const id = oneCard();
    if (!id) return "Select the card it goes under";
    const c = cardOf(s().doc, id)!;
    return canHold(c.kind, k) ? true : `${KIND_LABEL[c.kind]} cards don't hold ${PLURAL[k]}`;
  },
  run: () => addChildCard(oneCard()!, k),
});

const unavailable = (id: string, reason: string) => {
  const c = getCommand(id);
  return c ? [{ ...c, enabled: undefined, unavailable: reason }] : [];
};

/** Commands that would break a card's place in the tree, off while a card is selected. */
const BLOCKED_CATEGORIES = new Set(["arrange", "transform", "auto-layout", "shape", "vector", "text", "components"]);
const BLOCKED_IDS = new Set(["edit.copy-properties", "edit.paste-properties", "edit.paste-replace", "edit.paste-over", "select.children", "select.parent", "edit.nudge", "edit.nudge-big", "text.edit", "vector.edit"]);

export function registerDiscoveryCommands() {
  registerCommands([
    {
      id: "tool.card",
      label: "Card",
      category: "tools",
      keys: [kb("c")],
      keywords: ["opportunity", "solution", "outcome", "tree", "node"],
      run: () => {
        s().setEditingText(null);
        s().setTool("card");
      },
      checked: () => s().tool === "card",
    },
    {
      id: "tool.sticky",
      label: "Sticky note",
      category: "tools",
      keys: [kb("s")],
      keywords: ["note", "post-it", "sticky"],
      run: () => {
        s().setEditingText(null);
        s().setTool("sticky");
      },
      checked: () => s().tool === "sticky",
    },
    {
      id: "discovery.add-child",
      label: "Add a card under it",
      category: "discovery",
      keys: [kb("⇥")],
      priority: PRIORITY,
      keywords: ["child", "new card", "branch"],
      enabled: needCard,
      run: () => addChildCard(oneCard() ?? lastCard()!),
    },
    {
      id: "discovery.add-sibling",
      label: "Add a card next to it",
      category: "discovery",
      keys: [kb("↵")],
      priority: PRIORITY,
      keywords: ["sibling", "new card"],
      enabled: needCard,
      run: () => addSiblingCard(oneCard() ?? lastCard()!),
    },
    {
      id: "discovery.edit-sticky",
      label: "Edit sticky",
      category: "discovery",
      keys: [kb("↵")],
      priority: PRIORITY,
      hidden: true,
      enabled: () => {
        const n = s().doc.nodes[sel()[0]];
        return sel().length === 1 && isNote(n) && n.meta.note.kind === "sticky" ? true : "Select a sticky";
      },
      run: () => {
        const n = s().doc.nodes[sel()[0]];
        const text = n?.children[0];
        if (text) s().setEditingText(text);
      },
    },
    {
      id: "discovery.edit-title",
      label: "Edit the card's title",
      category: "discovery",
      keys: [kb("F2"), kb("⌘R")],
      priority: PRIORITY,
      keywords: ["rename", "title", "type"],
      enabled: needOneCard,
      run: () => startTitleEdit(oneCard()!, false),
    },
    ...(["up", "down", "left", "right"] as const).map(
      (d): Command => ({
        id: `discovery.select-${d}`,
        label: `Select the card ${d === "up" ? "above" : d === "down" ? "below" : `to the ${d}`}`,
        category: "discovery",
        keys: [kb(d === "up" ? "↑" : d === "down" ? "↓" : d === "left" ? "←" : "→")],
        priority: PRIORITY,
        repeat: true,
        hidden: true,
        enabled: needCard,
        run: () => walk(d),
      }),
    ),
    {
      id: "discovery.move-earlier",
      label: "Move the card earlier",
      category: "discovery",
      keys: [kb("⌥←"), kb("⌥↑")],
      priority: PRIORITY,
      repeat: true,
      keywords: ["reorder", "move left", "move up"],
      enabled: needOneCard,
      run: () => s().mutate((d) => void reorderCardIn(d, oneCard()!, -1)),
    },
    {
      id: "discovery.move-later",
      label: "Move the card later",
      category: "discovery",
      keys: [kb("⌥→"), kb("⌥↓")],
      priority: PRIORITY,
      repeat: true,
      keywords: ["reorder", "move right", "move down"],
      enabled: needOneCard,
      run: () => s().mutate((d) => void reorderCardIn(d, oneCard()!, 1)),
    },
    {
      id: "discovery.collapse",
      label: "Fold or unfold the branch",
      category: "discovery",
      keys: [kb("⌥L")],
      priority: PRIORITY,
      keywords: ["collapse", "expand", "fold", "hide children"],
      enabled: needCard,
      run: () => {
        if (!toggleCollapsed(cards())) feedback("Nothing under it to fold", { id: "discovery.fold" });
      },
    },
    {
      id: "discovery.delete",
      label: "Delete the card and its branch",
      category: "discovery",
      keys: [kb("⌫"), kb("⌦")],
      priority: PRIORITY,
      keywords: ["remove"],
      enabled: needCard,
      run: deleteSelected,
    },
    {
      id: "discovery.delete-keep",
      label: "Delete the card, keep what's under it",
      category: "discovery",
      keys: [kb("⇧⌫")],
      priority: PRIORITY,
      keywords: ["remove", "unwrap"],
      enabled: needOneCard,
      run: () => {
        const id = oneCard()!;
        s().mutate((d) => deleteKeepIn(d, id));
        s().select([]);
      },
    },
    {
      id: "discovery.target",
      label: "Make it the target opportunity",
      category: "discovery",
      keywords: ["focus", "target", "priority"],
      enabled: ofKind("opportunity"),
      run: makeTarget,
    },
    {
      id: "discovery.orientation",
      label: "Lay the tree out left to right",
      category: "discovery",
      keywords: ["horizontal", "vertical", "direction", "layout", "mind map"],
      enabled: () => (treeOfSelection() ? true : "Add an outcome first"),
      checked: () => {
        const r = treeOfSelection();
        return !!r && cardOf(s().doc, r)?.orientation === "lr";
      },
      run: () => {
        const r = treeOfSelection();
        if (!r) return;
        s().mutate((d) => updateCardIn(d, r, (c) => (c.orientation === "lr" ? delete c.orientation : (c.orientation = "lr"))));
        requestAnimationFrame(() => commandCanvas()?.glideToFit());
      },
    },
    {
      id: "discovery.select-assumed",
      label: "Select the assumed opportunities",
      category: "discovery",
      keywords: ["evidence", "assumed", "unproven"],
      enabled: () => (allCards(s().doc).some((c) => isAssumed(c.card)) ? true : "No assumed opportunities"),
      run: () => {
        const ids = allCards(s().doc)
          .filter((c) => isAssumed(c.card) && s().doc.nodes[c.id].visible)
          .map((c) => c.id);
        s().select(ids);
        feedback(`${ids.length} assumed ${ids.length === 1 ? "opportunity" : "opportunities"}: attach evidence to make them solid`, { id: "discovery.assumed" });
      },
    },
    {
      id: "discovery.design-this",
      label: "Design this…",
      category: "discovery",
      keywords: ["screens", "generate", "handoff", "design"],
      enabled: ofKind("solution"),
      run: () => useDiscovery.setState({ designFor: oneCard() }),
    },
    {
      id: "discovery.redo-interview",
      label: "Redo the product interview…",
      category: "discovery",
      keywords: ["questions", "interview", "draft", "start over"],
      run: () => useDiscovery.setState({ sheet: "interview" }),
    },
    // Sources: what customers said, from documents, pages and connected tools.
    {
      id: "panels.sources",
      label: "Show Sources",
      category: "panels",
      keys: [kb("⌥2")],
      keywords: ["documents", "research", "evidence", "quotes"],
      run: () => s().setLeftTab("sources"),
      checked: () => s().leftOpen && s().leftTab === "sources",
    },
    {
      id: "discovery.add-source",
      label: "Add a source…",
      category: "discovery",
      keywords: ["import", "pdf", "word", "docx", "markdown", "page", "url", "interview notes", "research", "evidence"],
      run: () => {
        useSources.setState({ adding: true });
        s().setLeftTab("sources");
      },
    },
    {
      id: "discovery.map-quotes",
      label: "Map quotes to the tree",
      category: "discovery",
      keywords: ["synthesize", "evidence", "sources", "qalam ai", "opportunities"],
      enabled: () => (useSources.getState().list.some((x) => x.quotes.length) ? (useSources.getState().busy ? "Qalam AI is still reading" : true) : "Add a source with quotes first"),
      run: () => void mapQuotes(),
    },
    {
      id: "discovery.accept-proposals",
      label: "Accept all of Qalam AI's proposals",
      category: "discovery",
      keywords: ["review", "sources", "quotes"],
      enabled: () => (reviewing() ? true : "Nothing to review"),
      run: acceptAll,
    },
    {
      id: "discovery.discard-proposals",
      label: "Discard all of Qalam AI's proposals",
      category: "discovery",
      keywords: ["review", "sources", "quotes"],
      enabled: () => (reviewing() ? true : "Nothing to review"),
      run: discardAll,
    },
    { ...addKind("outcome"), label: "Add a sub-outcome", keywords: ["add", "new", "outcome", "sub-outcome", "goal", "sub-goal"] },
    addKind("opportunity"),
    addKind("solution"),
    addKind("test"),
    {
      id: "discovery.brain-dump",
      label: "Brain dump…",
      category: "discovery",
      keywords: ["paste", "notes", "thinking", "goals", "ideas", "distribute", "qalam ai"],
      enabled: () => (useDiscovery.getState().drafting ? "Qalam AI is drafting the tree" : true),
      run: () => openBrainDump(),
    },
    {
      id: "discovery.compare",
      label: "Compare the needs under it…",
      category: "discovery",
      keywords: ["compare", "target", "choose", "prioritize", "prioritise", "rank", "needs", "opportunities"],
      enabled: () => {
        const id = oneCard();
        return id && canCompare(s().doc, id) ? true : "Select a card with two needs or more under it";
      },
      run: () => {
        const id = oneCard();
        if (id) openCompare(id);
      },
    },
    {
      id: "discovery.summary",
      label: "Copy where the board stands",
      category: "discovery",
      keywords: ["share", "status", "summary", "report", "stakeholders", "update", "markdown", "copy"],
      run: () => void copyBoardSummary(),
    },
    {
      id: "discovery.new-tree",
      label: "New outcome tree",
      category: "discovery",
      keywords: ["add", "new", "outcome", "goal", "tree", "root"],
      run: () => {
        const node = makeCardNode(newCard("outcome"), placeFor(s().doc, null));
        s().beginTx();
        s().mutate((d) => addCardIn(d, node, null));
        created(node.id, () => s().cancelTx(), "");
      },
    },
    ...stageCommands(),
    // The layers panel is the tree's outline here, and Library holds the product's context.
    { ...getCommand("panels.layers")!, label: "Show Outline" },
    { ...getCommand("panels.knowledge")!, label: "Show product context" },
    // Screens tools and AI that have no place on a board.
    ...["ai.generate", "ai.import", "ai.audit", "ai.direction", "ai.tune", "ai.extract", "ai.critique"].flatMap((id) => unavailable(id, "Qalam AI works on the tree from its cards here")),
    ...["panels.assets", "panels.tokens", "tool.frame", "tool.pen", "tool.pencil", "tool.polygon", "tool.star", "tool.scale", "tool.resources"].flatMap((id) => unavailable(id, "Not on a Discovery board")),
  ]);
  setCommandGuard((c) => {
    if (c.category === "discovery" || !cards().length) return null;
    return BLOCKED_CATEGORIES.has(c.category) || BLOCKED_IDS.has(c.id) ? "Tree cards keep their place in the tree" : null;
  });
}

/** The tree the selection is in, else the board's first tree. */
function treeOfSelection(): string | null {
  const doc = s().doc;
  const id = cards()[0];
  if (id) return treeRootOf(doc, id);
  return doc.roots.find((r) => isOstCard(doc.nodes[r])) ?? null;
}

