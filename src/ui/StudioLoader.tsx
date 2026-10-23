"use client";

import dynamic from "next/dynamic";
import type { ProjectType } from "@/projects/model";
import { Splash } from "./brand/splash";

const loading = () => (
  <div className="fixed inset-0 grid place-items-center bg-app text-fg">
    <Splash />
  </div>
);

// The splash also covers the download of the studio's own code, in the same place Studio keeps it.
const Studio = dynamic(() => import("./Studio"), { ssr: false, loading });
const Home = dynamic(() => import("./home/Home"), { ssr: false, loading });
const SystemProject = dynamic(() => import("./SystemProject"), { ssr: false, loading });

export default function StudioLoader({ projectId, mode }: { projectId: string; mode: ProjectType }) {
  return <Studio projectId={projectId} mode={mode} />;
}

/** The projects home (client-only: projects live in this browser's storage). */
export function HomeLoader() {
  return <Home />;
}

/** A design-system project: its brand interview, or its system once saved. */
export function SystemProjectLoader({ projectId }: { projectId: string }) {
  return <SystemProject projectId={projectId} />;
}
