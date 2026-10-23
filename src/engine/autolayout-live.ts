import { produce } from "immer";
import type { Doc } from "@/doc/schema";
import { useStudio } from "@/doc/store";
import { relayoutAll, setAutoLayoutEnabled } from "@/doc/autolayout";
import { clearMeasureCache } from "@/doc/measure";
import { fingerprint } from "@/design-system/place";
import { allScreenRoots } from "@/doc/pages";
import { onFontsChanged } from "./fonts";

/**
 * Relayout the whole document outside undo history (new metrics, not an edit). Screens that
 * were untouched builds stay untouched: their fingerprint is refreshed, not flagged as edited.
 */
function relayoutStudio() {
  const before = useStudio.getState().doc;
  const after = relayoutAll(before);
  if (after === before) return;
  const doc = produce(after, (d) => {
    // Every page's screens (relayoutAll laid out every node).
    for (const id of allScreenRoots(before)) {
      const r = before.nodes[id];
      if (r?.meta.spec && r.meta.specFingerprint && fingerprint(before, id) === r.meta.specFingerprint) d.nodes[id].meta.specFingerprint = fingerprint(d as Doc, id);
    }
  });
  useStudio.setState({ doc });
}

let started = false;

/** Turn live auto layout on once Yoga and the CanvasKit measurer are ready (idempotent). */
export function startAutoLayout() {
  if (setAutoLayoutEnabled(true)) relayoutStudio();
  if (started) return;
  started = true;
  onFontsChanged(() => {
    clearMeasureCache();
    relayoutStudio();
  });
}
