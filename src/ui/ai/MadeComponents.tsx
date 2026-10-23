import { useState } from "react";
import { Component, Crosshair } from "lucide-react";
import { useStudio } from "@/doc/store";
import { revealLayers } from "../pages";
import { descendants } from "@/doc/geometry";
import type { ComponentDef } from "@/design-system/docs";
import { BUILTIN_ID, dsIdForNode, systemFor, useSystems } from "@/design-system/registry";
import { CUSTOM } from "@/design-system/custom";
import { Button, Tag } from "../controls";
import { useComponentPreview } from "../componentPreviews";
import { syncScreens } from "../workspace/editing";
import { useWorkspace } from "../workspace/store";
import { adoptComponent } from "./chats";
import type { GenerateOutcome } from "./chatTypes";

/**
 * Components Qalam AI made while designing (things the catalog can't draw, from the system's
 * tokens). Each works on its screens at once; the designer decides whether it joins the design
 * system, where its instances then follow the system's version.
 */
export function MadeComponents({ chatId, turnId, o }: { chatId: string; turnId: string; o: GenerateOutcome }) {
  const doc = useStudio((s) => s.doc);
  useSystems((s) => s.systems);
  if (!o.newComponents?.length) return null;
  const live = o.frameIds.filter((id) => doc.nodes[id]);
  const dsId = live.length ? dsIdForNode(doc, live[0]) : useSystems.getState().activeId;
  return (
    <>
      <div className="mt-[2px] flex items-center gap-[6px] text-micro font-medium text-fg-subtle">
        <Component size={12} absoluteStrokeWidth strokeWidth={1.25} className="text-component" /> Made for these screens
      </div>
      {o.newComponents.map((def) => (
        <MadeCard key={def.name} chatId={chatId} turnId={turnId} def={def} o={o} dsId={dsId} live={live} />
      ))}
    </>
  );
}

function MadeCard({ chatId, turnId, def, o, dsId, live }: { chatId: string; turnId: string; def: ComponentDef; o: GenerateOutcome; dsId: string; live: string[] }) {
  const doc = useStudio((s) => s.doc);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const preview = useComponentPreview(`made:${turnId}:${def.name}`, { component: CUSTOM, props: { name: def.name } }, dsId, { components: [def], width: 280 });
  const instances = live.flatMap((id) => descendants(doc, id)).filter((id) => doc.nodes[id]?.meta.component === `${CUSTOM}/${def.name}`);
  const adopted = o.adopted?.[def.name];
  const ds = systemFor(dsId);
  // Screens of this answer still on the system it was copied from (the built-in one) aren't linked yet.
  const behind = adopted?.forkedFrom ? live.filter((id) => dsIdForNode(doc, id) === adopted.forkedFrom) : [];

  return (
    <div className="flex flex-col gap-[8px] rounded-lg p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      {preview && preview !== "error" && (
        <div className="q-fade flex max-h-[160px] items-center justify-center overflow-hidden rounded-md bg-stage p-[8px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt={def.name} className="max-h-[144px] max-w-full object-contain" />
        </div>
      )}
      <div className="flex items-center gap-[8px]">
        <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">{def.name}</span>
        {adopted ? <Tag tone="component">In {adopted.systemName}</Tag> : <Tag tone="neutral">Not in the system yet</Tag>}
      </div>
      {def.purpose && <p className="text-caption text-fg-muted">{def.purpose}</p>}
      {!!def.props?.length && (
        <div className="flex flex-wrap gap-[4px]">
          {def.props.map((p) => (
            <span key={p.name} className="inline-flex h-[20px] items-center rounded-sm bg-active px-[6px] font-mono text-micro text-fg-muted" title={`Example: ${p.example}`}>
              {p.name} · {p.kind === "icon" ? "icon" : `≤${p.maxChars}`}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-[6px]">
        {!adopted && (
          <Button size="sm" onClick={() => setError(adoptComponent(chatId, turnId, def.name))}>
            {ds.id === BUILTIN_ID ? `Add to a copy of ${ds.name}` : `Add to ${ds.name}`}
          </Button>
        )}
        {adopted && (
          <Button size="sm" variant="secondary" onClick={() => useWorkspace.getState().open("components", { component: def.name, systemId: adopted.systemId })}>
            Open in library
          </Button>
        )}
        {instances.length > 0 && (
          <button
            type="button"
            className="q-item inline-flex h-[24px] items-center gap-[6px] rounded-md px-[6px] text-caption text-fg-muted hover:bg-hover hover:text-fg"
            onClick={() => revealLayers(instances)}
          >
            <Crosshair size={12} absoluteStrokeWidth strokeWidth={1.25} /> <span className="tnum">{instances.length === 1 ? "1 instance" : `${instances.length} instances`}</span>
          </button>
        )}
      </div>
      {!adopted && ds.id === BUILTIN_ID && <p className="text-micro text-fg-subtle">The built-in system stays as it is: adding makes an editable copy with {def.name} in it.</p>}
      {adopted && (
        <div className="rounded-md bg-success-subtle px-[10px] py-[8px] text-caption text-fg">
          Added to <b className="font-medium">{adopted.systemName}</b>. Screens on it place the system&apos;s {def.name}, so changing it in the library updates them.
          {behind.length > 0 && (
            <div className="mt-[6px] flex flex-col items-start gap-[6px]">
              <span className="text-fg-muted">
                {behind.length === 1 ? "This screen is" : `These ${behind.length} screens are`} still on {systemFor(adopted.forkedFrom!).name}, so {behind.length === 1 ? "it keeps" : "they keep"} its own copy.
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={moving}
                onClick={async () => {
                  setMoving(true);
                  await syncScreens(adopted.systemId, behind, { history: true });
                  setMoving(false);
                }}
              >
                Move to {adopted.systemName}
              </Button>
            </div>
          )}
        </div>
      )}
      {error && <p className="q-shake text-caption text-danger">{error}</p>}
    </div>
  );
}
