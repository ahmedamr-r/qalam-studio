import { BUSINESS_SECTIONS, SECTION_LABEL } from "@/business/types";
import { PLAYBOOKS, PLAYBOOK_IDS, type PlaybookId } from "@/consult/playbooks.gen";
import { LEVELS, STAGES } from "@/consult/situation";
import { ALL_POSITIONS } from "@/org/you";
import { FIRST_READ_SYSTEM } from "./scan";

/*
 * Qalam AI as a product and business consultant (src/consult/): the rules its turns follow beside the
 * interview's own (src/ai/asking.ts), the playbook it's following as a block of its own, the fields a
 * turn answers in besides the interview's, and the small read of who's asking that picks the playbook.
 * All of it browser-safe, since the window checks a turn's fields the same way.
 */

const str = (description: string) => ({ type: "string", description });
const bool = (description: string) => ({ type: "boolean", description });
const arr = (items: unknown, description: string) => ({ type: "array", items, description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const oneOf = (values: readonly string[], description: string) => ({ type: "string", enum: [...values], description });

/** When each playbook fits, as every turn hears it: the one in use comes as its own block. */
const playbookIndex = () => PLAYBOOKS.map((p) => `- ${p.id}: ${p.title}. ${p.when.join(" ")}`).join("\n");

/** The consultant's task, beside the interview's rules: stable, so it's cached with them. */
export const CONSULT_TASK = `You're a product and business consultant, working something out with someone who may be new to product work. Another step then proposes cards for their canvas, as the playbook in use says. Find out what would change that, the way a good consultant would:
- Meet them where they came in. Climb only as far as you need to anchor it (what it does for the business, which number it moves), then come down to the likely causes and the cheapest way to check each.
- Ask what happened, not opinions: the last time it happened, what they saw, what changed. Never ask what they would do, and never ask them to confirm what they just said.
- Each question earns its place: ask it only when its answer would change what you ask next or what's proposed.
- Facts that can be found are yours to find (a lookup), each with a line saying why the lookup answers it better than they could; never before they've answered anything. Never ask what they can't know: ask how it could be found out (where it's kept, who would know).
- Name what they may be missing: when a blind spot the playbook names fits, ask the question that would show it, and say in its why why it matters.
- Talk at their level (who's asking, below). New to it: plain words, open questions first, an example of a useful answer with each question (example), and a word explained the first time you use it (explain). Somewhat familiar: plain words, and an example only where an answer is hard to picture. Seasoned: their own terms, and no teaching.
- Likely causes come later, as choices that are visibly yours (your recommendation), never as what they said. None is true until they say so or a check shows it.
- open: what's still open that would change what's proposed, a short line each, in their words where you can.
- business: only what an answer of theirs plainly says about how the business works, as it stands: who it serves, what they get from it, how it earns, what it takes to run (its biggest costs, and who and what it runs on), how customers find it, the numbers that matter, where it stands. Each with its section and the id of the question it answered; theirs: true only when the line is their own words. Never the problem being worked on, a recent change or event, or how a screen shows something; never force a line into a section that doesn't fit it. Never from an answer that only agrees with your recommendation, a don't-know or a question they left, and never a number they didn't give.
- situation: how you read who's asking so far; change a field only when an answer settles it, with the ids of those answers (from).
- playbook: the one that fits now, from the list below; the next turn follows it.
- Write in the language they wrote in. Never mention playbooks, rounds, layers or ids.

The playbooks:
${playbookIndex()}`;

/** The playbook in use, as a block of its own (cached apart, so a switch costs one block). */
export function playbookBlock(id: PlaybookId): string {
  const p = PLAYBOOKS.find((x) => x.id === id) ?? PLAYBOOKS[0];
  return `The playbook in use now: ${p.title}.\n\n${p.body}`;
}

/** What a consultant's turn answers besides the interview's fields. */
export function consultFields(): Record<string, unknown> {
  return {
    situation: obj({
      level: oneOf(LEVELS, "new: new to product and business work · some: somewhat familiar · seasoned: it's their job"),
      role: str("What they said of their role, in their words; empty when they said nothing of it"),
      position: oneOf(["", ...ALL_POSITIONS.map((p) => p.value)], "Their position, only where they said something of their role; empty otherwise"),
      stage: oneOf(STAGES, "How far along what they're working on is"),
      theirs: oneOf(["yes", "no", "unsure"], "Whether it's their own product or business"),
      whose: oneOf(["team", "solo", "unsure"], "A team's, or one person's own"),
      from: arr(str("The id of an answer"), "The answers that settled a change; [] when nothing changed"),
    }),
    playbook: oneOf(PLAYBOOK_IDS, "The playbook that fits now"),
    business: arr(
      obj({
        section: oneOf(BUSINESS_SECTIONS, BUSINESS_SECTIONS.map((s) => `${s}: ${SECTION_LABEL[s]}`).join(" · ")),
        text: str("One line about the business, in their words where you can"),
        q: str("The id of the question whose answer says it"),
        theirs: bool("true only when the line is their own words"),
      }),
      "What answers told about how the business works. [] when nothing new",
    ),
  };
}

export const SITUATION_SYSTEM = `${FIRST_READ_SYSTEM}

Also read who's asking and where they came in, from these words alone:
- role: what they say of their role, in their words ("I own a small delivery app" → "owns a delivery app"); empty when they say nothing of it. position: one of founder, product-lead, pm, designer, engineer, other or solo, only where they said something of their role; empty otherwise.
- level: new when they don't use product or business words, or say they aren't a product or tech person; seasoned when they use product words precisely (conversion, retention, a funnel, an experiment); some otherwise.
- stage: idea (nothing built), building (being built), running (people use it or pay for it), growing (running and growing), unknown.
- theirs: yes when it's their own product or business ("my app", "our store", "we run"), no when they're looking into someone else's, unsure otherwise. whose: team when they speak for a team ("we", "our team"), solo when they say it's theirs alone, unsure otherwise.
- layer: page when they name a page, a screen, a step or a moment in what they offer; grow when they want more customers, orders or revenue from what runs already; idea when they want to start or build something; business otherwise.`;

export function situationCall(said: string) {
  return {
    kind: "chat-route" as const,
    system: SITUATION_SYSTEM,
    schema: obj({
      said: { type: "string", enum: ["named", "none"], description: "named: it names something to read about · none: it doesn't" },
      product: str("A product's own name as they wrote it, or empty"),
      name: str("What to call the project, 2 to 4 words, or empty"),
      role: str("What they said of their role, in their words, or empty"),
      position: oneOf(["", ...ALL_POSITIONS.map((p) => p.value)], "Their position, or empty"),
      level: oneOf(LEVELS, "How much product and business work they know"),
      stage: oneOf(STAGES, "How far along it is"),
      theirs: oneOf(["yes", "no", "unsure"], "Whether it's theirs"),
      whose: oneOf(["team", "solo", "unsure"], "A team's, or one person's own"),
      layer: oneOf(PLAYBOOK_IDS, "Where they came in"),
    }),
    effort: "low" as const,
    maxTokens: 400,
    content: [{ type: "text" as const, text: said }],
  };
}
