import { startTransition, useEffect, useState } from "react";
import clsx from "clsx";
import { bootOrg } from "@/org/boot";
import { CantReachFiles, listOrgs, NoOrgYet, OrgMissing, type OrgRef } from "@/org/client";
import { useOrgContext } from "@/org/context";
import { projectLetter, spaceHref, welcomeHref, type ProjectType } from "@/projects/model";
import { Splash } from "./brand/splash";
import { r } from "./recipes";
import { routeOf, type Route } from "./routes";
import { movedTo, pageMovedTo } from "./frame/spaces";
import { currentSpace, lastSpace } from "./frame/useSpace";
import StudioLoader, { CaptureLoader, HomeLoader, OrgsLoader, SeenLoader, PageSuspense, PlaceLoader, SetupLoader, SystemProjectLoader, WelcomeLoader } from "./StudioLoader";
import { armMotion } from "./motion";
import { startInPlace } from "./nav";
import { bootRetryDelay } from "./welcome/steps";
import { boardHomeHref } from "./space/href";
import { loadLab } from "@/lab";

type State = { kind: "loading" } | { kind: "ready"; org: OrgRef } | { kind: "error"; message: string; missingOrg?: boolean } | { kind: "missing" };

/** The page for this address, once the organization's files are within reach; the frame's pages then move in place (./nav.ts). */
export function App() {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.pathname));
  const [state, setState] = useState<State>({ kind: "loading" });
  // What v0.1 hides is read before any page draws (src/lab.ts), the welcome's too.
  const [labReady, setLabReady] = useState(false);
  useEffect(() => void loadLab(bootRetryDelay).then(() => setLabReady(true)), []);
  // Transitions come on once a page can draw; a Screens project's studio does this itself, after its boot fade.
  useEffect(() => {
    if (labReady && route.kind !== "project") armMotion();
  }, [labReady, route.kind]);
  const ready = state.kind === "ready" ? state.org.id : null;
  useEffect(() => {
    if (!ready) return;
    return startInPlace(ready, (r) => startTransition(() => setRoute(r)));
  }, [ready]);

  const boot = (attempt = 0) => {
    // The welcome needs no organization (there may be none yet), and the organizations' list picks one.
    if (route.kind === "welcome" || route.kind === "root") return;
    setState({ kind: "loading" });
    const org = route.kind === "capture" || route.kind === "missing" ? null : route.org;
    loadLab(bootRetryDelay).then(() => bootOrg(org)).then(
      async (o) => {
        // Opening an organization lands on the canvas this tab was on last (a product's, while it's
        // there), else the organization's own.
        if (route.kind === "spaces") {
          const last = lastSpace(o.id);
          const product = last && useOrgContext.getState().products.some((p) => p.id === last) ? last : null;
          return window.location.replace(spaceHref(product, "home", o.id));
        }
        // A goal's or a topic page's own address: its page in the canvas's panel, in place (read from the
        // address as it is now: boot can run again after it moved).
        const page = pageMovedTo(routeOf(window.location.pathname), window.location.hash, currentSpace());
        if (page) {
          history.replaceState(null, "", page);
          setRoute(routeOf(window.location.pathname));
        }
        // Addresses from before spaces: the sidebar's ?product=, the home's old tabs, places from before the job order.
        const moved = movedTo(route, window.location.search);
        if (moved) return window.location.replace(spaceHref(moved.product, moved.place, o.id) + moved.search + window.location.hash);
        // A board's page is its space's home now: the board's old address lands there, with what it asked for.
        if (route.kind === "project" && route.type === "discovery" && route.org) {
          const p = (await fetch(`/api/org/${o.id}/projects/${route.id}`).then((r) => (r.ok ? r.json() : null), () => null)) as { product?: string | null } | null;
          if (!p) return setState({ kind: "missing" });
          return window.location.replace(boardHomeHref(route.id, p.product ?? null, { query: window.location.search, org: o.id }) + window.location.hash);
        }
        // An address from before organizations moves to its organization's.
        if (route.kind === "project" && !route.org) {
          const home = await findProject(route.id, route.type, o.id);
          if (home) return window.location.replace(`${home}${window.location.search}${window.location.hash}`);
          return setState({ kind: "missing" });
        }
        setState({ kind: "ready", org: o });
      },
      (e: unknown) => {
        // The first run: nothing to open yet, so the welcome.
        if (e instanceof NoOrgYet) return window.location.replace(welcomeHref());
        // The desktop app's core may still be starting (503) or restarting (502): wait for it a while.
        const wait = e instanceof CantReachFiles && (e.status === 503 || e.status === 502) ? bootRetryDelay(attempt) : null;
        if (wait !== null) return void setTimeout(() => boot(attempt + 1), wait);
        setState({ kind: "error", message: e instanceof Error ? e.message : String(e), missingOrg: e instanceof OrgMissing });
      },
    );
  };
  useEffect(() => boot(), []);

  // One boundary for every page; each address is a page of its own, so moving in place mounts the
  // next one fresh while the last one shows until its code is in. A canvas stays one page while its
  // query changes (a page opened in its panel, a card asked for).
  return (
    <PageSuspense>
      <Page key={route.kind === "org" ? window.location.pathname : window.location.pathname + window.location.search} route={route} state={state} labReady={labReady} retry={boot} />
    </PageSuspense>
  );
}

