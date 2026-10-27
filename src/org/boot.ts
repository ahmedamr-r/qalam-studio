import { hydrateSystems, reloadSystems } from "@/design-system/registry";
import { hydrateNaming } from "@/ui/ai/aiStore";
import { currentOrg, type OrgRef } from "./client";
import { onOrgChange, startLive } from "./live";

let booted: Promise<OrgRef> | null = null;

/**
 * Before anything draws: the organization this window works in, its design systems and its naming
 * memory. Then keep them current as they change elsewhere.
 */
export function bootOrg(): Promise<OrgRef> {
  booted ??= (async () => {
    const org = await currentOrg();
    await Promise.all([hydrateSystems(org.id), hydrateNaming()]);
    startLive();
    onOrgChange((c) => {
      if (c.kind === "system") void reloadSystems();
      if (c.kind === "naming") void hydrateNaming();
    });
    return org;
  })().catch((e) => {
    booted = null;
    throw e;
  });
  return booted;
}
