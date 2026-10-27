import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Check, CircleAlert, Component, Plus, TriangleAlert } from "lucide-react";
import { studio } from "@/doc/store";
import { assetURL } from "@/doc/assets";
import { CUSTOM, fillComposition } from "@/design-system/custom";
import { missingColours } from "@/design-system/component-import";
import { insertComponent } from "@/design-system/place";
import { systemFor, useSystems } from "@/design-system/registry";
import type { ComponentDef } from "@/design-system/docs";
import { Button, Swatch, Tag } from "../controls";
import { r } from "../recipes";
import { useComponentPreview } from "../componentPreviews";
import { confirmDialog } from "../surfaces/dialog";
import { useWorkspace } from "../workspace/store";
import { composerDraft } from "./composerBridge";
import { patchTurn } from "./chats";
import { removeAdded } from "./componentImport";
import type { ChatTurn, ComponentOutcome } from "./chatTypes";

const ico = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const noteBox = "rounded-lg bg-muted px-[10px] py-[8px] text-caption text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line-subtle)]";
const warnBox = "flex items-start gap-[8px] rounded-lg bg-warning-subtle px-[10px] py-[8px] text-caption text-fg [&>svg]:mt-[2px] [&>svg]:shrink-0 [&>svg]:text-warning";
/** A light well for user content (screenshots and renders), in both themes. */
const well = "relative grid min-h-[72px] place-items-center overflow-hidden rounded-md bg-stage p-[10px]";
const wellLabel = "text-micro font-medium text-fg-subtle";

/** Small and stable: the preview cache is keyed by it. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function useAsset(ref: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // assetURL gives the image's address in the organization: nothing to revoke.
    if (ref) void assetURL(ref).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [ref]);
  return url;
}

/** The component drawn as it is defined (every prop at its example), at its 1x width. */
function Drawing({ def, dsId, width }: { def: ComponentDef; dsId: string; width: number }) {
  const inst = useMemo(() => fillComposition(def, Object.fromEntries((def.props ?? []).map((p) => [p.name, p.example]))), [def]);
  const preview = useComponentPreview(`import:${hash(JSON.stringify(def))}:${width}`, inst, dsId, { width });
  if (preview === "error") return <span className="text-caption text-[#55524e]">It can&apos;t be drawn with this system.</span>;
  if (!preview) return <div className="q-breathe h-[48px] w-[70%] rounded-md bg-black/[0.06]" />;
  return <img src={preview.url} alt={def.name} className="q-fade max-h-[220px] max-w-full object-contain" />;
}

/**
 * Add component: the screenshot beside the component as the system draws it, what joined the
 * library (and where), how the check against the screenshot went, and what couldn't match.
 */
