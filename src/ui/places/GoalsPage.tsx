import { useState } from "react";
import clsx from "clsx";
import { ChevronRight, Frame, Palette } from "lucide-react";
import { feedback } from "@/commands/feedback";
import { changeGoal, createGoal, useGoals } from "@/goals/client";
import { useOrgContext } from "@/org/context";
import { goalHref, projectHref, type ProjectType } from "@/projects/model";
import { createProject } from "@/projects/session";
import { Button } from "../controls";
import { r } from "../recipes";
import { promptDialog } from "../surfaces/dialog";
import { PageFrame } from "../frame/PageFrame";
import { useCurrentOrg } from "../frame/store";
import { inSpace } from "../frame/spaces";
import { useSpace } from "../frame/useSpace";
import { editContext } from "../org/ContextEditor";
import { GoalsList } from "../org/Goals";
import { useOrgData } from "../org/useOrgData";
import { PlaceHead } from "./PlaceHead";
import { ProjectCard, StartTile } from "./ProjectCard";
import { navigate } from "../nav";

/**
 * The organization's goals as one tree (goals.md), in the space: all of them in the organization's,
 * each marked with its product, or one product's in its own. The North Star on top,
 * each goal under the goal it feeds, each opening its page (its number, its board, the problems
 * behind it). Boards that work on no goal, and design work on hold, wait below. What the
 * organization is (About) opens from here too.
 */

const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export default function GoalsPage({ product: productId = null }: { product?: string | null }) {
  const { space, product } = useSpace(productId, "goals");
  const [placing, setPlacing] = useState(false);
  const { projects, refresh } = useOrgData();
  const tree = useGoals();
  const { products, about } = useOrgContext();
  const org = useCurrentOrg();
  const orgName = org?.name ?? "the organization";
  const scoped = tree.goals.filter((g) => inSpace(g.product, space));
  const linked = new Set(tree.goals.flatMap((g) => (g.on ? [g.on.board] : [])));
  const loose = (projects ?? []).filter((p) => p.type === "discovery" && inSpace(p.product, space) && !linked.has(p.id));
  const design = (projects ?? []).filter((p) => p.type !== "discovery");
  const unplaced = tree.north ? scoped.filter((g) => !g.parent && g.id !== tree.north) : [];

  const newGoal = async () => {
    const title = await promptDialog({
      title: "New goal",
      body: tree.north ? "A change the team is trying to make: it goes under the North Star until you say which goal it feeds." : "The first is the North Star: what the whole company is trying to move.",
      label: "The change it's after",
      placeholder: tree.north ? "More customers reorder every week" : "2M dirhams a month in orders by end of Q2",
      confirmLabel: "Add goal",
      validate: (v) => (v.trim() ? null : "Say what it's after"),
    });
    if (!title?.trim()) return;
    const g = await createGoal({ title: title.trim(), product: product?.id ?? null, parent: tree.north, north: "if-none" }).catch((e) => feedback(`Couldn't add it: ${e instanceof Error ? e.message : String(e)}`, { kind: "error", id: "goals.new" }));
    if (g) navigate(goalHref(g.id));
  };
  const placeAll = async () => {
    setPlacing(true);
    for (const g of unplaced) await changeGoal(g.id, { parent: tree.north }).catch(() => {});
    setPlacing(false);
  };
  const start = async (type: ProjectType) => {
    const p = await createProject(type, type === "system" ? "Untitled system" : "Untitled", {});
    window.location.assign(projectHref(p));
  };

  return (
    <PageFrame place="goals" crumbs={[{ label: "Goals" }]} space={space}>
      <div className={clsx(r.pageMain, "max-w-[1080px]")}>
        <PlaceHead title="Goals" count={tree.loaded ? scoped.length : null} space={space}>
          <span className="flex items-center gap-[8px]">
            <Button variant="ghost" size="sm" onClick={() => (product ? editContext({ kind: "product", product }) : editContext({ kind: "org", name: orgName, about }))}>
              About {product?.name ?? orgName}
            </Button>
            <Button size="sm" onClick={() => void newGoal()}>
              New goal
            </Button>
          </span>
        </PlaceHead>

        {scoped.length ? (
          <GoalsList tree={tree} boards={new Map((projects ?? []).map((p) => [p.id, p.name]))} products={new Map(products.map((p) => [p.id, p.name]))} keep={(g) => inSpace(g.product, space)} />
        ) : (
          <p className="text-body text-fg-muted">{tree.goals.length ? "No goals for this product yet." : "No goals yet. The North Star goes on top, what the whole company is trying to move; each goal goes under the goal it feeds, and a board works on one."}</p>
        )}

        {unplaced.length > 0 && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-[12px] rounded-lg bg-raised px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
            <p className="text-body text-fg-muted">
              {unplaced.length === 1 ? "1 goal doesn't" : `${unplaced.length} goals don't`} feed a goal yet. Each can go under the goal it moves, from its page, or all of them under the North Star.
            </p>
            <Button variant="secondary" size="sm" disabled={placing} onClick={() => void placeAll()}>
              Put them under the North Star
            </Button>
          </div>
        )}

        {!!loose.length && (
          <section aria-labelledby="loose" className="flex flex-col gap-[12px]">
            <div className="flex flex-col gap-[2px]">
              <h2 id="loose" className="text-title font-medium">
                Boards with no goal
              </h2>
              <p className="text-caption text-fg-subtle">Their outcome cards aren't goals yet: opening one makes it one.</p>
            </div>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[16px]">
              {loose.map((p) => (
                <li key={p.id}>
                  <ProjectCard p={p} products={products} onChanged={refresh} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <details className="group flex flex-col gap-[12px]">
          <summary className="cursor-pointer list-none text-title font-medium text-fg-muted marker:hidden hover:text-fg">
            <span className="inline-flex items-center gap-[6px]">
              <ChevronRight size={14} absoluteStrokeWidth strokeWidth={1.25} className="transition-transform group-open:rotate-90" />
              Design <span className="text-caption font-normal text-fg-subtle">· screens and design systems{design.length ? ` · ${design.length}` : ""}</span>
            </span>
          </summary>
          <div className="mt-[12px] flex flex-col gap-[16px]">
            <div className="grid gap-[12px] sm:grid-cols-2">
              <StartTile icon={<Palette {...ICON} />} title="Design system" body="Three directions from your brand, shaped on real screens." onClick={() => void start("system")} />
              <StartTile icon={<Frame {...ICON} />} title="Screens" body="A blank canvas for screens and flows." onClick={() => void start("screens")} />
            </div>
            {!!design.length && (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[16px]">
                {design.map((p) => (
                  <li key={p.id}>
                    <ProjectCard p={p} products={products} onChanged={refresh} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </div>
    </PageFrame>
  );
}
