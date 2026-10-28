import clsx from "clsx";
import { r } from "../recipes";
import { PageFrame } from "../frame/PageFrame";
import { inScope } from "../home/scope";
import { useScope } from "../home/useScope";
import { DecisionsList } from "../org/DecisionsList";
import { useOrgData } from "../org/useOrgData";
import { useDecisions } from "../decisions/list";
import { PlaceHead } from "./PlaceHead";

/** What was decided on the boards and why, by day, for the product in view. */
export default function DecisionsPage() {
  const [scope, setScope] = useScope();
  const { projects } = useOrgData();
  const decisions = useDecisions({ limit: 300 });
  // A decision is for its board's product as it is now (it records the one it had then, for a board since deleted).
  const scoped = (decisions ?? []).filter((d) => inScope((projects ?? []).find((p) => p.id === d.board)?.product ?? d.product, scope));
  return (
    <PageFrame place="decisions" crumbs={[{ label: "Decisions" }]} scope={scope} onScope={setScope}>
      <div className={clsx(r.pageMain, "max-w-[880px]")}>
        <PlaceHead title="Decisions" count={decisions ? scoped.length : null} scope={scope} />
        <DecisionsList decisions={scoped} projects={projects ?? []} />
      </div>
    </PageFrame>
  );
}
