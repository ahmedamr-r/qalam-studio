import { useState } from "react";
import clsx from "clsx";
import { nanoid } from "nanoid";
import type { Topic } from "@/hub/topics";
import { useOrgContext } from "@/org/context";
import { topicsDb } from "@/org/topics";
import { topicHref } from "@/projects/model";
import { Button } from "../controls";
import { r } from "../recipes";
import { promptDialog } from "../surfaces/dialog";
import { PageFrame } from "../frame/PageFrame";
import { inScope } from "../home/scope";
import { useScope } from "../home/useScope";
import { AddToOrg } from "../org/AddToOrg";
import { SourcesList } from "../org/SourcesList";
import { TopicsList } from "../org/TopicsList";
import { useOrgData } from "../org/useOrgData";
import { useTopics } from "../topics/list";
import { PlaceHead } from "./PlaceHead";
import { ProductMaps } from "./ProductMaps";

/**
 * What the organization has heard and read, for the product in view: its sources (interviews,
 * tickets, documents, pages, brain dumps) with the boards that use each, the pages on its
 * segments and products, and what the product does today, from its code. The problems themselves
 * have a place of their own.
 */
export default function EvidencePage() {
  const [scope, setScope] = useScope();
  const [adding, setAdding] = useState(false);
  const { projects, sources, refresh } = useOrgData();
  const topics = useTopics();
  const products = useOrgContext((s) => s.products);
  const scopedSources = sources.filter((s) => inScope(s.product, scope));
  const pages = topics?.filter((t) => t.kind !== "need" && (scope === "all" ? true : scope === "org" ? !t.products.length : t.products.includes(scope))) ?? null;
  const product = scope !== "all" && scope !== "org" ? scope : null;

  const newSegment = async () => {
    const title = await promptDialog({ title: "New segment", body: "A kind of customer the team tells apart.", label: "Title", placeholder: "Parents of young children", confirmLabel: "Add page", validate: (v) => (v.trim() ? null : "Name it") });
    if (!title) return;
    const now = Date.now();
    const t: Topic = { id: nanoid(10), kind: "segment", title: title.trim().replace(/\s+/g, " ").slice(0, 100), products: product ? [product] : [], createdAt: now, updatedAt: now, lines: [], history: [] };
    await topicsDb.put(t, null);
    window.location.assign(topicHref(t.id));
  };

  return (
    <PageFrame place="evidence" crumbs={[{ label: "Evidence" }]} scope={scope} onScope={setScope}>
      <div className={clsx(r.pageMain, "max-w-[880px]")}>
        <PlaceHead title="Evidence" count={projects ? scopedSources.length : null} scope={scope}>
          <span className="flex items-center gap-[8px]">
            <Button size="sm" variant="ghost" onClick={() => void newSegment()}>
              New segment
            </Button>
            <Button size="sm" variant={adding ? "secondary" : "primary"} onClick={() => setAdding((a) => !a)}>
              {adding ? "Done" : "Add"}
            </Button>
          </span>
        </PlaceHead>
        {adding && <AddToOrg product={product} />}
        <section aria-labelledby="sources" className="flex flex-col gap-[8px]">
          <h2 id="sources" className="text-title font-medium">
            Sources
          </h2>
          <SourcesList sources={scopedSources} projects={projects ?? []} products={products} onChanged={refresh} />
        </section>
        {pages && pages.length > 0 && (
          <section aria-labelledby="who" className="flex flex-col gap-[8px]">
            <h2 id="who" className="text-title font-medium">
              Who and what
            </h2>
            <TopicsList topics={pages} sources={scopedSources} products={products} onFiled={refresh} banner={false} />
          </section>
        )}
        <ProductMaps product={product} products={products} />
      </div>
    </PageFrame>
  );
}
