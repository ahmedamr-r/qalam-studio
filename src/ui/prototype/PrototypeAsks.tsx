import clsx from "clsx";
import { MousePointerClick, Play } from "lucide-react";
import { useStudio } from "@/doc/store";
import { asksOf } from "@/proto/asks";
import { Button } from "../controls";
import { r } from "../recipes";
import { proposeOn } from "./store";

/**
 * Under a Generate answer: what the brief asked to see happen on the screens that wasn't drawn
 * (they happen on the screen, so they're prototyped there), and the way to it — the prototype
 * opens with Qalam AI proposing how to build them. Gone once a build has taken them.
 */
export function PrototypeAsks({ screens }: { screens: string[] }) {
  const doc = useStudio((s) => s.doc);
  const waiting = screens.filter((id) => doc.nodes[id] && asksOf(doc.proto?.routes?.[id]).length);
  if (!waiting.length) return null;
  const asks = [...new Set(waiting.flatMap((id) => asksOf(doc.proto?.routes?.[id])))];
  return (
    <div className="flex flex-col gap-[6px]">
      <div className={clsx(r.eyebrow, "flex items-center gap-[6px]")}>
        <MousePointerClick size={12} absoluteStrokeWidth strokeWidth={1.25} className="text-selection" /> For the prototype, not drawn
      </div>
      <p className="text-caption text-fg-muted">These happen on the screen, so Qalam AI builds them in its prototype instead of drawing more screens.</p>
      <ul className="flex flex-col gap-[2px]">
        {asks.map((a, i) => (
          <li key={i} className="flex gap-[8px] text-caption text-fg" dir="auto">
            <span aria-hidden className="mt-[6px] size-[4px] shrink-0 rounded-full bg-selection" />
            {a}
          </li>
        ))}
      </ul>
      <Button size="sm" variant="secondary" className="self-start" onClick={() => proposeOn(waiting[0])}>
        <Play size={12} absoluteStrokeWidth strokeWidth={1.25} /> Prototype {waiting.length > 1 ? `“${doc.nodes[waiting[0]].name}”` : "it"}
      </Button>
    </div>
  );
}
