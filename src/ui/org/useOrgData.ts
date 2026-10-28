import { useCallback, useEffect, useState } from "react";
import type { SourceRecord } from "@/discovery/sources";
import { orgJson } from "@/org/client";
import { onOrgChange } from "@/org/live";
import { hasLegacyChanges, listProjects } from "@/projects/library";
import type { Project } from "@/projects/model";
import type { Goal } from "./Goals";

/**
 * What the home and the places list: the projects, every board's goals and the sources, kept
 * current when the tab comes back and when another window or the folder itself changes them.
 */
export function useOrgData() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);

  const refresh = useCallback(() => {
    void listProjects()
      .then((list) => {
        setProjects(list);
        setLegacy(hasLegacyChanges());
      })
      .catch(() => setProjects([]));
    void orgJson<Goal[]>("/goals").then(setGoals, () => {});
    void orgJson<SourceRecord[]>("/sources").then(setSources, () => {});
  }, []);

  useEffect(() => {
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", refresh);
    const off = onOrgChange((c) => {
      if (c.kind === "project" || c.kind === "source") refresh();
    });
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", refresh);
    };
  }, [refresh]);

  return { projects, legacy, goals, sources, refresh };
}
