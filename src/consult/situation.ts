import { sharedWords } from "@/discovery/near";
import { ALL_POSITIONS, type Position } from "@/org/you";
import { sanitizeFirstRead } from "@/scan/input";
import { PLAYBOOK_IDS, type PlaybookId } from "./playbooks.gen";

/*
 * Who's asking, and where they came in (pure): read once from their first words, by one small call
 * (src/ai/consult.ts), and changed later only by an answer that settles it. It picks the playbook the
 * consultant starts from, how much it teaches, and how many questions a round holds.
 */

/** How much product and business work they know: new to it, some, or it's their job. */
export type Level = "new" | "some" | "seasoned";
export const LEVELS: readonly Level[] = ["new", "some", "seasoned"];

export type Stage = "idea" | "building" | "running" | "growing" | "unknown";
export const STAGES: readonly Stage[] = ["idea", "building", "running", "growing", "unknown"];

/** Where they came in: the playbook it starts from. */
export type Layer = PlaybookId;

export interface Situation {
  /** As the first read has them (src/scan/input.ts): whether it names anything, a product's own name, what to call the project. */
  named: boolean;
  product: string;
  name: string;
  /** What they said of their role, in their words; "" when they said nothing of it. */
  role: string;
  /** Their position, only where they said something of their role. */
  position?: Position;
  level: Level;
  stage: Stage;
  /** Whether what they're working on is theirs (their product or business), or one they're looking into. */
  theirs: "yes" | "no" | "unsure";
  /** A team's, or one person's own. */
  whose: "team" | "solo" | "unsure";
  layer: Layer;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const pick = <T extends string>(v: unknown, list: readonly T[], or: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : or);
const one = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Where words alone say they came in, when nothing can read them: a page or a step, growing, an idea,
 * else the business. A guess for the opening only; the first turn reads it properly.
 */
export function guessLayer(said: string): Layer {
  const t = said.toLowerCase();
  if (/\b(page|screen|step|checkout|signup|sign-up|onboarding|form|button|flow|funnel)\b/.test(t)) return "page";
  if (/\b(grow|growth|more (customers|users|orders|sales|revenue)|scale|revenue|sales)\b/.test(t)) return "grow";
  if (/\b(idea|start (a|an|my)|build (a|an)|make (a|an)|launch|thinking of|want to create)\b/.test(t)) return "idea";
  return "business";
}

/** Read with no call: what code can tell from their words alone. */
export function situationOf(said: string): Situation {
  const t = said.toLowerCase();
  const mine = /\b(my|our)\s+(own\s+)?(\w+\s+){0,2}(app|store|shop|business|company|startup|product|site|website|restaurant|clinic|service|platform)\b/.test(t);
  const team = /\b(we|our|us)\b/.test(t);
  return { named: true, product: "", name: "", role: "", level: "some", stage: mine ? "running" : "unknown", theirs: mine ? "yes" : "unsure", whose: team ? "team" : "unsure", layer: guessLayer(said) };
}

/**
 * What code keeps of a read: names as the first read keeps them (a product's only as they wrote it),
 * a role only where it shares a telling word with what they said (and a position only with one), and
 * the rest from their lists.
 */
export function sanitizeSituation(raw: unknown, said: string): Situation {
  const r = rec(raw);
  const first = sanitizeFirstRead(raw, said);
  const role = typeof r.role === "string" ? one(r.role).slice(0, 60) : "";
  const roleHolds = !!role && sharedWords(role, said) >= 1;
  const position = roleHolds && typeof r.position === "string" && ALL_POSITIONS.some((p) => p.value === r.position) ? (r.position as Position) : undefined;
  const fallback = situationOf(said);
  return {
    ...first,
    role: roleHolds ? role : "",
    ...(position ? { position } : {}),
    level: pick(r.level, LEVELS, "some"),
    stage: pick(r.stage, STAGES, fallback.stage),
    theirs: pick(r.theirs, ["yes", "no", "unsure"] as const, fallback.theirs),
    whose: pick(r.whose, ["team", "solo", "unsure"] as const, fallback.whose),
    layer: pick(r.layer, PLAYBOOK_IDS, fallback.layer),
  };
}

/** How much they know, as it's set: what they said with Explain more or Skip the basics wins, then this conversation's reading, then what was kept. */
export function levelOf(o: { set?: { level: Level; by: "you" | "qalam" } | null; read?: Level | null }): Level {
  if (o.set?.by === "you") return o.set.level;
  return o.read ?? o.set?.level ?? "some";
}

/** One step simpler, or one step past the basics; the same at either end. */
export const simpler = (l: Level): Level => (l === "seasoned" ? "some" : "new");
export const pastBasics = (l: Level): Level => (l === "new" ? "some" : "seasoned");

/** A line for Qalam AI about who's asking: what they said of their role and how much they know. */
export function situationLine(s: Situation): string {
  const level = s.level === "new" ? "new to product and business work: plain words, an example with each question, a term explained the first time" : s.level === "seasoned" ? "seasoned in product work: their own terms, no teaching" : "somewhat familiar with product work: plain words, an example only where an answer is hard to picture";
  const theirs = s.theirs === "yes" ? "It's their own product or business." : s.theirs === "no" ? "It's something they're looking into, not theirs." : "Whether it's theirs isn't settled.";
  return [`Who's asking: ${s.role ? `${s.role}, ` : ""}${level}.`, theirs, s.stage !== "unknown" ? `Stage: ${s.stage}.` : ""].filter(Boolean).join(" ");
}
