import { studio, useStudio } from "@/doc/store";
import { clearMeasureCache } from "@/doc/measure";
import { onFontsChanged } from "@/engine/fonts";
import { setCanvasDelegate } from "@/engine/canvas-delegate";
import { createOstTools } from "@/engine/ost-tools";
import { useGoals } from "@/goals/client";
import { relayoutSpace } from "@/space/session";
import { useSpaceView } from "@/space/view";
import { registerDiscoveryCommands } from "../discovery/commands";
import { ensureHandlers } from "../discovery/draft";
import { dropStaleEdit } from "../discovery/editing";
import { useDiscovery } from "../discovery/store";
import { useSources } from "../discovery/sources";
import { startWork } from "../discovery/work";
import { loadFeeds, SPACE, useFeeds } from "../discovery/feeds";
import { onOrgChange } from "@/org/live";
import { startRecorder } from "../decisions/recorder";
import { startSpaceGoalSync } from "./goals";

/*
 * A space's canvas in this window: the board's gestures and commands, installed once (the canvas
 * comes and goes as the window moves between pages; what it edits stays, ../../space/session.ts).
 */

let started = false;

export function startSpaceCanvas() {
  if (started) return;
  started = true;
  setCanvasDelegate(createOstTools());
  registerDiscoveryCommands();
  ensureHandlers();
  onFontsChanged(() => {
    clearMeasureCache();
    relayoutSpace();
  });
  // The canvas redraws for what's drawn beside the document: a title being typed, the lane's sources, what's faint or noticed.
  useDiscovery.subscribe(() => studio().invalidate());
  useSources.subscribe(() => studio().invalidate());
  useSpaceView.subscribe(() => studio().invalidate());
  useGoals.subscribe((s, prev) => s.goals !== prev.goals && studio().invalidate());
  useStudio.subscribe((s, prev) => {
    if (s.doc !== prev.doc) dropStaleEdit();
  });
  // Where solutions' linked issues and pull requests stand (their chips).
  startWork();
  // Goals' cards and goals.md agree; what's decided on the canvas goes to the decision log, each on its card's board.
  startSpaceGoalSync();
  startRecorder();
  // The feeds watching for the canvas's cards, in the lane.
  useFeeds.setState({ board: SPACE, list: [], news: {} });
  void loadFeeds(SPACE);
  useFeeds.subscribe(() => studio().invalidate());
  onOrgChange((c) => c.kind === "feed" && void loadFeeds(SPACE, false));
}
