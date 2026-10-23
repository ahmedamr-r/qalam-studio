import { studio, useStudio } from "@/doc/store";
import { appendAnswer, emptyBrief, updateScreen } from "@/doc/brief";
import type { ProjectBrief } from "@/doc/schema";
import type { Gap } from "@/knowledge/gaps";
import { readRequest, reviseRequest } from "@/knowledge/changes";
import { emptyControls, type DecisionInfo, type KnowledgeControls, type KnowledgeNode } from "@/knowledge/types";
import { dsKeyOf } from "@/knowledge/refs";
import { getController } from "../CanvasView";
import { openChat, send, useChats } from "../ai/chats";
import { startCritique } from "../ai/critiqueSession";
import { openWorkspace, useWorkspace, type TokenScope } from "../workspace/store";
import { useEdits } from "../workspace/editing";
import { remapRef, remapSystem } from "@/knowledge/controls";

/** What the hub's inspector does: go to where a fact lives, and forget or pin it. */

/** Close the hub and show a screen on the canvas. */
export function showOnCanvas(frameIds: string[]) {
  const ids = frameIds.filter((id) => studio().doc.nodes[id]);
  if (!ids.length) return;
  useWorkspace.getState().close();
  studio().select(ids);
  requestAnimationFrame(() => getController()?.zoomToFit(ids));
}

