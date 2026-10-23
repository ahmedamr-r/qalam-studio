import { studio } from "@/doc/store";
import { revealLayers } from "../pages";
import type { Doc } from "@/doc/schema";
import { aiStatus } from "@/ai/client";
import { seedBrief, servesSummary } from "@/discovery/handoff";
import type { Project } from "@/projects/model";
import { currentProject, updateProject } from "@/projects/session";
import { newChat, recordTurn, send, startChats, useChats } from "../ai/chats";
import { askQalamAI } from "../surfaces/ai-actions";

/*
 * The Screens side of "Design this". A project opened with a solution to design takes it up once:
 * the Knowledge hub learns the need the screens serve, a chat opens with the solution and its
 * lineage as context, and Qalam AI starts planning the screens (Plan first: a few questions before
 * anything is drawn). Screens it makes for the solution are tagged, and counted on this project's
 * record, where the Discovery board reads them ("N screens" on the card).
 */

function chatsLoaded(): Promise<void> {
  startChats();
  if (useChats.getState().loaded) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useChats.subscribe((s) => {
      if (!s.loaded) return;
      off();
      resolve();
    });
  });
}

let consumed = false;

/** Take up a solution sent here with Design this (once: a reload never asks again). */
export async function consumeHandoff(p: Project) {
  const h = p.handoff;
  // React's dev double effects boot the studio twice with the same record.
  if (!h || consumed) return;
  consumed = true;
  const since = Date.now();
  await updateProject({ handoff: undefined, serving: { projectId: h.from.projectId, projectName: h.from.projectName, cardId: h.from.cardId, cardTitle: h.solution.title, since } }, { touch: false });
  studio().mutate((d) => void (d.brief = seedBrief(d.brief, h, since)), { history: false });
  await chatsLoaded();
  newChat();
  recordTurn("discovery", { text: `Design ▸ ${h.solution.title}` }, { kind: "discovery", action: "handoff", handoff: h });
  studio().setChatOpen(true);
  // Plan first needs Qalam AI; without it, the request waits in the composer.
  if ((await aiStatus()).ai) void send({ tool: "generate", text: h.prompt, plan: true });
  else askQalamAI(h.prompt);
}

let tagging = false;
const tagged = new Set<string>();

/** Screens Generate makes while this project serves a solution are that solution's (meta.serves). */
export function startServesTagging() {
  if (tagging) return;
  tagging = true;
  useChats.subscribe((s) => {
    const serving = currentProject()?.serving;
    if (!serving) return;
    const ids: string[] = [];
    for (const c of s.chats)
      for (const t of c.turns) {
        if (t.tool !== "generate" || t.at < serving.since || tagged.has(t.id) || t.outcome?.kind !== "generate") continue;
        tagged.add(t.id);
        ids.push(...t.outcome.frameIds);
      }
    const doc = studio().doc;
    const live = ids.filter((id) => doc.nodes[id] && !doc.nodes[id].meta.serves);
    if (!live.length) return;
    studio().mutate(
      (d) => {
        for (const id of live) d.nodes[id].meta.serves = { projectId: serving.projectId, cardId: serving.cardId };
      },
      { history: false },
    );
  });
}

/** After a save: the screens made for Discovery solutions, counted on this project's record. */
export function syncServes(doc: Doc) {
  const serves = servesSummary(doc);
  const cur = currentProject()?.serves ?? [];
  if (JSON.stringify(serves) !== JSON.stringify(cur)) void updateProject({ serves: serves.length ? serves : undefined }, { touch: false });
}

/** /p/<id>?focus=<frameId>: select that screen and bring it into view (a Discovery card's link). */
export function focusFromUrl() {
  const params = new URLSearchParams(location.search);
  const id = params.get("focus");
  if (!id) return;
  params.delete("focus");
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  if (!studio().doc.nodes[id]) return;
  revealLayers([id]);
}
