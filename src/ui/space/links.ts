import { isOstCard } from "@/doc/board";
import { boundsOf, worldBounds } from "@/doc/geometry";
import { studio } from "@/doc/store";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { sameTopic } from "@/hub/topics";
import { useSpaceView } from "@/space/view";
import { glideToLayer, onCanvasReady } from "../discovery/canvas";
import { findWith, scanFrom, sendToChat } from "./chat/store";
import { composeIn } from "./chat/compose";
import { takeWords } from "./handoff";
import { currentSpace } from "../frame/useSpace";
import { takeIdea } from "../discovery/idea";
import { reviewPlacements, usePlacements } from "../discovery/placements";
import { draftSolutionsFor, draftsFromUrl } from "../discovery/solutions";
import { draftTestsFor } from "../discovery/tests";
import { useDiscovery } from "../discovery/store";
import { problemCard } from "../topics/start-board";
import { addMaterial } from "./new";

/*
 * What an address asks of a space's canvas once it's open, as a board's page used to take it
 * (a board's old address lands here with its query, App.tsx):
 *   ?card=<id>            that card, picked and in view (unfolding what hides it)
 *   ?board=<id>           that board's trees in view
 *   &then=solutions|tests Qalam AI drafts what goes under the card
 *   ?problem=<topic>&under=<card>  the problem put under that card (a goal's "Work on it")
 *   ?solutions=<topic>    the drafts kept on the problem's page, reviewed under its card
 *   ?review=placed        what Qalam AI found for the space's boards, reviewed
 *   ?source=<id>          that source read
 *   ?idea=1               the first run's idea, read as a brain dump in the chat
 *   ?add=1                the sources open on adding what customers said (Evidence's old address)
 *   ?find=goal|problem    the first run's "Help me find one", in the chat
 *   ?write=1              the chat's box, for a goal or a problem they have in mind
 *   ?take=goal|problem    their words from the first run, taken as a goal or a problem
 *   ?scan=1               the first run's one box: their words read for what people complain about
 *   ?panel=problems       the panel open on that section (read by ../home/Home.tsx as it opens)
 */

const KEYS = ["card", "board", "then", "problem", "under", "review", "source", "idea", "add", "find", "write", "take", "scan", "panel"];

export async function consumeHomeParams() {
  const u = new URL(window.location.href);
  const p = u.searchParams;
  if (!KEYS.some((k) => p.has(k)) && !p.has("solutions")) return;
  const get = (k: string) => p.get(k);
  const card = get("card");
  const board = get("board");
  const then = get("then");
  const problem = get("problem");
  const under = get("under");
  const review = get("review");
  const source = get("source");
  const idea = get("idea");
  const find = get("find");
  const take = get("take");
  const write = get("write");
  const scan = get("scan");
  if (get("add") === "1") addMaterial();
  for (const k of KEYS) p.delete(k);
  // The kept drafts read the address themselves (src/ui/discovery/solutions.ts).
  const drafts = p.has("solutions");
  // The step keeps its own state (how many pages are open over the canvas, src/ui/nav.ts).
  history.replaceState(history.state, "", `${u.pathname}${p.size ? `?${p}` : ""}${u.hash}`);
  const doc = studio().doc;

  if (problem) {
    await addProblem(problem, under);
    if (drafts) void draftsFromUrl();
    return;
  }
  if (card && isOstCard(doc.nodes[card])) {
    show(card);
    if (then === "solutions" && doc.nodes[card].meta.ost?.kind === "opportunity") void draftSolutionsFor(card);
    if (then === "tests" && doc.nodes[card].meta.ost?.kind === "solution") void draftTestsFor(card);
  } else if (board) {
    const v = useSpaceView.getState();
    const tops = [...v.boardOf].filter(([id, b]) => b === board && !(doc.nodes[id]?.parentId && v.boardOf.get(doc.nodes[id].parentId!) === board)).map(([id]) => id);
    const boxes = tops.filter((id) => doc.nodes[id]).map((id) => worldBounds(doc, id));
    if (tops[0]) studio().select([tops[0]]);
    if (boxes.length) onCanvasReady((c) => c.glideTo(c.fitCamera(boundsOf(boxes.flatMap((b) => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }])), {}, 1)));
  }
  if (drafts) void draftsFromUrl();
  if (review === "placed") void waitForPlacements().then(reviewPlacements);
  if (source) openSourceItem(source);
  if (idea === "1") {
    const text = takeIdea();
    if (text) void sendToChat(text, "dump");
  }
  // From the first run's start: help finding one, the box for one in mind, or their words taken as one.
  if (find === "goal" || find === "problem") findWith(find, currentSpace());
  if (write === "1") composeIn({});
  if (scan === "1") {
    const text = takeWords();
    if (text) scanFrom(text, currentSpace());
  }
  if (take === "goal" || take === "problem") {
    const text = takeWords();
    if (text) void sendToChat(text, take);
  }
}

/** Bring a card into view, unfolding what hides it (outside undo), and pick it unless `select` is false. */
export function show(id: string, o: { select?: boolean } = {}) {
  const doc = studio().doc;
  const folded: string[] = [];
  for (let p = doc.nodes[id]?.parentId; p && isOstCard(doc.nodes[p]); p = doc.nodes[p].parentId) if (doc.nodes[p].meta.ost?.collapsed) folded.push(p);
  if (folded.length)
    studio().mutate(
      (d) => {
        for (const f of folded) delete d.nodes[f].meta.ost!.collapsed;
      },
      { history: false },
    );
  if (o.select !== false) studio().select([id]);
  onCanvasReady((c) => glideToLayer(c, id));
}

/** A goal page's "Work on it": the problem under the card (a goal's), once; one there already is just shown. */
export async function addProblem(topic: string, under: string | null) {
  const c = await problemCard(topic);
  if (!c) return;
  const doc = studio().doc;
  const parent = under && isOstCard(doc.nodes[under]) ? under : null;
  const there = Object.values(doc.nodes).find((n) => isOstCard(n) && n.meta.ost?.kind === "opportunity" && !n.id.startsWith("topic:") && sameTopic(n.meta.ost.title, c.title));
  if (there) return show(there.id);
  const node = makeCardNode(newCard("opportunity", { title: c.title, evidence: c.evidence }));
  const t = parent ? useSpaceView.getState().things.get(parent) : undefined;
  const faint = `topic:${t?.type === "goal" ? t.goal : "none"}:${topic}`;
  studio().mutate((d) => {
    // The page it was drawn faint as goes: it's this card now.
    const list = parent ? d.nodes[parent].children : d.roots;
    if (list.includes(faint)) {
      list.splice(list.indexOf(faint), 1);
      delete d.nodes[faint];
    }
    addCardIn(d, node, parent);
  });
  show(node.id);
}

/** Placements load as the canvas opens: wait a little for them. */
async function waitForPlacements() {
  for (let i = 0; i < 20 && !usePlacements.getState().list.length; i++) await new Promise((r) => setTimeout(r, 250));
}

/** A source read in the panel, from the lane (where a card rests on it). */
export function openSourceItem(id: string) {
  onCanvasReady(() => {
    void import("@/engine/ost-tools").then(({ boardLane }) => {
      const item = boardLane().items.find((i) => i.sourceId === id);
      if (item) useDiscovery.setState({ reading: item.key });
    });
  });
}
