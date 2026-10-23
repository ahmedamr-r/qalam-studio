import { useEffect, useRef, useState, type ComponentType } from "react";
import clsx from "clsx";
import { Code2, Copy, Download, Play, RotateCcw, TriangleAlert, X } from "lucide-react";
import type { Doc } from "@/doc/schema";
import type { PhoneFeel } from "@/design-system/native-motion";
import type { Machine } from "@/proto/walk";
import { feedback } from "@/commands/feedback";
import { formatKeys, kb } from "@/commands/registry";
import { studio } from "@/doc/store";
import { currentProject } from "@/projects/session";
import { IconBtn, Segmented, Tip } from "../controls";
import { download } from "../exporter";
import { r } from "../recipes";
import { buildPrototype, type BuiltPrototype } from "./build";
import { Failure } from "./Failure";
import { loadPrototypeModule, type PlayerProps } from "./runtime";
import { Session } from "./session/Session";
import { closePrototype, setPlayParam, usePrototypeMode } from "./store";

/**
 * Prototype mode (⌥⌘↵): the selected screens compiled to React + Motion and played live, links
 * wired, over the studio — a session (session/Session.tsx) that, for a screen with a route, lists
 * what it does step by step and plays it through. What plays is the exported TSX itself
 * (runtime.ts), so Copy and Download hand over exactly this. The canvas is untouched: animation
 * lives in the code, not in CanvasKit.
 */

type State =
  | { kind: "loading" }
  | { kind: "ready"; built: BuiltPrototype; doc: Doc; Proto: ComponentType<PlayerProps>; machine: Machine | null }
  | { kind: "error"; message: string; code?: string };

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const ESC = formatKeys(kb("Esc"));

const fileName = () => `${(currentProject()?.name ?? "qalam-prototype").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "qalam-prototype"}.tsx`;

