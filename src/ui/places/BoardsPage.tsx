import clsx from "clsx";
import { ChevronRight, Frame, Network, Palette } from "lucide-react";
import { useOrgContext } from "@/org/context";
import { projectHref, type ProjectType } from "@/projects/model";
import { createProject } from "@/projects/session";
import { Button } from "../controls";
import { r } from "../recipes";
import { PageFrame } from "../frame/PageFrame";
import { inScope } from "../home/scope";
import { useScope } from "../home/useScope";
import { useOrgData } from "../org/useOrgData";
import { PlaceHead } from "./PlaceHead";
import { ProjectCard, StartTile } from "./ProjectCard";

/**
 * The organization's boards, for the product in view (the sidebar's Products), newest opened first.
 * Design work (screens, design systems) waits below, on hold.
 */

const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export default function BoardsPage() {
  const [scope, setScope] = useScope();
  const { projects, refresh } = useOrgData();
  const products = useOrgContext((s) => s.products);
  const product = scope !== "all" && scope !== "org" ? products.find((p) => p.id === scope) : undefined;
  const boards = (projects ?? []).filter((p) => p.type === "discovery" && inScope(p.product, scope));
  const design = (projects ?? []).filter((p) => p.type !== "discovery");

  const start = async (type: ProjectType) => {
    const extra = type === "discovery" && product ? { product: product.id } : {};
    const p = await createProject(type, type === "system" ? "Untitled system" : type === "discovery" ? "Untitled board" : "Untitled", extra);
    window.location.assign(projectHref(p));
  };

  return (
    <PageFrame place="boards" crumbs={[{ label: "Boards" }]} scope={scope} onScope={setScope}>
      <div className={clsx(r.pageMain, "max-w-[1080px]")}>
        <PlaceHead title="Boards" count={projects ? boards.length : null} scope={scope}>
          <Button size="sm" onClick={() => void start("discovery")}>
            New board
          </Button>
        </PlaceHead>
        {projects === null ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[16px]" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className={clsx(r.skeleton, "aspect-[4/3] rounded-lg")} />
            ))}
          </div>
        ) : boards.length === 0 ? (
          <StartTile icon={<Network {...ICON} />} title="Start a board" body="The outcome you're after, your customers' needs and what to try, as a tree." onClick={() => void start("discovery")} />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[16px]">
            {boards.map((p) => (
              <li key={p.id}>
                <ProjectCard p={p} products={products} onChanged={refresh} />
              </li>
            ))}
          </ul>
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
