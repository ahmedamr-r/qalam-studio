import { feedback } from "@/commands/feedback";
import type { Decision } from "@/decisions/model";
import { boardSummary } from "@/discovery/summary";
import { studio } from "@/doc/store";
import { voicesByQuote } from "@/hub/people";
import { orgJson } from "@/org/client";
import { useOrgContext } from "@/org/context";
import { goalServed, statedGoals } from "@/org/goals";
import { usePeople } from "@/org/people";
import { currentProject } from "@/projects/session";
import { useSources } from "./sources";

/** Where this board stands, as Markdown on the clipboard, to paste for the people the team answers to. */
export async function copyBoardSummary() {
  const p = currentProject();
  if (!p) return;
  const { about, products } = useOrgContext.getState();
  const stated = statedGoals(about, products);
  const s = useSources.getState();
  const voices = voicesByQuote([...s.list, ...s.visiting], usePeople.getState().people);
  const decisions = await orgJson<Decision[]>(`/decisions?board=${encodeURIComponent(p.id)}&limit=20`).catch(() => [] as Decision[]);
  const md = boardSummary(studio().doc, { name: p.name, now: Date.now(), voices, decisions, goalOf: (c) => goalServed(c.serves, stated)?.goal.text });
  try {
    await navigator.clipboard.writeText(md);
    feedback("Copied where the board stands, as Markdown", { id: "discovery.summary" });
  } catch {
    feedback("Couldn't copy it: the browser didn't allow the clipboard", { kind: "error", id: "discovery.summary" });
  }
}
