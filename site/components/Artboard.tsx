"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * A fixed-size drawing (in px) scaled to fit its parent, the way a frame sits on a canvas. Every
 * mock is laid out in its own artboard coordinates, so positions and travel distances in the
 * timelines are plain numbers that hold at any viewport size.
 */
export function Artboard({
  w,
  h,
  children,
  className,
  max = 1.15,
  style,
  label,
}: {
  w: number;
  h: number;
  children: ReactNode;
  className?: string;
  /** Largest scale allowed. A little upscaling is fine: everything inside is vector. */
  max?: number;
  style?: CSSProperties;
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const s = Math.min(el.clientWidth / w, el.clientHeight / h, max);
      el.style.setProperty("--fit", String(Math.max(0.1, s)));
      el.dataset.ready = "";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h, max]);
  return (
    <div ref={box} className={`artboard ${className ?? ""}`} role={label ? "img" : undefined} aria-label={label}>
      <div className="artboard-inner" style={{ width: w, height: h, ...style }}>
        {children}
      </div>
    </div>
  );
}
