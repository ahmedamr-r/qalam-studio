import clsx from "clsx";
import { useStudio } from "@/doc/store";
import { routeGeometry } from "@/proto/canvas/layout";
import { toScreenBox } from "../ai/anchor";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { r } from "../recipes";
import { generateNext } from "./next";

/**
 * Over each page a screen goes on to before it's designed (a dashed card at the end of its row of
 * parts): what the page shows, and Generate it, which draws it and wires the screen to it. Shown
 * while the card is big enough to hold them, with the prototype's parts and wires.
 */
export function PendingPages() {
  const doc = useStudio((s) => s.doc);
  const cam = useStudio((s) => s.camera);
  const shown = useStudio((s) => s.view.routeParts);
  const moving = useStudio((s) => !!s.txBase);
  if (!shown) return null;
  const pages = routeGeometry(doc).flatMap((g) => g.pages.map((p) => ({ ...p, screen: g.screen })));
  return (
    <>
      {pages.map((p) => {
        const b = toScreenBox(p.box, cam);
        // Room for what it shows and the page's name; else just Generate; too small, the canvas caption says it.
        const roomy = b.w >= 150 && b.h >= 96;
        if (!roomy && (b.w < 76 || b.h < 30)) return null;
        return (
          <div
            key={`${p.screen}:${p.page}`}
            className="pointer-events-none absolute flex flex-col items-center justify-center gap-[8px] p-[8px] text-center"
            style={{ left: b.x, top: b.y, width: b.w, height: b.h, opacity: moving ? 0 : 1 }}
          >
            {roomy && p.brief && b.h >= 140 && (
              <p className="line-clamp-3 max-w-full text-caption text-fg-muted" dir="auto">
                {p.brief}
              </p>
            )}
            <button
              type="button"
              className={clsx(r.buttonSm, r.buttonSecondary, "pointer-events-auto")}
              title={`Generate ${p.name} with Qalam AI, and go to it from here`}
              aria-label={`Generate ${p.name}`}
              onClick={() => void generateNext(p.screen, p.page)}
            >
              <QalamAIGlyph size={14} /> {roomy ? `Generate ${p.name}` : "Generate"}
            </button>
          </div>
        );
      })}
    </>
  );
}
