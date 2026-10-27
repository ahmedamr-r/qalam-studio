import { useEffect, useState } from "react";
import { projectsDb } from "@/projects/db";
import { ensureMigrated } from "@/projects/migrate";
import { isProjectId, projectHref, type Project } from "@/projects/model";
import { Splash } from "./brand";
import Studio, { ProjectMissing } from "./Studio";
import InterviewApp from "./interview/InterviewApp";

/**
 * A design-system project: the brand interview runs full-screen with no canvas until it is saved;
 * after that the project opens its system in the studio (Tokens full-screen, specimen screens on
 * the canvas).
 */
export default function SystemProject({ projectId }: { projectId: string }) {
  const [p, setP] = useState<Project | null | undefined>(undefined);

  useEffect(() => {
    void ensureMigrated()
      .then(() => (isProjectId(projectId) ? projectsDb.get(projectId) : undefined))
      .then((found) => {
        if (found && found.type !== "system") window.location.replace(projectHref(found));
        else setP(found ?? null);
      })
      .catch(() => setP(null));
  }, [projectId]);

  if (p === undefined)
    return (
      <div className="fixed inset-0 grid place-items-center bg-app text-fg">
        <Splash />
      </div>
    );
  if (p === null)
    return (
      <div className="fixed inset-0 grid place-items-center bg-app text-fg">
        <ProjectMissing />
      </div>
    );
  if (p.interview?.stage === "saved" && p.systemId) return <Studio projectId={p.id} mode="system" />;
  return <InterviewApp project={p} />;
}
