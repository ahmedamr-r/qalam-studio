import { currentProject, useProject } from "./session";
import type { ProjectType } from "./model";

/**
 * The open project's kind, for the shell: Screens and Discovery share the studio and differ in
 * their tools, panels and AI. (A page only ever holds one project; switching is a page load.)
 */
export const useProjectType = (): ProjectType => useProject((s) => s.project?.type ?? "screens");
export const projectType = (): ProjectType => currentProject()?.type ?? "screens";
export const isDiscovery = () => projectType() === "discovery";
