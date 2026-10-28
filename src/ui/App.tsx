import { useEffect, useState } from "react";
import clsx from "clsx";
import { bootOrg } from "@/org/boot";
import { CantReachFiles, listOrgs, NoOrgYet, OrgMissing, type OrgRef } from "@/org/client";
import { orgHref, placeHref, projectLetter, welcomeHref, type ProjectType } from "@/projects/model";
import { Splash } from "./brand/splash";
import { r } from "./recipes";
import { routeOf, type Route } from "./routes";
import { legacyTab } from "./frame/places";
import StudioLoader, { HomeLoader, PlaceLoader, SetupLoader, SystemProjectLoader, TopicLoader, WelcomeLoader } from "./StudioLoader";
import { bootRetryDelay } from "./welcome/steps";

type State = { kind: "loading" } | { kind: "ready"; org: OrgRef } | { kind: "error"; message: string; missingOrg?: boolean } | { kind: "missing" };

/** The page for this address, once the organization's files are within reach. */
export function App() {
  const [route] = useState<Route>(() => routeOf(window.location.pathname));
  const [state, setState] = useState<State>({ kind: "loading" });

  const boot = (attempt = 0) => {
    // The welcome needs no organization (there may be none yet).
    if (route.kind === "welcome") return;
    setState({ kind: "loading" });
    const org = route.kind === "org" || route.kind === "project" || route.kind === "topic" || route.kind === "setup" || route.kind === "place" ? route.org : null;
    bootOrg(org).then(
      async (o) => {
        // The bare address opens the organization opened last; an address from before
        // organizations moves to its organization's.
        if (route.kind === "root") return window.location.replace(orgHref(o.id) + window.location.search);
        // The home's old tabs are places of their own now.
        const tab = route.kind === "org" ? legacyTab(window.location.search) : null;
        if (tab) return window.location.replace(placeHref(tab.place, o.id) + tab.search);
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

  if (route.kind === "welcome") return <WelcomeLoader />;
  if (state.kind === "loading")
    return (
      <div className="fixed inset-0 grid place-items-center bg-app text-fg">
        <Splash />
      </div>
    );
  if (state.kind === "error") return state.missingOrg ? <Missing title="Organization not found" body="It isn't on this computer: its folder moved, or it was made on another computer." /> : <CantReach message={state.message} onRetry={boot} />;
  if (state.kind === "missing" || route.kind === "missing") return <Missing title="Page not found" body="There's nothing at this address." />;
  if (route.kind === "org") return <HomeLoader />;
  if (route.kind === "topic") return <TopicLoader id={route.id} />;
  if (route.kind === "setup") return <SetupLoader />;
  if (route.kind === "place") return <PlaceLoader place={route.place} />;
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
          Back to projects
        </a>
      </div>
    </div>
  );
}
