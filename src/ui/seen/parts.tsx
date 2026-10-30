import { useRef, useState, type DragEvent } from "react";
import clsx from "clsx";
import { ImagePlus, RotateCcw } from "lucide-react";
import { seenHref } from "@/projects/model";
import { QalamAIGlyph } from "../brand/ai-glyph";
import { Button, Spinner } from "../controls";
import { ReplyChips, type PartComponent } from "../chat/ChatThread";
import type { PartData } from "../chat/types";
import { r } from "../recipes";
import { addShots, answer, dropReading, sendAnswers, unanswer, useSeen } from "./client";
import { Shot } from "./Shot";

/*
 * The parts of the reading's conversation (./thread.ts names them): where screenshots go in, the
 * screenshots added, Qalam AI at work, a question with the screens it's about and why it asks, the
 * round going back, the review, and what's next once it's in.
 */

/** Files from a drop, folders opened (one level is enough for a batch of screenshots). */
async function droppedFiles(e: DragEvent): Promise<File[]> {
  const items = [...e.dataTransfer.items];
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
  if (!entries.some((x) => x.isDirectory)) return [...e.dataTransfer.files];
  const out: File[] = [];
  const fileOf = (f: FileSystemFileEntry) => new Promise<File>((ok, no) => f.file(ok, no));
  for (const entry of entries) {
    if (entry.isFile) out.push(await fileOf(entry as FileSystemFileEntry));
    else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const all: FileSystemEntry[] = [];
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, no) => reader.readEntries(ok, no));
        if (!batch.length) break;
        all.push(...batch);
      }
      for (const f of all.filter((x) => x.isFile && !x.name.startsWith("."))) out.push(await fileOf(f as FileSystemFileEntry));
    }
  }
  return out;
}

export function DropArea({ compact }: { compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const adding = useSeen((s) => !!s.adding);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void droppedFiles(e).then(addShots);
      }}
      onPaste={(e) => {
        const files = [...e.clipboardData.files];
        if (files.length) void addShots(files);
      }}
      tabIndex={0}
      className={clsx("flex flex-col items-center gap-[8px] rounded-lg border border-dashed text-center transition-colors", compact ? "px-[12px] py-[12px]" : "px-[16px] py-[22px]", over ? "border-fg bg-hover" : "border-line-strong")}
    >
      <ImagePlus size={20} strokeWidth={1.5} className="text-fg-muted" />
      <p className="text-body text-fg">Drop screenshots or a folder of them here, or paste</p>
      <p className="text-caption text-fg-subtle">PNG, JPEG or WebP, up to 60 at a time. Their words are read on this Mac.</p>
      <Button size="sm" variant="secondary" disabled={adding} onClick={() => input.current?.click()}>
        Choose screenshots
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => {
          void addShots([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function AddingPart({ data }: { data: PartData }) {
  return (
    <span className={clsx(r.chatStatus, "text-fg-muted")}>
      <Spinner size={12} /> Keeping {String(data.done)} of {String(data.count)} screenshots…
    </span>
  );
}

function ShotsPart() {
  const shots = useSeen((s) => s.view?.reading?.shots ?? []);
  const notes = useSeen((s) => s.view?.reading?.notes ?? {});
  return (
    <div className="flex flex-col gap-[6px]">
      <span className="text-caption text-fg-muted">{shots.length === 1 ? "A screenshot" : `${shots.length} screenshots`}</span>
      <div className="flex flex-wrap gap-[6px]">
        {shots.map((s) => (
          <Shot key={s.ref} shot={s.ref} label={notes[s.ref]?.name ?? s.name} w={40} className={clsx(!notes[s.ref] && "opacity-70")} />
        ))}
      </div>
    </div>
  );
}

function WorkingPart() {
  return (
    <span className={clsx(r.chatStatus, "text-fg-muted")}>
      <Spinner size={12} /> <span className="q-shimmer-text">Working…</span>
    </span>
  );
}

function QuestionPart({ data }: { data: PartData }) {
  const reading = useSeen((s) => s.view?.reading);
  const notes = reading?.notes ?? {};
  const said = useSeen((s) => s.answers);
  const q = reading?.rounds[Number(data.round)]?.questions.find((x) => x.id === data.id);
  if (!q) return null;
  const live = data.live === true;
  const name = (shot: string) => notes[shot]?.name ?? reading?.proposal?.screens.find((s) => s.shots.includes(shot))?.name ?? "Screen";
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex flex-wrap gap-[8px]">
        {q.shots.map((shot) => (
          <Shot key={shot} shot={shot} label={name(shot)} marks={q.marks.filter((m) => m.shot === shot)} w={88} />
        ))}
      </div>
      <p className="text-body leading-[20px] text-fg" dir="auto">
        {q.ask}
      </p>
      <p className="flex items-start gap-[6px] text-caption text-fg-muted" dir="auto">
        <QalamAIGlyph size={12} className="mt-[3px] shrink-0" />
        <span>
          <span className="font-medium text-fg-muted">Why I ask:</span> {q.why}
        </span>
      </p>
      {live && q.options.length > 0 && (
        <ReplyChips>
          {q.options.map((o) => (
            <Button key={o} size="sm" variant="secondary" onClick={() => answer(q.id, o)}>
              {o}
            </Button>
          ))}
        </ReplyChips>
      )}
      {!live && said[q.id] && reading?.phase === "asking" && (
        <button type="button" className="self-start text-micro font-medium text-fg-muted hover:text-fg" onClick={() => unanswer(q.id)}>
          Change my answer
        </button>
      )}
    </div>
  );
}

function SendPart() {
  const busy = useSeen((s) => s.busy);
  return (
    <ReplyChips>
      <Button size="sm" disabled={busy} onClick={() => void sendAnswers()}>
        {busy ? "Sending…" : "Place them with my answers"}
      </Button>
    </ReplyChips>
  );
}

function ReviewPart() {
  return <p className="text-caption text-fg-subtle">Tick or cross each flow on the right, then add them. Screens stay kept either way.</p>;
}

function DonePart() {
  const key = useSeen((s) => s.key);
  return (
    <ReplyChips>
      {key && (
        <a href={seenHref(key)} className={clsx(r.buttonSm, r.buttonPrimary)}>
          See the flows
        </a>
      )}
      <Button size="sm" variant="ghost" onClick={() => void dropReading()}>
        Add more screenshots
      </Button>
    </ReplyChips>
  );
}

function RetryPart() {
  return (
    <ReplyChips>
      <Button size="sm" variant="secondary" onClick={() => void dropReading()}>
        <RotateCcw size={13} /> Start again
      </Button>
    </ReplyChips>
  );
}

export const PARTS: Record<string, PartComponent> = {
  drop: () => <DropArea />,
  adding: AddingPart,
  shots: ShotsPart,
  working: WorkingPart,
  question: QuestionPart,
  send: SendPart,
  review: ReviewPart,
  done: DonePart,
  retry: RetryPart,
};
