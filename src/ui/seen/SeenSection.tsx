import { useEffect, useState } from "react";
import clsx from "clsx";
import { ImagePlus } from "lucide-react";
import { onOrgChange } from "@/org/live";
import type { Product } from "@/org/context-md";
import { seenHref } from "@/projects/model";
import { ORG_SEEN, type SeenMap } from "@/seen/types";
import { useWords } from "../frame/store";
import { r } from "../recipes";
import { ago } from "../time";
import { seenMaps } from "./client";
import { Shot } from "./Shot";

/**
 * What people see, on Evidence: each product's screens and flows from its screenshots, a few of its
 * screens and counts, opening its page; "Add screenshots" for a product with none yet. In a
 * product's space only that product; in the organization's every product (and the organization's
 * own, when it has one).
 */
export function SeenSection({ product, products }: { product: string | null; products: Product[] }) {
  const [maps, setMaps] = useState<SeenMap[] | null>(null);
  const words = useWords();
  useEffect(() => {
    const load = () => void seenMaps().then(setMaps, () => setMaps([]));
    load();
    return onOrgChange((c) => c.kind === "seen" && !c.reading && load());
  }, []);
  if (!maps) return null;
  const keys = product ? [product] : [...products.map((p) => p.id), ...(maps.some((m) => m.key === ORG_SEEN) ? [ORG_SEEN] : [])];
  const nameOf = (key: string) => (key === ORG_SEEN ? words.whole : (products.find((p) => p.id === key)?.name ?? key));
  return (
    <section aria-labelledby="seen" className="flex flex-col gap-[8px]">
      <h2 id="seen" className="text-title font-medium">
        What people see
      </h2>
      {!keys.length && <p className="text-caption text-fg-subtle">Add a product first: screenshots are read for one product at a time.</p>}
      {keys.map((key) => {
        const m = maps.find((x) => x.key === key);
        if (!m)
          return (
            <div key={key} className="flex items-center gap-[12px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
              <span className="min-w-0 flex-1 text-caption text-fg-muted">
                <span className="font-medium text-fg">{nameOf(key)}</span> · Qalam AI reads its screenshots and puts them into flows, each screen with notes it can refer to later.
              </span>
              <a href={seenHref(key, { add: true })} className={clsx(r.buttonSm, r.buttonSecondary)}>
                <ImagePlus size={13} /> Add screenshots
              </a>
            </div>
          );
        const first = m.flows[0];
        const shots = (first ? first.steps.map((s) => m.screens.find((x) => x.key === s)).filter((s) => !!s) : m.screens).slice(0, 8);
        return (
          <a key={key} href={seenHref(key)} className="q-item flex flex-col gap-[8px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)] hover:bg-hover">
            <span className="text-caption text-fg-muted">{[nameOf(key), `${m.screens.length} screens`, `${m.flows.length} flows`, `read ${ago(m.readAt)}`].join(" · ")}</span>
            {m.flows.length > 0 && <span className="text-body text-fg">{m.flows.map((f) => f.name).join(" · ")}</span>}
            <span className="flex gap-[6px]">
              {shots.map((s) => (
                <Shot key={s.key} shot={s.shots[0]} label={s.name} w={36} open={false} />
              ))}
            </span>
          </a>
        );
      })}
    </section>
  );
}

/** On a goal's page: the flows from screenshots that serve it, each as a row of its screens. */
export function FlowsToward({ goal }: { goal: string }) {
  const [maps, setMaps] = useState<SeenMap[] | null>(null);
  useEffect(() => {
    const load = () => void seenMaps().then(setMaps, () => setMaps([]));
    load();
    return onOrgChange((c) => c.kind === "seen" && !c.reading && load());
  }, []);
  const flows = (maps ?? []).flatMap((m) => m.flows.filter((f) => f.goal === goal).map((f) => ({ m, f })));
  if (!flows.length) return null;
  return (
    <section aria-labelledby="toward" className="flex flex-col gap-[8px] rounded-lg bg-panel px-[14px] py-[12px] shadow-[inset_0_0_0_1px_var(--color-line-subtle)]">
      <h2 id="toward" className="text-body font-medium text-fg">
        Flows toward it
      </h2>
      {flows.map(({ m, f }) => {
        const screens = new Map(m.screens.map((s) => [s.key, s]));
        return (
          <a key={`${m.key}/${f.key}`} href={seenHref(m.key)} className="q-item flex flex-col gap-[6px] rounded-md p-[6px] hover:bg-hover">
            <span className="text-caption text-fg-muted" dir="auto">
              <span className="font-medium text-fg">{f.name}</span>
              {f.aim ? ` · ${f.aim}` : ""} · {f.steps.length} screens
            </span>
            <span className="flex flex-wrap items-center gap-[4px]">
              {f.steps.map((key, k) => {
                const s = screens.get(key);
                return s ? <Shot key={`${key}-${k}`} shot={s.shots[0]} label={s.name} w={32} open={false} /> : null;
              })}
            </span>
          </a>
        );
      })}
    </section>
  );
}
