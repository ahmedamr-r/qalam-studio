import type { BriefMeta } from "@/discovery/brief";
import { orgFetch, orgJson } from "./client";

/** A card's brief, in the window: the core writes it (server/org/briefs.ts) and announces each change. */

export const listBriefs = () => orgJson<{ briefs: BriefMeta[] }>("/briefs").then((r) => r.briefs);
export const getBrief = (id: string) => orgJson<{ brief: { meta: BriefMeta; body: string } }>(`/briefs/${encodeURIComponent(id)}`).then((r) => r.brief);
export const writeCardBrief = (req: unknown, signal?: AbortSignal) => orgJson<{ brief: BriefMeta }>("/briefs", { method: "POST", json: req, ...(signal ? { signal } : {}) }).then((r) => r.brief);
export const removeBrief = (id: string) => orgFetch(`/briefs/${encodeURIComponent(id)}`, { method: "DELETE" }).then(() => {});
