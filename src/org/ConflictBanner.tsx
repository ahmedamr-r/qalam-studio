import { useState } from "react";
import { feedback } from "@/commands/feedback";
import { useStudio } from "@/doc/store";
import { forStorage } from "@/doc/pages";
import { projectsDb } from "@/projects/db";
import { createProject, currentProject, flushDoc, showDocFromElsewhere, useSaveConflict } from "@/projects/session";
import { Button } from "@/ui/controls";

/**
 * The open document changed in another window or on disk while it had edits here. Saving waits
 * until the designer chooses: keep this version (over the other), take the other one, or keep
 * this one as a copy and take the other.
 */
export function ConflictBanner() {
  const conflict = useSaveConflict((s) => s.conflict);
  const [busy, setBusy] = useState(false);
  if (!conflict) return null;

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      feedback(`Couldn't do that: ${e instanceof Error ? e.message : String(e)}`, { kind: "error", id: "org.conflict" });
    } finally {
      setBusy(false);
    }
  };

  const loadTheirs = async () => {
    const p = currentProject();
    if (!p) return;
    const doc = await projectsDb.getDoc(p.id);
    if (doc) showDocFromElsewhere(doc);
  };

  const keepMine = () => flushDoc({ force: true });

  const saveCopy = async () => {
    const p = currentProject();
    if (!p) return;
    const copy = await createProject(p.type, `${p.name} (my copy)`, { systemId: p.systemId, freeform: p.freeform }, forStorage(useStudio.getState().doc));
    await loadTheirs();
    feedback(`Your version is saved as “${copy.name}”, on the projects home`, { kind: "success", id: "org.conflict" });
  };

  return (
    <div role="alertdialog" aria-label="This document changed elsewhere" className="fixed left-1/2 top-[56px] z-[60] flex max-w-[640px] -translate-x-1/2 flex-wrap items-center gap-[10px] rounded-xl bg-elevated px-[14px] py-[10px] text-body shadow-[0_8px_24px_rgba(0,0,0,.35),inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="mr-auto text-fg">It changed in another window or on disk while you were editing it here.</p>
      <Button size="sm" variant="secondary" disabled={busy} onClick={run(loadTheirs)}>
        Load theirs
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={run(saveCopy)}>
        Save mine as a copy
      </Button>
      <Button size="sm" disabled={busy} onClick={run(keepMine)}>
        Keep mine
      </Button>
    </div>
  );
}
