import type { Box } from "@/doc/geometry";
import { studio, useStudio } from "@/doc/store";
import { userCameraEpoch } from "@/engine/controller";
import { getController } from "../CanvasView";
import { agentFor, useAgents } from "./agents";
import { chatBottomInset } from "./chatFrame";

/**
 * The camera follows one agent's cursor at a time, the way Figma follows a collaborator: the
 * Designer you just asked for, or any agent you click in the top bar. Moving the camera yourself
 * stops following (then the top bar or the chat offers "Follow" again).
 */

/** The designer's camera moves when following started: any newer one means they took over. */
let epoch = -1;
let watching = false;
const MARGIN = 48;

/** Around the work: the screen's width, and some room above and below the element. */
function around(target: Box, screen?: Box): Box {
  if (!screen) return target;
  const top = Math.max(screen.y, target.y - 160);
  const bottom = Math.min(screen.y + screen.h, target.y + target.h + 160);
  return { x: screen.x, y: top, w: screen.w, h: Math.max(bottom - top, Math.min(screen.h, 320)) };
}

function show(box: Box, glide: boolean, maxZoom = 1) {
  const c = getController();
  if (!c) return;
  const cam = c.fitCamera(box, { bottom: chatBottomInset() }, maxZoom, 32);
  if (glide) c.panTo(cam);
  else studio().setCamera(cam);
}

/** Stop following as soon as the designer pans or zooms, not only when the agent moves next. */
function watch() {
  if (watching) return;
  watching = true;
  useStudio.subscribe((s, prev) => {
    if (s.camera !== prev.camera && useAgents.getState().following && userCameraEpoch() !== epoch) unfollow();
  });
}

function setFollowing(turnId: string) {
  watch();
  epoch = userCameraEpoch();
  useAgents.setState({ following: turnId });
}

/** Fit screens in the part of the canvas the chat window leaves visible. */
export function showAboveChat(box: Box) {
  show(box, true, 2);
}

/** Start following an agent that just started: frame the top of the first screen, readable above the chat. */
export function beginFollow(turnId: string, box?: Box) {
  setFollowing(turnId);
  if (box) requestAnimationFrame(() => show(box, false));
}

/** Keep the work in view while following this agent: pan only when it's about to leave the visible part of the canvas. */
export function followTarget(turnId: string, target: Box, screen?: Box) {
  if (useAgents.getState().following !== turnId) return;
  if (userCameraEpoch() !== epoch) return unfollow();
  const c = getController();
  if (!c) return;
  const cam = studio().camera;
  const vp = c.viewport;
  const visible = { x: cam.x, y: cam.y, w: vp.w / cam.zoom, h: Math.max(1, vp.h - chatBottomInset()) / cam.zoom };
  const m = MARGIN / cam.zoom;
  const inside = target.x >= visible.x + m && target.y >= visible.y + m && target.x + Math.min(target.w, visible.w / 2) <= visible.x + visible.w - m && target.y + Math.min(target.h, visible.h / 2) <= visible.y + visible.h - m;
  if (!inside) show(around(target, screen), true);
}

/** Follow an agent (the top bar's avatars, the chat's Follow): glide to its cursor, then keep up with it. */
export function followAgent(turnId: string) {
  const t = agentFor(turnId)?.target;
  if (!t) return;
  setFollowing(turnId);
  show(t, true);
}

export function unfollow() {
  if (useAgents.getState().following) useAgents.setState({ following: null });
}
