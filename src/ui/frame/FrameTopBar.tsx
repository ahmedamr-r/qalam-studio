import { Fragment, type ReactNode } from "react";
import clsx from "clsx";
import { orgsHref } from "@/projects/model";
import { QalamMark } from "../brand";
import { r } from "../recipes";
import { OrgSwitcher } from "../org/OrgSwitcher";
import { CanvasMenu, FrameTools } from "./CanvasMenu";
import type { Space } from "./spaces";
import { setCurrentOrg, useCurrentOrg } from "./store";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * A page's top bar, aligned with Studio's: the mark (every organization), the organization (its
 * menu switches, makes or renames one), the canvas the page is in (its menu goes to another, when
 * there are products), where you are, and the page's own actions on the right, then Connections
 * and the theme. `space` undefined: the page isn't in a space.
 */
export function FrameTopBar({ crumbs = [], right, space }: { crumbs?: Crumb[]; right?: ReactNode; space?: Space }) {
  const org = useCurrentOrg();
  return (
    <header className={clsx(r.shellBar, "min-w-0")} data-region="topbar">
      <a href={orgsHref()} aria-label="All projects" className={r.brandCell}>
        <QalamMark size={20} />
      </a>
      <nav aria-label="Location" className="flex min-w-0 items-center gap-[2px] text-body text-fg-subtle">
        {org ? <OrgSwitcher org={org} onRenamed={setCurrentOrg} /> : <span className="px-[8px] font-medium text-fg">Project</span>}
        {space !== undefined && <CanvasMenu space={space} />}
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            <span aria-hidden className={r.crumbSep}>
              /
            </span>
            {c.href ? (
              <a href={c.href} className="q-item inline-flex h-[28px] max-w-[240px] items-center rounded-md px-[6px] hover:bg-hover hover:text-fg-muted">
                <span className="truncate">{c.label}</span>
              </a>
            ) : (
              <span aria-current="page" className="max-w-[320px] truncate px-[6px] font-medium text-fg">
                {c.label}
              </span>
            )}
          </Fragment>
        ))}
      </nav>
      <div className={r.topRight}>
        {right}
        <FrameTools space={space ?? null} />
      </div>
    </header>
  );
}

