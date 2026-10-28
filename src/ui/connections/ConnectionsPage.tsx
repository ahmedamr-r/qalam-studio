import clsx from "clsx";
import { r } from "../recipes";
import { PageFrame } from "../frame/PageFrame";
import { EngineCard } from "./EngineCard";
import { ThisMac } from "./ThisMac";

/**
 * Connections: what Qalam AI runs on (the engine, who pays, what it used), and This Mac's health.
 * The tools the organization's material comes from join here next.
 */
export default function ConnectionsPage() {
  return (
    <PageFrame place="connections" crumbs={[{ label: "Connections" }]}>
      <div className={clsx(r.pageMain, "max-w-[880px] gap-[24px]")}>
        <h1 className="text-heading font-semibold text-fg">Connections</h1>
        <div className="flex flex-col gap-[8px]">
          <h2 className="text-micro font-medium text-fg-subtle">Qalam AI</h2>
          <EngineCard />
        </div>
        <div className="flex flex-col gap-[8px]">
          <h2 className="text-micro font-medium text-fg-subtle">This Mac</h2>
          <ThisMac withEngine={false} />
        </div>
      </div>
    </PageFrame>
  );
}
