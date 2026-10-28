import { useState } from "react";
import { nanoid } from "nanoid";
import type { CaptureResult } from "@/discovery/capture";
import { captureIngested } from "@/org/capture";
import { projectHref } from "@/projects/model";
import { ingestFile, ingestPaste, ingestUrl } from "../discovery/ingest";
import { readFromTools, type AddInput } from "../discovery/import";
import { AddSource } from "../discovery/SourcesPanel";

/**
 * Adding material to the organization from its home, not to a board: a paste, files, a page, items
 * from connected tools. Each is read here, then the core keeps it as a source of the
 * organization's, picks out what customers said, files it into the topic pages and proposes where
 * it fits on the boards (server/capture.ts); each board finds its proposals waiting.
 */

type Item = { id: string; title: string; step: string } & ({ state: "working" } | { state: "done"; result: CaptureResult } | { state: "failed"; error: string });

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const titleOf = (i: AddInput) => (i.kind === "file" ? i.file.name : i.kind === "url" ? i.url : i.kind === "paste" ? i.title || "Pasted text" : `${i.label}: ${i.request}`);

/** "12 quotes picked out · filed into 3 topic pages · 5 proposals for Weekly reorders". */
function said(r: CaptureResult): string {
  if (r.waiting === "roles") return "Kept. It's an interview: add it to a board and say who is who there, then Qalam AI reads it.";
  if (!r.quotes) return "Kept, but Qalam AI found nothing customers said in it.";
  const pages = r.filed ? r.filed.pages.length : 0;
  return [`${plural(r.quotes, "quote")} picked out`, pages ? `filed into ${plural(pages, "topic page")}` : "", r.placed.length ? r.placed.map((p) => `${plural(p.count, "proposal")} for ${p.name}`).join(", ") : "no board it fits yet"].filter(Boolean).join(" · ");
}

export function AddToOrg({ product }: { product: string | null }) {
  const [items, setItems] = useState<Item[]>([]);
  const update = (id: string, patch: Partial<Item>) => setItems((list) => list.map((x) => (x.id === id ? ({ ...x, ...patch } as Item) : x)));

  const take = async (inputs: AddInput[]) => {
    for (const input of inputs) {
      const id = nanoid(8);
      setItems((list) => [{ id, title: titleOf(input), step: "Reading it", state: "working" }, ...list]);
      try {
        const read =
          input.kind === "file" ? [await ingestFile(input.file)] : input.kind === "url" ? [await ingestUrl(input.url)] : input.kind === "paste" ? [await ingestPaste(input.text, input.title)] : await readFromTools(input, undefined, (step) => update(id, { step }));
        for (const ing of read) {
          update(id, { title: ing.title, step: "Keeping it in the organization" });
          const result = await captureIngested(ing, { product, onActivity: (step) => update(id, { step }) });
          update(id, { state: "done", result });
        }
      } catch (e) {
        update(id, { state: "failed", error: message(e) });
      }
    }
  };

  return (
    <div className="flex flex-col gap-[10px] rounded-lg bg-panel p-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <p className="text-caption text-fg-muted">Interviews, tickets, notes, pages: Qalam AI picks out what customers said, files it into the topic pages and proposes where it fits on your boards. Files dropped in the organization&apos;s inbox folder are taken in the same way.</p>
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
