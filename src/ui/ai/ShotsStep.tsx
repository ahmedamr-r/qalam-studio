import { useRef, useState, type RefObject } from "react";
import clsx from "clsx";
import { ImagePlus, X } from "lucide-react";
import { putAsset } from "@/doc/assets";
import { Button, Spinner } from "../controls";
import { Dictated } from "../voice/MicButton";
import { Shot } from "../seen/Shot";
import { droppedFiles, isScreenshotFile } from "../chat/dropped";
import { SHOTS_MAX, addAnswerShots, removeShot, type Answer, type ShotsQuestion } from "./questionFlow";

/*
 * A question asking to see a screen: screenshots dropped, pasted or picked under it, in the order given
 * (each kept as the project's asset as it lands, no tokens), and words beside them if they like. What's
 * printed on a screenshot is never words of theirs; only what they type is.
 */

const icon = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;

/** A screenshot's name: its file's, without the extension; a pasted one ("image.png") has none worth keeping. */
const nameOf = (f: File, n: number) => {
  const base = f.name.replace(/\.[a-z0-9]+$/i, "").trim();
  return !base || /^image$/i.test(base) ? `Screenshot ${n}` : base.slice(0, 120);
};

export function ShotsStep({ q, a, onAnswer, textArea, onEnter }: { q: ShotsQuestion; a: Answer; onAnswer: (a: Answer) => void; textArea: RefObject<HTMLTextAreaElement | null>; onEnter: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const shots = a.kind === "shots" ? a.shots : [];
  const text = a.kind === "shots" ? a.text : a.kind === "text" ? a.text : "";
  const max = q.max ?? SHOTS_MAX;
  // Files land after a render or two: each batch builds on the answer as it is then.
  const latest = useRef(a);
  latest.current = a;
  const answerNow = useRef(onAnswer);
  answerNow.current = onAnswer;

  const add = async (files: File[]) => {
    const pictures = files.filter(isScreenshotFile);
    const other = files.length - pictures.length;
    const had = latest.current.kind === "shots" ? latest.current.shots.length : 0;
    const take = pictures.slice(0, Math.max(0, max - had));
    setNote(other ? `${other === 1 ? "One file isn't" : `${other} files aren't`} a screenshot Qalam reads (PNG, JPEG, WebP, GIF, or HEIC on a Mac).` : pictures.length > take.length ? `Up to ${max} in one answer: add the rest in another.` : null);
    if (!take.length) return;
    setBusy((n) => n + take.length);
    try {
      const kept = await Promise.all(take.map((f) => putAsset(f).then((asset) => ({ asset, f }), (e: unknown) => ({ error: e instanceof Error ? e.message : String(e), f }))));
      const failed = kept.filter((k): k is { error: string; f: File } => "error" in k);
      if (failed.length) setNote(`Couldn't keep ${failed[0].f.name || "a screenshot"}: ${failed[0].error}`);
      const base = latest.current.kind === "shots" ? latest.current.shots.length : 0;
      const good = kept.filter((k): k is { asset: string; f: File } => "asset" in k).map((k, i) => ({ asset: k.asset, title: nameOf(k.f, base + i + 1) }));
      if (good.length) answerNow.current(addAnswerShots(latest.current, good, max));
    } finally {
      setBusy((n) => n - take.length);
    }
  };

  const setText = (t: string) => onAnswer({ kind: "shots", shots, text: t });

  return (
    <div className="flex flex-col gap-[8px]">
      {/* Its own keys: Enter on a button here isn't the card's Next. */}
      <div
        onKeyDown={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void droppedFiles(e).then(add);
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (!files.length) return;
          e.preventDefault();
          void add(files);
        }}
        tabIndex={0}
        aria-label="Screenshots for this answer: drop, paste or choose them"
        className={clsx("flex flex-col gap-[8px] rounded-lg border border-dashed px-[10px] py-[10px] outline-none transition-colors focus-visible:border-fg", over ? "border-fg bg-hover" : "border-line-strong")}
      >
        {shots.length > 0 && (
          <ol className="flex flex-wrap items-start gap-[6px]" aria-label="Screenshots, in the order people see them">
            {shots.map((s, i) => (
              <li key={s.asset} className="flex items-start gap-[6px]">
                {i > 0 && (
                  <span aria-hidden className="mt-[20px] text-micro text-fg-faint">
                    →
                  </span>
                )}
                <span className="group/shot relative flex w-[56px] flex-col gap-[2px]">
                  <Shot shot={s.asset} label={s.title} w={56} />
                  <span className="truncate text-micro text-fg-subtle" title={s.title}>
                    {s.title}
                  </span>
                  <button
                    type="button"
                    aria-label={`Take ${s.title} out`}
                    onClick={() => onAnswer(removeShot(a.kind === "shots" ? a : { kind: "shots", shots, text }, s.asset))}
                    className="absolute -right-[6px] -top-[6px] grid size-[18px] place-items-center rounded-full bg-elevated text-fg-muted opacity-0 shadow-[0_0_0_1px_var(--color-line)] transition-opacity hover:text-fg focus-visible:opacity-100 group-hover/shot:opacity-100"
                  >
                    <X size={10} {...icon} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-[8px]">
          <ImagePlus size={16} {...icon} className="shrink-0 text-fg-muted" />
          <span className="min-w-0 flex-1 text-caption text-fg-muted">{shots.length ? "Add more, in the order people see them" : "Drop or paste screenshots, in the order people see them"}</span>
          {busy > 0 && <Spinner size={12} />}
          <Button size="sm" variant="secondary" disabled={shots.length >= max} onClick={() => input.current?.click()}>
            Choose
          </Button>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
            multiple
            hidden
            onChange={(e) => {
              void add([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
        {note && <p className="text-micro text-fg-muted">{note}</p>}
      </div>
      <Dictated field={textArea} set={setText}>
        <textarea
          ref={textArea}
          rows={2}
          dir="auto"
          className="ds-textarea block w-full resize-none placeholder:text-fg-faint"
          placeholder={q.placeholder}
          maxLength={q.maxLength}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            // A screenshot pasted into the words goes with the screenshots; words paste as words.
            const files = [...e.clipboardData.files];
            if (!files.length) return;
            e.preventDefault();
            void add(files);
          }}
          onKeyDown={(e) => {
            // Enter goes on, as everywhere in the card; Shift+Enter starts a new line.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey) {
              e.preventDefault();
              e.stopPropagation();
              onEnter();
            }
          }}
        />
      </Dictated>
    </div>
  );
}
