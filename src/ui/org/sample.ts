import { feedback } from "@/commands/feedback";
import { openSampleOrg } from "@/org/client";
import { orgHref } from "@/projects/model";

/** Opens the sample project on its ranked problems. Nothing has to be set up first. */
export async function trySample(): Promise<void> {
  try {
    const org = await openSampleOrg();
    window.location.assign(`${orgHref(org.id)}?panel=problems`);
  } catch (e) {
    feedback(`The sample couldn't open. ${e instanceof Error ? e.message : ""}`.trim(), { kind: "error" });
  }
}