export default function PrototypeMode() {
  const selection = usePrototypeMode((s) => s.selection);
  const version = usePrototypeMode((s) => s.version);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [run, setRun] = useState(0);
  const [showCode, setShowCode] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    // Compiling again (Qalam AI built steps): what's playing stays until the new build is in.
    setState((s) => (s.kind === "ready" ? s : { kind: "loading" }));
    const doc = studio().doc;
    buildPrototype(doc, selection, currentProject()?.name)
      .then((built) => {
        if (!live) return;
        try {
          const { Prototype, exports } = loadPrototypeModule(built.preview.code);
          // With routes, the module's own machine plays the steps through (proto/walk.ts).
          const machine = typeof exports.step === "function" && typeof exports.initial === "function" && exports.TAPS ? (exports as unknown as Machine) : null;
          setState({ kind: "ready", built, doc, Proto: Prototype, machine });
        } catch (e) {
          setState({ kind: "error", message: e instanceof Error ? e.message : String(e), code: built.code });
        }
      })
      .catch((e: unknown) => live && setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [selection, version]);

  // Keys stay in here: Esc closes, nothing reaches the canvas behind (see Workspace for the same guard).
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.current?.focus({ preventScroll: true });
    const guard = (e: Event) => {
      if (e.target !== document.body && e.target !== document.documentElement) return;
      e.stopImmediatePropagation();
      if (e instanceof KeyboardEvent && e.key === "Escape") closePrototype();
    };
    const types = ["keydown", "copy", "cut", "paste"] as const;
    for (const t of types) window.addEventListener(t, guard, true);
    return () => {
      for (const t of types) window.removeEventListener(t, guard, true);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // The address says which screen is playing while the session is open.
  const playing = state.kind === "ready" ? state.built.preview.start : null;
  useEffect(() => {
    if (playing) setPlayParam(playing);
  }, [playing]);
  useEffect(() => () => setPlayParam(null), []);

  const built = state.kind === "ready" ? state.built : null;
  const code = built?.code ?? (state.kind === "error" ? state.code : undefined);
  const screens = built?.preview.screens ?? [];
  const start = screens.find((s) => s.id === built?.preview.start);
  const warnings = built?.warnings ?? [];

  // Phone screens move as iOS or Android does: the designer's pick, kept with the document (and in the code it hands over).
  const feel = built?.preview.feel;
  const setFeel = (v: PhoneFeel) => {
    if (v === feel) return;
    studio().mutate((d) => {
      if (!d.proto) return;
      if (v === "ios") delete d.proto.feel;
      else d.proto.feel = v;
    });
    usePrototypeMode.setState((s) => ({ version: s.version + 1 }));
  };

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      feedback("Copied the prototype's TSX", { kind: "success", id: "prototype.copy" });
    } catch {
      feedback("Couldn't reach the clipboard; use Download instead", { kind: "error", id: "prototype.copy" });
    }
  };

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal
      aria-label="Prototype"
      tabIndex={-1}
      className="q-fade fixed inset-0 z-50 flex flex-col bg-app text-fg outline-none"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") closePrototype();
      }}
      onKeyUp={(e) => e.stopPropagation()}
      onCopy={(e) => e.stopPropagation()}
      onPaste={(e) => e.stopPropagation()}
    >
      <header className="flex h-(--topbar-h) shrink-0 items-center gap-[8px] border-b border-line-subtle pr-[10px] pl-[16px]">
        <Play size={14} className="text-fg-subtle" aria-hidden />
        <h2 className="text-body font-semibold">Prototype</h2>
        <span className="truncate text-caption text-fg-subtle">
          {state.kind === "loading" ? "Compiling…" : screens.length ? `${screens.length} ${screens.length === 1 ? "screen" : "screens"} · starts on ${start?.name ?? screens[0].name}` : ""}
        </span>
        {warnings.length > 0 && (
          <Tip label={showWarnings ? "Hide notes" : "What couldn't be compiled"}>
            <button type="button" onClick={() => setShowWarnings((v) => !v)} className={clsx(r.buttonSm, r.buttonGhost, "text-warning")} aria-expanded={showWarnings}>
              <TriangleAlert {...ICON} /> {warnings.length}
            </button>
          </Tip>
        )}
        <span className="grow" />
        {(feel === "ios" || feel === "android") && (
          <Segmented<PhoneFeel>
            label="Moves like"
            value={feel}
            onChange={setFeel}
            className="mr-[4px] w-[136px]"
            options={[
              { value: "ios", label: "iOS", title: "Moves as iOS does: UIKit's navigation and sheet spring, SwiftUI's springs, presses that dim" },
              { value: "android", label: "Android", title: "Moves as Android does: Material 3's emphasized curve and springs, ripples" },
            ]}
          />
        )}
        <IconBtn label="Restart" onClick={() => setRun((n) => n + 1)} disabled={state.kind !== "ready"}>
          <RotateCcw {...ICON} />
        </IconBtn>
        <IconBtn label={showCode ? "Hide code" : "Show code"} active={showCode} onClick={() => setShowCode((v) => !v)} disabled={!code}>
          <Code2 {...ICON} />
        </IconBtn>
        <span aria-hidden className={r.vsep} />
        <button type="button" className={clsx(r.button, r.buttonSecondary)} onClick={() => void copy()} disabled={!code}>
          <Copy {...ICON} /> Copy TSX
        </button>
        <button type="button" className={clsx(r.button, r.buttonSecondary, "ml-[6px]")} onClick={() => code && download(fileName(), code, "text/plain;charset=utf-8")} disabled={!code}>
          <Download {...ICON} /> Download
        </button>
        <span aria-hidden className={r.vsep} />
        <IconBtn label="Close" keys={ESC} onClick={closePrototype}>
          <X size={16} absoluteStrokeWidth strokeWidth={1.25} />
        </IconBtn>
      </header>
      {showWarnings && warnings.length > 0 && (
        <ul className="shrink-0 border-b border-line-subtle px-[16px] py-[8px] text-caption text-fg-muted">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {state.kind === "ready" && start ? (
        <Session
          doc={state.doc}
          screen={start.id}
          screenKey={start.key}
          machine={state.machine}
          size={{ w: start.w, h: start.h }}
          Proto={state.Proto}
          restart={run}
          aside={showCode && code ? <pre className="w-[min(46vw,720px)] shrink-0 overflow-auto border-l border-line-subtle bg-panel p-[16px] font-mono text-micro leading-[1.6] text-fg-muted select-text">{code}</pre> : null}
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 overflow-auto bg-canvas p-[24px]" data-prototype-stage>
            {state.kind === "loading" && <p className="m-auto text-caption text-fg-subtle">Compiling the screens…</p>}
            {state.kind === "error" && (
              <div className="m-auto">
                <Failure title="The prototype didn't compile" message={state.message} />
              </div>
            )}
          </div>
          {showCode && code && (
            <pre className="w-[min(46vw,720px)] shrink-0 overflow-auto border-l border-line-subtle bg-panel p-[16px] font-mono text-micro leading-[1.6] text-fg-muted select-text">{code}</pre>
          )}
        </div>
      )}
    </div>
  );
}
