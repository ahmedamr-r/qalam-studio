import clsx from "clsx";
import { r } from "./recipes";
import { routeOf } from "./routes";
import StudioLoader, { HomeLoader, SystemProjectLoader } from "./StudioLoader";

/** The page for this address. */
export function App() {
  const route = routeOf(window.location.pathname);
  if (route.kind === "home") return <HomeLoader />;
  if (route.kind === "missing") return <PageMissing />;
  if (route.type === "system") return <SystemProjectLoader projectId={route.id} />;
  return <StudioLoader projectId={route.id} mode={route.type} />;
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
