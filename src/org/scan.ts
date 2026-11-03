import type { ScanRequest, ScanSession } from "@/scan/session";
import { orgFetch, orgJson } from "./client";

/** What people complain about, in the window: the core runs it (server/org/scan.ts) and announces each change. */

export const scanNow = () => orgJson<{ session: ScanSession | null }>("/scan").then((r) => r.session);

export const startScan = (req: ScanRequest) => orgJson<{ session: ScanSession }>("/scan", { method: "POST", json: req }).then((r) => r.session);

export const stopScan = () => orgFetch("/scan", { method: "DELETE" }).then(() => {});
