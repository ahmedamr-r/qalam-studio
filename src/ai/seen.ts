import type Anthropic from "@anthropic-ai/sdk";
import type { PlaceSent } from "@/seen/place";
import type { ReadSent } from "@/seen/read";
import { MOVE_HOWS, SCREEN_KINDS, SEEN_LIMITS } from "@/seen/types";

/*
 * Qalam AI reading a product's screenshots and placing them in flows (src/seen/). Reading describes
 * each screenshot as it is: what the screen is for, what's on it, its controls by their labels,
 * its navigation, the state it shows and how it's laid out, never whether it's good. Placing groups
 * screenshots of one screen, orders screens into flows (one per thing a person is trying to do:
 * where it starts, the way through, the branches, where it ends, what the screenshots don't show)
 * and asks only what the screenshots can't tell. Code keeps what the screens' own words back.
 */

type Block = Anthropic.Beta.Messages.BetaContentBlockParam;
export type ShotImage = { mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string };

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const arr = (items: unknown, description: string) => ({ type: "array", items, description });
const enm = (values: readonly string[], description: string) => ({ type: "string", enum: [...values], description });
const bool = (description: string) => ({ type: "boolean", description });
/** Enum values for ids a call may name (a placeholder when there are none, which code ignores). */
const ids = (list: string[]) => (list.length ? list : ["none"]);

const DESCRIBE = `Describe; don't judge. Say what is there and how it is laid out, never whether it is good, clear or a problem: critique comes later, from the team.`;

export const SEEN_READ_SYSTEM = `You read screenshots of one product, one screen each, so a product team can find any screen later and see how people move through the product.

For each screenshot (s1, s2, …), say:
- name: what the team would call this screen, in two or three words ("Cart", "Delivery slot", "Order placed"). Prefer the screen's own title when it has one.
- kind: the closest kind from the list.
- does: what the screen is for, in one sentence, from the point of view of the person using it.
- on: what is on it, top to bottom, in one or two sentences.
- can: the controls a person can use on it (buttons, links, tabs, fields, toggles), each by its label exactly as the screen shows it, and what it does. Leave out controls with no visible label.
- nav: navigation that is on it (a tab bar's or a menu's labels, exactly as shown). [] when there is none.
- state: what this screenshot shows of the screen when it is one state of several (empty, loading, an error, filled in, after a coupon), else "".
- design: how it is laid out (structure, the patterns it uses: a list of cards, a bottom sheet, a stepper, a fixed bar at the bottom), in one sentence.

${DESCRIBE}

The words this Mac read off each screenshot come after it. Copy labels from there, exactly. Put words from the screen in quotation marks only when you copy them exactly; write a number only as the screen shows it. Never write anyone's name, email address, phone number or street address from a screenshot.`;

export function readSchema(m: Pick<ReadSent, "shots">) {
  return obj({
    screens: arr(
      obj({
        id: enm(ids([...m.shots.keys()]), "The screenshot (s…)"),
        name: str("What the team would call this screen, two or three words"),
        kind: enm(SCREEN_KINDS, "The closest kind of screen"),
        does: str("What the screen is for, one sentence"),
        on: str("What is on it, top to bottom, one or two sentences"),
        can: arr(obj({ label: str("The control's label, exactly as the screen shows it"), does: str("What it does, a few words") }), "Its labelled controls, the main one first, at most 12"),
        nav: arr(str("A navigation label, exactly as shown"), "Navigation on it. [] when none"),
        state: str('What this screenshot shows when it is one state of several, else ""'),
        design: str("How it is laid out, one sentence, described, not judged"),
      }),
      "One per screenshot, in order",
    ),
  });
}

/** Each screenshot after what's said about it, its words after it, then what to do. */
export function readContent(m: ReadSent, images: ReadonlyMap<string, ShotImage>): Block[] {
  const content: Block[] = [];
  for (const b of m.blocks) {
    content.push({ type: "text", text: b.head });
    const im = images.get(b.ref);
    if (im) content.push({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } });
    content.push({ type: "text", text: b.words });
  }
  content.push({ type: "text", text: `Read ${m.blocks.length === 1 ? "this screenshot" : `these ${m.blocks.length} screenshots`}: one entry each, in order.` });
  return content;
}

/** Reading a batch of screenshots (at most SEEN_LIMITS.batch). */
export function readCall(m: ReadSent, images: ReadonlyMap<string, ShotImage>) {
  return {
    kind: "seen-read" as const,
    system: SEEN_READ_SYSTEM,
    schema: readSchema(m),
    effort: "medium" as const,
    maxTokens: 8000,
    content: readContent(m, images),
  };
}

