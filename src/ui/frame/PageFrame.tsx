import { useEffect, type CSSProperties, type ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { dispatchPageKey } from "@/commands/pages";
import Toasts from "../toast";
import { DialogHost } from "../surfaces/dialog";
import { ContextEditorHost } from "../org/ContextEditor";
import { spaceHref } from "@/projects/model";
import { FrameTopBar, type Crumb } from "./FrameTopBar";
import { OrgSidebar } from "./OrgPlaces";
import { PagePalette } from "./PagePalette";
import type { Place } from "./places";
import type { Space } from "./spaces";
import { keepSpace, lastSpace, useSpaceName } from "./useSpace";

/**
 * The frame every page outside the canvas sits in: the top bar (the organization, where you are,
 * the page's actions), the sidebar (the space and its places; ⌘\ folds it to the rail), and the
 * page, which scrolls under them. What every page needs is mounted here once: toasts, the dialogs,
 * the About and product editor, ⌘K and the page keys. `space` is the space the page is in (kept
 * for the tab, and named in the top bar when it's a product's); a page outside the spaces leaves
 * it out and links into the tab's last one. `focus` leaves the sidebar out (first run, the
 * picker); `fill` lets a page of panels scroll inside itself.
 */
export function PageFrame({
  place,
  crumbs,
  right,
  space,
  focus,
  fill,
  children,
}: {
  place: Place | null;
  crumbs?: Crumb[];
  right?: ReactNode;
  space?: Space;
  focus?: boolean;
  /** The page fills the space and scrolls inside itself (panels), instead of the page scrolling. */
  fill?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => void dispatchPageKey(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (space !== undefined) keepSpace(space);
  }, [space]);
  const here = space !== undefined ? space : (lastSpace() ?? null);
  const named = useSpaceName(space ?? null);
  // A product's space is named after the organization: Basket / Grocery app / Goals.
  const trail = space && named ? [{ label: named, href: crumbs?.length ? spaceHref(space) : undefined }, ...(crumbs ?? [])] : crumbs;
  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      <div className="grid h-screen grid-rows-[var(--topbar-h)_minmax(0,1fr)] overflow-hidden bg-app text-fg">
        <FrameTopBar crumbs={trail} right={right} home={spaceHref(here)} />
        <div className="flex min-h-0">
          {!focus && <OrgSidebar place={place} space={here} />}
          {/* Toasts sit over the page, bottom-centre (no toolbar here to clear). */}
          <div className="relative min-h-0 min-w-0 flex-1" style={{ "--toolbar-h": "0px" } as CSSProperties}>
            <main className={fill ? "h-full overflow-hidden" : "h-full overflow-y-auto"}>{children}</main>
            <Toasts />
          </div>
        </div>
      </div>
      <DialogHost />
      <ContextEditorHost />
      <PagePalette space={here} />
    </Tooltip.Provider>
  );
}