export function ComponentView({ chatId, t, o }: { chatId: string; t: ChatTurn; o: ComponentOutcome }) {
  useSystems((s) => s.systems); // names, the active system and removals show live
  const activeId = useSystems((s) => s.activeId);
  const shot = useAsset(o.source);
  const [error, setError] = useState<string | null>(null);
  const [shape, setShape] = useState<number | null>(null);
  const a = o.added;
  const dsId = a && !o.removed ? a.systemId : (t.request.system?.id ?? activeId);
  const ds = systemFor(dsId);
  const running = t.status === "running";
  const misses = missingColours(o.colours ?? []);

  if (o.screen)
    return (
      <div className="flex flex-col gap-[8px]">
        {o.read && <p className="text-body leading-[20px] text-fg">{o.read}</p>}
        <div className={warnBox}>
          <TriangleAlert size={14} {...ico} />
          <span>This looks like a whole screen rather than one component, so nothing was added. Crop it to the component, or use Extract system to turn screens into a design system.</span>
        </div>
        <Button size="sm" variant="secondary" className="self-start" onClick={() => studio().setAITab("extract")}>
          Use Extract system
        </Button>
      </div>
    );

  const remove = async () => {
    if (!a) return;
    const ok = await confirmDialog({ title: `Remove ${a.name} from ${a.systemName}?`, body: "Screens that placed it show a placeholder until it's added again.", confirmLabel: "Remove", danger: true });
    if (!ok) return;
    const why = removeAdded(o);
    if (why) return setError(why);
    patchTurn(chatId, t.id, (cur) => (cur.outcome?.kind === "component" ? { outcome: { ...cur.outcome, removed: true } } : {}));
  };

  const askTune = () => {
    studio().setAITab("tune");
    requestAnimationFrame(() => composerDraft.set(`Add the colours the ${o.def?.name ?? "component"} screenshot uses that ${ds.name} doesn't have: ${misses.map((c) => `${c.hex} (drawn as ${c.role} for now)`).join(", ")}.`));
  };

  return (
    <div className="flex flex-col gap-[10px]">
      {o.read && <p className="text-body leading-[20px] text-fg">{o.read}</p>}
      {(o.def || shot) && (
        <div className={clsx("grid gap-[8px]", shape !== null && shape < 1.5 ? "grid-cols-2" : "grid-cols-1")}>
          <div className="flex min-w-0 flex-col gap-[4px]">
            <span className={wellLabel}>Screenshot</span>
            <div className={well}>
              {shot ? <img src={shot} alt="The component's screenshot" onLoad={(e) => setShape(e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight))} className="max-h-[220px] max-w-full object-contain" /> : <div className="q-skeleton h-[48px] w-[70%] rounded-md" />}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-[4px]">
            <span className={wellLabel}>
              In {ds.name}
              {o.width ? <span className="font-normal tnum"> · {o.width}px wide</span> : null}
            </span>
            <div className={well}>{o.def ? <Drawing def={o.def} dsId={dsId} width={o.width ?? 358} /> : <div className="q-breathe h-[48px] w-[70%] rounded-md bg-black/[0.06]" />}</div>
          </div>
        </div>
      )}

      {o.def && (
        <div className="flex flex-col gap-[6px]">
          <div className="flex items-center gap-[8px]">
            <Component size={14} {...ico} className="shrink-0 text-component" />
            <span className="min-w-0 flex-1 truncate text-body font-medium text-fg">{o.def.name}</span>
            {o.removed ? <Tag>Removed from {a?.systemName}</Tag> : a ? <Tag tone="component">{a.replaced ? "Updated in" : "In"} {a.systemName}</Tag> : running ? <Tag>Not added yet</Tag> : null}
          </div>
          {o.def.purpose && <p className="text-caption text-fg-muted">{o.def.purpose}</p>}
          {!!o.def.props?.length && (
            <div className="flex flex-wrap gap-[4px]">
              {o.def.props.map((p) => (
                <span key={p.name} className="inline-flex h-[20px] items-center rounded-sm bg-active px-[6px] font-mono text-micro text-fg-muted" title={`Example: ${p.example}`}>
                  {p.name} · {p.kind === "icon" ? "icon" : `≤${p.maxChars}`}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {o.check && !t.request.revise && (
        <div className="flex items-start gap-[8px] text-caption text-fg-muted [&>svg]:mt-[2px] [&>svg]:shrink-0">
          {o.check.error ? <CircleAlert size={12} {...ico} className="text-fg-subtle" /> : <Check size={12} {...ico} className="text-success" />}
          <span>
            {o.check.error
              ? `Not checked against the screenshot: ${o.check.error}`
              : o.check.kept === "revised"
                ? `Checked against the screenshot and corrected${o.checkNote ? `: ${o.checkNote}` : "."}`
                : "Checked against the screenshot: the correction came out no closer, so the first version stays."}
          </span>
        </div>
      )}

      {(!!o.cut?.length || !!o.overflow?.length) && !running && (
        <div className={warnBox}>
          <TriangleAlert size={14} {...ico} />
          <span>
            Doesn&apos;t fit at {o.width ?? 358}px:{" "}
            {[...(o.cut?.length ? [`${o.cut.map((c) => `“${c}”`).join(", ")} cut off`] : []), ...(o.overflow ?? []).map((x) => `${x.name} sticks out by ${x.by}px`)].join("; ")}. Ask Qalam AI to make it fit, or change the parts in the library.
          </span>
        </div>
      )}

      {(!!o.differences?.length || misses.length > 0) && (
        <div className={warnBox}>
          <TriangleAlert size={14} {...ico} />
          <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
            <span className="font-medium">Where it can&apos;t match the screenshot</span>
            {!!o.differences?.length && (
              <ul className="flex flex-col gap-[2px]">
                {o.differences.map((d, i) => (
                  <li key={i}>
                    {d.part && <b className="font-medium">{d.part}: </b>}
                    {d.note}
                  </li>
                ))}
              </ul>
            )}
            {misses.length > 0 && (
              <div className="flex flex-col gap-[4px]">
                <span>Colours {ds.name} has nothing close to:</span>
                {misses.map((c) => (
                  <span key={c.hex} className="flex items-center gap-[6px] font-mono text-micro">
                    <Swatch color={c.hex} size={12} /> {c.hex} <span className="text-fg-subtle">→</span> <Swatch color={c.roleHex} size={12} /> {c.role}
                  </span>
                ))}
                {!running && (
                  <button type="button" className={clsx(r.link, "self-start font-medium")} onClick={askTune}>
                    Ask Tune system to add them
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {a && !o.removed && !running && (
        <>
          <div className="flex flex-wrap items-center gap-[6px]">
            <Button size="sm" onClick={() => useWorkspace.getState().open("components", { component: a.name, systemId: a.systemId })}>
              Open in library
            </Button>
            {a.systemId === activeId && (
              <Button size="sm" variant="secondary" onClick={() => void insertComponent({ component: CUSTOM, props: { name: a.name } })}>
                <Plus size={12} {...ico} /> Insert on canvas
              </Button>
            )}
            <Button size="sm" variant="ghost" className="hover:text-danger" onClick={() => void remove()}>
              Remove
            </Button>
          </div>
          {a.forkedFrom && <p className={noteBox}>{systemFor(a.forkedFrom).name} stays as it is, so {a.name} went into an editable copy, {a.systemName}.</p>}
          <p className="text-micro text-fg-subtle">Say what to change and Qalam AI updates {a.name} in the library; screens that place it follow.</p>
        </>
      )}
      {error && <p className="q-shake text-caption text-danger">{error}</p>}
    </div>
  );
}
