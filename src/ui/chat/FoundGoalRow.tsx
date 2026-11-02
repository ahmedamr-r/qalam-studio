import { useState } from "react";
import { foundNumber, type FoundGoal } from "@/goals/found";
import { r } from "../recipes";

/** A goal a document pointed to: its words and number, to accept or leave out, then where it stands. */
export function FoundGoalRow({ goal, onDecide }: { goal: FoundGoal; onDecide: (accept: boolean) => void }) {
  const [sent, setSent] = useState(false);
  const number = foundNumber(goal.metric);
  const decide = (accept: boolean) => {
    setSent(true);
    onDecide(accept);
  };
  return (
    <div className="flex flex-col gap-[6px] rounded-md bg-raised px-[10px] py-[8px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="text-body leading-[20px] text-fg" dir="auto">
        {goal.title}
      </p>
      {number && <p className="text-caption text-fg-muted tnum">{number}</p>}
      {goal.state ? (
        <p className="text-caption text-fg-subtle">{goal.state === "accepted" ? "In your goals. I'm linking the problems that bear on it." : "Left out."}</p>
      ) : (
        <div className="flex flex-wrap gap-[6px]">
          <button type="button" disabled={sent} className={r.replyChipPrimary} onClick={() => decide(true)}>
            Accept
          </button>
          <button type="button" disabled={sent} className={r.replyChip} onClick={() => decide(false)}>
            Leave out
          </button>
        </div>
      )}
    </div>
  );
}
