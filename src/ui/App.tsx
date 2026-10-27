import { useEffect, useState } from "react";
import clsx from "clsx";
import { bootOrg } from "@/org/boot";
import { Splash } from "./brand/splash";
import { r } from "./recipes";
import { routeOf } from "./routes";
import StudioLoader, { HomeLoader, SystemProjectLoader } from "./StudioLoader";

/** The page for this address, once the organization's files are within reach. */
export function App() {
  const [state, setState] = useState<"loading" | "ready" | { error: string }>("loading");
  const boot = () => {
    setState("loading");
    bootOrg().then(
      () => setState("ready"),
      (e: unknown) => setState({ error: e instanceof Error ? e.message : String(e) }),
    );
  };
  useEffect(boot, []);

  if (state === "loading")
    return (
      <div className="fixed inset-0 grid place-items-center bg-app text-fg">
        <Splash />
      </div>
    );
  if (state !== "ready") return <CantReach message={state.error} onRetry={boot} />;
  return <Page />;
}

function Page() {
  const route = routeOf(window.location.pathname);
  if (route.kind === "home") return <HomeLoader />;
  if (route.kind === "missing") return <PageMissing />;
  if (route.type === "system") return <SystemProjectLoader projectId={route.id} />;
  return <StudioLoader projectId={route.id} mode={route.type} />;
}

function CantReach({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="fixed inset-0 grid place-items-center bg-app text-fg">
      <div className="flex w-[340px] flex-col items-center gap-[12px] text-center">
        <p className="text-title font-medium text-fg">Qalam can't reach your files</p>
        <p className="text-body text-fg-muted">{message}</p>
        <button type="button" className={clsx(r.button, r.buttonSecondary)} onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

function PageMissing() {
  return (
    <div className="fixed inset-0 grid place-items-center bg-app text-fg">
      <div className="flex w-[300px] flex-col items-center gap-[12px] text-center">
        <p className="text-title font-medium text-fg">Page not found</p>
        <p className="text-body text-fg-muted">There's nothing at this address.</p>
        <a href="/" className={clsx(r.button, r.buttonSecondary)}>
          Back to projects
        </a>
      </div>
    </div>
  );
}
