import { useEffect, useState } from "react";
import clsx from "clsx";
import { worldBounds } from "@/doc/geometry";
import { useStudio, studio } from "@/doc/store";
import { dsIdForNode, tokenSetFor } from "@/design-system/registry";
import { chooseTake, collapseTakes, type TakeReport } from "@/proto/takes";
import { toScreenBox } from "../ai/anchor";
import { r } from "../recipes";
import { PendingPages } from "./PendingPages";

/** What the canvas shows over routes: pages not designed yet, and takes. */
export function RouteOverlays() {
  return (
    <>
      <PendingPages />
      <Takes />
    </>
  );
}

/** Moving the route to a take: what was built again, and what's left to redo in the session. */
const said = (x: TakeReport) =>
  [x.rebuilt.length ? `Built again: ${x.rebuilt.join(", ")}.` : "", x.left.length ? `Redo in the prototype: ${x.left.join(", ")}.` : ""].filter(Boolean).join(" ") || "The prototype moved to this take.";

/**
 * Above each take of a screen: which take it is; on the others, Use this take (the route moves to
 * it); on the chosen one, that it's the one prototyped, and tucking the others away or back.
 */
function Takes() {
  const doc = useStudio((s) => s.doc);
  const cam = useStudio((s) => s.camera);
  const moving = useStudio((s) => !!s.txBase);
  const [note, setNote] = useState<{ frame: string; text: string } | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 8000);
    return () => clearTimeout(t);
  }, [note]);
  const groups = doc.proto?.takes ?? [];
  if (!groups.length) return null;
  const use = (frame: string) => {
    const ts = tokenSetFor(dsIdForNode(studio().doc, frame));
    const report = chooseTake(frame, { typography: (p) => ts.typography(p) });
    if (report) setNote({ frame, text: said(report) });
  };
  return (
    <>
      {groups.flatMap((g) =>
        g.frames.map((f, k) => {
          if ((g.collapsed && f !== g.chosen) || !doc.nodes[f]) return null;
          const b = toScreenBox(worldBounds(doc, f), cam);
          if (b.w < 160) return null;
          const chosen = f === g.chosen;
          return (
            <div
              key={f}
              className="pointer-events-none absolute flex flex-col items-end gap-[6px]"
              style={{ left: b.x, top: b.y - 36, width: b.w, opacity: moving ? 0 : 1 }}
            >
              <div className="flex items-center gap-[6px]">
                <span className={clsx(r.chip, "pointer-events-auto")}>
                  Take {k + 1} of {g.frames.length}
                  {chosen ? " · prototyped" : ""}
                </span>
                {chosen ? (
                  <button type="button" className={clsx(r.buttonSm, r.buttonGhost, "pointer-events-auto")} onClick={() => collapseTakes(f, !g.collapsed)}>
                    {g.collapsed ? `Show ${g.frames.length - 1} more` : "Tuck the others away"}
                  </button>
                ) : (
                  <button type="button" className={clsx(r.buttonSm, r.buttonSecondary, "pointer-events-auto")} title="Prototype this take instead: its parts and steps move to it" onClick={() => use(f)}>
                    Use this take
                  </button>
                )}
              </div>
              {note?.frame === f && <p className="pointer-events-auto max-w-[320px] rounded-md bg-raised px-[8px] py-[6px] text-caption text-fg-muted shadow-raised">{note.text}</p>}
            </div>
          );
        }),
      )}
    </>
  );
}
