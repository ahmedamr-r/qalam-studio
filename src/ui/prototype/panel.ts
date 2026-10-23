import { create } from "zustand";

/** The right panel's tabs (UI3): Design, and Prototype (links, states and tracks). */
export type RightTab = "design" | "prototype";

const RIGHT_TAB_KEY = "qalam/right-tab";

/** The right panel opens on the tab it was on last, per browser. */
function loadRightTab(): RightTab {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(RIGHT_TAB_KEY) === "prototype" ? "prototype" : "design";
  } catch {
    return "design";
  }
}

export const useRightTab = create<{ tab: RightTab }>(() => ({ tab: loadRightTab() }));

export const rightTab = (): RightTab => useRightTab.getState().tab;

export function setRightTab(tab: RightTab) {
  useRightTab.setState({ tab });
  try {
    window.localStorage.setItem(RIGHT_TAB_KEY, tab);
  } catch {
    /* storage unavailable: the tab lasts for this session */
  }
}