/** Open the chat a decision was made in, at its turn (the hub closes as the chat opens). */
export function openTurn(chatId: string, turnId?: string) {
  openChat(chatId);
  useStudio.getState().setChatOpen(true);
  if (turnId) setTimeout(() => document.getElementById(`turn-${turnId}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 120);
}

/** The token editor's page for a design-system fact. */
function scopeFor(n: KnowledgeNode): TokenScope {
  if (n.kind === "language" || n.kind === "principle" || n.kind === "do" || n.kind === "dont") return { kind: "doc", doc: "language" };
  if (n.kind === "layout" || n.kind === "rule" || n.kind === "template") return { kind: "doc", doc: "layout" };
  return { kind: "all" };
}

/** Where a fact lives in the studio, if it has a home of its own. */
export function homeOf(n: KnowledgeNode): { label: string; go: () => void } | null {
  const ds = dsKeyOf(n.ref);
  if (ds) {
    if (n.kind === "guide" || n.kind === "pattern") {
      const name = n.kind === "guide" ? ds.key.slice("guide:".length) : ds.key.slice("pattern:".length);
      return { label: "Open in the component library", go: () => openWorkspace("components", { component: name, systemId: ds.systemId }) };
    }
    return { label: "Open in the token editor", go: () => openWorkspace("tokens", { systemId: ds.systemId, scope: scopeFor(n) }) };
  }
  if (n.kind === "token") return { label: "Open in the token editor", go: () => openWorkspace("tokens", { scope: { kind: "all" } }) };
  if (n.kind === "component") return { label: "Open in the component library", go: () => openWorkspace("components", { component: n.label }) };
  if (n.kind === "system") return { label: "Open in the token editor", go: () => openWorkspace("tokens", { systemId: n.ref.slice("system:".length), scope: { kind: "all" } }) };
  if (n.frameId) return { label: "Show on canvas", go: () => showOnCanvas([n.frameId!]) };
  if (n.ref.startsWith("brief:"))
    return {
      label: "Show in the Library panel",
      go: () => {
        useWorkspace.getState().close();
        useStudio.getState().setLeftTab("knowledge");
      },
    };
  return null;
}

// ---------------------------------------------------------------------------
// Forget and pin: per project, in the document, out of undo history (like the brief).

function setControls(fn: (c: KnowledgeControls) => KnowledgeControls) {
  const next = fn(studio().doc.knowledge ?? emptyControls());
  studio().mutate(
    (d) => {
      d.knowledge = next;
    },
    { history: false },
  );
}

const without = (m: Record<string, number>, ref: string) => {
  const { [ref]: _, ...rest } = m;
  return rest;
};

/** Stop sending a fact to Qalam AI (it stays in the hub, greyed, until restored). */
export const forget = (ref: string) => setControls((c) => ({ ...c, forgotten: { ...c.forgotten, [ref]: Date.now() }, pinned: without(c.pinned, ref) }));
export const restore = (ref: string) => setControls((c) => ({ ...c, forgotten: without(c.forgotten, ref) }));
/** Always send a fact, ahead of any limit. */
export const pin = (ref: string) => setControls((c) => ({ ...c, pinned: { ...c.pinned, [ref]: Date.now() }, forgotten: without(c.forgotten, ref) }));
export const unpin = (ref: string) => setControls((c) => ({ ...c, pinned: without(c.pinned, ref) }));

/** A rule edited in the hub gets a new ref (its words are its key): what the designer chose for it follows. */
export const moveControls = (from: string, to: string) => {
  if (from !== to && studio().doc.knowledge) setControls((c) => remapRef(c, from, to));
};

// A built-in system's first edit makes a copy: forgotten and pinned rules stay so in the copy.
if (typeof window !== "undefined")
  useEdits.subscribe((s, prev) => {
    const f = s.forked;
    if (!f || f === prev.forked || !studio().doc.knowledge) return;
    setControls((c) => remapSystem(c, f.from, f.to));
  });

/** Facts that can be forgotten or pinned: the knowledge itself, not decisions, anchors or the essentials screens need. */
export function controllable(n: KnowledgeNode): { forget: boolean; pin: boolean } {
  if (n.kind === "decision" || n.group === "anchor" || n.status === "ghost" || n.kind === "tokens" || n.kind === "structure") return { forget: false, pin: false };
  // Research goes with its own turn, and naming choices are all sent: there's no limit to pin past.
  if (n.kind === "research" || n.kind === "source" || n.kind === "naming") return { forget: n.kind !== "source", pin: false };
  // Screen goals and verdicts are always sent for their screens.
  if (n.kind === "screen-goal" || n.kind === "verdict") return { forget: true, pin: false };
  return { forget: true, pin: true };
}

// ---------------------------------------------------------------------------
// "Tell it": the designer's answer to a gap goes into the brief (out of undo, like the critique's answers).

export function tellIt(gap: Gap, answer: string) {
  const words = answer.trim();
  if (!words) return;
  const now = Date.now();
  const doc = studio().doc;
  const base = doc.brief ?? emptyBrief();
  let next: ProjectBrief;
  if (gap.field === "summary") next = { ...base, summary: words.slice(0, 2000), updatedAt: now };
  else if (gap.field && gap.screenId) next = updateScreen(base, gap.screenId, doc.nodes[gap.screenId]?.name ?? "", { [gap.field]: words.slice(0, 400) }, now);
  else next = appendAnswer(base, { id: `a${now.toString(36)}`, topic: gap.topic, question: gap.question, answer: words.slice(0, 600), screenIds: gap.screenId ? [gap.screenId] : [], at: now }, (id) => !!doc.knowledge?.pinned[`brief:answer:${id}`]);
  studio().mutate(
    (d) => {
      d.brief = next;
    },
    { history: false },
  );
}

// ---------------------------------------------------------------------------
// The fix loop: after fixing what led a design astray, revise it in the chat it came from.

/** Revise a design with the fixed knowledge: the same request, as a follow-up on its screen, saying what changed. */
export async function generateAgain(d: DecisionInfo, frameId: string, note: string) {
  const turn = d.chatId && d.turnId ? useChats.getState().chats.find((c) => c.id === d.chatId)?.turns.find((t) => t.id === d.turnId) : undefined;
  // A revision of a revision still names the first request.
  const original = readRequest((d.request ?? turn?.request.text ?? "").replace(/\s+/g, " ").trim()).original;
  const text = reviseRequest(note, original);
  useWorkspace.getState().close();
  studio().select([frameId]);
  if (d.chatId) openChat(d.chatId);
  useStudio.getState().setChatOpen(true);
  await send({ tool: "generate", text, lang: turn?.request.lang, platform: turn?.request.platform ?? "auto" });
}

/** Critique a screen again (a critique's story). */
export function critiqueAgain(frameId: string) {
  useWorkspace.getState().close();
  studio().select([frameId]);
  startCritique([frameId]);
}
