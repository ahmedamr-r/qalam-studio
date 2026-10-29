import clsx from "clsx";
import { r } from "../recipes";
import { PageFrame } from "../frame/PageFrame";
import { inSpace } from "../frame/spaces";
import { useSpace } from "../frame/useSpace";
import { DecisionsList } from "../org/DecisionsList";
import { useOrgData } from "../org/useOrgData";
import { useDecisions } from "../decisions/list";
import { PlaceHead } from "./PlaceHead";

/** What was decided on the boards and why, by day, in the space: the organization's, or a product's. */
export default function DecisionsPage({ product = null }: { product?: string | null }) {
  const { space } = useSpace(product, "decisions");
  const { projects } = useOrgData();
  const decisions = useDecisions({ limit: 300 });
  // A decision is for its board's product as it is now (it records the one it had then, for a board since deleted).
  const scoped = (decisions ?? []).filter((d) => inSpace((projects ?? []).find((p) => p.id === d.board)?.product ?? d.product, space));
  return (
    <PageFrame place="decisions" crumbs={[{ label: "Decisions" }]} space={space}>
      <div className={clsx(r.pageMain, "max-w-[880px]")}>
        <PlaceHead title="Decisions" count={decisions ? scoped.length : null} space={space} />
        <DecisionsList decisions={scoped} projects={projects ?? []} />
      </div>
    </PageFrame>
  );
}
