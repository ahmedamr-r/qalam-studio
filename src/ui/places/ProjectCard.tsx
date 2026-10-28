import type { ReactNode } from "react";
import clsx from "clsx";
import { Frame, MoreHorizontal, Network, Palette } from "lucide-react";
import type { Product } from "@/org/context-md";
import { projectsDb } from "@/projects/db";
import { getSystem } from "@/design-system/registry";
import { projectHref, statusOf, type Project, type ProjectType } from "@/projects/model";
import { deleteProject, renameProjectById } from "@/projects/library";
import { Menu, MenuItem, MenuSeparator, SubMenu } from "../menu";
import { r } from "../recipes";
import { confirmDialog, promptDialog } from "../surfaces/dialog";
import { ago } from "../time";

/*
 * A project as the places show it: its thumbnail and name, what's in it, and its menu (open,
 * rename, which product it's for, delete). A start tile begins a new one.
 */

const TYPE_LABEL: Record<ProjectType, string> = { system: "Design system", screens: "Screens", discovery: "Discovery" };
const TYPE_ICON: Record<ProjectType, typeof Frame> = { system: Palette, screens: Frame, discovery: Network };

const ICON = { size: 16, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export function StartTile({ icon, title, body, onClick }: { icon: ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="q-item q-press flex items-start gap-[12px] rounded-lg bg-panel p-[16px] text-left shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover"
    >
      <span className="grid size-[32px] shrink-0 place-items-center rounded-md bg-raised text-fg">{icon}</span>
      <span className="flex flex-col gap-[4px]">
        <span className="text-body font-medium text-fg">{title}</span>
        <span className="text-caption text-fg-muted">{body}</span>
      </span>
    </button>
  );
}

export function ProjectCard({ p, products, onChanged }: { p: Project; products: Product[]; onChanged: () => void }) {
  const moveTo = async (product: string | null) => {
    await projectsDb.patch(p.id, { product: product ?? undefined });
    onChanged();
  };
  const href = projectHref(p);
  const TypeIcon = TYPE_ICON[p.type];
  const rename = async () => {
    const name = await promptDialog({ title: "Rename project", defaultValue: p.name, confirmLabel: "Rename", validate: (v) => (v.trim() ? null : "Name can't be empty") });
    if (name) await renameProjectById(p.id, name);
    onChanged();
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete “${p.name}”?`,
      body: p.type === "discovery" ? "The board and its chats are removed from the organization's folder. Its sources stay in the organization. This can't be undone." : "Its canvas and chats are removed from the organization's folder. This can't be undone.",
      confirmLabel: "Delete project",
      danger: true,
    });
    if (!ok) return;
    const system = p.type === "system" && p.systemId ? getSystem(p.systemId) : undefined;
    const removeSystem = system
      ? await confirmDialog({
          title: `Also remove “${system.name}” from your systems?`,
          body: "Screens in other projects that use it switch to the built-in system.",
          confirmLabel: "Remove system",
          cancelLabel: "Keep system",
          danger: true,
        })
      : false;
    await deleteProject(p, { removeSystem });
    onChanged();
  };
  return (
    <div className="flex flex-col gap-[8px]">
      <a
        href={href}
        aria-label={`Open ${p.name}`}
        className="q-item grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-stage shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
      >
        {p.thumbnail ? (
          <img src={p.thumbnail} alt="" className="max-h-[86%] max-w-[86%] rounded-sm object-contain" />
        ) : (
          <span className="text-fg-faint">
            <TypeIcon size={24} absoluteStrokeWidth strokeWidth={1.25} />
          </span>
        )}
      </a>
      <div className="flex items-start justify-between gap-[8px] px-[2px]">
        <div className="min-w-0">
          <a href={href} className="block truncate text-body font-medium text-fg hover:underline">
            {p.name}
          </a>
          <p className="flex items-center gap-[6px] text-caption text-fg-muted">
            <span>{TYPE_LABEL[p.type]}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{p.type === "system" ? statusOf(p) : `${statusOf(p)} · ${ago(p.updatedAt)}`}</span>
          </p>
        </div>
        <Menu
          label="Project actions"
          align="end"
          className="w-[180px]"
          trigger={
            <button type="button" aria-label={`Actions for ${p.name}`} className={clsx(r.iconButton, "shrink-0")}>
              <MoreHorizontal {...ICON} />
            </button>
          }
        >
          <MenuItem onSelect={() => window.location.assign(href)}>Open</MenuItem>
          <MenuItem onSelect={() => void rename()}>Rename…</MenuItem>
          {p.type === "discovery" && (
            <SubMenu label="For" checks>
              <MenuItem checked={!p.product} onSelect={() => void moveTo(null)}>
                The whole organization
              </MenuItem>
              {products.map((x) => (
                <MenuItem key={x.id} checked={p.product === x.id} onSelect={() => void moveTo(x.id)}>
                  {x.name}
                </MenuItem>
              ))}
            </SubMenu>
          )}
          <MenuSeparator />
          <MenuItem danger onSelect={() => void remove()}>
            Delete…
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
}
