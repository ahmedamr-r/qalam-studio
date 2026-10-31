import clsx from "clsx";
import { Cable, Info, Milestone, Moon, PanelLeft, PanelLeftClose, Plus, Sun, Workflow, type LucideIcon } from "lucide-react";
import { newProduct, productOf, saveProduct, useOrgContext } from "@/org/context";
import { wordsFor } from "@/org/words";
import { spaceHref } from "@/projects/model";
import { runCommand } from "@/commands/registry";
import { IconBtn, Tip } from "../controls";
import { r } from "../recipes";
import { useTheme } from "../theme";
import { promptDialog } from "../surfaces/dialog";
import { editContext } from "../org/ContextEditor";
import { navigate } from "../nav";
import { PLACES, placeShown, RAIL_PLACES, type Place } from "./places";
import type { Space } from "./spaces";
import { useCurrentOrg, useFrame } from "./store";
import { useHealthDot } from "./useHealth";
import { hereHref } from "./useSpace";
import { StatusDot } from "../viz";

/*
 * The organization's canvases, drawn two ways. On a page, the sidebar: the organization's own
 * canvas on top, its products' under it (./spaces.ts), New product, and Decisions and Connections
 * at the foot; ⌘\ folds it to a labelled rail. On a board, a few icon links above its own panels
 * in Studio's rail. Between pages, they move in place (../nav.ts); from a board, leaving is a full
 * page load.
 */

const ICONS: Record<Place, LucideIcon> = { home: Workflow, decisions: Milestone, connections: Cable };
const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** Below the canvases: Decisions (hidden in v0.1, src/lab.ts) and Connections. */
const FOOT: readonly Place[] = ["decisions", "connections"];

const TILE = { sm: "size-[16px] rounded-[4px] text-micro", md: "size-[24px] rounded-md text-caption", lg: "size-[36px] rounded-lg text-heading" } as const;

/** A space's initial, its mark in the sidebar, ⌘K and the organizations' list. */
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

/** The sidebar of a page: the organization's canvases, `space`'s marked while the page is its canvas. */
export function OrgSidebar({ place, space }: { place: Place | null; space: Space }) {
  const folded = useFrame((s) => s.sidebar) === "rail";
  const org = useCurrentOrg();
  const words = wordsFor(org?.shape);
  const { products, about } = useOrgContext();
  const name = org?.name ?? "";
  const canvases: { id: Space; name: string }[] = [{ id: null, name }, ...products.map((p) => ({ id: p.id, name: p.name }))];
  const foot = PLACES.filter((p) => FOOT.includes(p.id) && placeShown(p.id));
  // Connections and Decisions are pages of their own: no canvas is marked there.
  const current = (id: Space) => id === space && !FOOT.includes(place as Place);
  const aboutIt = (id: Space) => {
    const p = id ? productOf(id) : undefined;
    void (p ? editContext({ kind: "product", product: p }) : editContext({ kind: "org", name, about }));
  };

  if (folded)
    return (
      <nav aria-label="Organization" data-region="rail" className={r.rail}>
        {canvases.map((c) => (
          <Tip key={c.id ?? ""} label={c.name} side="right">
            <a href={spaceHref(c.id)} aria-label={c.name} aria-current={current(c.id) ? "page" : undefined} className={r.railItem}>
              <SpaceTile name={c.name || "·"} size={c.id ? "sm" : "md"} />
            </a>
          </Tip>
        ))}
        <Tip label="New product" side="right">
          <button type="button" aria-label="New product" onClick={() => void addProduct(words.org)} className={r.railItem}>
            <Plus size={16} absoluteStrokeWidth strokeWidth={1.25} />
          </button>
        </Tip>
        {foot.map((p, i) => {
          const Icon = ICONS[p.id];
          return (
            <Tip key={p.id} label={p.label} side="right">
              <a href={spaceHref(space, p.id)} aria-label={p.label} aria-current={place === p.id ? "page" : undefined} className={clsx(r.railItem, i === 0 && "mt-auto")}>
                <Icon size={18} absoluteStrokeWidth strokeWidth={1.25} />
                <span className={clsx(r.railLabel, "max-w-[56px]")}>{p.label}</span>
                {p.id === "connections" && <ConnectionsDot corner />}
              </a>
            </Tip>
          );
        })}
        <Foot folded />
      </nav>
    );

  return (
    <nav aria-label="Organization" className={r.sidebar}>
      {canvases.map((c) => (
        <div key={c.id ?? ""} className="group relative flex shrink-0">
          <a
            href={spaceHref(c.id)}
            aria-current={current(c.id) ? "page" : undefined}
            className={clsx(r.sidebarItem, "flex-1 pr-[32px]", c.id ? "pl-[20px]" : "mb-[2px] h-[40px] gap-[8px] px-[6px] font-medium text-fg")}
          >
            <SpaceTile name={c.name || "·"} size={c.id ? "sm" : "md"} />
            <span className="truncate">{c.name}</span>
          </a>
          <IconBtn size="sm" label={`About ${c.name}`} onClick={() => aboutIt(c.id)} className="absolute top-1/2 right-[4px] -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
            <Info size={14} absoluteStrokeWidth strokeWidth={1.25} />
          </IconBtn>
        </div>
      ))}
      <button type="button" onClick={() => void addProduct(words.org)} className={clsx(r.sidebarItem, "pl-[20px] text-fg-subtle")}>
        <Plus {...ICON} />
        New product
      </button>

      <span className="flex-1" />
      {foot.map((p) => {
        const Icon = ICONS[p.id];
        return (
          <a key={p.id} href={spaceHref(space, p.id)} aria-current={place === p.id ? "page" : undefined} className={r.sidebarItem}>
            <Icon {...ICON} />
            {p.label}
            {p.id === "connections" && <ConnectionsDot />}
          </a>
        );
      })}
      <Foot />
    </nav>
  );
}

