import { projectHref } from "@/projects/model";
import { X } from "lucide-react";
import { updateProject, useProject } from "@/projects/session";
import { IconBtn } from "../controls";
import KindMark from "./KindMark";
import { saveThenGo } from "./links";

/**
 * In a Screens project designing a Discovery solution: which one, with a way back to its card.
 * The screens Qalam AI makes here are counted on the solution's card.
 */
export default function ServingBanner() {
  const serving = useProject((s) => s.project?.serving);
  if (!serving) return null;
  return (
    <div className="flex shrink-0 items-center gap-[8px] border-b border-line-subtle bg-muted px-[14px] py-[8px] text-caption text-fg-muted">
      <KindMark kind="solution" className="shrink-0 text-fg-subtle" />
      <span className="min-w-0 flex-1 truncate">
        Designing for <b className="font-medium text-fg">{serving.cardTitle || "a solution"}</b> · {serving.projectName}
      </span>
      <a href={`${projectHref({ id: serving.projectId, type: "discovery" })}?card=${serving.cardId}`} onClick={saveThenGo} className="shrink-0 font-medium text-fg underline decoration-fg/40 underline-offset-2 hover:decoration-fg">
        Open in Discovery
      </a>
      <IconBtn size="sm" label="Stop linking new screens to it" onClick={() => void updateProject({ serving: undefined }, { touch: false })}>
        <X size={12} absoluteStrokeWidth strokeWidth={1.25} />
      </IconBtn>
    </div>
  );
}
