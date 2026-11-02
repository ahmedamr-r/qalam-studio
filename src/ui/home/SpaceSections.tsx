import { useState } from "react";
import clsx from "clsx";
import { ChevronRight, Frame, Palette, Plus } from "lucide-react";
import { changeGoal, type GoalsNow } from "@/goals/client";
import type { Bearing } from "@/goals/bearings";
import type { SourceRecord } from "@/discovery/sources";
import type { Product } from "@/org/context-md";
import type { NeedsNow } from "@/org/needs";
import type { TopicInfo } from "@/hub/topics";
import { projectHref, type Project, type ProjectType } from "@/projects/model";
import { createProject } from "@/projects/session";
import { Button, Select } from "../controls";
import { r } from "../recipes";
import { inSpace, type Space } from "../frame/spaces";
import { ProblemsList } from "../goals/ProblemsList";
import { FilingBanner, TopicsList } from "../org/TopicsList";
import { ProjectCard, StartTile } from "../places/ProjectCard";
import { ProductMaps } from "../places/ProductMaps";
import { SeenSection } from "../seen/SeenSection";
import { newTopic } from "../space/new";
import { lab } from "@/lab";

/*
 * What a space's panel shows with nothing picked, besides Ask and Needs a look (./Home.tsx): the
 * problems customers raise, ranked by what backs them (each opening its page in the panel), the
 * segment and product pages, goals that feed no goal yet, and the lab's own parts (design work,
 * what people see, what the code does) where they're on.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** The space's problems, the best-backed first, filtered by the goal they bear on; what customers said that no page has taken in waits on top. */
export function SpaceProblems({ space, needs, links, tree, sources, onFiled }: { space: Space; needs: NeedsNow | null; links: Bearing[]; tree: GoalsNow; sources: SourceRecord[]; onFiled: () => void }) {
  const [goal, setGoal] = useState("all");
  const scoped = (needs?.needs ?? []).filter((n) => inSpace(n.products, space));
  const shown = scoped.filter((n) => {
    if (goal === "all") return true;
    const of = links.filter((l) => l.need === n.topic);
    return goal === "none" ? !of.length : of.some((l) => l.goal === goal);
  });
  return (
    <section aria-labelledby="space-problems" className="flex flex-col gap-[10px]">
      <div className="flex items-center justify-between gap-[8px]">
        <h2 id="space-problems" className="text-title font-medium">
          Problems
          {needs && scoped.length > 0 && <span className="ml-[6px] text-caption font-normal text-fg-subtle tnum">{scoped.length}</span>}
        </h2>
        <Button size="sm" variant="ghost" onClick={() => void newTopic("need", space)}>
          <Plus {...ICON} className="mr-[4px]" />
          New
        </Button>
      </div>
      {!!tree.goals.length && scoped.length > 0 && (
        <Select
          ariaLabel="Bears on"
          value={goal}
          onChange={setGoal}
          options={[{ value: "all", label: "Every goal" }, ...tree.goals.filter((g) => inSpace(g.product, space) || g.id === tree.north).map((g) => ({ value: g.id, label: g.id === tree.north ? `North Star: ${g.title}` : g.title })), { value: "none", label: "No goal yet" }]}
        />
      )}
      <FilingBanner sources={sources.filter((s) => inSpace(s.product, space))} onFiled={onFiled} />
      {!needs ? (
        <div className="flex flex-col gap-[6px]" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className={clsx(r.skeleton, "h-[48px] rounded-lg")} />
          ))}
        </div>
      ) : !needs.indexed ? (
        <p className="text-caption text-fg-subtle">Ranking problems takes this computer&apos;s search, which isn&apos;t running. Connections says why.</p>
      ) : shown.length ? (
        <ProblemsList needs={shown} links={links} goals={tree.goals} limit={8} />
      ) : (
        <p className="text-caption text-fg-muted">{scoped.length ? "None here." : "No problems yet. Bring what you have to the chat (or Sources on the canvas): reports, research, interviews, tickets. Qalam AI files what it states into one page per problem."}</p>
      )}
    </section>
  );
}

