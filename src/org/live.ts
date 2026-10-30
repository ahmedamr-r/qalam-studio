import { feedback } from "@/commands/feedback";
import { projectsDb } from "@/projects/db";
import type { Project } from "@/projects/model";
import { adoptProject, currentProject, hasUnsavedDoc, showDocFromElsewhere, useSaveConflict } from "@/projects/session";
import { orgPath, TAB } from "./client";

/**
 * Changes made elsewhere, as they happen: another window, or the organization's folder edited on
 * disk (an editor, Git, Finder). The server announces each change (server/org/routes.ts, events);
 * this window ignores its own and lets the pages that care react.
 */

export type OrgChange = { tab?: string } & (
  | { kind: "project"; id: string; parts: ("record" | "doc")[]; removed?: boolean }
  | { kind: "source"; id: string; boards: string[]; removed?: boolean }
  | { kind: "system"; id: string; removed?: boolean }
  | { kind: "chat"; id: string; removed?: boolean }
  | { kind: "naming" }
  | { kind: "product"; id: string; removed?: boolean }
  | { kind: "person"; id: string; removed?: boolean }
  | { kind: "about" }
  | { kind: "org" }
  | { kind: "decision"; ids: string[]; boards: string[] }
  | { kind: "topic"; id: string; removed?: boolean }
  | { kind: "notice" }
  | { kind: "relation" }
  | { kind: "inbox" }
  | { kind: "placement"; board: string }
  | { kind: "feeds" }
  | { kind: "comment"; cards: string[] }
);

const listeners = new Set<(c: OrgChange) => void>();

/** Hear about changes made elsewhere. Returns the way to stop. */
export function onOrgChange(fn: (c: OrgChange) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let started = false;

/** Listen for the organization's changes for as long as the window is open (reconnecting if the stream drops). */
export function startLive() {
  if (started) return;
  started = true;
  let wait = 1000;
  const run = async () => {
    try {
      const res = await fetch(await orgPath("/events"));
      if (!res.ok || !res.body) throw new Error(String(res.status));
      wait = 1000;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as { type: string } & OrgChange;
          if (msg.type !== "event" || msg.tab === TAB) continue;
          for (const fn of listeners) fn(msg);
        }
      }
    } catch {
      // The server restarted, or the network blinked: try again shortly.
    }
    setTimeout(() => void run(), wait);
    wait = Math.min(wait * 2, 30_000);
  };
  void run();
}

/**
 * The open project changed elsewhere. Its record is taken as it is now; its document is shown
 * as it is now when nothing here is waiting to be saved, and otherwise the designer chooses
 * (src/org/ConflictBanner.tsx), since a save would overwrite the other change.
 */
export function followOpenProject(): () => void {
  return onOrgChange((c) => {
    const open = currentProject();
    if (c.kind !== "project" || !open || c.id !== open.id) return;
    if (c.removed) {
      feedback("This project was deleted in another window or on disk", { kind: "error", id: "org.removed" });
      return;
    }
    if (c.parts.includes("record")) void projectsDb.get(open.id).then((r: Project | undefined) => r && adoptProject(r));
    if (!c.parts.includes("doc")) return;
    void projectsDb.getDoc(open.id).then((doc) => {
      if (!doc) return;
      if (hasUnsavedDoc()) useSaveConflict.setState({ conflict: { doc, version: "" } });
      else {
        showDocFromElsewhere(doc);
        feedback("Updated from disk", { id: "org.updated" });
      }
    });
  });
}