function Page({ route, state, labReady, retry }: { route: Route; state: State; labReady: boolean; retry: () => void }) {
  if (route.kind === "welcome" && labReady) return <WelcomeLoader />;
  if (route.kind === "root" && labReady) return <OrgsLoader />;
  if (state.kind === "loading" || !labReady)
    return (
      <div className="fixed inset-0 grid place-items-center bg-app text-fg">
        <Splash />
      </div>
    );
  if (state.kind === "error") return state.missingOrg ? <Missing title="Organization not found" body="It isn't on this computer: its folder moved, or it was made on another computer." /> : <CantReach message={state.message} onRetry={retry} />;
  if (state.kind === "missing" || route.kind === "missing") return <Missing title="Page not found" body="There's nothing at this address." />;
  if (route.kind === "org") return <HomeLoader product={route.product} />;
  if (route.kind === "seen") return <SeenLoader seenKey={route.key} add={!!route.add} />;
  if (route.kind === "setup") return <SetupLoader />;
  if (route.kind === "place") return <PlaceLoader place={route.place} product={route.product} />;
  if (route.kind === "capture") return <CaptureLoader />;
  if (route.kind !== "project") return null;
  if (route.type === "system") return <SystemProjectLoader projectId={route.id} />;
  return <StudioLoader projectId={route.id} mode={route.type} />;
}

/** Where a project from an address without an organization lives now: the open organization first, then the others. */
async function findProject(id: string, type: ProjectType, first: string): Promise<string | null> {
  const { orgs } = await listOrgs().catch(() => ({ orgs: [] as OrgRef[] }));
  const order = [first, ...orgs.map((o) => o.id).filter((o) => o !== first)];
  for (const org of order) {
    const res = await fetch(`/api/org/${org}/projects/${id}`).catch(() => null);
    if (res?.ok) return `/o/${org}/${projectLetter(type)}/${id}`;
  }
  return null;
}

function CantReach({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="fixed inset-0 grid place-items-center bg-app text-fg">
      <div className="flex w-[340px] flex-col items-center gap-[12px] text-center">
        <p className="text-title font-medium text-fg">Qalam can't reach your files</p>
        <p className="text-body text-fg-muted">{message}</p>
        <button type="button" className={clsx(r.button, r.buttonSecondary)} onClick={() => onRetry()}>
          Try again
        </button>
      </div>
    </div>
  );
}

function Missing({ title, body }: { title: string; body: string }) {
  return (
    <div className="fixed inset-0 grid place-items-center bg-app text-fg">
      <div className="flex w-[300px] flex-col items-center gap-[12px] text-center">
        <p className="text-title font-medium text-fg">{title}</p>
        <p className="text-body text-fg-muted">{body}</p>
        <a href="/" className={clsx(r.button, r.buttonSecondary)}>
          Back home
        </a>
      </div>
    </div>
  );
}
