import { createOrg, type OrgRef } from "@/org/client";
import { startPlan, type BoxDoc } from "@/onboarding/start";
import type { HandedImage, StartHandoff } from "@/onboarding/handoff";
import { putAssetIn } from "@/doc/assets";
import { orgHref } from "@/projects/model";
import { docRef, guessVoice, heldImages, readyDocs, type Attachment } from "../chat/attach";
import { connectorDef } from "@/connectors/catalog";

/*
 * The first run's moves. The one box's message makes the project and goes to its canvas, where the
 * chat takes it as its first turns (src/ui/space/chat/store.ts, startFrom). What was attached goes
 * with it, kept in the project until the canvas takes it (src/onboarding/handoff.ts).
 */

const finishFirstRun = (org: string) => fetch(`/api/org/${encodeURIComponent(org)}/first-run`, { method: "POST" }).catch(() => {});

/** The project made on an earlier try, so trying again doesn't make another. */
let made: { key: string; org: OrgRef } | null = null;

/** What the box knows of each doc, for routing and whose it is. */
export const boxDocs = (items: readonly Attachment[]): BoxDoc[] =>
  items.filter((a) => a.state === "ready").map((a) => ({ title: a.title, ...(a.held ? { image: true as const } : {}), ...(a.basis ? { basis: a.basis } : {}), ...(connectorDef(a.from)?.group ? { group: connectorDef(a.from)!.group } : {}) }));

/** A picture's type, by its own or by its name. */
const pictureType = (f: File) => f.type || ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif" } as Record<string, string>)[f.name.split(".").pop()?.toLowerCase() ?? ""] || "application/octet-stream";

/**
 * The box's message: the project made, what was attached kept in it, and on to its canvas. False:
 * nothing it could go with (the box keeps the text). Throws what went wrong, in words.
 */
export async function sendStart(text: string, items: readonly Attachment[]): Promise<boolean> {
  const plan = startPlan(text, boxDocs(items), text.trim() ? guessVoice({ text, title: "" }) : undefined);
  if (!plan) return false;
  const docs = readyDocs(items);
  const held = heldImages(items);
  const key = JSON.stringify([text.trim(), items.map((a) => a.key)]);
  const org = made?.key === key ? made.org : await createOrg(plan.name, plan.whose.shape);
  made = { key, org };
  const images: HandedImage[] = [];
  for (const h of held) {
    const type = pictureType(h.held);
    images.push({ asset: await putAssetIn(org.id, h.held, type), title: h.title, type, ...(h.at ? { at: h.at } : {}) });
  }
  const handoff: StartHandoff = { v: 1, turns: plan.turns, whose: plan.whose, docs: docs.map((d) => ({ ...docRef(d), ingested: d.ingested })), images };
  const r = await fetch(`/api/org/${encodeURIComponent(org.id)}/start`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(handoff) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message ?? `Couldn't start the project (${r.status}).`);
  await finishFirstRun(org.id);
  window.location.assign(`${orgHref(org.id)}?start=1`);
  return true;
}
