import type { MouseEvent } from "react";
import clsx from "clsx";
import { Cable, Files, House, Milestone, Moon, Network, NotebookText, PanelLeft, PanelLeftClose, Plus, Sun, type LucideIcon } from "lucide-react";
import { newProduct, saveProduct, useOrgContext } from "@/org/context";
import { placeHref } from "@/projects/model";
import { runCommand } from "@/commands/registry";
import { Tip } from "../controls";
import { r } from "../recipes";
import { useTheme } from "../theme";
import { promptDialog } from "../surfaces/dialog";
import { editContext } from "../org/ContextEditor";
import { withScope, type Scope } from "../home/scope";
import { PLACES, RAIL_PLACES, type Place } from "./places";
import { useFrame } from "./store";
import { useHealthDot } from "./useHealth";
import { StatusDot } from "../viz";

/*
 * The organization's places, drawn two ways. On a page, the sidebar: Home, Boards, Topics, Sources
 * and Decisions, the products (a filter that rides in ?product=), and Connections at the foot; ⌘\
 * folds it to a labelled rail. On a board, a few icon links above its own panels in Studio's rail.
 * Moving between places is a full page load, like every link in the app.
 */

const ICONS: Record<Place, LucideIcon> = { home: House, boards: Network, topics: NotebookText, sources: Files, decisions: Milestone, connections: Cable };
const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

const PRIMARY = PLACES.filter((p) => p.id !== "connections");
const CONNECTIONS = PLACES.find((p) => p.id === "connections")!;

/** The sidebar of a page: `scope` and `onScope` let the page switch products without a reload. */
export function OrgSidebar({ place, scope = "all", onScope }: { place: Place | null; scope?: Scope; onScope?: (s: Scope) => void }) {
  const folded = useFrame((s) => s.sidebar) === "rail";
  const { products } = useOrgContext();
  const href = (p: Place) => placeHref(p) + (p === "connections" ? "" : withScope("", scope));

  if (folded)
    return (
      <nav aria-label="Organization" data-region="rail" className={r.rail}>
        {PLACES.map((p) => {
          const Icon = ICONS[p.id];
          return (
            <Tip key={p.id} label={p.label} side="right">
              <a href={href(p.id)} aria-label={p.label} aria-current={place === p.id ? "page" : undefined} className={clsx(r.railItem, p.id === "connections" && "mt-auto")}>
                <Icon size={18} absoluteStrokeWidth strokeWidth={1.25} />
                <span className={clsx(r.railLabel, "max-w-[56px]")}>{p.short ?? p.label}</span>
                {p.id === "connections" && <ConnectionsDot corner />}
              </a>
            </Tip>
          );
        })}
        <Foot folded />
      </nav>
    );

  // A product picked here filters this place; from a topic page (one page, not a list) it opens the list.
  const scoped = (s: Scope) => placeHref(place && place !== "connections" ? place : "home") + withScope("", s);
  const pick = (s: Scope) => (e: MouseEvent) => {
    if (!onScope) return;
    e.preventDefault();
    onScope(s);
  };
  const addProduct = async () => {
    const name = await promptDialog({ title: "New product", body: "Boards and sources can be for one product, or for the whole organization.", label: "Name", placeholder: "Grocery app", confirmLabel: "Add product", validate: (v) => (v.trim() ? null : "Name it") });
    if (!name) return;
    const p = newProduct(name);
    await saveProduct(p);
    editContext({ kind: "product", product: p });
    if (onScope) onScope(p.id);
    else window.location.assign(scoped(p.id));
  };

  return (
    <nav aria-label="Organization" className={r.sidebar}>
      {PRIMARY.map((p) => {
        const Icon = ICONS[p.id];
        return (
          <a key={p.id} href={href(p.id)} aria-current={place === p.id ? "page" : undefined} className={r.sidebarItem}>
            <Icon {...ICON} />
            {p.label}
          </a>
        );
      })}

      <div className={r.sidebarGroup}>
        <span>Products</span>
        <Tip label="New product" side="right">
          <button type="button" aria-label="New product" onClick={() => void addProduct()} className={r.iconButtonSm}>
            <Plus size={12} absoluteStrokeWidth strokeWidth={1.25} />
          </button>
        </Tip>
      </div>
      {[{ id: "all", name: "Everything" }, { id: "org", name: "Whole organization" }, ...products].map((p) => (
        <a key={p.id} href={scoped(p.id)} onClick={pick(p.id)} aria-current={scope === p.id && place !== "connections" ? true : undefined} className={r.sidebarSub}>
          <span className="truncate">{p.name}</span>
        </a>
      ))}

      <span className="flex-1" />
      <a href={href("connections")} aria-current={place === "connections" ? "page" : undefined} className={r.sidebarItem}>
        <Cable {...ICON} />
        {CONNECTIONS.label}
        <ConnectionsDot />
      </a>
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
 * tooltips. `leave` saves the board before the page goes (session's leaveTo).
 */
export function RailPlaces({ current, leave }: { current: Place | null; leave: (href: string) => void }) {
  return (
    <div role="group" aria-label="Organization" className="flex flex-col items-center gap-[2px]">
      {RAIL_PLACES.map((id) => {
        const p = PLACES.find((x) => x.id === id)!;
        const Icon = ICONS[id];
        const href = placeHref(id);
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
