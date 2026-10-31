import { useState } from "react";
import { feedback } from "@/commands/feedback";
import { resolveSpaceConflict, useSpaceConflict } from "@/space/session";
import { Button } from "../controls";

/**
 * Boards on the canvas changed in another window or on disk while they had edits here. Saving
 * waits until the person chooses: keep this window's (over the other), or take the other (this
 * window's edits to those boards go; its edits to other boards are kept).
 */
export function SpaceConflictBanner() {
  const boards = useSpaceConflict((s) => s.boards);
  const [busy, setBusy] = useState(false);
  if (!boards.length) return null;
  const run = (take: "mine" | "theirs") => async () => {
    setBusy(true);
    try {
      await resolveSpaceConflict(take);
    } catch (e) {
      feedback(`Couldn't do that: ${e instanceof Error ? e.message : String(e)}`, { kind: "error", id: "space.conflict" });
    } finally {
      setBusy(false);
    }
  };
  const names = boards.map((b) => `“${b.name}”`).join(", ");
  return (
    <div role="alertdialog" aria-label="Boards changed elsewhere" className="absolute left-1/2 top-[12px] z-[60] flex max-w-[640px] -translate-x-1/2 flex-wrap items-center gap-[10px] rounded-xl bg-elevated px-[14px] py-[10px] text-body shadow-[0_8px_24px_rgba(0,0,0,.35),inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="mr-auto text-fg">{boards.length === 1 ? `${names} changed in another window or on disk while you were editing it here.` : `${names} changed in another window or on disk while you were editing them here.`}</p>
      <Button size="sm" variant="secondary" disabled={busy} onClick={run("theirs")}>
        Load theirs
      </Button>
      <Button size="sm" disabled={busy} onClick={run("mine")}>
        Keep mine
      </Button>
    </div>
  );
}
