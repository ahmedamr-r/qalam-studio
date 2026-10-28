import { create } from "zustand";
import { currentOrg, type OrgRef } from "@/org/client";
import { onOrgChange } from "@/org/live";

/*
 * The frame's own state, apart from Studio's doc store: whether the sidebar is open or folded to
 * the rail (⌘\, remembered on this computer), and the organization the window works in, which the
 * top bar, the sidebar and the page share (a rename in the top bar shows everywhere at once).
 */

const KEY = "qalam/frame/v1";
type Sidebar = "open" | "rail";

function readSidebar(): Sidebar {
  try {
    return (JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as { sidebar?: Sidebar }).sidebar === "rail" ? "rail" : "open";
  } catch {
    return "open";
  }
}

export const useFrame = create<{ sidebar: Sidebar }>(() => ({ sidebar: typeof window === "undefined" ? "open" : readSidebar() }));

export function toggleSidebar() {
  const sidebar: Sidebar = useFrame.getState().sidebar === "open" ? "rail" : "open";
  useFrame.setState({ sidebar });
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ sidebar }));
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
