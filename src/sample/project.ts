import { briefMarkdown, type BriefData } from "@/discovery/brief";
import type { OstMetric } from "@/discovery/types";
import type { BearingLog } from "@/goals/bearings";
import type { Topic, TopicLine, TopicSection } from "@/hub/topics";
import { AT, day, quoteRef, SOURCES } from "./basket";

/*
 * What "Try it with a sample" adds to Basket's sources and boards so it reads as a finished piece of
 * work, written by hand so that it spends no tokens (pure): the problem pages that rank, the goals
 * above the boards, and one brief. Its lines follow the rules Qalam AI's are held to, and
 * project.test.ts holds them to it: every line cites quotes that are there, its quoted words and
 * numbers are in them, and "We know" and "Against" rest only on what can reach them.
 */

export const SAMPLE_NAME = "Basket (sample)";

export const SAMPLE_ABOUT = {
  audience: "Parents in Dubai who do a big weekly shop, and offices that stock a pantry",
  context: "Basket is a made-up grocery delivery app, here to show what Qalam Studio gives you. Its interviews, tickets and numbers are invented.",
  segments: [] as string[],
};

const NORTH = "basket-north";
const SECOND_ORDER = "basket-second-order";

/** The goals no board holds: the North Star the boards' goals feed, and one nothing is being worked on for yet. */
export const SAMPLE_GOALS: { id: string; title: string; parent: string | null; north?: true; metric: OstMetric; cites: string[] }[] = [
  {
    id: NORTH,
    title: "2M dirhams a month in orders by end of Q2",
    parent: null,
    north: true,
    metric: { name: "Orders a month", unit: "M dirhams", direction: "increase", baseline: 1.4, current: 1.4, target: 2, timeframe: "by end of Q2" },
    cites: [quoteRef("dump-1")],
  },
  {
    id: SECOND_ORDER,
    title: "More first-time customers order a second time",
    parent: NORTH,
    metric: { name: "Second order within 14 days", unit: "%", direction: "increase", baseline: 38, current: 38, target: 50 },
    cites: [quoteRef("dump-3")],
  },
];

type Written = readonly [text: string, quotes: readonly string[]];

interface PageIn {
  id: string;
  title: string;
  know?: readonly Written[];
  believe?: readonly Written[];
  against?: readonly Written[];
  open?: readonly string[];
}

