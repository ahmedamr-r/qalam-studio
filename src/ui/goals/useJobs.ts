import { useEffect } from "react";
import { create } from "zustand";
import type { Job } from "@/goals/jobs";
import { jobsDb } from "@/org/jobs";
import { onOrgChange } from "@/org/live";

/*
 * The jobs still to do across goals (hub/jobs.jsonl, as they are now), kept current: one load
 * shared by everything on the page that reads them (the home's goals, a picked card's next steps).
 */

const useJobsState = create<{ jobs: Job[] | null }>(() => ({ jobs: null }));

let users = 0;
let off: (() => void) | null = null;
let alive = 0;

function load() {
  const at = ++alive;
  void jobsDb.open().then(
    (l) => at === alive && useJobsState.setState({ jobs: l }),
    () => at === alive && useJobsState.setState({ jobs: [] }),
  );
}

/** The jobs to do (null while loading). */
export function useJobs(): Job[] | null {
  useEffect(() => {
    if (users++ === 0) {
      load();
      off = onOrgChange((c) => c.kind === "job" && load());
    }
    return () => {
      if (--users) return;
      off?.();
      off = null;
      alive++;
    };
  }, []);
  return useJobsState((s) => s.jobs);
}
