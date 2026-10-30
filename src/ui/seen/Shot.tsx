import { useEffect, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { create } from "zustand";
import { assetURL } from "@/doc/assets";
import type { SeenQuestion } from "@/seen/types";

/*
 * A screenshot as the person added it (never drawn by Qalam AI): a thumbnail that opens big, with
 * the words a question points at marked where they are on it (boxes from what this Mac read).
 */

type Mark = SeenQuestion["marks"][number];

export function useShotURL(ref?: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (ref) void assetURL(ref).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [ref]);
  return url;
}

function Marks({ marks }: { marks: Mark[] }) {
  return (
    <>
      {marks.map((m, k) => (
        <span
          key={k}
          aria-hidden
          className="pointer-events-none absolute rounded-[3px] bg-ai/15 shadow-[0_0_0_2px_var(--color-ai)]"
          style={{ left: `${m.box[0] * 100}%`, top: `${m.box[1] * 100}%`, width: `${m.box[2] * 100}%`, height: `${m.box[3] * 100}%` }}
        />
      ))}
    </>
  );
}

const useZoom = create<{ shot: string | null; marks: Mark[]; label: string }>(() => ({ shot: null, marks: [], label: "" }));

/** Open a screenshot big. */
export const zoomShot = (shot: string, label: string, marks: Mark[] = []) => useZoom.setState({ shot, marks, label });

/** A screenshot's thumbnail: its top (where a screen says what it is), `w` wide; a click opens it big. */
export function Shot({ shot, label, marks = [], w = 72, className, open = true }: { shot: string; label: string; marks?: Mark[]; w?: number; className?: string; open?: boolean }) {
  const url = useShotURL(shot);
  const box = (
    <span className={clsx("relative block overflow-hidden rounded-md bg-active shadow-[0_0_0_1px_var(--color-line-subtle)]", className)} style={{ width: w, height: Math.round(w * 2.1) }}>
      {url && (
        <span className="relative block w-full">
          <img src={url} alt={label} className="block w-full" loading="lazy" />
          <Marks marks={marks} />
        </span>
      )}
    </span>
  );
  if (!open) return box;
  return (
    <button type="button" onClick={() => zoomShot(shot, label, marks)} aria-label={`Open ${label} bigger`} className="q-item shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg">
      {box}
    </button>
  );
}

/** The screenshot opened big, over the page; Esc or a click outside closes it. */
export function ShotZoom() {
  const { shot, marks, label } = useZoom();
  const url = useShotURL(shot ?? undefined);
  useEffect(() => {
    if (!shot) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useZoom.setState({ shot: null });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shot]);
  if (!shot) return null;
  return (
    <div role="dialog" aria-label={label} className="fixed inset-0 z-[70] grid place-items-center bg-overlay p-[32px]" onClick={() => useZoom.setState({ shot: null })}>
      <div className="relative flex max-h-full flex-col items-center gap-[8px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex w-full items-center gap-[8px] text-body font-medium text-fg">
          <span className="truncate">{label}</span>
          <span className="flex-1" />
          <button type="button" aria-label="Close" onClick={() => useZoom.setState({ shot: null })} className="q-item grid size-[28px] place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg">
            <X size={16} />
          </button>
        </div>
        <span className="block max-h-[calc(100vh-120px)] overflow-auto rounded-lg shadow-[0_0_0_1px_var(--color-line)]">
          {url && (
            <span className="relative block">
              <img src={url} alt={label} className="block max-h-[calc(100vh-120px)] w-auto" />
              <Marks marks={marks} />
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
