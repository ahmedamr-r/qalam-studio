/*
 * Who an organization is (pure): a company or team, or one person on their own idea. It's a fact
 * about the organization, kept in its org.json, so it travels with the folder; turning a solo
 * project into a team is one switch. Solo changes the words, not the files: a "project" instead of
 * an organization, "your words" instead of the team's, and every goal is the person's own.
 */

export type OrgShape = "team" | "solo";

export const orgShape = (x: unknown): OrgShape | null => (x === "team" || x === "solo" ? x : null);

export interface OrgWords {
  /** "organization" or "project", as in "the {org}'s folder". */
  org: string;
  /** "The whole organization" or "The whole project": what's for all of it, not one product. */
  whole: string;
  /** Whose words aren't evidence yet: "the team's" or "your". */
  ours: string;
  /** "only the team says so" or "only you say so". */
  onlyUs: string;
}

const TEAM: OrgWords = { org: "organization", whole: "The whole organization", ours: "the team's", onlyUs: "only the team says so" };
const SOLO: OrgWords = { org: "project", whole: "The whole project", ours: "your", onlyUs: "only you say so" };

/** The words for an organization's shape; one made before shapes is a team's. */
export const wordsFor = (shape?: OrgShape | null): OrgWords => (shape === "solo" ? SOLO : TEAM);
