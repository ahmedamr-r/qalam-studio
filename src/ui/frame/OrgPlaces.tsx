import clsx from "clsx";
import { Cable, Milestone, Workflow, type LucideIcon } from "lucide-react";
import { newProduct, productOf, saveProduct } from "@/org/context";
import { spaceHref } from "@/projects/model";
import { Tip } from "../controls";
import { r } from "../recipes";
import { promptDialog } from "../surfaces/dialog";
import { editContext } from "../org/ContextEditor";
import { navigate } from "../nav";
import { PLACES, RAIL_PLACES, type Place } from "./places";
import { useHealthDot } from "./useHealth";
import { hereHref } from "./useSpace";
import { StatusDot } from "../viz";

/*
 * The organization's canvases and places outside the top bar's menus (./CanvasMenu.tsx): a space's
 * tile, making a product, and on a board a few icon links above its own panels in Studio's rail
 * (leaving a board is a full page load).
 */

const ICONS: Record<Place, LucideIcon> = { home: Workflow, decisions: Milestone, connections: Cable };

const TILE = { sm: "size-[16px] rounded-[4px] text-micro", md: "size-[24px] rounded-md text-caption", lg: "size-[36px] rounded-lg text-heading" } as const;

/** A space's initial, its mark in the canvas menu, ⌘K and the organizations' list. */
export function SpaceTile({ name, size = "md" }: { name: string; size?: keyof typeof TILE }) {
  return (
    <span aria-hidden className={clsx(r.spaceTile, TILE[size])}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** A new product: named, then said what it is, then you're on its canvas. */
export async function addProduct(org: string) {
  const name = await promptDialog({ title: "New product", body: `Goals, problems, boards and sources can be for one product, or for the whole ${org}. Each product has a canvas of its own.`, label: "Name", placeholder: "Grocery app", confirmLabel: "Add product", validate: (v) => (v.trim() ? null : "Name it") });
  if (!name) return;
  const p = newProduct(name);
  await saveProduct(p);
  await editContext({ kind: "product", product: p });
  // Deleted from the editor straight away: stay where you are.
  if (productOf(p.id)) navigate(spaceHref(p.id));
}

/** Connections speaks only when something needs fixing (This Mac's worst row). */
export function ConnectionsDot({ className }: { className?: string }) {
  const dot = useHealthDot();
  if (!dot || dot === "ok") return null;
  return <StatusDot tone={dot === "bad" ? "bad" : dot === "warn" ? "warn" : "off"} className={className} />;
}

/**
 * The organization's places above a board's panels, in Studio's rail: icons only, named in their
 * tooltips, in the space the board shows in (its product's, or the one this tab came from).
 * `leave` saves the board before the page goes (session's leaveTo).
 */
export function RailPlaces({ current, product, leave }: { current: Place | null; product: string | null | undefined; leave: (href: string) => void }) {
  return (
    <div role="group" aria-label="Project" className="flex flex-col items-center gap-[2px]">
      {RAIL_PLACES.map((id) => {
        const p = PLACES.find((x) => x.id === id)!;
        const Icon = ICONS[id];
        const href = hereHref(id, product ? [product] : []);
        return (
          <Tip key={id} label={p.label} side="right">
            <a
              href={href}
              aria-label={p.label}
              aria-current={current === id ? true : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                leave(href);
              }}
              className={r.railPlace}
            >
              <Icon size={16} absoluteStrokeWidth strokeWidth={1.25} />
            </a>
          </Tip>
        );
      })}
      <span aria-hidden className={r.railDivider} />
    </div>
  );
}
