import { lazy, Suspense, type ReactNode } from "react";
import type { ProjectType } from "@/projects/model";
import type { PagePlace } from "./frame/places";
import { Splash } from "./brand/splash";

const loading = (
  <div className="fixed inset-0 grid place-items-center bg-app text-fg">
    <Splash />
  </div>
);

// The splash also covers the download of the studio's own code, in the same place Studio keeps it.
const Studio = lazy(() => import("./Studio"));
const Home = lazy(() => import("./home/Home"));
const SystemProject = lazy(() => import("./SystemProject"));
const TopicPage = lazy(() => import("./topics/TopicPage"));
const GoalPage = lazy(() => import("./goals/GoalPage"));
const SetupPage = lazy(() => import("./setup/SetupPage"));
const WelcomePage = lazy(() => import("./welcome/WelcomePage"));
const CapturePage = lazy(() => import("./capture/CapturePage"));
const SpacesPage = lazy(() => import("./places/SpacesPage"));
const ConnectionsPage = lazy(() => import("./connections/ConnectionsPage"));
/** The places a space has its own of (src/ui/frame/spaces.ts); Connections is the organization's. */
const SPACE_PAGES = {
  goals: lazy(() => import("./places/GoalsPage")),
  problems: lazy(() => import("./places/ProblemsPage")),
  evidence: lazy(() => import("./places/EvidencePage")),
  decisions: lazy(() => import("./places/DecisionsPage")),
} satisfies Record<Exclude<PagePlace, "connections">, unknown>;

const Loading = ({ children }: { children: ReactNode }) => <Suspense fallback={loading}>{children}</Suspense>;

export default function StudioLoader({ projectId, mode }: { projectId: string; mode: ProjectType }) {
  return (
    <Loading>
      <Studio projectId={projectId} mode={mode} />
    </Loading>
  );
}

/** A space's home: the organization's, or a product's. */
export function HomeLoader({ product = null }: { product?: string | null }) {
  return (
    <Loading>
      <Home product={product} />
    </Loading>
  );
}

/** Picking a space: the whole organization or one product. */
export function SpacesLoader() {
  return (
    <Loading>
      <SpacesPage />
    </Loading>
  );
}

/** A design-system project: its brand interview, or its system once saved. */
export function SystemProjectLoader({ projectId }: { projectId: string }) {
  return (
    <Loading>
      <SystemProject projectId={projectId} />
    </Loading>
  );
}

/** One of the organization's topic pages. */
export function TopicLoader({ id }: { id: string }) {
  return (
    <Loading>
      <TopicPage id={id} />
    </Loading>
  );
}

/** A goal's page: its number and the problems behind it. */
export function GoalLoader({ id }: { id: string }) {
  return (
    <Loading>
      <GoalPage id={id} />
    </Loading>
  );
}

/** Setting the organization up from a brain dump about it. */
export function SetupLoader() {
  return (
    <Loading>
      <SetupPage />
    </Loading>
  );
}

/** One of the organization's places: its goals, problems, evidence or decisions (in a product's space with `product`), or its connections. */
export function PlaceLoader({ place, product = null }: { place: PagePlace; product?: string | null }) {
  if (place === "connections")
    return (
      <Loading>
        <ConnectionsPage />
      </Loading>
    );
  const Page = SPACE_PAGES[place];
  return (
    <Loading>
      <Page product={product} />
    </Loading>
  );
}

/** The welcome: the first run, a new organization, or checking the setup again. */
export function WelcomeLoader() {
  return (
    <Loading>
      <WelcomePage />
    </Loading>
  );
}

/** Quick capture, into the inbox (the menu bar's capture window). */
export function CaptureLoader() {
  return (
    <Loading>
      <CapturePage />
    </Loading>
  );
}
