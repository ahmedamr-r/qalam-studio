import { useEffect } from "react";
import { create } from "zustand";
import { connectorsDb } from "@/org/connectors";
import { lab } from "@/lab";

/*
 * The connected tools that bring material in (what a feed can watch: Intercom, Slack, Notion…), as
 * Connections last saw them: asked once a page, by what reads them (a card's next steps).
 */

export interface Tool {
  id: string;
  label: string;
}

const useToolsState = create<{ tools: Tool[] | null }>(() => ({ tools: null }));
let asked = false;

/** The tools a feed can watch (null until known). */
export function useTools(): Tool[] | null {
  useEffect(() => {
    // Feeds are hidden in v0.1 (src/lab.ts): nothing asks what one could watch.
    if (asked || !lab("feeds")) return;
    asked = true;
    void connectorsDb.list().then(
      (v) => useToolsState.setState({ tools: v.connectors.filter((c) => c.imports && (c.tone === "ok" || c.claudeCode?.status === "connected")).map((c) => ({ id: c.id, label: c.label })) }),
      () => {
        asked = false;
        useToolsState.setState({ tools: [] });
      },
    );
  }, []);
  return useToolsState((s) => s.tools);
}
