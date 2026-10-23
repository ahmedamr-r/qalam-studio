import { studio } from "@/doc/store";
import type { Doc } from "@/doc/schema";
import { selectedScreens } from "../ai/chats";
import { startCritique } from "../ai/critiqueSession";
import { directionTargets, nextDir } from "../ai/direction";
import { composerDraft } from "../ai/Composer";
import { isDiscovery } from "@/projects/mode";
import { boardAIActions } from "../discovery/ai-actions";

/*
 * Qalam AI actions offered by the ⌘K palette and the context menu. Each opens the real tool (the chat
 * with its composer set up, or the critique card); nothing here spends a model call by itself except
 * Critique, which is a single click in the canvas card too.
 */

export interface AIAction {
  id: string;
  label: string;
  /** Selected screens' names, shown as the row's context ("Pay · Send"). */
  sub?: string;
  /** Right-side state ("Plans first"). */
  state?: string;
  keywords: string[];
  /** True, or why it can't run. */
  enabled: true | string;
  run: () => void;
}

const names = (list: { name: string }[]) => (list.length === 1 ? list[0].name : list.length ? `${list.length} screens` : undefined);

function planFirst(): boolean {
  try {
    return localStorage.getItem("qalam/plan-first/v1") !== "off";
  } catch {
    return true;
  }
}

/** Open the chat on Generate with `text` in the composer (not sent: the designer reviews and presses ↵). */
export function askQalamAI(text: string) {
  // A Discovery board's chat has no composer (its Qalam AI works from the tree): open it.
  if (isDiscovery()) return studio().setChatOpen(true);
  studio().setAITab("generate");
  // The composer focuses itself when the chat opens; fill it once that has happened.
  requestAnimationFrame(() => composerDraft.set(text));
}

export function aiActions(doc: Doc = studio().doc, selection: string[] = studio().selection): AIAction[] {
  if (isDiscovery()) return boardAIActions(doc, selection);
  const screens = selectedScreens(doc, selection);
  const targets = directionTargets(doc, selection);
  const toRtl = nextDir(targets) === "rtl";
  const sub = names(screens);
  return [
    {
      id: "ai:generate",
      label: screens.length ? "Edit with Qalam AI…" : "Generate screens from a prompt…",
      sub: screens.length ? sub : undefined,
      state: screens.length ? undefined : planFirst() ? "Plans first" : undefined,
      keywords: ["generate", "create", "design", "prompt", "screen", "edit", "change"],
      enabled: true,
      run: () => studio().setAITab("generate"),
    },
    {
      id: "ai:critique",
      label: "Critique selection",
      sub,
      keywords: ["critique", "review", "feedback", "heuristics"],
      enabled: screens.length ? true : "Select a screen to critique",
      run: () => startCritique(studio().selection),
    },
    {
      id: "ai:direction",
      label: toRtl ? "Mirror for Arabic (RTL)…" : "Mirror for English (LTR)…",
      sub: names(targets),
      keywords: ["rtl", "ltr", "arabic", "english", "mirror", "direction", "translate", "localize"],
      enabled: targets.length ? true : "Select a screen to mirror",
      run: () => studio().setAITab("direction"),
    },
    {
      id: "ai:audit",
      label: "Audit selection…",
      sub,
      keywords: ["audit", "lint", "accessibility", "tokens", "check"],
      enabled: screens.length ? true : "Select a screen to audit",
      run: () => studio().setAITab("audit"),
    },
  ];
}
