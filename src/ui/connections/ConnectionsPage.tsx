import clsx from "clsx";
import { welcomeHref } from "@/projects/model";
import { r } from "../recipes";
import { PageFrame } from "../frame/PageFrame";
import { EngineCard } from "./EngineCard";
import { ThisMac } from "./ThisMac";
import { Connectors } from "./Connectors";
import { ProductCode } from "./ProductCode";
import { VoiceCard } from "./VoiceCard";

/**
 * Connections: what Qalam AI runs on (the engine, who pays, what it used), the tools the
 * organization's material comes from, the products' code it reads, and This Mac's health.
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
          <h2 className="text-micro font-medium text-fg-subtle">Connectors</h2>
          <Connectors />
        </div>
        <div className="flex flex-col gap-[8px]">
          <h2 className="text-micro font-medium text-fg-subtle">Product code</h2>
          <ProductCode />
        </div>
        <div className="flex flex-col gap-[8px]">
          <h2 className="text-micro font-medium text-fg-subtle">Voice</h2>
          <VoiceCard />
        </div>
        <div className="flex flex-col gap-[8px]">
          <div className="flex items-center justify-between gap-[12px]">
            <h2 className="text-micro font-medium text-fg-subtle">This Mac</h2>
            <a href={welcomeHref("verify")} className="text-caption text-fg-muted hover:text-fg hover:underline">
              Check the whole setup again
            </a>
          </div>
          <ThisMac withEngine={false} />
        </div>
      </div>
    </PageFrame>
  );
}
