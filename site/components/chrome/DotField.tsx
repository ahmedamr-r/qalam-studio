"use client";

import { useEffect, useRef } from "react";

import { REDUCED } from "@/lib/gsap";

/**
 * The studio's dotted canvas behind the hero. Dots near the pointer lean toward it and brighten,
 * like the canvas noticing you. It only draws while the hero is on screen and the pointer moves;
 * with reduced motion it draws once and stays still.
 */
export function DotField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia(REDUCED).matches;
    const GAP = 22;
    const R = 150;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let px = -9999;
    let py = -9999;
    let tx = -9999;
    let ty = -9999;
    let raf = 0;
    let visible = true;

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      draw();
    };
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (let y = GAP / 2; y < h; y += GAP) {
        for (let x = GAP / 2; x < w; x += GAP) {
          const dx = px - x;
          const dy = py - y;
          const d = Math.hypot(dx, dy);
          const k = d < R ? 1 - d / R : 0;
          const e = k * k;
          ctx.fillStyle = `rgba(242, 240, 237, ${0.11 + e * 0.5})`;
          ctx.beginPath();
          ctx.arc(x + dx * e * 0.22, y + dy * e * 0.22, 1 + e * 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    const loop = () => {
      px += (tx - px) * 0.16;
      py += (ty - py) * 0.16;
      draw();
      raf = Math.abs(tx - px) + Math.abs(ty - py) > 0.5 ? requestAnimationFrame(loop) : 0;
    };
    const move = (e: PointerEvent) => {
      if (still || !visible) return;
      const rect = canvas.getBoundingClientRect();
      tx = e.clientX - rect.left;
      ty = e.clientY - rect.top;
      if (px < -999) {
        px = tx;
        py = ty;
      }
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const leave = () => {
      tx = ty = -9999;
      px = py = -9999;
      draw();
    };
    const io = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    io.observe(canvas);
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);
  return <canvas ref={ref} className="dotfield" aria-hidden />;
}
