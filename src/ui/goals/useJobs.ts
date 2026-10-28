import { useEffect, useState } from "react";
import type { Job } from "@/goals/jobs";
import { jobsDb } from "@/org/jobs";
import { onOrgChange } from "@/org/live";

/** The jobs still to do across goals (hub/jobs.jsonl, as they are now), kept current. Null while loading. */
export function useJobs(): Job[] | null {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void jobsDb.open().then((l) => alive && setJobs(l), () => alive && setJobs([]));
    load();
    const off = onOrgChange((c) => c.kind === "job" && load());
    return () => {
      alive = false;
      off();
    };
  }, []);
  return jobs;
}
