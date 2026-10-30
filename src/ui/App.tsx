import { startTransition, useEffect, useState } from "react";
import clsx from "clsx";
import { bootOrg } from "@/org/boot";
import { CantReachFiles, listOrgs, NoOrgYet, OrgMissing, type OrgRef } from "@/org/client";
import { useOrgContext } from "@/org/context";
import { orgHref, projectLetter, spaceHref, spacesHref, welcomeHref, type ProjectType } from "@/projects/model";
import { Splash } from "./brand/splash";
import { r } from "./recipes";
import { routeOf, type Route } from "./routes";
import { movedTo } from "./frame/spaces";
import StudioLoader, { CaptureLoader, GoalLoader, HomeLoader, SeenLoader, PageSuspense, PlaceLoader, SetupLoader, SpacesLoader, SystemProjectLoader, TopicLoader, WelcomeLoader } from "./StudioLoader";
import { startInPlace } from "./nav";
import { bootRetryDelay } from "./welcome/steps";

type State = { kind: "loading" } | { kind: "ready"; org: OrgRef } | { kind: "error"; message: string; missingOrg?: boolean } | { kind: "missing" };

/** The page for this address, once the organization's files are within reach; the frame's pages then move in place (./nav.ts). */
export function App() {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.pathname));
  const [state, setState] = useState<State>({ kind: "loading" });
  const ready = state.kind === "ready" ? state.org.id : null;
  useEffect(() => {
    if (!ready) return;
    return startInPlace(ready, (r) => startTransition(() => setRoute(r)));
  }, [ready]);

  const boot = (attempt = 0) => {
    // The welcome needs no organization (there may be none yet).
    if (route.kind === "welcome") return;
    setState({ kind: "loading" });
    const org = route.kind === "root" || route.kind === "capture" || route.kind === "missing" ? null : route.org;
    bootOrg(org).then(
      async (o) => {
        // Opening an organization (the bare address opens the one opened last) lands on picking a
        // space once it has products, else on its home.
        const products = useOrgContext.getState().products.length;
        if (route.kind === "root") return window.location.replace(products && !window.location.search ? spacesHref(o.id) : orgHref(o.id) + window.location.search);
        if (route.kind === "spaces" && new URLSearchParams(window.location.search).has("open")) {
          if (!products) return window.location.replace(orgHref(o.id));
          history.replaceState(null, "", spacesHref(o.id));
        }
        // Addresses from before spaces: the sidebar's ?product=, the home's old tabs, places from before the job order.
        const moved = movedTo(route, window.location.search);
        if (moved) return window.location.replace(spaceHref(moved.product, moved.place, o.id) + moved.search + window.location.hash);
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
  // next one fresh while the last one shows until its code is in.
  return (
    <PageSuspense>
      <Page key={window.location.pathname + window.location.search} route={route} state={state} retry={boot} />
    </PageSuspense>
  );
}

function Page({ route, state, retry }: { route: Route; state: State; retry: () => void }) {
  if (route.kind === "welcome") return <WelcomeLoader />;
  if (state.kind === "loading")
    return (
      <div className="fixed inset-0 grid place-items-center bg-app text-fg">
        <Splash />
      </div>
    );
  if (state.kind === "error") return state.missingOrg ? <Missing title="Organization not found" body="It isn't on this computer: its folder moved, or it was made on another computer." /> : <CantReach message={state.message} onRetry={retry} />;
  if (state.kind === "missing" || route.kind === "missing") return <Missing title="Page not found" body="There's nothing at this address." />;
  if (route.kind === "org") return <HomeLoader product={route.product} />;
  if (route.kind === "spaces") return <SpacesLoader />;
  if (route.kind === "topic") return <TopicLoader id={route.id} />;
  if (route.kind === "goal") return <GoalLoader id={route.id} />;
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
