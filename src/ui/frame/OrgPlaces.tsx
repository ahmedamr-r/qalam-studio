import clsx from "clsx";
import { Cable, ChevronsUpDown, Files, House, MessageSquareWarning, Milestone, Moon, PanelLeft, PanelLeftClose, Sun, Target, type LucideIcon } from "lucide-react";
import { placeHref, spaceHref, spacesHref } from "@/projects/model";
import { runCommand } from "@/commands/registry";
import { Tip } from "../controls";
import { r } from "../recipes";
import { useTheme } from "../theme";
import { PLACES, RAIL_PLACES, type Place } from "./places";
import type { Space } from "./spaces";
import { useFrame } from "./store";
import { useHealthDot } from "./useHealth";
import { hereHref, useSpaceName } from "./useSpace";
import { StatusDot } from "../viz";

/*
 * The organization's places, drawn two ways. On a page, the sidebar: the space you're in on top
 * (the organization's or a product's, ./spaces.ts; it opens the picker), then Home, Goals,
 * Problems, Evidence and Decisions in that space, and Connections at the foot; ⌘\ folds it to a
 * labelled rail. On a board, a few icon links above its own panels in Studio's rail. Moving
 * between places is a full page load, like every link in the app.
 */

const ICONS: Record<Place, LucideIcon> = { home: House, goals: Target, problems: MessageSquareWarning, evidence: Files, decisions: Milestone, connections: Cable };
const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

const PRIMARY = PLACES.filter((p) => p.id !== "connections");
const CONNECTIONS = PLACES.find((p) => p.id === "connections")!;

const TILE = { sm: "size-[16px] rounded-[4px] text-micro", md: "size-[24px] rounded-md text-caption", lg: "size-[36px] rounded-lg text-heading" } as const;

/** A space's initial, its mark in the sidebar, ⌘K and the picker. */
export function SpaceTile({ name, size = "md" }: { name: string; size?: keyof typeof TILE }) {
  return (
    <span aria-hidden className={clsx(r.spaceTile, TILE[size])}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** The sidebar of a page, its places in `space`. */
export function OrgSidebar({ place, space }: { place: Place | null; space: Space }) {
  const folded = useFrame((s) => s.sidebar) === "rail";
  const name = useSpaceName(space);
  const href = (p: Place) => spaceHref(space, p);

  if (folded)
    return (
      <nav aria-label="Organization" data-region="rail" className={r.rail}>
        <Tip label={`${name} · Switch space`} side="right">
          <a href={spacesHref()} aria-label={`${name}: switch space`} className={r.railItem}>
            <SpaceTile name={name} />
          </a>
        </Tip>
        <span aria-hidden className={r.railDivider} />
        {PLACES.map((p) => {
          const Icon = ICONS[p.id];
          return (
            <Tip key={p.id} label={p.label} side="right">
              <a href={href(p.id)} aria-label={p.label} aria-current={place === p.id ? "page" : undefined} className={clsx(r.railItem, p.id === "connections" && "mt-auto")}>
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
      <Tip label="Switch space" side="right">
        <a href={spacesHref()} aria-label={`${name}: switch space`} className={r.sidebarSpace}>
          <SpaceTile name={name} />
          <span className="truncate">{name}</span>
          <ChevronsUpDown size={14} absoluteStrokeWidth strokeWidth={1.25} />
        </a>
      </Tip>
      {PRIMARY.map((p) => {
        const Icon = ICONS[p.id];
        return (
          <a key={p.id} href={href(p.id)} aria-current={place === p.id ? "page" : undefined} className={r.sidebarItem}>
            <Icon {...ICON} />
            {p.label}
          </a>
        );
      })}

      <span className="flex-1" />
      <a href={placeHref("connections")} aria-current={place === "connections" ? "page" : undefined} className={r.sidebarItem}>
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
