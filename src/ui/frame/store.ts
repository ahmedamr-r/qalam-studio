import { create } from "zustand";
import { currentOrg, type OrgRef } from "@/org/client";
import { onOrgChange } from "@/org/live";
import { wordsFor, type OrgWords } from "@/org/words";

/*
 * The frame's own state, apart from Studio's doc store: whether Qalam AI's chat beside the canvas
 * is open or folded (⌘\, remembered on this computer), and the organization the window works in,
 * which the top bar, the chat and the page share (a rename in the top bar shows everywhere at once).
 */

const KEY = "qalam/frame/v2";

function readChat(): boolean {
  try {
    return (JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as { chat?: boolean }).chat !== false;
  } catch {
    return true;
  }
}

export const useFrame = create<{ chat: boolean }>(() => ({ chat: typeof window === "undefined" ? true : readChat() }));

/** Open or fold the chat (no argument: the other way). */
export function toggleChat(open?: boolean) {
  const chat = open ?? !useFrame.getState().chat;
  useFrame.setState({ chat });
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ chat }));
  } catch {
    /* storage unavailable: it lasts for this page */
  }
}

const useOrgState = create<{ org: OrgRef | null; started: boolean }>(() => ({ org: null, started: false }));

const loadOrg = () => void currentOrg().then((org) => useOrgState.setState({ org }), () => {});

/** The organization this window works in (null until it's known). */
export function useCurrentOrg(): OrgRef | null {
  if (!useOrgState.getState().started) {
    useOrgState.setState({ started: true });
    loadOrg();
    // Renamed in another window, or in the folder itself.
    onOrgChange((c) => c.kind === "org" && loadOrg());
  }
  return useOrgState((s) => s.org);
}

/** After this window renamed it (its own changes aren't announced back to it). */
export const setCurrentOrg = (org: OrgRef) => useOrgState.setState({ org });

/** The words for this organization: a team's, or one person's own project. */
export const useWords = (): OrgWords => wordsFor(useCurrentOrg()?.shape);
