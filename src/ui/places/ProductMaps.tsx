import { useEffect, useState } from "react";
import type { ProductMap } from "@/code/map";
import { codeDb } from "@/org/code";
import { onOrgChange } from "@/org/live";
import type { Product } from "@/org/context-md";
import { goalHref, placeHref } from "@/projects/model";
import { useGoals } from "@/goals/client";
import { ago } from "../time";

/**
 * What each product does today, from its code (hub/maps, read by the code reader): its main flows,
 * each step with the file it's in and the events it sends, and which goal a flow measures. Read
 * again from Connections.
 */
export function ProductMaps({ product, products }: { product: string | null; products: Product[] }) {
  const [maps, setMaps] = useState<ProductMap[] | null>(null);
  const goals = useGoals();
  useEffect(() => {
    const load = () => void codeDb.view().then((v) => setMaps(v.maps), () => setMaps([]));
    load();
    return onOrgChange((c) => c.kind === "map" && load());
  }, []);
  const shown = (maps ?? []).filter((m) => !product || !m.product || m.product === product);
  if (!maps) return null;
  return (
    <section aria-labelledby="code" className="flex flex-col gap-[8px]">
      <div className="flex items-end justify-between gap-[12px]">
        <h2 id="code" className="text-title font-medium">
          What the product does today
        </h2>
        <a href={placeHref("connections")} className="text-caption text-fg-muted hover:text-fg hover:underline">
          {shown.length ? "Read it again" : "Read the product's code"}
        </a>
      </div>
      {!shown.length && <p className="text-caption text-fg-subtle">Qalam reads the product&apos;s code, read-only, and writes its main flows here: each step with its file and the events it sends.</p>}
      {shown.map((m) => (
        <div key={m.key} className="flex flex-col gap-[6px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
          <span className="text-caption text-fg-muted">
            {[products.find((p) => p.id === m.product)?.name ?? "The whole organization", `${m.repo}${m.commit ? ` at ${m.commit.slice(0, 7)}` : ""}`, `read ${ago(m.readAt)}`, `${m.events.length} events`].join(" · ")}
          </span>
          {m.flows.map((f) => (
            <div key={f.name} className="flex flex-col gap-[2px] pt-[4px]">
              <span className="text-body font-medium text-fg">
                {f.name}
                {f.goal && goals.goals.some((g) => g.id === f.goal) && (
                  <a href={goalHref(f.goal)} className="ml-[8px] text-caption font-normal text-fg-muted hover:text-fg hover:underline">
                    measures “{goals.goals.find((g) => g.id === f.goal)!.title}”
                  </a>
                )}
              </span>
              <ol className="flex flex-col">
                {f.steps.map((s, i) => (
                  <li key={`${s.file}:${i}`} className="grid grid-cols-[20px_minmax(0,1fr)_minmax(0,260px)] items-baseline gap-x-[10px] py-[2px]">
                    <span className="text-caption text-fg-subtle tnum">{i + 1}</span>
                    <span className="truncate text-caption text-fg">
                      {s.title} <span className="font-mono text-micro text-fg-subtle">{s.file}</span>
                    </span>
                    <span className="truncate text-right font-mono text-micro text-fg-muted">{s.events.join(", ")}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {!m.flows.length && <span className="text-caption text-fg-subtle">No flow held up against the code.</span>}
        </div>
      ))}
    </section>
  );
}