/** Connections speaks only when something needs fixing (This Mac's worst row). */
function ConnectionsDot({ corner }: { corner?: boolean }) {
  const dot = useHealthDot();
  if (!dot || dot === "ok") return null;
  return <StatusDot tone={dot === "bad" ? "bad" : dot === "warn" ? "warn" : "off"} className={corner ? "absolute top-[8px] right-[11px] shadow-[0_0_0_2px_var(--color-app)]" : "ml-auto"} />;
}

/** The theme and the fold, at the foot. */
function Foot({ folded }: { folded?: boolean }) {
  const theme = useTheme((s) => s.resolved);
  return (
    <div className={clsx("flex items-center gap-[2px] pt-[6px]", folded ? "flex-col" : "px-[2px]")}>
      <Tip label={folded ? "Open the sidebar" : "Fold the sidebar"} command="frame.sidebar" side="right">
        <button type="button" aria-label={folded ? "Open the sidebar" : "Fold the sidebar"} onClick={() => runCommand("frame.sidebar", "toolbar")} className={r.iconButton}>
          {folded ? <PanelLeft {...ICON} /> : <PanelLeftClose {...ICON} />}
        </button>
      </Tip>
      <Tip label={theme === "dark" ? "Light theme" : "Dark theme"} side="right">
        <button type="button" aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"} onClick={() => runCommand("view.theme-toggle", "toolbar")} className={r.iconButton}>
          {theme === "dark" ? <Moon {...ICON} /> : <Sun {...ICON} />}
        </button>
      </Tip>
    </div>
  );
}

/**
 * The organization's places above a board's panels, in Studio's rail: icons only, named in their
 * tooltips, in the space the board shows in (its product's, or the one this tab came from).
 * `leave` saves the board before the page goes (session's leaveTo).
 */
export function RailPlaces({ current, product, leave }: { current: Place | null; product: string | null | undefined; leave: (href: string) => void }) {
  return (
    <div role="group" aria-label="Organization" className="flex flex-col items-center gap-[2px]">
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
