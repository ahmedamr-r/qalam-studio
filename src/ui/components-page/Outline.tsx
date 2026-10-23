import clsx from "clsx";
import { Component, LucideProvider } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { studio, useStudio } from "@/doc/store";
import { r } from "../recipes";
import { glideToLayer, onCanvasReady } from "../discovery/canvas";

/**
 * The Components page's layers: its sections and their components, read-only (the page is drawn
 * from the design system). A click selects the component and brings it into view.
 */
export default function ComponentsOutline() {
  // One string per section (stable under shallow compare): its id, name and its cards' ids.
  const rows = useStudio(
    useShallow((s) =>
      s.doc.roots.map((id) => {
        const n = s.doc.nodes[id];
        const list = n?.children.find((c) => s.doc.nodes[c]?.name === "Components");
        return [id, n?.name ?? "", ...(list ? s.doc.nodes[list].children : [])].join("\u0001");
      }),
    ),
  );
  const sections = rows.map((row) => {
    const [id, name, ...cards] = row.split("\u0001");
    return { id, name, cards };
  });
  if (!sections.length)
    return (
      <div className="flex flex-col gap-[8px] px-[16px] py-[12px]">
        <div className={clsx(r.skeleton, "h-[20px] w-[60%]")} />
        <div className={clsx(r.skeleton, "h-[20px] w-[80%]")} />
        <div className={clsx(r.skeleton, "h-[20px] w-[70%]")} />
      </div>
    );
  return (
    <LucideProvider strokeWidth={1.25} absoluteStrokeWidth>
      <div role="tree" aria-label="Components" className="flex flex-col gap-[2px] px-[8px] pt-[4px] pb-[16px]">
        {sections.map((sec) => (
          <section key={sec.id} className="flex flex-col">
            <h3 className={clsx(r.eyebrow, "px-[8px] pt-[8px] pb-[4px]")}>{sec.name}</h3>
            {sec.cards.map((id) => (
              <CardRow key={id} id={id} />
            ))}
          </section>
        ))}
      </div>
    </LucideProvider>
  );
}

function CardRow({ id }: { id: string }) {
  const name = useStudio((s) => s.doc.nodes[id]?.meta.showcase?.component ?? "");
  // The card is selected, or one of its variant cells.
  const selected = useStudio((s) => s.selection.some((x) => x === id || isIn(s.doc.nodes, x, id)));
  const hovered = useStudio((s) => s.hoverId === id);
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      onMouseEnter={() => studio().setHover(id)}
      onMouseLeave={() => studio().setHover(null)}
      onClick={() => {
        studio().select([id]);
        onCanvasReady((c) => glideToLayer(c, id));
      }}
      className={clsx(r.layerRow, "cursor-default select-none pl-[8px]", selected ? r.layerRowSelected : hovered && "bg-hover")}
    >
      <Component size={14} className="ic shrink-0 text-component" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </div>
  );
}

function isIn(nodes: Record<string, { parentId: string | null }>, id: string, ancestor: string): boolean {
  let p = nodes[id]?.parentId;
  while (p) {
    if (p === ancestor) return true;
    p = nodes[p]?.parentId ?? null;
  }
  return false;
}
