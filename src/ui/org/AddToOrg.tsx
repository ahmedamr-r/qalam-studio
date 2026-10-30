import { useState } from "react";
import { nanoid } from "nanoid";
import { callAI } from "@/ai/client";
import type { CaptureResult } from "@/discovery/capture";
import { captureIngested, type LinkedNow } from "@/org/capture";
import { orgPath } from "@/org/client";
import { projectHref } from "@/projects/model";
import { Segmented } from "../controls";
import { ingestFile, ingestPaste, ingestUrl } from "../discovery/ingest";
import { readFromTools, type AddInput } from "../discovery/import";
import { AddSource } from "../discovery/SourcesPanel";
import { useCurrentOrg } from "../frame/store";

/**
 * Adding material to the organization from its home, not to a board: a paste, files, a page, items
 * from connected tools. Each is read here, then the core keeps it as a source of the
 * organization's, picks out what customers said, files it into the topic pages and proposes where
 * it fits on the boards (server/capture.ts); each board finds its proposals waiting. On a goal's
 * page it takes the notes from a job that was handed over (`job`): they're kept on the job, and what
 * they say is linked to the goals at once. Whose words they are is asked first: their own notes are
 * read as what they believe, never as what customers said (on your own, that's the default), and
 * material with no customers' words in it can be read that way after.
 */

type Result = CaptureResult & { linked?: LinkedNow | null };
type Item = { id: string; title: string; step: string } & ({ state: "working" } | { state: "done"; result: Result } | { state: "failed"; error: string });
type Whose = "customers" | "mine";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const titleOf = (i: AddInput) => (i.kind === "file" ? i.file.name : i.kind === "url" ? i.url : i.kind === "paste" ? i.title || "Pasted text" : `${i.label}: ${i.request}`);

/** "12 quotes picked out · filed into 3 topic pages · 5 proposals for Weekly reorders". */
function said(r: Result): string {
  if (r.own !== undefined) return r.own ? `Read as your own thinking: ${plural(r.own, "piece")}, filed${r.filed ? ` into ${plural(r.filed.pages.length, "topic page")}` : ""} as what you believe.` : "Kept, but Qalam AI found nothing in it to file.";
  if (r.waiting === "roles") return "Kept. It's an interview: add it to a board and say who is who there, then Qalam AI reads it.";
  if (!r.quotes) return "Kept, but Qalam AI found nothing customers said in it.";
  const pages = r.filed ? r.filed.pages.length : 0;
  const linked = r.linked ? (r.linked.added ? `${plural(r.linked.added, "new link")} from problems to goals` : "no new link to a goal") : "";
  return [`${plural(r.quotes, "quote")} picked out`, pages ? `filed into ${plural(pages, "topic page")}` : "", linked, r.placed.length ? r.placed.map((p) => `${plural(p.count, "proposal")} for ${p.name}`).join(", ") : "no board it fits yet"].filter(Boolean).join(" · ");
}

export function AddToOrg({ product, job, hint = "Interviews, tickets, notes, pages. Qalam AI files what customers said and proposes where it fits." }: { product: string | null; job?: string; hint?: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const solo = useCurrentOrg()?.shape === "solo";
  const [whose, setWhose] = useState<Whose | null>(null);
  // On your own, what you add is most often your own notes; a job's notes are what people told you.
  const mine = (whose ?? (solo && !job ? "mine" : "customers")) === "mine";
  const update = (id: string, patch: Partial<Item>) => setItems((list) => list.map((x) => (x.id === id ? ({ ...x, ...patch } as Item) : x)));

  const take = async (inputs: AddInput[]) => {
    for (const input of inputs) {
      const id = nanoid(8);
      setItems((list) => [{ id, title: titleOf(input), step: "Reading it", state: "working" }, ...list]);
      try {
        const read =
          input.kind === "file" ? [await ingestFile(input.file)] : input.kind === "url" ? [await ingestUrl(input.url)] : input.kind === "paste" ? [await ingestPaste(input.text, input.title)] : await readFromTools(input, undefined, (step) => update(id, { step }));
        for (const ing of read) {
          update(id, { title: ing.title, step: "Keeping it" });
          const result = await captureIngested(ing, { product, job, own: mine, onActivity: (step) => update(id, { step }) });
          update(id, { state: "done", result });
        }
      } catch (e) {
        update(id, { state: "failed", error: message(e) });
      }
    }
  };

  /** Nothing customers said in it: read it again as their own thinking. */
  const asOwn = async (it: Item & { state: "done" }) => {
    update(it.id, { state: "working", step: "Reading it as your own thinking" } as Partial<Item>);
    try {
      const { data } = await callAI<{ own: number; filed?: CaptureResult["filed"] }>(await orgPath(`/sources/${encodeURIComponent(it.result.sourceId)}/own`), {}, undefined, undefined, (e) => e.type === "activity" && update(it.id, { step: e.label }));
      update(it.id, { state: "done", result: { ...it.result, ...data } });
    } catch (e) {
      update(it.id, { state: "failed", error: message(e) });
    }
  };

  return (
    <div className="flex flex-col gap-[10px] rounded-lg bg-panel p-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className="text-caption text-fg-muted">{mine ? "Your own notes and thinking. Qalam AI files them as what you believe, never as what customers said." : hint}</p>
        {!job && (
          <Segmented
            label="Whose words"
            value={mine ? "mine" : "customers"}
            options={[
              { value: "customers", label: "Customers' words" },
              { value: "mine", label: "Mine" },
            ]}
            onChange={(v) => setWhose(v as Whose)}
          />
        )}
      </div>
      <AddSource compact onAdd={(inputs) => void take(inputs)} />
      {items.length > 0 && (
        <ul className="flex flex-col gap-[6px]">
          {items.map((it) => (
            <li key={it.id} role="status" className="flex flex-col gap-[2px] text-caption">
              <span className="truncate font-medium text-fg">{it.title}</span>
              {it.state === "working" && <span className="q-shimmer-text truncate text-fg-muted">{it.step}…</span>}
              {it.state === "failed" && <span className="text-fg-muted">Couldn&apos;t add it: {it.error}</span>}
              {it.state === "done" && (
                <span className="text-fg-muted">
                  {said(it.result)}
                  {/* Nothing customers said in it: it may be their own thinking. */}
                  {!it.result.quotes && it.result.own === undefined && !it.result.waiting && (
                    <>
                      {" "}
                      <button type="button" onClick={() => void asOwn(it)} className="font-medium text-fg underline decoration-fg/30 underline-offset-2">
                        Read it as your own thinking
                      </button>
                    </>
                  )}
                  {it.result.placed.map((p) => (
                    <span key={p.board}>
                      {" · "}
                      <a href={`${projectHref({ id: p.board, type: "discovery" })}?review=placed`} className="font-medium text-fg underline decoration-fg/30 underline-offset-2">
                        Review on {p.name}
                      </a>
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
