import clsx from "clsx";
import { FileText, MoreHorizontal } from "lucide-react";
import { SOURCE_KIND_LABEL, type SourceRecord } from "@/discovery/sources";
import type { Product } from "@/org/context-md";
import { orgFetch } from "@/org/client";
import { projectHref, type Project } from "@/projects/model";
import { Menu, MenuItem } from "../menu";
import { r } from "../recipes";
import { confirmDialog } from "../surfaces/dialog";

/**
 * The organization's sources: interviews, documents, pages, brain dumps. Each belongs to the
 * organization; the boards that use it are listed with it.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

export function SourcesList({ sources, projects, products, onChanged }: { sources: SourceRecord[]; projects: Project[]; products: Product[]; onChanged: () => void }) {
  if (!sources.length) return <p className="text-body text-fg-muted">No sources yet. Add interviews, documents or pages on a board: they're kept here, for every board to use.</p>;
  const boardName = (id: string) => projects.find((p) => p.id === id)?.name;
  const remove = async (s: SourceRecord) => {
    const ok = await confirmDialog({
      title: `Delete “${s.title}”?`,
      body: `It's removed from the organization${s.boards?.length ? ` and from ${s.boards.length === 1 ? "the board" : `the ${s.boards.length} boards`} that use it` : ""}. Quotes already on cards stay, without the link back to it.`,
      confirmLabel: "Delete source",
      danger: true,
    });
    if (!ok) return;
    await orgFetch(`/sources/${s.id}`, { method: "DELETE" });
    onChanged();
  };
  return (
    <ul className="flex flex-col divide-y divide-line-subtle rounded-lg bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      {[...sources]
        .sort((a, b) => b.addedAt - a.addedAt)
        .map((s) => {
          const product = products.find((p) => p.id === s.product)?.name;
          const boards = (s.boards ?? []).filter((b) => boardName(b));
          return (
            <li key={s.id} className="flex items-start gap-[10px] px-[12px] py-[10px]">
              <span className="mt-[2px] text-fg-subtle">
                <FileText {...ICON} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="truncate text-body text-fg">{s.title}</span>
                <span className="text-caption text-fg-muted">
                  {[SOURCE_KIND_LABEL[s.kind], `${s.quotes.length} ${s.quotes.length === 1 ? "quote" : "quotes"}`, product ?? "Whole organization"].join(" · ")}
                </span>
                <span className="text-caption text-fg-subtle">
                  {boards.length ? (
                    <>
                      On{" "}
                      {boards.map((b, i) => (
                        <span key={b}>
                          {i > 0 && ", "}
                          <a className="underline decoration-fg/20 underline-offset-2 hover:text-fg" href={`${projectHref({ id: b, type: "discovery" })}?source=${s.id}`}>
                            {boardName(b)}
                          </a>
                        </span>
                      ))}
                    </>
                  ) : (
                    "Not on a board"
                  )}
                </span>
              </div>
              <Menu
                label="Source actions"
                align="end"
                className="w-[180px]"
                trigger={
                  <button type="button" aria-label={`Actions for ${s.title}`} className={clsx(r.iconButton, "shrink-0")}>
                    <MoreHorizontal {...ICON} />
                  </button>
                }
              >
                <MenuItem danger onSelect={() => void remove(s)}>
                  Delete…
                </MenuItem>
              </Menu>
            </li>
          );
        })}
    </ul>
  );
}
