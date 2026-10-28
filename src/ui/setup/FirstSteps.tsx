import { useEffect, useState } from "react";
import clsx from "clsx";
import { Star, Target } from "lucide-react";
import { setMine, useGoals } from "@/goals/client";
import { metricLine } from "@/goals/goals-md";
import { childrenOf, goalById } from "@/goals/tree";
import type { GoalTree } from "@/goals/types";
import { connectorsDb, type ConnectorState } from "@/org/connectors";
import { goalHref, orgHref, placeHref } from "@/projects/model";
import { Button, Checkbox } from "../controls";
import { qr } from "../ai/Questionnaire";
import { StatusDot } from "../viz";
import { connectFor } from "../welcome/steps";

/*
 * The first run's last two steps on the setup page: which goals are this person's (kept on this
 * computer: the home leads with them), and what to connect for the goals, the most useful first.
 * Finishing opens the first of their goals' pages.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** The goals in tree order, each with how deep it sits. */
function rows(t: GoalTree) {
  const out: { id: string; title: string; depth: number; line: string; north: boolean }[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    const g = goalById(t, id);
    if (!g || seen.has(id)) return;
    seen.add(id);
    out.push({ id, title: g.title, depth, line: g.metric ? metricLine(g.metric) : "", north: id === t.north });
    childrenOf(t, id).forEach((c) => walk(c.id, depth + 1));
  };
  t.goals.filter((g) => !g.parent).forEach((g) => walk(g.id, 0));
  return out;
}

/** Where finishing goes: their first goal, else the first goal under the North Star, else the North Star. */
export function firstGoalHref(): string {
  const t = useGoals.getState();
  const order = rows(t);
  const g = order.find((x) => t.mine.includes(x.id)) ?? (t.north ? childrenOf(t, t.north)[0] : undefined) ?? order[0];
  return g ? goalHref(g.id) : orgHref();
}

export function Yours({ onNext }: { onNext: () => void }) {
  const goals = useGoals();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const chosen = picked ?? new Set(goals.mine);
  const list = rows(goals);
  const next = async () => {
    setSaving(true);
    await setMine(list.map((g) => g.id).filter((id) => chosen.has(id))).catch(() => {});
    onNext();
  };
  return (
    <section aria-labelledby="yours-title" className="flex flex-col gap-[14px]">
      <div className="flex flex-col gap-[6px]">
        <h1 id="yours-title" className="text-heading font-semibold text-fg">
          Which goals are yours?
        </h1>
        <p className="text-body text-fg-muted">Your home leads with them, each with the problems behind it. Everyone sees every goal; this is only what you work on, kept on this computer.</p>
      </div>
      {list.length ? (
        <ul className="flex flex-col rounded-lg bg-panel py-[4px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          {list.map((g) => (
            <li key={g.id} className="flex items-center gap-[8px] py-[4px] pr-[12px]" style={{ paddingLeft: 12 + g.depth * 20 }}>
              <span className={g.north ? "text-fg" : "text-fg-subtle"}>{g.north ? <Star {...ICON} /> : <Target {...ICON} />}</span>
              <span className="min-w-0 flex-1">
                <Checkbox
                  checked={chosen.has(g.id)}
                  onChange={(on) => setPicked(new Set(on ? [...chosen, g.id] : [...chosen].filter((x) => x !== g.id)))}
                  label={
                    <span className="flex min-w-0 flex-col py-[2px]">
                      <span className="truncate text-body text-fg">{g.title}</span>
                      {(g.north || g.line) && <span className="truncate text-caption text-fg-muted tnum">{[g.north ? "North Star" : null, g.line || null].filter(Boolean).join(" · ")}</span>}
                    </span>
                  }
                />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-fg-muted">There are no goals yet: you can add them on the Goals page any time.</p>
      )}
      <div className="flex items-center gap-[8px]">
        <span className="flex-1 text-caption text-fg-subtle">{chosen.size ? `${chosen.size} picked` : "None picked: the home leads with the North Star and the goals under it."}</span>
        <Button disabled={saving} onClick={() => void next()}>
          Next
        </Button>
      </div>
    </section>
  );
}

export function Connect() {
  const goals = useGoals();
  const [tools, setTools] = useState<ConnectorState[] | null>(null);
  useEffect(() => void connectorsDb.list().then((v) => setTools(v.connectors), () => setTools([])), []);
  const hasNumbers = goals.goals.some((g) => !!g.metric?.name);
  return (
    <section aria-labelledby="connect-title" className="flex flex-col gap-[14px]">
      <div className="flex flex-col gap-[6px]">
        <h1 id="connect-title" className="text-heading font-semibold text-fg">
          Connect what your goals need
        </h1>
        <p className="text-body text-fg-muted">Qalam reads from these and never writes to them. Connect any of them now or later, in Connections.</p>
      </div>
      <ul className="flex flex-col gap-[6px]">
        {connectFor(hasNumbers).map((c) => {
          const t = tools?.find((x) => x.id === c.id);
          // Reading the product's code comes next: GitHub's card today is for work linked to solutions.
          const word = c.id === "github" ? "Coming next" : (t?.word ?? "");
          const tone = c.id === "github" ? "off" : (t?.tone ?? "off");
          return (
            <li key={c.id} className={clsx(qr.inset, "flex items-center gap-[10px] px-[12px] py-[8px]")}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body text-fg">{t?.label ?? (c.id === "github" ? "GitHub" : c.id)}</span>
                <span className="text-caption text-fg-muted">{c.why}</span>
              </span>
              {tools && (
                <span className="flex shrink-0 items-center gap-[6px] text-caption text-fg-muted">
                  <StatusDot tone={tone} hollow={tone === "off"} />
                  {word}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-[8px]">
        <a href={placeHref("connections")} className={qr.textBtn}>
          Open Connections
        </a>
        <span className="flex-1" />
        <Button onClick={() => window.location.assign(firstGoalHref())}>Finish</Button>
      </div>
    </section>
  );
}