/** Titled as their cards are, so a problem that's on a board shows as being there. */
export const SAMPLE_PAGES: readonly PageIn[] = [
  {
    id: "basket-substitutions",
    title: "Substitutions break my trust",
    know: [
      ["Items get swapped with no say in it: “They swap it without asking.”", ["sara-4"]],
      ["A wrong swap can mean food the family can't use: “I got full-fat milk instead of the lactose-free one and my son can't drink it.”", ["sara-5"]],
      ["“They replaced my organic chicken with a regular one and charged me the same.”", ["nadia-1"]],
      ["97 tickets in a week were about wrong substitutions, with dairy and baby products leading.", ["tix-2"]],
    ],
    believe: [
      ["People want a say before it happens: “A message where I can say yes or no would be perfect.”", ["nadia-2"]],
      ["Leaving an item out beats a bad swap: “I'd rather they just leave it out.”", ["sara-6"]],
      ["Some items matter far more than others: “Baby formula, never. Bread, I don't care.”", ["nadia-3", "nadia-4"]],
    ],
    open: ["Would people rather be asked about every swap, or set rules once?"],
  },
  {
    id: "basket-usual-basket",
    title: "Rebuilding my usual basket takes too long",
    know: [
      ["Parents rebuild the same basket by hand each week: “Every Sunday night I sit down and rebuild my basket from scratch.”", ["sara-1", "sara-2"]],
      ["Past orders are hard to find: “it's buried three screens deep under Account”", ["sara-3"]],
      ["38 tickets in a week were app problems, mostly people who can't find past orders.", ["tix-4"]],
      ["Clinics do it by hand too: “I copy last month's order from my email into the app line by line.”", ["mona-2", "mona-1"]],
    ],
    believe: [["One button could save the evening: “Let me press one button to get last week's basket, then I'll take things off.”", ["sara-8"]]],
    against: [["Not everyone feels it: “Reordering is fine for me, I use my favourites list.”", ["ahmed-7"]]],
    open: ["Does a favourites list solve this for most parents, or only for some?"],
  },
  {
    id: "basket-evening-slots",
    title: "Evening slots are full when I need them",
    know: [
      ["People order after the kids are asleep, and it's too late by then: “By then every evening slot for tomorrow is gone.”", ["ahmed-1"]],
      ["The fallback costs someone their morning, or the order: “Or I give up and go to the supermarket on Friday.”", ["ahmed-2", "ahmed-3"]],
      ["131 tickets in a week were late or missed deliveries, most of them evening slots that slipped past 10pm.", ["tix-1"]],
      ["Customers who wrote twice about lateness ordered 40% less the next month.", ["tix-5"]],
    ],
    believe: [["Some would pay to keep a slot: “For the 7 to 9 slot, yes, a few dirhams.”", ["ahmed-4"]]],
    open: ["How many people would pay, and how much?"],
  },
  {
    id: "basket-arrival",
    title: "I'm never sure when my order will arrive",
    know: [
      ["“I can't plan bath time around a four-hour window.”", ["sara-7"]],
      [`Tracking says little: “The app says "on the way" for an hour.”`, ["ahmed-5"]],
    ],
    believe: [
      ["People compare it to taxis: “I'd love to see where the driver is, like with taxis.”", ["ahmed-6"]],
      ["The founder doubts it matters much: “I'm not sure arrival time matters that much, our ETAs are right most of the time.”", ["dump-5"]],
    ],
  },
  {
    id: "basket-run-out",
    title: "I forget to reorder until I've run out",
    know: [
      ["New customers just drift off: “Then I forgot the app existed.”", ["layla-3"]],
      ["The corner shop wins the moment they need something: “when I needed eggs I just walked to the shop downstairs”", ["layla-4"]],
      ["Offices run out as well: “We run out of oat milk by Wednesday and people complain on Slack.”", ["karim-3"]],
    ],
    believe: [
      ["A nudge might bring them back: “maybe a nudge on Thursday, that's when the fridge is empty”", ["layla-6"]],
      ["The founder wonders about a subscription: “Maybe a staples subscription box would fix running out of milk.”", ["dump-6"]],
    ],
  },
  {
    id: "basket-surprise-fees",
    title: "Surprise fees put new customers off",
    know: [
      ["“the delivery fee was 15 dirhams on a 90 dirham order and that felt like a lot”", ["layla-1"]],
      ["It shows too late: “I didn't see it until the last screen.”", ["layla-2"]],
    ],
    believe: [["“If the second order was free to deliver I'd have tried it again.”", ["layla-5"]]],
    open: ["How many first orders are small enough for the fee to hurt?"],
  },
  {
    id: "basket-pantry-count",
    title: "Counting the pantry takes a morning",
    know: [
      ["“Every Monday I walk around with a notepad, count what's left, and place one big order.”", ["karim-1"]],
      ["“It takes me most of the morning.”", ["karim-2"]],
    ],
    believe: [["“If the basics arrived every Monday and I only added extras, I'd get my morning back.”", ["karim-5"]]],
  },
  {
    id: "basket-opening-hours",
    title: "Deliveries must arrive before opening hours",
    know: [
      ["“Deliveries must come before 9am, before patients arrive.”", ["mona-4"]],
      ["“Twice the driver came at noon and blocked the entrance.”", ["mona-5"]],
    ],
  },
  {
    id: "basket-invoice",
    title: "Finance needs one monthly invoice",
    know: [["“Finance wants one invoice a month, not forty receipts.”", ["karim-4"]]],
  },
  {
    id: "basket-refunds",
    title: "Refunds take too long to show",
    know: [["Refunds take 5 to 7 days to show on cards.", ["tix-3"]]],
  },
];

const titleOf = new Map(SOURCES.flatMap((s) => s.quotes.map((q) => [q.id, s.title] as const)));

