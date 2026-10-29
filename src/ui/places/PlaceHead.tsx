import type { ReactNode } from "react";
import type { Space } from "../frame/spaces";
import { useSpaceName } from "../frame/useSpace";

/** A place's heading: its name, the space's (the organization's or the product's), how many there are in it (once known), and anything else it needs beside it. */
export function PlaceHead({ title, count, space, children }: { title: string; count: number | null; space: Space; children?: ReactNode }) {
  const name = useSpaceName(space);
  return (
    <div className="flex flex-wrap items-end justify-between gap-[12px]">
      <div className="flex flex-col gap-[2px]">
        <h1 className="text-heading font-semibold text-fg">{title}</h1>
        <p className="text-caption text-fg-subtle tnum">{[name, count === null ? null : String(count)].filter(Boolean).join(" · ")}</p>
      </div>
      {children}
    </div>
  );
}
