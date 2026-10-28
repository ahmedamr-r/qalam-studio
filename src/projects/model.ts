import { nanoid } from "nanoid";
import type { InterviewState } from "./interview";
import type { DesignHandoff, DiscoveryState, Serving, ServesLink } from "@/discovery/types";
import type { Place } from "@/ui/frame/places";

/**
 * Projects: what the home lists. A Screens project is a canvas document; a Design system project
 * starts with the brand interview (outside the canvas) and then owns the system it saved; a
 * Discovery project is a board for the product's opportunity tree (src/discovery). Records stay
 * small (the document lives in its own store), so the home can list them without loading docs.
 */

export type ProjectType = "screens" | "system" | "discovery";

export interface Project {
  id: string;
  type: ProjectType;
  name: string;
  createdAt: number;
  /** Last change to the project or its document. */
  updatedAt: number;
  /** Last time it was opened: the home sorts by this. */
  openedAt?: number;
  /** Small data URL of the first screen (or the interview's hero). */
  thumbnail?: string;
  /** System project: the system it saved. Screens project: the system new work uses. */
  systemId?: string;
  /** Screens project: new work uses no design system (Qalam AI picks each brief's look). */
  freeform?: boolean;
  /** System project: the brand interview, until (and after) it is saved. */
  interview?: InterviewState;
  /** Counted when the document saves, so the home needn't open it. */
  summary?: { frames: number };
  /** One-shot: text placed in the AI composer when the project first opens. */
  pendingBrief?: string;
  /** Discovery project: its product interview and counts. */
  discovery?: DiscoveryState;
  /** Screens project, one-shot: a Discovery solution sent here with "Design this", taken up when it opens. */
  handoff?: DesignHandoff;
  /** Screens project: the Discovery solution it's designing for (the chat's banner links back). */
  serving?: Serving;
  /** Screens project: screens made for Discovery solutions, counted when the document saves. */
  serves?: ServesLink[];
  /** The document from before projects existed. */
  legacy?: true;
  /** The organization's product it's for (products/<slug>.md); none: the whole organization. */
  product?: string | null;
}

export const newProjectId = () => nanoid(10);
export const isProjectId = (id: string) => /^[A-Za-z0-9_-]{6,24}$/.test(id);

/** The letter a project's address starts with. */
export const projectLetter = (type: ProjectType) => (type === "system" ? "s" : type === "discovery" ? "d" : "p");

/** The organization this window's links point into (set once the window knows it). */
let linkOrg: string | null = null;
export const setLinkOrg = (id: string | null) => void (linkOrg = id);

/** The organization's home (the projects home when no organization is known yet). */
export const orgHref = (org: string | null = linkOrg) => (org ? `/o/${org}` : "/");

/** A topic page of the organization (src/hub/topics.ts). */
export const topicHref = (id: string, org: string | null = linkOrg) => `${org ? `/o/${org}` : ""}/t/${encodeURIComponent(id)}`;

/** A goal's page (goals.md, src/goals). */
export const goalHref = (id: string, org: string | null = linkOrg) => `${org ? `/o/${org}` : ""}/g/${encodeURIComponent(id)}`;

/** Setting the organization up from a brain dump about it (src/ui/setup). */
export const setupHref = (org: string | null = linkOrg) => `${org ? `/o/${org}` : ""}/setup`;

/** The welcome (src/ui/welcome): `new` names another organization; `verify` checks the setup again, changing nothing. */
export const welcomeHref = (mode?: "new" | "verify") => `/welcome${mode ? `?${mode}=1` : ""}`;

/** One of the organization's places (src/ui/frame/places.ts); Home is the organization's own address. */
export const placeHref = (place: Place, org: string | null = linkOrg) => (place === "home" ? orgHref(org) : `${org ? `/o/${org}` : ""}/${place}`);

/** Where a project opens. */
export const projectHref = (p: Pick<Project, "id" | "type">, org: string | null = linkOrg) => `${org ? `/o/${org}` : ""}/${projectLetter(p.type)}/${p.id}`;

const STAGE_LABEL: Record<InterviewState["stage"], string> = {
  brief: "Brief",
  read: "Read-back",
  directions: "Directions",
  refine: "Refine",
  components: "Components",
  saved: "Saved",
};

/** The status line on a project card. */
export function statusOf(p: Project): string {
  if (p.type === "discovery") {
    const d = p.discovery;
    if (d?.stage === "interview") return "Interview";
    if (d?.stage === "drafting") return "Drafting";
    const c = d?.counts;
    if (!c || !(c.opportunities + c.solutions + c.tests)) return d?.stage === "ready" ? "Empty board" : "New";
    const part = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : "");
    // Outcomes count once a board has more than one goal.
    return [(c.outcomes ?? 0) > 1 ? part(c.outcomes!, "outcome", "outcomes") : "", part(c.opportunities, "opportunity", "opportunities"), part(c.solutions, "solution", "solutions"), part(c.tests, "test", "tests")].filter(Boolean).join(" · ");
  }
  if (p.type === "system") {
    const stage = p.interview?.stage ?? "brief";
    return stage === "saved" ? "Design system" : `Interview · ${STAGE_LABEL[stage]}`;
  }
  const n = p.summary?.frames ?? 0;
  return n === 0 ? "Empty" : `${n} ${n === 1 ? "frame" : "frames"}`;
}

/** Most recently opened (or changed) first. */
export const sortProjects = (list: Project[]) => [...list].sort((a, b) => (b.openedAt ?? b.updatedAt) - (a.openedAt ?? a.updatedAt));

export function newProject(type: ProjectType, name: string, extra: Partial<Project> = {}, now = Date.now()): Project {
  return {
    id: newProjectId(),
    type,
    name,
    createdAt: now,
    updatedAt: now,
    ...(type === "system" ? { interview: { v: 1, stage: "brief" } as InterviewState } : {}),
    ...(type === "discovery" ? { discovery: { v: 1, stage: "start" } as DiscoveryState } : {}),
    ...extra,
  };
}