function linesOf(p: PageIn, at: number): TopicLine[] {
  const lines = (section: TopicSection, written: readonly Written[] = []) =>
    written.map(([text, quotes], i): TopicLine => ({ id: `${p.id}-${section}-${i}`, section, text, by: "qalam", cites: quotes.map(quoteRef), from: [...new Set(quotes.map((q) => titleOf.get(q)!))], at }));
  return [
    ...lines("know", p.know),
    ...lines("believe", p.believe),
    ...lines("against", p.against),
    ...(p.open ?? []).map((text, i): TopicLine => ({ id: `${p.id}-open-${i}`, section: "open", text, by: "qalam", cites: [], from: [], at })),
  ];
}

export const samplePages = (): Topic[] =>
  SAMPLE_PAGES.map((p) => ({ id: p.id, kind: "need", title: p.title, products: [], createdAt: day(8), updatedAt: day(8), lines: linesOf(p, day(8)), history: [{ at: day(8), text: "Filled in for this sample." }] }));

/** A problem no board has, drawn faint under the goal it bears on. */
export const SAMPLE_BEARINGS: BearingLog[] = [
  { need: "basket-surprise-fees", goal: SECOND_ORDER, bears: "direct", how: "A fee first seen on the last screen stands in the way of a second order.", cites: [quoteRef("layla-2"), quoteRef("layla-5")], by: "qalam", at: AT },
];

/** The card the sample's brief hangs under: what the board's furthest along. */
export const SAMPLE_BRIEF_CARD = "s1";

const quoted = (id: string) => ({ text: SOURCES.flatMap((s) => s.quotes).find((q) => q.id === id)!.text, source: titleOf.get(id)! });

const BRIEF: BriefData = {
  at: day(9),
  title: "Order again shelf on the home screen",
  audience: "Parents with young kids who do a big weekly shop",
  goal: { title: "More customers reorder every week", metric: "Reorders per customer, 1.3 now, 1.5 by March" },
  problems: [
    {
      title: "Rebuilding my usual basket takes too long",
      lines: ["Parents rebuild the same basket by hand each week.", "Past orders are hard to find: 38 tickets in a week were app problems, mostly people who can't find past orders."],
      open: ["Does a favourites list solve this for most parents, or only for some?"],
    },
  ],
  quotes: ["sara-1", "sara-2", "sara-3", "tix-4"].map(quoted),
  build: {
    title: "Order again shelf on the home screen",
    description: "Last week's basket waits on the home screen, ready to change and check out.",
    why: "It came up in every weekly-planner interview and in the tickets about past orders.",
    wrong: "Parents change little enough of last week's basket that starting from it saves them time.",
    test: { what: "Parents want last week's basket, not a fresh start", how: "5-user prototype test with parents who shop weekly", suggested: "4 of 5 find the shelf unprompted" },
  },
  later: [
    { title: "Saved baskets to reorder in one tap", why: "parents wanted last week's basket, not a list to maintain" },
    { title: "Thursday reminder when the fridge is empty", why: "a different problem: people forgetting to reorder at all" },
  ],
  features: [
    {
      title: "Last week's basket on the home screen",
      why: "Parents buy nearly the same things each week, and today they search for each one.",
      acceptance: ["A customer with a past order sees that order's items on the home screen", "Someone with no past order sees the home screen as it is today", "Items out of stock are marked, never swapped"],
      data: ["Each customer's last order", "Whether each item is in stock"],
      connects: ["Order history", "Stock levels"],
      quotes: ["sara-1", "sara-8"].map(quoted),
    },
    {
      title: "Add it all, then take things off",
      why: "The person asking for this wants to start from everything and remove what they don't need.",
      acceptance: ["One press puts every item in the basket", "Removing an item takes one press", "Going back to the shelf keeps the changes"],
      data: ["The basket in progress"],
      connects: ["Checkout"],
      quotes: ["sara-8"].map(quoted),
    },
  ],
  asked: { platform: "iOS and Android", exists: "A working app with accounts, orders and a past-orders page under Account" },
  known: [],
};

export const sampleBrief = () => ({ meta: { card: SAMPLE_BRIEF_CARD, kind: "solution" as const, title: BRIEF.title, at: BRIEF.at, features: BRIEF.features.length }, body: briefMarkdown(BRIEF) });

export const sampleBriefData = () => BRIEF;
