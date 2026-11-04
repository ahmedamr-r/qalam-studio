import { useEffect, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import * as Tooltip from "@radix-ui/react-tooltip";
import { dispatchPageKey } from "@/commands/pages";
import Toasts from "../toast";
import { DialogHost } from "../surfaces/dialog";
import { ContextEditorHost } from "../org/ContextEditor";
import { spaceHref } from "@/projects/model";
import { FrameTopBar, type Crumb } from "./FrameTopBar";
import { PagePalette } from "./PagePalette";
import type { Place } from "./places";
import type { Space } from "./spaces";
import { keepSpace, lastSpace } from "./useSpace";

/**
 * The frame every page sits in, the canvas too: the top bar (the organization, the canvas, where
 * you are, the page's actions, Connections) and the page, which scrolls under it. The canvas puts
 * Qalam AI's chat at its own left (../space/chat/). What every page needs is mounted here once:
 * toasts, the dialogs, the About and product editor, ⌘K and the page keys. `space` is the space the
 * page is in (kept for the tab, and its canvas named in the top bar); a page outside the spaces
 * leaves it out and links into the tab's last one. `fill` lets a page of panels scroll inside itself.
 */
export function PageFrame({
  place,
  crumbs,
  right,
  space,
  fill,
  children,
}: {
  place: Place | null;
  crumbs?: Crumb[];
  right?: ReactNode;
  space?: Space;
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
  // A page beside the canvas leads back to it (the canvas menu goes to another).
  const trail = place !== "home" && crumbs?.length ? [{ label: "Canvas", href: spaceHref(here) }, ...crumbs] : crumbs;
  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      <div className="q-shell grid h-screen grid-rows-[var(--topbar-h)_minmax(0,1fr)] overflow-hidden bg-app text-fg">
        <FrameTopBar crumbs={trail} right={right} space={space} />
        {/* Toasts sit over the page, bottom-centre (no toolbar here to clear). A page of panels lays its own on the Desk. */}
        <div className={clsx("relative min-h-0 min-w-0", !fill && "px-[8px] pb-[8px]")} style={{ "--toolbar-h": "0px" } as CSSProperties}>
          <main className={fill ? "h-full overflow-hidden" : "h-full overflow-y-auto rounded-xl bg-app shadow-panel"}>{children}</main>
          <Toasts />
        </div>
      </div>
      <DialogHost />
      <ContextEditorHost />
      <PagePalette space={here} />
    </Tooltip.Provider>
  );
}
