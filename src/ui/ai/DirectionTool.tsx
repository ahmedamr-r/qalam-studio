import clsx from "clsx";
import { ArrowLeftRight, Copy, Frame, Languages, ShieldCheck, TriangleAlert } from "lucide-react";
import type { FrameNode } from "@/doc/schema";
import { studio } from "@/doc/store";
import { getController } from "../CanvasView";
import { LANG_NAME, langForDir } from "@/design-system/translate";
import { Button, Checkbox } from "../controls";
import { r } from "../recipes";
import { DIR_LABEL, nextDir, type CopyOutcome, type DirectionMode, type DirectionOutcome } from "./direction";

/* UI of the Direction tool: the composer body and the result card in the chat (logic in direction.ts). */

function show(ids: string[]) {
  const live = ids.filter((id) => studio().doc.nodes[id]);
  if (!live.length) return;
  studio().select(live);
  getController()?.zoomToFit(live);
}

/** Composer body: what will change, and how (in place or as a copy), and whether the copy is translated with it. */
export function DirectionComposerBody({
  targets,
  mode,
  onMode,
  toTranslate,
  translate,
  onTranslate,
}: {
  targets: FrameNode[];
  mode: DirectionMode;
  onMode: (m: DirectionMode) => void;
  /** Distinct strings written in the other language. */
  toTranslate: number;
  translate: boolean;
  onTranslate: (v: boolean) => void;
}) {
  if (!targets.length) return <p className="px-[12px] pt-[12px] pb-[6px] text-body text-fg-muted">Select a screen or frame on the canvas to switch its direction.</p>;
  const to = nextDir(targets);
  const from = targets[0].dir;
  const options: { value: DirectionMode; icon: typeof Frame; title: string; hint: string }[] = [
    { value: "switch", icon: ArrowLeftRight, title: `Switch to ${to.toUpperCase()}`, hint: "Flip this frame in place" },
    { value: "mirror", icon: Copy, title: `Duplicate as ${to.toUpperCase()} mirror`, hint: `Keep the ${from.toUpperCase()} version next to it` },
  ];
  return (
    <div className="flex flex-col gap-[8px] px-[10px] pt-[10px] pb-[4px]">
      <p className="px-[2px] text-caption text-fg-muted">
        Now {DIR_LABEL[from]}. Auto layout mirrors rows, padding and alignment; corners and directional icons flip too.
      </p>
      <div className="grid grid-cols-2 gap-[6px]" role="radiogroup" aria-label="How to switch">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={mode === o.value}
            onClick={() => onMode(o.value)}
            className={clsx("q-item q-press flex flex-col items-start gap-[2px] rounded-md px-[10px] py-[8px] text-left", mode === o.value ? r.optionCardSelected : "shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-hover")}
          >
            <span className="flex items-center gap-[6px] text-caption font-medium text-fg">
              <o.icon size={12} absoluteStrokeWidth strokeWidth={1.25} className={mode === o.value ? "text-fg-accent" : "text-fg-subtle"} /> {o.title}
            </span>
            <span className="text-micro text-fg-subtle">{o.hint}</span>
          </button>
        ))}
      </div>
      <CopyRow to={langForDir(to)} count={toTranslate} translate={translate} onTranslate={onTranslate} />
    </div>
  );
}

/** What the scan found in the copy, and the choice to translate it. */
function CopyRow({ to, count, translate, onTranslate }: { to: "en" | "ar"; count: number; translate: boolean; onTranslate: (v: boolean) => void }) {
  const from = LANG_NAME[to === "ar" ? "en" : "ar"];
  if (!count)
    return (
      <p className="flex items-center gap-[6px] px-[2px] text-caption text-fg-muted">
        <Languages size={12} absoluteStrokeWidth strokeWidth={1.25} className="shrink-0 text-fg-subtle" /> No {from} copy to translate.
      </p>
    );
  return (
    <div className="flex flex-col gap-[2px] rounded-md px-[10px] py-[6px] shadow-[inset_0_0_0_1px_var(--color-line)]">
      <Checkbox checked={translate} onChange={onTranslate} label={<span className="text-caption font-medium text-fg">Translate the copy to {LANG_NAME[to]}</span>} />
      <span className="pl-[22px] text-micro text-fg-subtle tnum">
        {count} text{count > 1 ? "s" : ""} in {from}. Qalam AI translates them; names, brands and amounts stay as written.
      </span>
    </div>
  );
}

/** The copy's line in the result card. */
function copyLine(c: CopyOutcome): string {
  const lang = LANG_NAME[c.to];
  const from = LANG_NAME[c.to === "ar" ? "en" : "ar"];
  const n = (k: number) => `${k} text${k === 1 ? "" : "s"}`;
  if (!c.found) return `No ${from} copy to translate.`;
  if (c.skipped === "kept") return `Kept the copy as written: ${n(c.found)} still in ${from}.`;
  if (c.skipped === "no-ai") return `${n(c.found)} still in ${from}: translating needs Qalam AI, which isn't set up here.`;
  const kept = c.kept.length ? ` Kept as written: ${c.kept.slice(0, 4).map((k) => `"${k.slice(0, 24)}"`).join(", ")}${c.kept.length > 4 ? "…" : ""}.` : "";
  return `Translated ${n(c.translated)} to ${lang}.${kept}`;
}

/** Result card in the chat. */
export function DirectionView({ o, onReview }: { o: DirectionOutcome; onReview: () => void }) {
  const names = o.frames.map((f) => f.name).join(", ");
  return (
    <div className="flex flex-col gap-[8px] rounded-lg p-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="text-body leading-[20px] text-fg">
        {o.frames.length === 0
          ? `Already ${DIR_LABEL[o.toDir]}: nothing to switch.`
          : o.mode === "switch"
            ? `Switched ${names} to ${DIR_LABEL[o.toDir]}.`
            : `Made ${o.frames.length > 1 ? "mirrored copies" : "a mirrored copy"}: ${names}.`}
      </p>
      {o.copy && o.frames.length > 0 && (
        <div className="flex flex-col gap-[2px]">
          <p className="flex items-start gap-[6px] text-caption text-fg-muted">
            <Languages size={12} absoluteStrokeWidth strokeWidth={1.25} className="mt-[2px] shrink-0 text-fg-subtle" /> {copyLine(o.copy)}
          </p>
          {o.copy.note && <p className="pl-[18px] text-micro text-fg-subtle">{o.copy.note}</p>}
        </div>
      )}
      {o.frames.length > 0 && (
        <p className={clsx("flex items-center gap-[6px] text-caption", o.rtlIssues ? "text-warning" : "text-fg-muted")}>
          {o.rtlIssues ? <TriangleAlert size={12} absoluteStrokeWidth strokeWidth={1.25} className="shrink-0" /> : <ShieldCheck size={12} absoluteStrokeWidth strokeWidth={1.25} className="shrink-0 text-success" />}
          {o.rtlIssues ? `${o.rtlIssues} RTL check${o.rtlIssues > 1 ? "s" : ""} to review (Arabic type, letter-spacing, icons).` : "No RTL issues found."}
        </p>
      )}
      {o.frames.length > 0 && (
        <div className="flex flex-wrap gap-[6px]">
          <Button size="sm" variant="secondary" onClick={() => show(o.frames.map((f) => f.id))}>
            <Frame size={12} absoluteStrokeWidth strokeWidth={1.25} /> Show on canvas
          </Button>
          {o.rtlIssues > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                show(o.frames.map((f) => f.id));
                onReview();
              }}
            >
              <ShieldCheck size={12} absoluteStrokeWidth strokeWidth={1.25} /> Review in Audit
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
