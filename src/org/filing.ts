import { callAI } from "@/ai/client";
import type { SourceRecord } from "@/discovery/sources";
import { fileMaterial, type FilingDeps, type FilingTotals } from "@/hub/filing";
import { contextFor, useOrgContext } from "./context";
import { orgContext } from "./pack";
import { topicsDb } from "./topics";

/** Filing into the topic pages from a window (src/hub/filing.ts): through the organization's API. */

export { materialName, unfiled, type FilingTotals } from "@/hub/filing";

const fromWindow = (): FilingDeps => ({
  ...useOrgContext.getState(),
  productLine: contextFor,
  listTopics: topicsDb.list,
  pack: orgContext,
  call: async (body, signal) => (await callAI<unknown>("/api/topics", body, undefined, signal)).data,
  file: topicsDb.file,
});

/** File the sources' quotes the pages haven't seen. `product`: the material's (a board's), else each source's own. */
export const fileIntoTopics = (sources: SourceRecord[], o: { product?: string | null; signal?: AbortSignal; onStep?: (done: number, of: number) => void } = {}): Promise<FilingTotals> => fileMaterial(fromWindow(), sources, o);
