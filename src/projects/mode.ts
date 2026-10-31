import { currentProject, useProject } from "./session";
import type { ProjectType } from "./model";
import { useSpaceView } from "@/space/view";

/**
 * The open project's kind, for the shell: Screens and Discovery share the studio and differ in
 * their tools, panels and AI. (A page only ever holds one project; switching is a page load.) A
 * space's canvas (the home) is Discovery's: its cards are boards' cards.
 */
export const useProjectType = (): ProjectType => {
  const space = useSpaceView((s) => s.active);
  const type = useProject((s) => s.project?.type ?? "screens");
  return space ? "discovery" : type;
};
export const projectType = (): ProjectType => (useSpaceView.getState().active ? "discovery" : (currentProject()?.type ?? "screens"));
export const isDiscovery = () => projectType() === "discovery";
