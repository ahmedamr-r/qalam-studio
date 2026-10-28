import { useState } from "react";
import clsx from "clsx";
import { useOrgContext } from "@/org/context";
import { Button } from "../controls";
import { r } from "../recipes";
import { PageFrame } from "../frame/PageFrame";
import { inScope } from "../home/scope";
import { useScope } from "../home/useScope";
import { AddToOrg } from "../org/AddToOrg";
import { SourcesList } from "../org/SourcesList";
import { useOrgData } from "../org/useOrgData";
import { PlaceHead } from "./PlaceHead";

/** What the organization has read (interviews, documents, pages, brain dumps), for the product in view, and the boards that use each. */
export default function SourcesPage() {
  const [scope, setScope] = useScope();
  const [adding, setAdding] = useState(false);
  const { projects, sources, refresh } = useOrgData();
  const products = useOrgContext((s) => s.products);
  const scoped = sources.filter((s) => inScope(s.product, scope));
  const product = scope !== "all" && scope !== "org" ? scope : null;
  return (
    <PageFrame place="sources" crumbs={[{ label: "Sources" }]} scope={scope} onScope={setScope}>
      <div className={clsx(r.pageMain, "max-w-[880px]")}>
        <PlaceHead title="Sources" count={projects ? scoped.length : null} scope={scope}>
          <Button size="sm" variant={adding ? "secondary" : "primary"} onClick={() => setAdding((a) => !a)}>
            {adding ? "Done" : "Add"}
          </Button>
        </PlaceHead>
        {adding && <AddToOrg product={product} />}
        <SourcesList sources={scoped} projects={projects ?? []} products={products} onChanged={refresh} />
      </div>
    </PageFrame>
  );
}
