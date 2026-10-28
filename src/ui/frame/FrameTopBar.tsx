import { Fragment, type ReactNode } from "react";
import clsx from "clsx";
import { orgHref } from "@/projects/model";
import { QalamMark } from "../brand";
import { r } from "../recipes";
import { OrgSwitcher } from "../org/OrgSwitcher";
import { setCurrentOrg, useCurrentOrg } from "./store";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * A page's top bar, aligned with Studio's: the mark in the rail's column, the organization (its
 * menu switches, makes or renames one), where you are in it, and the page's own actions on the right.
 */
export function FrameTopBar({ crumbs = [], right }: { crumbs?: Crumb[]; right?: ReactNode }) {
  const org = useCurrentOrg();
  return (
    <header className={clsx(r.topBar, "min-w-0")} data-region="topbar">
      <a href={orgHref()} aria-label="Home" className={r.brandCell}>
        <QalamMark size={20} />
      </a>
      <nav aria-label="Location" className="flex min-w-0 items-center gap-[2px] text-body text-fg-subtle">
        {org ? <OrgSwitcher org={org} onRenamed={setCurrentOrg} /> : <span className="px-[8px] font-medium text-fg">Organization</span>}
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
      <div className={r.topRight}>{right}</div>
    </header>
  );
}
