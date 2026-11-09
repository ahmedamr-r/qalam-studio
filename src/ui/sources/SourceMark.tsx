import { AudioLines, FileText, Globe, Image, PenLine, ScrollText } from "lucide-react";
import { sourceMark, type SourceIcon } from "@/discovery/look";
import type { SetupDoc } from "@/org/setup";
import { ConnectorLogo } from "../brand/ConnectorLogo";

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;
const ICONS: Record<SourceIcon, typeof PenLine> = { "pen-line": PenLine, globe: Globe, "file-text": FileText, "audio-lines": AudioLines, "scroll-text": ScrollText, image: Image };

/** Where a part of a source came from: the tool's logo, or an icon for what it is. */
export function SourceMark({ doc }: { doc: SetupDoc | undefined }) {
  const what = sourceMark(doc?.from);
  if ("logo" in what) return <ConnectorLogo id={what.logo} size={16} decorative />;
  const Icon = ICONS[what.icon];
  return (
    <span className="grid size-[16px] shrink-0 place-items-center rounded-[3px] bg-kh-research/15 text-kh-research">
      <Icon size={11} {...ICON} />
    </span>
  );
}
