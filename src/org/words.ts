/*
 * Who an organization is (pure): a company or team, or one person on their own idea. It's a fact
 * about the organization, kept in its org.json, so it travels with the folder; turning a solo
 * project into a team is one switch. People read "project" for an organization either way, so
 * their picture of it is one thing they work on; solo changes the rest of the words, not the
 * files: "your words" instead of the team's, and every goal is the person's own.
 */

export type OrgShape = "team" | "solo";

export const orgShape = (x: unknown): OrgShape | null => (x === "team" || x === "solo" ? x : null);

export interface OrgWords {
  /** "project", as in "the {org}'s folder" (an organization, in code). */
  org: string;
  /** "The whole project": what's for all of it, not one product. */
  whole: string;
  /** Whose words aren't evidence yet: "the team's" or "your". */
  ours: string;
  /** "only the team says so" or "only you say so". */
  onlyUs: string;
  /** "Company" or "Project": what the canvas knows about. */
  company: string;
}

const TEAM: OrgWords = { org: "project", whole: "The whole project", ours: "the team's", onlyUs: "only the team says so", company: "Company" };
const SOLO: OrgWords = { org: "project", whole: "The whole project", ours: "your", onlyUs: "only you say so", company: "Project" };

/** The words for an organization's shape; one made before shapes is a team's. */
export const wordsFor = (shape?: OrgShape | null): OrgWords => (shape === "solo" ? SOLO : TEAM);
