import { useStudio, registerDocPass, studio } from "@/doc/store";
import type { Doc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { clearMeasureCache } from "@/doc/measure";
import { onFontsChanged } from "@/engine/fonts";
import { setCanvasDelegate } from "@/engine/canvas-delegate";
import { createOstTools } from "@/engine/ost-tools";
import { layoutDocTrees, ostPass } from "@/discovery/pass";
import { allCards } from "@/discovery/tree";
import { isAssumed } from "@/discovery/evidence";
import type { DiscoveryCounts } from "@/discovery/types";
import type { Project } from "@/projects/model";
import { updateProject } from "@/projects/session";
import { listProjects } from "@/projects/library";
import { glideToLayer, onCanvasReady } from "./canvas";
import { registerDiscoveryCommands } from "./commands";
import { useDiscovery, type DesignLink } from "./store";
import { dropStaleEdit } from "./editing";
import { scheduleBoardThumbnail } from "./thumbnail";
import { ensureHandlers } from "./draft";
import { loadSources, openSource, reloadSources, sourceOf, useSources } from "./sources";
import { evidenceToLink, linkEvidenceIn } from "@/hub/migrate";
import { onOrgChange } from "@/org/live";
import { ensureDumpHandlers, resumeDumps } from "./dump";
import { startRecorder } from "../decisions/recorder";

/**
 * A Discovery project opening: the board's layout pass, gestures and commands are installed (a
 * page holds one project, so they never reach a Screens project), every tree is laid out with
 * the real fonts, and the start sheet opens on an empty board. Returns what to do after saves.
 */
let afterSave: ((doc: Doc) => void) | null = null;

export function startDiscoveryStudio(p: Project): (doc: Doc) => void {
  // Booted again (React's dev double effects): one set of subscribers.
  if (afterSave) return afterSave;
  registerDocPass(ostPass);
  setCanvasDelegate(createOstTools());
  registerDiscoveryCommands();
  ensureHandlers();
  relayoutTrees();
  onFontsChanged(() => {
    clearMeasureCache();
    relayoutTrees();
  });
  // The canvas redraws for the board's own state (the title being typed, design counts).
  useDiscovery.subscribe(() => studio().invalidate());
  useStudio.subscribe((s, prev) => {
    if (s.doc !== prev.doc) dropStaleEdit();
  });

  const hasTree = useStudio.getState().doc.roots.some((id) => isOstCard(useStudio.getState().doc.nodes[id]));
  const stage = p.discovery?.stage ?? "start";
  if (!hasTree && stage !== "ready") useDiscovery.setState({ sheet: stage === "interview" ? "interview" : "start" });

  void refreshDesigns(p.id);
  // What gets decided on the board goes to the organization's decision log.
  startRecorder();
  ensureDumpHandlers();
  void loadSources(p.id).then(resumeDumps).then(linkEvidence).then(openSourceFromUrl);
  onOrgChange((c) => {
    if (c.kind === "source" && c.boards.includes(p.id)) void reloadSources(p.id);
  });
  const refresh = () => document.visibilityState === "visible" && void refreshDesigns(p.id);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("focus", refresh);
  focusCardFromUrl();

  afterSave = (doc: Doc) => {
    scheduleBoardThumbnail(doc);
    const counts = countsOf(doc);
    const cur = p.discovery;
    void updateProject((pr) => ({ discovery: { ...(pr.discovery ?? cur ?? { v: 1, stage: "ready" }), counts } }), { touch: false });
  };
  return afterSave;
}

/** Every tree laid out again, outside undo history (new metrics, not an edit). */
function relayoutTrees() {
  const before = useStudio.getState().doc;
  const after = layoutDocTrees(before);
  if (after !== before) useStudio.setState({ doc: after });
}

export function countsOf(doc: Doc): DiscoveryCounts {
  const c: DiscoveryCounts = { outcomes: 0, opportunities: 0, solutions: 0, tests: 0, assumed: 0 };
  for (const { card } of allCards(doc)) {
    if (card.kind === "outcome") c.outcomes!++;
    else if (card.kind === "opportunity") c.opportunities++;
    else if (card.kind === "solution") c.solutions++;
    else if (card.kind === "test") c.tests++;
    if (isAssumed(card)) c.assumed++;
  }
  return c;
}

/** Screens projects working on this board's solutions (they record it on their own records). */
export async function refreshDesigns(projectId: string) {
  const list = await listProjects().catch(() => []);
  const designs: Record<string, DesignLink[]> = {};
  for (const pr of list) {
    for (const s of pr.serves ?? []) {
      if (s.projectId !== projectId) continue;
      (designs[s.cardId] ??= []).push({ projectId: pr.id, projectName: pr.name, frames: s.frames, ...(s.first ? { first: s.first } : {}) });
    }
  }
  const prev = useDiscovery.getState().designs;
  if (JSON.stringify(prev) !== JSON.stringify(designs)) useDiscovery.setState({ designs });
}

/** A board from before shared sources: its quotes name the quote they are, once (src/hub/migrate.ts). */
function linkEvidence() {
  const links = evidenceToLink(studio().doc, useSources.getState().list);
  if (links.size) studio().mutate((d) => linkEvidenceIn(d, links), { history: false });
}

/** …/d/<id>?source=<sourceId>: open that source in the Sources tab (the organization's sources list links here). */
function openSourceFromUrl() {
  const params = new URLSearchParams(location.search);
  const id = params.get("source");
  if (!id) return;
  params.delete("source");
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  if (sourceOf(id)) openSource(id);
}

/** /d/<id>?card=<cardId>: select that card and bring it into view (a Screens project's link back). */
function focusCardFromUrl() {
  const params = new URLSearchParams(location.search);
  const id = params.get("card");
  if (!id) return;
  params.delete("card");
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  const doc = studio().doc;
  if (!isOstCard(doc.nodes[id])) return;
  // Unfold what hides it, then glide there once the canvas is up.
  let p = doc.nodes[id].parentId;
  const folded: string[] = [];
  while (p && isOstCard(doc.nodes[p])) {
    if (doc.nodes[p].meta.ost?.collapsed) folded.push(p);
    p = doc.nodes[p].parentId;
  }
  if (folded.length)
    studio().mutate(
      (d) => {
        for (const f of folded) delete d.nodes[f].meta.ost!.collapsed;
      },
      { history: false },
    );
  studio().select([id]);
  onCanvasReady((c) => glideToLayer(c, id));
}
