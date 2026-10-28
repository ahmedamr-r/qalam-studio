import { hydrateSystems, reloadSystems } from "@/design-system/registry";
import { loadGoals } from "@/goals/client";
import { setLinkOrg } from "@/projects/model";
import { hydrateNaming } from "@/ui/ai/aiStore";
import { chooseOrg, currentOrg, forgetOrg, rememberOrg, type OrgRef } from "./client";
import { loadOrgContext } from "./context";
import { onOrgChange, startLive } from "./live";

let booted: Promise<OrgRef> | null = null;

/**
 * Before anything draws: the organization this window works in (the one in its address, or the
 * one opened last), its design systems, naming memory and what it and its products are. Then
 * keep them current as they change elsewhere.
 */
export function bootOrg(orgId: string | null = null): Promise<OrgRef> {
  booted ??= (async () => {
    chooseOrg(orgId);
    const org = await currentOrg();
    setLinkOrg(org.id);
    void rememberOrg(org.id);
    await Promise.all([hydrateSystems(org.id), hydrateNaming(), loadOrgContext(), loadGoals().catch(() => {})]);
    startLive();
    onOrgChange((c) => {
      if (c.kind === "system") void reloadSystems();
      if (c.kind === "naming") void hydrateNaming();
      if (c.kind === "product" || c.kind === "about") void loadOrgContext();
      if (c.kind === "goal") void loadGoals().catch(() => {});
      if (c.kind === "org") forgetOrg();
    });
    return org;
  })().catch((e) => {
    booted = null;
    throw e;
  });
  return booted;
}
