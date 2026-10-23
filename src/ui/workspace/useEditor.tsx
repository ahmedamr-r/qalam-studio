import { useSystems, type DesignSystem } from "@/design-system/registry";
import { feedback } from "@/commands/feedback";
import { editSystem, type EditFn } from "./editing";
import { useWorkspace } from "./store";

/** The system the editors show: the one picked in the editor, else the active one. */
export function useShownSystem(): { ds: DesignSystem; activeId: string } {
  const systems = useSystems((s) => s.systems);
  const activeId = useSystems((s) => s.activeId);
  const shownId = useWorkspace((s) => s.systemId);
  return { ds: systems.find((s) => s.id === (shownId ?? activeId)) ?? systems[0], activeId };
}

export type Edit = (label: string, fn: EditFn) => string | null;

/** Why an edit was refused, in the studio's toast (one slot: a newer refusal replaces the last). */
export const editError = (message: string) => feedback(message, { kind: "error", id: "workspace-edit" });

/**
 * Edits to the shown system. A built-in system's edit lands in a copy, which the editor then
 * shows; a refused edit shows its reason in a toast.
 */
export function useEditor(ds: DesignSystem): { edit: Edit; onError: (m: string) => void } {
  const edit: Edit = (label, fn) => {
    const r = editSystem(ds.id, label, fn);
    if ("error" in r) {
      editError(r.error);
      return null;
    }
    if (r.id !== ds.id) useWorkspace.setState({ systemId: r.id });
    return r.id;
  };
  return { edit, onError: editError };
}
