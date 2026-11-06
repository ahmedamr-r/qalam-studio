import type { OrgShape } from "@/org/words";
import type { Me } from "@/org/you";
import { projectName, scanInput, type FirstRead } from "@/scan/input";
import type { ScanTarget } from "@/scan/session";
import type { ScanSaid } from "@/scan/steer";

/*
 * The first run's questions (pure): who it's for first, then three questions each way. The first
 * says what to read, so reading starts on its answer; the other two can be skipped, and only say
 * where to look first (src/scan/steer.ts).
 */

export type StartPath = "company" | "idea";

export const shapeOfPath = (path: StartPath): OrgShape => (path === "company" ? "team" : "solo");
export const pathOfShape = (shape: OrgShape | null | undefined): StartPath => (shape === "team" ? "company" : "idea");

export interface StartChoice {
  label: string;
  /** Who they are, for the role question. */
  me?: Me;
}

export interface StartQuestion {
  id: "role" | "move" | "who" | "want";
  title: string;
  /** What the researcher says beside it. */
  line: string;
  placeholder: string;
  choices: readonly StartChoice[];
}

/** The same words the scan's own questions ask, so the chat doesn't ask it again once it's answered here. */
export const WHO_TITLE = "Who do you picture using this first?";

const ROLE: StartQuestion = {
  id: "role",
  title: "What's your role?",
  line: "So I know how much to explain.",
  placeholder: "Or your own title",
  choices: [
    { label: "Product", me: { position: "pm" } },
    { label: "Design", me: { position: "designer" } },
    { label: "Founder", me: { position: "founder" } },
    { label: "Engineering", me: { position: "engineer" } },
  ],
};

const MOVE: StartQuestion = {
  id: "move",
  title: "What are you trying to move?",
  line: "Or tell me it's complicated. It usually is.",
  placeholder: "Or in your own words",
  choices: [{ label: "Activation" }, { label: "Retention" }, { label: "Revenue" }, { label: "Not sure yet" }],
};

const WHO: StartQuestion = {
  id: "who",
  title: WHO_TITLE,
  line: "“Everyone” isn't an answer. I've checked.",
  placeholder: "Night-shift nurses, for instance",
  choices: [],
};

const WANT: StartQuestion = {
  id: "want",
  title: "What do you most want to find out?",
  line: "I'll find out either way. This says where to start.",
  placeholder: "Or in your own words",
  choices: [{ label: "Do people want it?" }, { label: "Who'd pay for it?" }, { label: "What to build first?" }],
};

/** What's asked once reading has started, in order. */
export const startQuestions = (path: StartPath): readonly StartQuestion[] => (path === "company" ? [ROLE, MOVE] : [WHO, WANT]);

export const firstQuestion = (path: StartPath) =>
  path === "company"
    ? { title: "Which product?", line: "A name, or what it does. I'll find the people it annoys.", placeholder: "Basket, basket.com, or what it does" }
    : { title: "What's the idea?", line: "One sentence is enough. Nobody reads the second.", placeholder: "A meal planner for night-shift workers" };

/** A product's name is a few words; more is them saying what it is. */
const NAME_WORDS = 6;

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * What to read, from the first answer on the path they picked, before it's read for what it is. A link
 * is always a product, and a product at their company is theirs. A few words on the company's path are
 * its name; more is them saying what it does, which is read as an idea until the first read finds the
 * product's own name in it (`targetAfterRead`).
 */
export function startTarget(path: StartPath, raw: string): ScanTarget | null {
  const text = one(raw);
  if (text.length < 2) return null;
  const read = scanInput(text);
  if (path === "company") {
    if (read?.kind === "product") return { ...read, mine: true };
    return text.split(" ").length <= NAME_WORDS && !/[.!?؟,]/.test(text) ? { kind: "product", name: text, mine: true } : { kind: "idea", said: text };
  }
  if (read?.kind === "product" && (read.app || /[./]/.test(text))) return read;
  return text.length >= 3 ? { kind: "idea", said: text } : null;
}

/** What's wrong with the first answer, in words; null when it can be read. */
export function firstAnswerProblem(path: StartPath, raw: string): string | null {
  if (startTarget(path, raw)) return null;
  if (path === "company") return "Name the product, say what it does, or paste its link.";
  return "Say what you want to build, in a few words.";
}

/**
 * What to read once the first answer is read: on the company's path, a product's own name found in what
 * they said is the product, and theirs. Otherwise what they said stands.
 */
export function targetAfterRead(path: StartPath, t: ScanTarget, read: FirstRead): ScanTarget {
  if (path === "company" && t.kind === "idea" && read.product) return { kind: "product", name: read.product, mine: true };
  return t;
}

/** What the project's called: the name the read found for it, else as before. With nothing named, "My project". It's theirs to change. */
export function nameAfterRead(t: ScanTarget, read: FirstRead): string {
  if (!read.named) return "My project";
  if (t.kind === "product" && t.name) return t.name;
  return read.name || projectName(t);
}

/** What's found isn't all there is: more can come in later. A company may have analytics; an idea has none yet. */
export const moreLine = (path: StartPath) => `This is only a start. Add ${path === "company" ? "interviews, docs, notes or your analytics" : "interviews, notes or docs"} any time from the canvas, to find more problems and goals.`;

/** Their first answer, as the chat's turn shows it. */
export const saidOf = (t: ScanTarget) => (t.kind === "idea" ? t.said : t.name || t.app || "");

/** A picked label or their own words, as the scan hears them. */
export const answerSaid = (q: StartQuestion, answer: string): ScanSaid[] => {
  const a = one(answer);
  return a && q.id !== "role" ? [{ question: q.title, answer: a }] : [];
};

/** Their role, from a picked label or their own title. */
export function meFrom(q: StartQuestion, answer: string): Me | null {
  const a = one(answer);
  if (q.id !== "role" || !a) return null;
  return q.choices.find((c) => c.label === a)?.me ?? { position: "other", title: a };
}
