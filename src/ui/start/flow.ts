import { chooseOrg, createOrg, orgFetch, type OrgRef } from "@/org/client";
import { saidOf, shapeOfPath, startTarget, type StartPath } from "@/onboarding/start";
import { orgHref } from "@/projects/model";
import { startScan } from "@/org/scan";
import { projectName, requestOf } from "@/scan/input";
import type { ScanSession, ScanTarget } from "@/scan/session";
import type { ScanSaid } from "@/scan/steer";
import { chatKey, scanTurn, withTurn, emptyChat } from "@/space/chat";
import { handWords } from "../space/handoff";
import { useFirstRun } from "../onboarding/flow";

/*
 * The first run's moves. Reading starts from the first answer, in the core, so the questions after
 * it can be asked full screen while it goes on; the canvas's chat picks it up from the turn written
 * here, the same as if it had been asked for there.
 */

export const startHref = (org: string, question?: number) => `/o/${encodeURIComponent(org)}/start${question !== undefined ? `?q=${question}` : ""}`;

const locale = () => (typeof navigator === "undefined" ? "" : navigator.language);

/** The canvas's chat, holding this scan. A first run's project has no other turns to keep. */
export const writeScanChat = (target: ScanTarget, session: ScanSession, told?: readonly ScanSaid[]) => orgFetch(`/canvas-chat/${chatKey(null)}`, { method: "PUT", json: withTurn(emptyChat(), scanTurn(target, saidOf(target), session, told)) });

const finishFirstRun = (org: string) => fetch(`/api/org/${encodeURIComponent(org)}/first-run`, { method: "POST" }).catch(() => {});

/** Until it's checked: nothing is started on an engine that may turn out not to be there. */
export const engineChecked = () =>
  new Promise<void>((done) => {
    if (!useFirstRun.getState().engine.checking) return done();
    const stop = useFirstRun.subscribe((s) => {
      if (s.engine.checking) return;
      stop();
      done();
    });
  });

const isReady = () => {
  const e = useFirstRun.getState().engine;
  return !!(e.test ?? e.view?.test)?.ok;
};

/** The project made on an earlier try, so trying again doesn't make another. */
let made: { key: string; org: OrgRef } | null = null;

/** Starts on the first answer, then on to the questions. It only returns if something went wrong. */
export async function beginReading(path: StartPath, raw: string): Promise<void> {
  const target = startTarget(path, raw);
  if (!target) throw new Error("Say what to look at first.");
  await engineChecked();
  const key = `${path}:${JSON.stringify(target)}`;
  const org = made?.key === key ? made.org : await createOrg(projectName(target), shapeOfPath(path));
  made = { key, org };
  // Set up later: its canvas opens, and its chat says what reading needs.
  if (!isReady()) {
    handWords(raw.trim());
    await finishFirstRun(org.id);
    return window.location.assign(`${orgHref(org.id)}?scan=1`);
  }
  chooseOrg(org.id);
  const session = await startScan(requestOf(target, raw, locale()));
  await writeScanChat(target, session);
  await finishFirstRun(org.id);
  window.location.replace(startHref(org.id, 0));
}

/** Read again, with what they've said. */
export async function readAgain(session: ScanSession): Promise<ScanSession> {
  const told = session.steer?.said;
  const next = await startScan({ ...requestOf(session.target, saidOf(session.target), locale()), ...(told?.length ? { told } : {}) });
  await writeScanChat(session.target, next, told);
  return next;
}
