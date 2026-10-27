import { dayOf, type Decision } from "@/decisions/model";
import { projectHref, type Project } from "@/projects/model";
import DecisionRow from "../decisions/DecisionRow";

/** The organization's decisions, newest first, by day, each with the board it was made on. */
export function DecisionsList({ decisions, projects }: { decisions: Decision[]; projects: Project[] }) {
  if (!decisions.length)
    return <p className="text-body text-fg-muted">No decisions yet. When a board&apos;s target changes, a solution is dropped or a card is merged, it&apos;s recorded here with what the team knew at the time.</p>;
  const days = new Map<string, Decision[]>();
  for (const d of decisions) days.set(dayOf(d.at), [...(days.get(dayOf(d.at)) ?? []), d]);
  const boardOf = (d: Decision) => {
    const p = projects.find((x) => x.id === d.board);
    return p ? { name: p.name, href: `${projectHref(p)}${d.card ? `?card=${encodeURIComponent(d.card)}` : ""}` } : { name: `${d.boardName} (deleted)` };
  };
  return (
    <div className="flex flex-col gap-[16px]">
      {[...days].map(([day, list]) => (
        <section key={day} className="flex flex-col gap-[6px]">
          <h3 className="text-caption font-medium text-fg-muted">{dayLabel(day)}</h3>
          <div className="flex flex-col divide-y divide-line-subtle rounded-lg bg-panel px-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
            {list.map((d) => (
              <DecisionRow key={d.id} d={d} board={boardOf(d)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** "Today", "Yesterday", "Mon, Oct 27" (with the year when it isn't this one). */
function dayLabel(day: string): string {
  const now = Date.now();
  if (day === dayOf(now)) return "Today";
  if (day === dayOf(now - 86_400_000)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric", ...(y !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}
