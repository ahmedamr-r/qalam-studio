import { useState } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import type { Group } from "@/knowledge/types";
import { GROUP_ICON, IconChip, KIND_ICON } from "./icons";
import { GROUP_LABEL } from "./labels";

/** The graph's key, bottom left: colours, shapes and the two kinds of trace line. Folds away. */

const KEY_GROUPS: Group[] = ["you", "system", "learned", "research", "decision"];
const KEY_KINDS: [string, (typeof KIND_ICON)[keyof typeof KIND_ICON]][] = [
  ["Your answer", KIND_ICON.answer],
  ["Screen goal", KIND_ICON["screen-goal"]],
  ["Rule", KIND_ICON.rule],
  ["Do / Don't", KIND_ICON.do],
  ["Look and feel", KIND_ICON.language],
  ["Component guide", KIND_ICON.guide],
  ["Verdict", KIND_ICON.verdict],
  ["Web source", KIND_ICON.research],
];
const LEGEND_KEY = "qalam/knowledge-legend/v1";

export default function Legend() {
  const [open, setOpen] = useState(() => {
    try {
      const saved = window.localStorage.getItem(LEGEND_KEY);
      return saved ? saved !== "closed" : window.innerHeight >= 860;
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      try {
        window.localStorage.setItem(LEGEND_KEY, o ? "closed" : "open");
      } catch {
        /* this session only */
      }
      return !o;
    });
  };
  return (
    <div className="pointer-events-auto absolute bottom-[12px] left-[12px] rounded-lg bg-raised/95 text-caption text-fg-muted shadow-[0_0_0_1px_var(--color-line-subtle),0_4px_16px_rgb(0_0_0/0.18)]">
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-[6px] rounded-lg py-[6px] pr-[8px] pl-[10px] text-left font-medium text-fg hover:bg-hover">
        <span className="flex-1">Key</span>
        <ChevronDown size={12} absoluteStrokeWidth strokeWidth={1.25} className={clsx("transition-[rotate] duration-fast", !open && "-rotate-90")} />
      </button>
      {open && (
        <div className="flex flex-col gap-[6px] px-[10px] pt-[2px] pb-[10px]">
          <span className="text-micro text-fg-subtle">Colour: where it came from</span>
          <div className="grid grid-cols-[auto_auto] gap-x-[14px] gap-y-[4px]">
            {KEY_GROUPS.map((g) => (
              <span key={g} className="flex items-center gap-[6px]">
                <IconChip group={g} icon={GROUP_ICON[g]} size={18} />
                {GROUP_LABEL[g]}
              </span>
            ))}
          </div>
          <span className="pt-[2px] text-micro text-fg-subtle">Icon: what kind of fact</span>
          <div className="grid grid-cols-[auto_auto] gap-x-[14px] gap-y-[4px]">
            {KEY_KINDS.map(([label, I]) => (
              <span key={label} className="flex items-center gap-[6px]">
                <I size={13} strokeWidth={1.5} absoluteStrokeWidth className="text-fg-subtle" aria-hidden />
                {label}
              </span>
            ))}
          </div>
          <span className="pt-[2px] text-micro text-fg-subtle">Lines</span>
          <div className="grid grid-cols-[auto_auto] gap-x-[14px] gap-y-[4px]">
            <span className="flex items-center gap-[6px]">
              <svg width="20" height="8" aria-hidden>
                <line x1="0" y1="4" x2="20" y2="4" stroke="var(--color-ai)" strokeWidth="2" />
              </svg>
              Relied on
            </span>
            <span className="flex items-center gap-[6px]">
              <svg width="20" height="8" aria-hidden>
                <line x1="0" y1="4" x2="20" y2="4" stroke="var(--color-ai)" strokeWidth="1.25" strokeDasharray="3 3" />
              </svg>
              Given, not used
            </span>
          </div>
          <span className="text-micro text-fg-subtle">Bigger was relied on more often. Outlined: a screen, token or component.</span>
        </div>
      )}
    </div>
  );
}
