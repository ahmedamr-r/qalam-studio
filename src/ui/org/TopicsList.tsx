import { FileText } from "lucide-react";
import type { SourceRecord } from "@/discovery/sources";
import { disputedCount, sectionCounts, TOPIC_KIND_LABEL, type TopicInfo, type TopicKind } from "@/hub/topics";
import type { Product } from "@/org/context-md";
import { unfiled } from "@/org/filing";
import { topicHref } from "@/projects/model";
import { Button } from "../controls";
import { ago } from "../time";
import { stopFiling, updatePages, useFiling } from "../topics/filing";

/**
 * The organization's topic pages, by kind: one for each need, kind of customer and product, saying
 * what the organization knows, believes, has against it and doesn't know yet. Qalam AI starts and
 * keeps them from the sources; what it hasn't filed yet waits above, with Update pages.
 */

const ICON = { size: 14, absoluteStrokeWidth: true, strokeWidth: 1.25 } as const;
const GROUPS: { kind: TopicKind; title: string }[] = [
  { kind: "need", title: "Problems" },
  { kind: "segment", title: "Segments" },
  { kind: "product", title: "Products" },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What customers said that the pages haven't taken in yet, and Update pages (or how far filing has got). */
export function FilingBanner({ sources, onFiled }: { sources: SourceRecord[]; onFiled: () => void }) {
  const { step, note } = useFiling();
  const waiting = unfiled(sources);
  const fromSources = new Set(waiting.map((w) => w.s.id)).size;
  const update = () => void updatePages(sources).then(onFiled);
  return (
    <>
      {step || waiting.length ? (
      <div role="status" className="flex flex-wrap items-center justify-between gap-[12px] rounded-lg bg-raised px-[12px] py-[10px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
        <p className="text-body text-fg-muted">
          {step
            ? `Qalam AI is filing what customers said into the pages${step.of > 1 ? `: ${Math.min(step.done + 1, step.of)} of ${step.of}` : ""}…`
            : `${plural(waiting.length, "quote")} in ${plural(fromSources, "source")} ${waiting.length === 1 ? "isn't" : "aren't"} on the topic pages yet.`}
        </p>
        {step ? (
          <Button variant="secondary" size="sm" onClick={stopFiling}>
            Stop
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={update}>
            Update pages
          </Button>
        )}
      </div>
      ) : null}
      {note && !step ? <p className="text-caption text-fg-muted">{note}</p> : null}
    </>
  );
}

export function TopicsList({ topics, sources, products, onFiled, banner = true }: { topics: TopicInfo[] | null; sources: SourceRecord[]; products: Product[]; onFiled: () => void; banner?: boolean }) {
  const waiting = unfiled(sources);
  if (topics === null) return <p className="text-body text-fg-muted">Loading the pages…</p>;
  if (!topics.length)
    return (
      <div className="flex flex-col gap-[12px]">
        {banner && <FilingBanner sources={sources} onFiled={onFiled} />}
        <p className="text-body text-fg-muted">
          No pages yet. Qalam AI keeps one for each problem customers have, each segment and each product: what you know, what you believe, what speaks against it and what nobody knows yet, each line resting on what customers said.{" "}
          {waiting.length ? "Update pages starts them from your sources." : "Add a source, and Qalam AI starts them."}
        </p>
      </div>
    );
  const productNames = (t: TopicInfo) => t.products.map((id) => products.find((p) => p.id === id)?.name).filter(Boolean) as string[];
  return (
    <div className="flex flex-col gap-[16px]">
      {banner && <FilingBanner sources={sources} onFiled={onFiled} />}
      {GROUPS.map(({ kind, title }) => {
        const list = topics.filter((t) => t.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind} className="flex flex-col gap-[6px]">
            <h3 className="text-caption font-medium text-fg-muted">
              {title} · {list.length}
            </h3>
            <ul className="flex flex-col divide-y divide-line-subtle rounded-lg bg-panel shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
              {list.map((t) => {
                const c = sectionCounts(t);
                const disputed = disputedCount(t);
                const counts = [c.know && `${c.know} known`, c.believe && `${c.believe} believed`, c.against && `${c.against} against`, c.open && `${plural(c.open, "open question")}`].filter(Boolean) as string[];
                return (
                  <li key={t.id}>
                    <a href={topicHref(t.id)} className="q-item flex items-start gap-[10px] px-[12px] py-[10px] hover:bg-hover">
                      <span className="mt-[2px] text-fg-subtle">
                        <FileText {...ICON} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                        <span className="truncate text-body text-fg">{t.title}</span>
                        <span className="text-caption text-fg-muted">
                          {[...(counts.length ? counts : ["Nothing on it yet"]), ...(disputed ? [`${disputed} disputed`] : [])].join(" · ")}
                        </span>
                        <span className="text-caption text-fg-subtle">{[TOPIC_KIND_LABEL[t.kind], ...(productNames(t).length ? productNames(t) : ["Whole organization"]), `updated ${ago(t.updatedAt)}`].join(" · ")}</span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
