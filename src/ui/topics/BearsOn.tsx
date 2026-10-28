import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Target, X } from "lucide-react";
import { feedback } from "@/commands/feedback";
import { useGoals } from "@/goals/client";
import type { Bearing } from "@/goals/bearings";
import { goalsOfNeed } from "@/goals/problems";
import { orgFetch, orgJson } from "@/org/client";
import { onOrgChange } from "@/org/live";
import { goalHref } from "@/projects/model";
import { Tip } from "../controls";
import { QalamAIGlyph } from "../brand";
import { Menu, MenuItem } from "../menu";
import { r } from "../recipes";

/**
 * The goals a problem bears on, each with how solving it would move the goal's number: Qalam AI's
 * lines (kept only where what customers said backs them) or a person's link. Link it to another
 * goal, or take a link off: Qalam AI never makes that one again.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export function BearsOn({ need }: { need: string }) {
  const [links, setLinks] = useState<Bearing[] | null>(null);
  const goals = useGoals();
  const load = useCallback(() => void orgJson<Bearing[]>("/bearings").then((all) => setLinks(goalsOfNeed(need, all)), () => setLinks([])), [need]);
  useEffect(() => {
    load();
    return onOrgChange((c) => c.kind === "bearing" && load());
  }, [load]);
  const set = async (goal: string, on: boolean) => {
    await orgFetch("/bearings", { method: "POST", json: { need, goal, on } }).catch((e) => feedback(`Couldn't change it: ${e instanceof Error ? e.message : String(e)}`, { kind: "error", id: "bears.link" }));
    load();
  };
  if (!links || !goals.goals.length) return null;
  const others = goals.goals.filter((g) => !links.some((l) => l.goal === g.id));
  return (
    <section aria-labelledby="bears" className="flex flex-col gap-[8px]">
      <div className="flex items-end justify-between gap-[12px]">
        <h2 id="bears" className="text-title font-medium">
          Bears on
        </h2>
        {!!others.length && (
          <Menu
            label="Link to a goal"
            align="end"
            className="max-h-[300px] w-[300px] overflow-y-auto"
            trigger={
              <button type="button" className={clsx(r.buttonSm, r.buttonGhost)}>
                Link to a goal…
              </button>
            }
          >
            {others.map((g) => (
              <MenuItem key={g.id} onSelect={() => void set(g.id, true)}>
                {g.id === goals.north ? `North Star: ${g.title}` : g.title}
              </MenuItem>
            ))}
          </Menu>
        )}
      </div>
      {links.length ? (
        <ul className="flex flex-col divide-y divide-line-subtle rounded-lg bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          {links.map((l) => {
            const g = goals.goals.find((x) => x.id === l.goal);
            if (!g) return null;
            return (
              <li key={l.goal} className="group/bear flex items-start gap-[10px] px-[12px] py-[10px]">
                <Target {...ICON} className="mt-[3px] shrink-0 text-fg-subtle" />
                <a href={goalHref(g.id)} className="flex min-w-0 flex-1 flex-col gap-[2px] hover:underline">
                  <span className="text-body text-fg">{g.title}</span>
                  <span className="flex items-start gap-[6px] text-caption text-fg-muted">
                    {l.by === "qalam" && <QalamAIGlyph size={12} className="mt-[2px] shrink-0" />}
                    <span>{l.how || "Linked by you"}{l.bears === "some" ? " (around the edges)" : ""}</span>
                  </span>
                </a>
                <Tip label="Not about this goal">
                  <button type="button" aria-label="Not about this goal" onClick={() => void set(l.goal, false)} className={clsx(r.iconButton, "opacity-0 group-hover/bear:opacity-100 focus-visible:opacity-100")}>
                    <X {...ICON} />
                  </button>
                </Tip>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-caption text-fg-subtle">Not linked to a goal yet. A goal's page finds the problems behind it.</p>
      )}
    </section>
  );
}
