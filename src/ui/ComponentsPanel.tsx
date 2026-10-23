import { useRef } from "react";
import clsx from "clsx";
import { Component, Crosshair, ImagePlus, LucideProvider, Maximize2, Plus } from "lucide-react";
import type { Inst } from "@/design-system/builders";
import { CATALOG } from "@/design-system/components";
import { insertComponent } from "@/design-system/place";
import { useStudio } from "@/doc/store";
import { onComponentsPage } from "@/doc/pages";
import { revealComponent } from "./components-page/runtime";
import { useActiveSystem } from "@/design-system/registry";
import { Tip } from "./controls";
import { r } from "./recipes";
import { useComponentPreview } from "./componentPreviews";
import { openWorkspace } from "./workspace/store";
import { attachComponentShot } from "./ai/composerBridge";

const CATEGORY_LABEL: Record<string, string> = {
  navigation: "Navigation",
  input: "Inputs & actions",
  content: "Content",
  feedback: "Feedback",
  layout: "Layout",
  commerce: "Commerce",
};

export default function ComponentsPanel() {
  const target = useStudio((s) => {
    const n = s.selection.length === 1 ? s.doc.nodes[s.selection[0]] : null;
    if (!n) return null;
    return n.type === "frame" ? n.name : n.parentId ? s.doc.nodes[n.parentId]?.name : null;
  });
  const cats = Object.keys(CATEGORY_LABEL);
  const system = useActiveSystem();
  // On the Components page a tile finds its component there instead of inserting it.
  const onComponents = useStudio((s) => onComponentsPage(s.doc));
  const shot = useRef<HTMLInputElement>(null);
  return (
    <LucideProvider strokeWidth={1.25} absoluteStrokeWidth>
    <div className="flex flex-col gap-[16px] px-[12px] pt-[4px] pb-[16px]">
      <p className="rounded-lg bg-muted px-[10px] py-[8px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
        Qalam AI composes screens only from these <span className="tnum">{CATALOG.length}</span> components, styled by <b className="font-medium text-fg">{system.name}</b>.{" "}
        {onComponents ? (
          "Click one to find it on this page"
        ) : (
          <>
            Click one to insert it {target ? <b className="font-medium text-fg">into “{target}”</b> : "on the canvas"}
          </>
        )}
        ; open one (
        <Maximize2 size={10} className="inline align-[-1px]" />) for its properties, tokens and design doc.
      </p>
      <input
        ref={shot}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) attachComponentShot(f, system.id);
        }}
      />
      <button
        type="button"
        onClick={() => shot.current?.click()}
        title={`Qalam AI builds the component in your screenshot from catalog parts in ${system.name}'s tokens, checks it against the screenshot and adds it to the library`}
        className="q-item -mt-[8px] flex h-[32px] items-center gap-[8px] rounded-md px-[8px] text-body text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover hover:text-fg"
      >
        <ImagePlus size={14} className="shrink-0 text-fg-subtle" /> Add a component from a screenshot
      </button>
      {system.docs.patterns.length > 0 && (
        <Group label={`${system.name} components`}>
          {/* Placed as linked instances: changing the component in the system updates them. */}
          {system.docs.patterns.map((p) => (
            <AssetTile key={p.name} id={`pattern:${p.name}`} name={p.name} description={p.purpose} inst={{ component: "Custom", props: { name: p.name } }} dsId={system.id} find={onComponents} />
          ))}
        </Group>
      )}
      {cats.map((cat) => (
        <Group key={cat} label={CATEGORY_LABEL[cat]}>
          {CATALOG.filter((c) => c.category === cat).map((c) => (
            <AssetTile key={c.name} id={`component:${c.name}`} name={c.name} description={c.description} inst={{ component: c.name, props: c.example, children: c.exampleChildren }} dsId={system.id} find={onComponents} />
          ))}
        </Group>
      ))}
    </div>
    </LucideProvider>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className={clsx(r.eyebrow, "mb-[6px] px-[4px]")}>{label}</h3>
      <div className="grid grid-cols-2 gap-[8px]">{children}</div>
    </section>
  );
}

/** Thumbnails show components at this fraction of their real size, unless they need to shrink further to fit. */
const PREVIEW_SCALE = 0.75;

/** A component card: a live render of it in the active system, its name below, what it's for on hover. */
function AssetTile({ id, name, description, inst, dsId, find }: { id: string; name: string; description: string; inst: Inst; dsId: string; find: boolean }) {
  const preview = useComponentPreview(id, inst, dsId);
  return (
    <div className="group/tile relative min-w-0">
      <Tip label={description}>
        <button
          type="button"
          onClick={() => (find ? revealComponent(name) : insertComponent(inst))}
          aria-label={find ? `Find ${name} on this page` : `Insert ${name}`}
          className="group q-press flex w-full min-w-0 flex-col overflow-hidden rounded-lg bg-raised text-left shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
        >
          {/* User content stays on the light stage in both themes, so components look as they will ship. */}
          <div className="m-[3px] mb-0 flex h-[90px] items-center justify-center rounded-md bg-stage p-[10px]">
            {preview === "error" ? (
              <Component size={18} className="text-black/40" />
            ) : preview ? (
              // One scale for every tile, so a button reads smaller than a bottom sheet; big ones shrink to fit.
              <img src={preview.url} alt="" draggable={false} className="max-h-full max-w-full object-contain" style={{ width: preview.w * PREVIEW_SCALE, height: preview.h * PREVIEW_SCALE }} />
            ) : (
              <div className="q-breathe h-full w-full rounded-sm bg-black/[.06]" />
            )}
          </div>
          <div className="flex h-[30px] items-center gap-[4px] px-[8px]">
            <span className="min-w-0 flex-1 truncate text-caption font-medium text-fg">{name}</span>
            {find ? (
              <Crosshair size={12} className="shrink-0 text-fg-muted opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-hover:duration-0" />
            ) : (
              <Plus size={12} className="shrink-0 text-fg-muted opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-hover:duration-0" />
            )}
          </div>
        </button>
      </Tip>
      <button
        type="button"
        aria-label={`Open ${name} in the component library`}
        title="Properties, tokens and design doc"
        onClick={() => openWorkspace("components", { component: name, systemId: dsId })}
        className="q-press q-press-icon absolute top-[8px] right-[8px] grid size-[24px] place-items-center rounded-md bg-elevated text-fg-muted opacity-0 shadow-raised transition-[opacity,scale,color] duration-fast group-hover/tile:opacity-100 hover:text-fg focus-visible:opacity-100"
      >
        <Maximize2 size={12} />
      </button>
    </div>
  );
}
