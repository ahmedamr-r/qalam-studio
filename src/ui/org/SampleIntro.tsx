import clsx from "clsx";
import { welcomeHref } from "@/projects/model";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { openBrief, useBriefs } from "../discovery/briefs";
import { r } from "../recipes";

/** What the sample's chat opens on: that it's made up, what to look at, and the way to their own. */
export function SampleIntro() {
  const brief = useBriefs((s) => s.list[0]);
  return (
    <div className="flex flex-col gap-[10px] pt-[8px]">
      <p className="text-body text-fg">This is a sample. Basket is a made-up grocery delivery app, so you can see what you get before bringing your own.</p>
      <p className="text-caption text-fg-muted">Its problems are on the right, the best backed first. Open one to read the words behind it and where each was said. On the canvas, each goal has its problems, what might solve them and how to test it.</p>
      <div className="flex flex-wrap gap-[6px]">
        <button type="button" className={clsx(r.replyChipPrimary, "self-start")} onClick={() => window.location.assign(welcomeHref("new"))}>
          <QalamAIGlyph size={12} /> Try it on my own idea
        </button>
        {brief && (
          <button type="button" className={r.replyChip} onClick={() => openBrief(brief.id)}>
            See a brief for a coding agent
          </button>
        )}
      </div>
    </div>
  );
}
