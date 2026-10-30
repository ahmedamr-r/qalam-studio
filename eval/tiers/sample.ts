import type { OutsidePage } from "@/goals/outside";

/*
 * What the tier eval adds to the Basket sample (eval/retrieval/basket.ts) for the two read calls
 * the sample has no material for: goals as a founder writes them down (the setup's shape call), and
 * two outside pages with the research step's notes on them (the claims call). The pages are written
 * for this eval, at example.com: they aren't real reports, and their numbers are made up.
 */

/** Basket's goals, one a line, indented under the goal each feeds. */
export const OUTLINE = `2M dirhams a month in orders by end of Q2
  More customers reorder every week: 1.2 orders a week per customer today, 1.5 by March
    Parents rebuild their weekly basket in under 5 minutes
    Fewer people stop ordering after a substitution they didn't ask for
  More first-time customers order a second time within 30 days
  Evening delivery slots don't run out before 6pm
  Offices reorder on a schedule (Basket for Business)
    Office managers set up a standing weekly order`;

/** What they answered about the numbers, by the line's place in the outline (o1…). */
export const ANSWERS: Record<string, string> = {
  o5: "About 22% of first-time customers order again within 30 days now. We want 30% by June.",
  o6: "On weekdays the evening slots are usually gone by 2pm. Ideally none sell out before 6pm, from April.",
  o8: "12 of our 140 offices have a standing order today.",
};

/** The products as the shape call names them (p…), and the sample's ids. */
export const SHAPE_PRODUCTS = [
  { ref: "p1", id: "grocery", name: "Grocery app" },
  { ref: "p2", id: "business", name: "Basket for Business" },
];

/** The goal the outside numbers are for. */
export const OUTSIDE_TASK = `Basket: Basket is a grocery delivery company with a consumer app and a business service.
A goal of its product Grocery app: “More customers reorder every week” (Reorders per customer: 1.2 → 1.5 orders by March).
It feeds: “2M dirhams a month in orders by end of Q2”.
What do companies in the same or a similar domain take as their North Star and the goals under it, and which numbers do they report publicly for goals like this one?`;

export const OUTSIDE_PAGES: OutsidePage[] = [
  {
    ref: "",
    url: "https://example.com/qalam-eval/grocery-delivery-retention-2026",
    title: "Grocery delivery retention benchmarks 2026 (sample page)",
    text: `Grocery delivery retention benchmarks 2026

This sample page was written for Qalam's tier eval. Its numbers are made up.

Across the 40 grocery delivery apps in the panel, the median customer placed 1.4 orders a week in their third month. Apps in the top quartile reached 2.1 orders a week, mostly through reorder features on the home screen.

Second orders matter most: 31% of first-time customers placed a second order within 30 days, and those who did were 3 times as likely to still be ordering after six months.

Substitutions were the most common reason people gave for stopping: 18% of customers who stopped ordering said an unwanted substitution was why. Apps that asked before substituting saw 9% fewer customers stop in the following month.

Evening delivery slots sold out before 5pm on 62% of weekdays in the Gulf markets in the panel, against 35% in Europe.`,
  },
  {
    ref: "",
    url: "https://example.com/qalam-eval/quick-commerce-north-stars",
    title: "How quick-commerce companies pick a North Star (sample page)",
    text: `How quick-commerce companies pick a North Star

This sample page was written for Qalam's tier eval. Its numbers are made up.

Of the 25 companies we spoke to, 14 use weekly ordering customers as their North Star. Six use gross merchandise value, and the other five use orders per active customer.

The companies that grew fastest set a target for reorder frequency first: on average they moved from 1.1 to 1.6 orders per customer per week over 18 months.

Business accounts behave differently. Offices with a standing weekly order spent 2.5 times as much a year as offices that ordered when they ran out, and 70% of them kept ordering after a year.`,
  },
];

/** The research step's notes about the pages, as it writes them (a link beside each number). */
export const OUTSIDE_NOTES = `- The median grocery delivery customer places 1.4 orders a week in their third month; the top quartile reaches 2.1 [Grocery delivery retention benchmarks 2026](https://example.com/qalam-eval/grocery-delivery-retention-2026)
- 31% of first-time customers order a second time within 30 days [Grocery delivery retention benchmarks 2026](https://example.com/qalam-eval/grocery-delivery-retention-2026)
- 18% of customers who stopped cite an unwanted substitution; asking first meant 9% fewer stopping [Grocery delivery retention benchmarks 2026](https://example.com/qalam-eval/grocery-delivery-retention-2026)
- 14 of 25 quick-commerce companies use weekly ordering customers as their North Star [How quick-commerce companies pick a North Star](https://example.com/qalam-eval/quick-commerce-north-stars)
- Fast growers moved reorder frequency from 1.1 to 1.6 orders per customer per week over 18 months [How quick-commerce companies pick a North Star](https://example.com/qalam-eval/quick-commerce-north-stars)
- Offices with a standing weekly order spent 2.5 times as much a year; 70% kept ordering after a year [How quick-commerce companies pick a North Star](https://example.com/qalam-eval/quick-commerce-north-stars)`;

/**
 * A problem page for the drafting call (solutions), as filing would write it from the sample's own
 * sources: its lines cite the sample's quotes by id, and a solution already on the board under it.
 */
export const PROBLEM = {
  title: "Evening slots are full when I need them",
  lines: [
    { section: "know" as const, text: "Parents who order after the kids are asleep find every evening slot for tomorrow gone.", cites: ["ahmed-1"] },
    { section: "know" as const, text: "A full evening slot pushes the order to a morning slot someone stays home for, or to the supermarket.", cites: ["ahmed-2", "ahmed-3"] },
    { section: "believe" as const, text: "Parents would pay a few dirhams to keep an evening slot.", cites: ["ahmed-4"] },
    { section: "against" as const, text: "The late-delivery tickets are evening slots slipping past 10pm, which is lateness rather than slots selling out.", cites: ["tix-1"] },
  ],
  goal: { title: "Evening delivery slots don't run out before 6pm", metric: "Weekday evening slots gone by 2pm today; none before 6pm from April" },
  cards: [{ title: "Priority evening slots for a fee", kind: "solution" as const }],
};
