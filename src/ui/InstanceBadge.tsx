import { useState } from "react";
import clsx from "clsx";
import { Component, Diamond, RotateCcw } from "lucide-react";
import type { SceneNode } from "@/doc/schema";
import { studio, useStudio } from "@/doc/store";
import { topFrameOf } from "@/doc/geometry";
import { CATALOG } from "@/design-system/components";
import { CUSTOM, componentKey } from "@/design-system/custom";
import { baseComponent, instanceFingerprint } from "@/design-system/instances";
import { dsIdForNode, systemFor, useSystems } from "@/design-system/registry";
import { Tag } from "./controls";
import { r } from "./recipes";
import { resetInstance } from "./systemSync";
import { useWorkspace } from "./workspace/store";
import { useProjectType } from "@/projects/mode";
import { revealComponent } from "./components-page/runtime";
import { addComponentToSystem, syncScreens } from "./workspace/editing";

/** A component tag that opens its component: the tag gains a component-tinted ring on hover. */
const tagLink = "q-press rounded-sm hover:shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-component)_45%,transparent)]";

/**
 * The component a layer was built from, in the Design panel. Opens that component's source in
 * the component library; an instance changed by hand says so and can be reset to its source.
 */
export function InstanceBadge({ node }: { node: SceneNode }) {
  const doc = useStudio((s) => s.doc);
  const screens = useProjectType() === "screens";
  if (node.meta.component?.startsWith(`${CUSTOM}/`)) return <MadeBadge node={node} />;
  const name = baseComponent(node.meta.component);
  const inCatalog = !!name && CATALOG.some((c) => c.name === name);
  const isInstance = node.meta.specPath !== undefined || !!node.meta.inst;
  const overridden = isInstance && !!node.meta.instFingerprint && instanceFingerprint(doc, node.id) !== node.meta.instFingerprint;
  const tag = (
    <Tag tone="component" icon={<Diamond size={12} />}>
      {node.meta.component}
    </Tag>
  );
  return (
    <>
      {inCatalog ? (
        <button
          type="button"
          className={tagLink}
          title={`Edit ${name}: changes show on every instance at once`}
          onClick={() => useWorkspace.getState().open("components", { component: name, systemId: dsIdForNode(doc, node.id) })}
        >
          {tag}
        </button>
      ) : (
        tag
      )}
      {inCatalog && screens && (
        <button
          type="button"
          aria-label="Go to main component"
          title={`Go to main component: ${name} on the Components page`}
          className={clsx(r.iconButtonSm, "size-[20px]")}
          onClick={() => revealComponent(name!)}
        >
          <Component size={12} />
        </button>
      )}
      {overridden && (
        <span className="inline-flex items-center gap-[4px]">
          <Tag tone="warning">Overridden</Tag>
          <button
            type="button"
            className={clsx(r.buttonBase, r.buttonGhost, "h-[20px] gap-[4px] rounded-sm px-[6px] text-micro")}
            title={`Drop your changes to this instance and rebuild it from ${name}`}
            onClick={() => void resetInstance(node.id)}
          >
            <RotateCcw size={12} /> Reset
          </button>
        </span>
      )}
    </>
  );
}

/**
 * A made component's instance (see design-system/custom.ts): opens the system's component, or,
 * when it was made for this screen only, offers to add it to the system (this screen moves onto
 * the system's editable copy when the built-in one had to be copied).
 */
function MadeBadge({ node }: { node: SceneNode }) {
  const doc = useStudio((s) => s.doc);
  useSystems((s) => s.systems);
  const [error, setError] = useState<string | null>(null);
  const name = node.meta.component!.slice(CUSTOM.length + 1);
  const dsId = dsIdForNode(doc, node.id);
  const ds = systemFor(dsId);
  const own = ds.docs.patterns.find((p) => componentKey(p.name) === componentKey(name));
  const rootId = topFrameOf(doc, node.id);
  const local = doc.nodes[rootId]?.meta.spec?.components?.find((d) => componentKey(d.name) === componentKey(name));
  const overridden = !!node.meta.instFingerprint && instanceFingerprint(doc, node.id) !== node.meta.instFingerprint;
  const tag = (
    <Tag tone="component" icon={<Diamond size={12} />}>
      {name}
    </Tag>
  );
  return (
    <>
      {own ? (
        <button
          type="button"
          className={tagLink}
          title={`Edit ${own.name} in ${ds.name}: changes show on every instance at once`}
          onClick={() => useWorkspace.getState().open("components", { component: own.name, systemId: dsId })}
        >
          {tag}
        </button>
      ) : (
        <span className="inline-flex items-center gap-[4px]">
          {tag}
          <Tag tone="warning">Not in the system yet</Tag>
          {local && (
            <button
              type="button"
              className={clsx(r.buttonBase, r.buttonSecondary, "h-[20px] gap-[6px] rounded-sm px-[6px] text-micro")}
              title={`Add ${local.name} to ${ds.name}${ds.source === "builtin" ? " (an editable copy; this screen moves onto it)" : ""}, so other screens reuse it`}
              onClick={async () => {
                const r = addComponentToSystem(dsId, local);
                if ("error" in r) return setError(r.error);
                setError(null);
                if (r.id !== dsId) await syncScreens(r.id, [rootId], { history: true });
                studio().select([node.id]);
              }}
            >
              Add
            </button>
          )}
        </span>
      )}
      {overridden && (
        <span className="inline-flex items-center gap-[4px]">
          <Tag tone="warning">Overridden</Tag>
          <button
            type="button"
            className={clsx(r.buttonBase, r.buttonGhost, "h-[20px] gap-[4px] rounded-sm px-[6px] text-micro")}
            title={`Drop your changes to this instance and rebuild it from ${name}`}
            onClick={() => void resetInstance(node.id)}
          >
            <RotateCcw size={12} /> Reset
          </button>
        </span>
      )}
      {error && <span className="text-caption text-danger">{error}</span>}
    </>
  );
}
