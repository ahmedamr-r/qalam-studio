import { useEffect, useRef, type DragEvent } from "react";
import { Renderer } from "@/engine/renderer";
import { Controller } from "@/engine/controller";
import { onFontsChanged } from "@/engine/fonts";
import { readChromeTheme } from "@/engine/chrome";
import { THEME_EVENT } from "./theme";
import { setExportRenderer } from "./exporter";
import TextEditor from "./TextEditor";
import CanvasOverlay from "./ai/CanvasOverlay";
import { RouteOverlays } from "./prototype/RouteOverlays";
import DiscoveryLayer from "./discovery/DiscoveryLayer";
import { useProjectType } from "@/projects/mode";
import { imageFiles, placeImages } from "./images";
import { boardDragOver, boardDrop, clearDropTarget } from "./discovery/drop";
import { studio } from "@/doc/store";
import { onComponentsPage } from "@/doc/pages";

let activeController: Controller | null = null;
export const getController = () => activeController;

export default function CanvasView() {
  const wrap = useRef<HTMLDivElement>(null);
  const board = useProjectType() === "discovery";
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvasRef.current!;
    const renderer = new Renderer(el);
    const controller = new Controller(el, renderer);
    activeController = controller;
    setExportRenderer(renderer);

    const ro = new ResizeObserver(() => {
      if (!wrap.current) return; // can fire once after unmount
      const r = wrap.current.getBoundingClientRect();
      el.style.width = `${r.width}px`;
      el.style.height = `${r.height}px`;
      renderer.resize(r.width, r.height, window.devicePixelRatio || 1);
      controller.render();
    });
    ro.observe(wrap.current!);
    const offFonts = onFontsChanged(() => {
      renderer.invalidateText();
      controller.render();
    });

    // Chrome colours come from the theme's CSS variables: read them now and on every switch.
    const applyTheme = () => {
      renderer.setTheme(readChromeTheme());
      controller.render();
    };
    applyTheme();
    window.addEventListener(THEME_EVENT, applyTheme);
    // Anything else that flips the theme attribute (the boot script, devtools) is caught here.
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      window.removeEventListener(THEME_EVENT, applyTheme);
      themeObserver.disconnect();
      offFonts();
      ro.disconnect();
      controller.dispose();
      renderer.dispose();
      setExportRenderer(null);
      activeController = null;
    };
  }, []);

  /** Where a drag is over the canvas, in world space. */
  const worldOf = (e: DragEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return activeController!.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  return (
    <div
      ref={wrap}
      data-region="canvas"
      className="relative h-full w-full overflow-hidden bg-canvas"
      // No browser menu over the canvas even where ours stays shut (rulers, ⌘-right-click on nothing).
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        // A board takes quotes, sources and documents dragged in (discovery/drop.ts).
        if (board && activeController && boardDragOver(e, worldOf(e))) return;
        // Nothing drops on the Components page (it is drawn from the design system).
        if (onComponentsPage(studio().doc)) return;
        if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file" && i.type.startsWith("image/"))) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={(e) => {
        if (board && !e.currentTarget.contains(e.relatedTarget as Node | null)) clearDropTarget();
      }}
      onDrop={(e) => {
        if (board && activeController && boardDrop(e, worldOf(e))) return;
        const files = imageFiles(e.dataTransfer.files);
        if (!files.length || !activeController || onComponentsPage(studio().doc)) return;
        e.preventDefault();
        void placeImages(files, worldOf(e));
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block touch-none" aria-label="Design canvas" />
      <TextEditor />
      <CanvasOverlay />
      {board && <DiscoveryLayer />}
      {!board && <RouteOverlays />}
    </div>
  );
}
