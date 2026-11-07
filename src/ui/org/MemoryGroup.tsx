import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { FLOW_WORDS } from "@/memory/types";
import { forgetMemory, loadMemory, useMemory, type MemoryLine } from "@/org/memory";
import { useCurrentOrg } from "../frame/store";
import { Button, IconBtn } from "../controls";
import { r } from "../recipes";

/*
 * What Qalam AI remembers from conversations (src/memory/), in the Company panel beside Words: each
 * question and how it was answered, whose, where and when, with Forget. Qalam AI reads it before it asks,
 * so it doesn't ask again. Their own answers and the picks they agreed to are the team's; what they didn't
 * know or left stays on this computer.
 */

const ICON = { absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const SHOWN = 8;
const day = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function answerOf(e: MemoryLine): string {
  if (e.how === "unknown") return e.a ? `Didn't know: “${e.a}”` : "Didn't know";
  if (e.how === "left") return "Left unanswered";
  return e.a;
}

function MemoryRow({ e, solo }: { e: MemoryLine; solo: boolean }) {
  // A solo project has no teammates: whoever answered there is "you".
  const who = e.mine || solo ? "You" : (e.name ?? "A teammate");
  const answered = e.how === "own" || e.how === "pick";
  return (
    <div className="group relative flex flex-col gap-[2px] pr-[24px]">
      <p className="text-caption text-fg-muted" dir="auto">
        {e.q}
      </p>
      <p className={answered ? "text-body leading-[20px] text-fg" : "text-body leading-[20px] text-fg-subtle"} dir="auto">
        {answerOf(e)}
        {e.how === "pick" && <span className="ml-[6px] text-micro text-fg-muted">· Qalam AI&apos;s pick, agreed to</span>}
      </p>
      <p className="text-micro text-fg-subtle">
        {who} · {FLOW_WORDS[e.flow]} · {day(e.at)}
      </p>
      <span className="absolute top-0 right-0 rounded-md bg-app opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <IconBtn size="sm" label="Forget this" onClick={() => void forgetMemory(e.id)}>
          <X size={12} {...ICON} />
        </IconBtn>
      </span>
    </div>
  );
}

function Lines({ entries, solo }: { entries: MemoryLine[]; solo: boolean }) {
  const [all, setAll] = useState(false);
  return (
    <>
      {(all ? entries : entries.slice(0, SHOWN)).map((e) => (
        <MemoryRow key={e.id} e={e} solo={solo} />
      ))}
      {entries.length > SHOWN && !all && (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setAll(true)}>
          Show all {entries.length}
        </Button>
      )}
    </>
  );
}

export function MemoryGroup() {
  const { entries, loaded, error } = useMemory();
  const solo = useCurrentOrg()?.shape === "solo";
  useEffect(() => void loadMemory(), []);
  const shared = entries.filter((e) => e.shared);
  const here = entries.filter((e) => !e.shared);
  return (
    <section aria-labelledby="space-memory" className="flex flex-col gap-[8px]">
      <div className="flex h-[24px] items-center">
        <h3 id="space-memory" className={r.sectionTitle}>
          Memory
        </h3>
      </div>
      <p className="text-caption text-fg-muted">
        {solo ? "What you've told Qalam AI when it asked." : "What you and your team told Qalam AI when it asked; your answers sync with the project."} It reads these first, so it doesn&apos;t ask again. Forget one and it won&apos;t bring it up.
      </p>
      {loaded && !entries.length && <p className="text-caption text-fg-subtle">Nothing yet. What you answer when Qalam AI asks shows here.</p>}
      <Lines entries={shared} solo={solo} />
      {here.length > 0 && (
        <>
          <p className="mt-[4px] text-caption font-medium text-fg-muted">Only on this computer</p>
          <p className="text-caption text-fg-subtle">What you didn&apos;t know, or left. It isn&apos;t shared.</p>
          <Lines entries={here} solo={solo} />
        </>
      )}
      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
