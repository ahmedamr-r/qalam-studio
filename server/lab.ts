import { labState, type LabState } from "@/lab";
import { readSettings } from "./settings";

/** What v0.1 hides that's on here (src/lab.ts): QALAM_LAB first, then this computer's `labs` setting. */
export async function labOn(): Promise<LabState> {
  const env = process.env.QALAM_LAB;
  if (env !== undefined && env !== "") return labState(env);
  return labState((await readSettings()).labs);
}