export const SEEN_PLACE_SYSTEM = `You put a product's screens into user flows, so its team can see how people move through the product today and refer to it later, when they work on goals and problems.

A flow is one thing a person is trying to do (order again, pay for the basket, sign up), from where it starts to where it ends. For each flow give: its name; its aim, in the person's terms ("to pay for the basket"); the goal it serves, when one of the goals clearly is what it moves, else "none"; its steps, the screens in order along the way through when all goes well; its moves, from one screen to the next and the branches off the way (an alternative, going back, an error), each with the control that makes it, its label exactly as the screen it leaves shows it ("" when the screenshots don't show it), and how (tap, back, system for the product moving on by itself, swipe, type); where it starts (its entry: the tab, link or screen that gets there); and what the screenshots don't show yet (a failed payment, an empty state), as short phrases, at most 4. A flow has at least two different screens. A screen can be in more than one flow. Leave a screen out of every flow when it isn't clearly part of one.

First decide which screenshots show one screen in several states (the cart, then the cart with a coupon), and group them in "same": code noticed which pairs look alike, a hint you can overrule either way. Then build flows over screens. Use the screens already kept (e…) and the flows already kept (f…): give a kept flow's id when you change it, "new" for a new one, and leave out a kept flow that doesn't change. Never change a person's flow.

When the product's code map lists steps (c…), say which screen shows which step, only when the screen is clearly that step.

${DESCRIBE}

Ask only what the screenshots can't tell you and that changes where a screen goes: at most ${SEEN_LIMITS.questions} questions, each about the screens (s… or e…) it shows, with why you ask, 2 to 4 short answers to pick from (or none for an open question) and the words on those screens it points at, copied exactly. Don't ask what the person already answered. When nothing is worth asking, set ready.

Put words from a screen in quotation marks only when you copy them exactly; write a number only as a screen shows it. Use only the ids the request gave.`;

export function placeSchema(m: Pick<PlaceSent, "nodes" | "flows" | "goals" | "steps">) {
  const nodes = ids([...m.nodes.keys()]);
  const shots = ids([...m.nodes.keys()].filter((k) => k.startsWith("s")));
  return obj({
    same: arr(arr(enm(nodes, "A screenshot (s…) or a kept screen (e…)"), "Screenshots of one screen, its usual look first"), "Groups of screenshots that show one screen in several states. [] when none"),
    states: arr(obj({ id: enm(shots, "A screenshot grouped with others (s…)"), shows: str("What this state shows, a few words") }), "What each grouped screenshot shows, beyond the first. [] when none"),
    flows: arr(
      obj({
        id: enm(["new", ...m.flows.keys()], "A kept flow it changes (f…), or new"),
        name: str("The flow's name, two to four words"),
        aim: str('What the person is trying to do, in their terms ("to pay for the basket")'),
        goal: enm(["none", ...m.goals.keys()], "The goal it serves (g…), or none"),
        steps: arr(enm(nodes, "A screen (s… or e…)"), "Its screens in order, the way through when all goes well"),
        moves: arr(obj({ from: enm(nodes, "The screen it leaves"), to: enm(nodes, "The screen it reaches"), via: str('The control that makes it, exactly as the screen it leaves shows it, or ""'), how: enm(MOVE_HOWS, "How") }), "Every move along the steps and the branches off them"),
        entry: str('Where it starts: the tab, link or screen that gets there, or ""'),
        notShown: arr(str("Something the screenshots don't show yet, a short phrase"), "At most 4. [] when nothing"),
        note: str('One sentence about the flow as it is, or ""'),
      }),
      `The flows, at most ${SEEN_LIMITS.flows}`,
    ),
    code: arr(obj({ screen: enm(nodes, "A screen (s… or e…)"), step: enm(ids([...m.steps.keys()]), "The code step it shows (c…)") }), "Screens that clearly show a code step. [] when none, or no steps were sent"),
    questions: arr(
      obj({
        shots: arr(enm(nodes, "A screen it is about"), "The screens it is about, at most 4"),
        ask: str("The question, one sentence"),
        why: str("Why you ask, one sentence"),
        options: arr(str("A short answer to pick"), "2 to 4 answers, or [] for an open question"),
        words: arr(obj({ id: enm(nodes, "A screen it is about"), words: str("Words on that screen it points at, copied exactly") }), "What on those screens it points at. [] when nothing"),
      }),
      `At most ${SEEN_LIMITS.questions}. [] when nothing is worth asking`,
    ),
    ready: bool("Nothing is left worth asking"),
  });
}

/** The material, then each new screenshot small, labelled with its id. */
export function placeContent(m: PlaceSent, thumbs: ReadonlyMap<string, ShotImage>): Block[] {
  const content: Block[] = [{ type: "text", text: m.text }];
  const shown = m.thumbs.filter((t) => thumbs.has(t.ref));
  if (shown.length) {
    content.push({ type: "text", text: "The new screenshots, small:" });
    for (const t of shown) {
      const im = thumbs.get(t.ref)!;
      content.push({ type: "text", text: `${t.id}:` }, { type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } });
    }
  }
  content.push({ type: "text", text: "Put the screens into flows." });
  return content;
}

/** Placing screenshots in flows: a round, the person's answers so far in its material. */
export function placeCall(m: PlaceSent, thumbs: ReadonlyMap<string, ShotImage>) {
  return {
    kind: "seen-place" as const,
    system: SEEN_PLACE_SYSTEM,
    schema: placeSchema(m),
    effort: "high" as const,
    maxTokens: 16000,
    content: placeContent(m, thumbs),
  };
}
