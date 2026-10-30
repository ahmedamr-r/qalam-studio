import clsx from "clsx";
import { ArrowRight, Plus, Star, Target } from "lucide-react";
import { useGoals } from "@/goals/client";
import { newProduct, productOf, saveProduct, useOrgContext } from "@/org/context";
import { wordsFor } from "@/org/words";
import { spaceHref } from "@/projects/model";
import { r } from "../recipes";
import { promptDialog } from "../surfaces/dialog";
import { editContext } from "../org/ContextEditor";
import { useOrgData } from "../org/useOrgData";
import { useTopics } from "../topics/list";
import { PageFrame } from "../frame/PageFrame";
import { SpaceTile } from "../frame/OrgPlaces";
import { spaceSummary, type Space } from "../frame/spaces";
import { useCurrentOrg } from "../frame/store";
import { lastSpace } from "../frame/useSpace";
import { navigate } from "../nav";

/*
 * Where you pick a space before going in (src/ui/frame/spaces.ts): the whole organization, where
 * the places show all of it, or one product, where they show only its own. The organization opens
 * here once it has products, and the space's name atop the sidebar comes back here. A new product
 * starts here too: named, then said what it is, then you're in it.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export default function SpacesPage() {
  const org = useCurrentOrg();
  const words = wordsFor(org?.shape);
  const { products, about } = useOrgContext();
  const tree = useGoals();
  const topics = useTopics();
  const { sources } = useOrgData();
  const last = lastSpace();
  const summary = (space: Space) => spaceSummary(space, { goals: tree.goals, north: tree.north, topics, sources });

  const addProduct = async () => {
    const name = await promptDialog({ title: "New product", body: `Goals, problems, boards and sources can be for one product, or for the whole ${words.org}.`, label: "Name", placeholder: "Grocery app", confirmLabel: "Add product", validate: (v) => (v.trim() ? null : "Name it") });
    if (!name) return;
    const p = newProduct(name);
    await saveProduct(p);
    await editContext({ kind: "product", product: p });
    // Deleted from the editor straight away: stay here.
    if (productOf(p.id)) navigate(spaceHref(p.id));
  };

  const name = org?.name ?? "";
  return (
    <PageFrame place={null} focus>
      <div className={clsx(r.pageMain, "max-w-[760px] gap-[24px] pt-[48px]")}>
        <div className="flex flex-col gap-[4px]">
          <h1 className="text-display font-semibold text-fg">Where do you want to work?</h1>
          <p className="text-body text-fg-muted">{name ? `${name} as a whole, or one of its products. You can switch any time from the top of the sidebar.` : `${words.whole}, or one of its products.`}</p>
        </div>

        <SpaceCard space={null} name={name} line={about.context.split("\n")[0]?.trim() || words.whole} summary={summary(null)} here={last === null} wide />

        <section aria-labelledby="products" className="flex flex-col gap-[10px]">
          <h2 id="products" className="text-title font-medium">
            Products
          </h2>
          <ul className="grid gap-[12px] sm:grid-cols-2">
            {products.map((p) => (
              <li key={p.id} className="flex">
                <SpaceCard space={p.id} name={p.name} line={p.audience.split("\n")[0]?.trim() || p.context.split("\n")[0]?.trim()} summary={summary(p.id)} here={last === p.id} />
              </li>
            ))}
            <li className="flex">
              <button
                type="button"
                onClick={() => void addProduct()}
                className="q-item q-press flex min-h-[76px] flex-1 items-center justify-center gap-[8px] rounded-lg border border-dashed border-line-strong text-body text-fg-muted hover:bg-hover hover:text-fg"
              >
                <Plus {...ICON} />
                New product
              </button>
            </li>
          </ul>
          {!products.length && <p className="text-caption text-fg-subtle">No products yet. Add one when a product has goals, customers or a team of its own; until then everything is the {words.org}&apos;s.</p>}
        </section>
      </div>
    </PageFrame>
  );
}

function SpaceCard({ space, name, line, summary, here, wide }: { space: Space; name: string; line?: string; summary: ReturnType<typeof spaceSummary>; here: boolean; wide?: boolean }) {
  const counts = [count(summary.goals, "goal"), summary.problems === null ? null : count(summary.problems, "problem"), count(summary.sources, "source")].filter(Boolean).join(" · ");
  return (
    <a
      href={spaceHref(space)}
      aria-current={here ? true : undefined}
      className={clsx(
        "q-item q-press group flex flex-1 items-start gap-[12px] rounded-lg bg-panel px-[16px] py-[14px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover aria-[current=true]:shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
        wide && "py-[16px]",
      )}
    >
      <SpaceTile name={name || "·"} size="lg" />
      <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
        <span className="flex items-center gap-[8px]">
          <span className="truncate text-title font-medium text-fg">{name}</span>
          {here && <span className="text-caption text-fg-subtle">Last here</span>}
          <ArrowRight {...ICON} className="ml-auto shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        {line && <span className="line-clamp-2 text-caption text-fg-muted">{line}</span>}
        {summary.top && (
          <span className="flex min-w-0 items-center gap-[6px] text-caption text-fg-muted">
            <span className="shrink-0 text-fg-subtle">{space === null ? <Star {...ICON} /> : <Target {...ICON} />}</span>
            <span className="truncate">{summary.top.title}</span>
          </span>
        )}
        <span className="text-caption text-fg-subtle tnum">{counts}</span>
      </span>
    </a>
  );
}