/** The segment and product pages: who the customers are, and what each product does for them. */
export function SpacePages({ space, topics, sources, products, onFiled }: { space: Space; topics: TopicInfo[] | null; sources: SourceRecord[]; products: Product[]; onFiled: () => void }) {
  const pages = topics?.filter((t) => t.kind !== "need" && inSpace(t.products, space)) ?? [];
  if (!pages.length) return null;
  return (
    <section aria-labelledby="space-pages" className="flex flex-col gap-[10px]">
      <div className="flex items-center justify-between gap-[8px]">
        <h2 id="space-pages" className="text-title font-medium">
          Who and what
        </h2>
        <Button size="sm" variant="ghost" onClick={() => void newTopic("segment", space)}>
          <Plus {...ICON} className="mr-[4px]" />
          Segment
        </Button>
      </div>
      <TopicsList topics={pages} sources={sources.filter((s) => inSpace(s.product, space))} products={products} onFiled={onFiled} banner={false} />
    </section>
  );
}

/** Goals that feed no goal yet, all put under the North Star in one go. */
export function UnplacedGoals({ tree, space }: { tree: GoalsNow; space: Space }) {
  const [placing, setPlacing] = useState(false);
  const unplaced = tree.north ? tree.goals.filter((g) => !g.parent && g.id !== tree.north && inSpace(g.product, space)) : [];
  if (!unplaced.length) return null;
  const placeAll = async () => {
    setPlacing(true);
    for (const g of unplaced) await changeGoal(g.id, { parent: tree.north }).catch(() => {});
    setPlacing(false);
  };
  return (
    <div role="status" className="flex flex-col items-start gap-[8px] rounded-lg bg-raised px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="text-caption text-fg-muted">
        {unplaced.length === 1 ? "1 goal doesn't" : `${unplaced.length} goals don't`} feed a goal yet. Each can go under the goal it moves, from its page, or all of them under the North Star.
      </p>
      <Button variant="secondary" size="sm" disabled={placing} onClick={() => void placeAll()}>
        Put them under the North Star
      </Button>
    </div>
  );
}

/** The lab's parts of a space (src/lab.ts), each where it's on: design work, what people see, what the code does. */
export function LabSections({ space, products, projects, onChanged }: { space: Space; products: Product[]; projects: Project[]; onChanged: () => void }) {
  const design = projects.filter((p) => p.type !== "discovery");
  const start = async (type: ProjectType) => {
    const p = await createProject(type, type === "system" ? "Untitled system" : "Untitled", {});
    window.location.assign(projectHref(p));
  };
  return (
    <>
      {lab("design") && (
        <details className="group flex flex-col gap-[12px]">
          <summary className="cursor-pointer list-none text-title font-medium text-fg-muted marker:hidden hover:text-fg">
            <span className="inline-flex items-center gap-[6px]">
              <ChevronRight {...ICON} className="transition-transform group-open:rotate-90" />
              Design <span className="text-caption font-normal text-fg-subtle">· screens and design systems{design.length ? ` · ${design.length}` : ""}</span>
            </span>
          </summary>
          <div className="mt-[12px] flex flex-col gap-[12px]">
            <StartTile icon={<Palette {...ICON} size={16} />} title="Design system" body="Three directions from your brand, shaped on real screens." onClick={() => void start("system")} />
            <StartTile icon={<Frame {...ICON} size={16} />} title="Screens" body="A blank canvas for screens and flows." onClick={() => void start("screens")} />
            {design.map((p) => (
              <ProjectCard key={p.id} p={p} products={products} onChanged={onChanged} />
            ))}
          </div>
        </details>
      )}
      {lab("seen") && <SeenSection product={space} products={products} />}
      {lab("code") && <ProductMaps product={space} products={products} />}
    </>
  );
}
