import clsx from "clsx";
import { Target } from "lucide-react";
import type { SourceRecord } from "@/discovery/sources";
import type { GoalsNow } from "@/goals/client";
import type { TopicInfo } from "@/hub/topics";
import type { Product } from "@/org/context-md";
import { spaceHref, spacesHref } from "@/projects/model";
import { r } from "../recipes";
import { SpaceTile } from "../frame/OrgPlaces";
import { spaceSummary } from "../frame/spaces";

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** The organization's home ends with its products, each with its top goal and its problems, opening its space. */
export function ProductsRow({ products, tree, topics, sources }: { products: Product[]; tree: GoalsNow; topics: TopicInfo[] | null; sources: SourceRecord[] }) {
  return (
    <section aria-labelledby="products" className="flex flex-col gap-[10px]">
      <div className="flex items-end justify-between gap-[12px]">
        <h2 id="products" className="text-title font-medium">
          Products
        </h2>
        <a href={spacesHref()} className={clsx(r.buttonSm, r.buttonGhost)}>
          Switch space
        </a>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[12px]">
        {products.map((p) => {
          const s = spaceSummary(p.id, { goals: tree.goals, topics, sources });
          return (
            <li key={p.id} className="flex">
              <a href={spaceHref(p.id)} className="q-item q-press flex flex-1 flex-col gap-[8px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover">
                <span className="flex min-w-0 items-center gap-[8px]">
                  <SpaceTile name={p.name} />
                  <span className="truncate text-body font-medium text-fg">{p.name}</span>
                </span>
                <span className="flex min-w-0 items-center gap-[6px] text-caption text-fg-muted">
                  <span className="shrink-0 text-fg-subtle">
                    <Target {...ICON} />
                  </span>
                  <span className="truncate">{s.top?.title ?? "No goal yet"}</span>
                </span>
                {s.problems !== null && <span className="text-caption text-fg-subtle tnum">{s.problems === 1 ? "1 problem" : `${s.problems} problems`}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
