import { CHECKLIST, type ChecklistItem } from "@/onboarding/checklist";
import { create } from "zustand";

/*
 * What this computer has tried of the canvas's checklist (./Checklist.tsx), and whether it's folded
 * or put away. Apart from the checklist itself, so ⌘K can ask for it without loading the canvas.
 */

const KEY = "qalam.checklist.canvas";

interface Kept {
  done: ChecklistItem[];
  closed: boolean;
  folded: boolean;
}

function read(): Kept {
  try {
    const kept = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<Kept>;
    const done = CHECKLIST.filter((i) => kept.done?.includes(i));
    // All done: it stays until they close it or come back.
    return { done, closed: !!kept.closed || done.length === CHECKLIST.length, folded: !!kept.folded };
  } catch {
    return { done: [], closed: false, folded: false };
  }
}

export const useChecklist = create<Kept>(read);

function keep(o: Partial<Kept>) {
  useChecklist.setState(o);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(useChecklist.getState()));
  } catch {
    // Only for this page load.
  }
}

export function tickChecklist(items: readonly ChecklistItem[]) {
  const { done } = useChecklist.getState();
  const fresh = items.filter((i) => !done.includes(i));
  if (fresh.length) keep({ done: [...done, ...fresh] });
}

export const foldChecklist = (folded: boolean) => keep({ folded });
export const closeChecklist = () => keep({ closed: true });
export const openChecklist = () => keep({ closed: false, folded: false });
