import type { InterviewAnswer } from "@/discovery/interview";

/**
 * A recorded product interview and draft for Discovery boards, for when AI isn't configured and
 * for "Try a sample": Basket, a fictional grocery app. The draft is shaped like the model's raw
 * answer and goes through the same sanitizer, which it tests on purpose: one opportunity quotes
 * words the builder never said (it ends up Assumed), the "now" number was never given (it's
 * dropped), and an idea of Qalam AI's sits under an opportunity that isn't the target (it's
 * dropped too).
 */

export const SAMPLE_ANSWERS: InterviewAnswer[] = [
  { id: "product", question: "What's the product, in a sentence?", answer: "Basket, a grocery app that delivers in 20 minutes across Dubai and Abu Dhabi." },
  { id: "audience", question: "Who is it for?", answer: "Busy parents who order groceries every week on their phone, usually in the evening." },
  { id: "stage", question: "Where is the product today?", answer: "Launched, finding its fit" },
  { id: "business", question: "What does the business need most in the next few months?", answer: "More repeat use" },
  { id: "metric", question: "Which customer behaviour would show you're getting there? Add today's number and your goal if you have them.", answer: "Weekly reorders per customer: 1.2 today, we want 1.5 by March." },
  {
    id: "pains",
    question: "What do customers struggle with or ask for, and what ideas does the team already have?",
    answer:
      "People tell us they can't find what they ordered last time and rebuild the basket from scratch. Many say they're never sure when it'll arrive, so they stay home waiting. We've talked about an order again shelf on the home screen.",
  },
];

export const SAMPLE_FOLLOWUPS_RAW = { followUps: [] };

export const SAMPLE_DRAFT_RAW = {
  summary: "Basket delivers groceries in 20 minutes to busy parents who shop every week. The outcome to move is how often they come back to reorder.",
  outcome: {
    title: "More customers reorder every week",
    rationale: "Repeat use is what the business needs, and a weekly reorder is the behaviour that shows it.",
    metric: { name: "Weekly reorders per customer", unit: "orders", direction: "increase", baseline: 1.2, current: 1.31, target: 1.5, timeframe: "by March" },
  },
  opportunities: [
    { id: "o1", parent: "outcome", title: "I can't find what I ordered last time", description: "Finding past orders is slow, so the weekly shop starts from zero.", evidence: [{ answerId: "pains", quote: "can't find what they ordered last time" }] },
    { id: "o2", parent: "o1", title: "Rebuilding my usual basket takes too long", description: "Most of a weekly shop is the same items as last week.", evidence: [{ answerId: "pains", quote: "rebuild the basket from scratch" }] },
    { id: "o3", parent: "outcome", title: "I'm never sure when my order will arrive", description: "Uncertain delivery times make ordering feel risky.", evidence: [{ answerId: "pains", quote: "never sure when it'll arrive" }] },
    { id: "o4", parent: "o3", title: "I have to stay home waiting for the delivery", description: "Waiting in costs parents their evening.", evidence: [{ answerId: "pains", quote: "so they stay home waiting" }] },
    { id: "o5", parent: "outcome", title: "I forget to reorder until I've run out", description: "Running out of staples sends people to the shop down the road.", evidence: [{ answerId: "pains", quote: "I always reorder the same five things" }] },
    { id: "o6", parent: "outcome", title: "Evening slots are full when I need them", description: "Parents shop after the kids are in bed.", evidence: [] },
  ],
  recommendedTarget: "o1",
  solutions: [
    {
      id: "s1",
      opportunity: "o1",
      title: "Order again shelf on the home screen",
      description: "Last week's items, one tap from the home screen.",
      answerId: "pains",
      quote: "an order again shelf on the home screen",
      assumptions: [
        { category: "desirability", text: "Customers want to see last week's items before anything else.", importance: 3 },
        { category: "usability", text: "They notice the shelf without being told it's there.", importance: 3 },
        { category: "feasibility", text: "We can load past orders fast enough for the home screen.", importance: 2 },
      ],
    },
    {
      id: "s2",
      opportunity: "o1",
      title: "Saved baskets to reorder in one tap",
      description: "Customers save a usual basket and reorder it whole.",
      answerId: null,
      quote: null,
      assumptions: [
        { category: "desirability", text: "Weekly baskets are similar enough to save as one.", importance: 3 },
        { category: "usability", text: "Customers understand saving a basket before they need it.", importance: 2 },
      ],
    },
    {
      id: "s3",
      opportunity: "o1",
      title: "Search that finds past orders first",
      description: "Searching “milk” shows the milk you bought before.",
      answerId: null,
      quote: null,
      assumptions: [
        { category: "desirability", text: "Customers search for items they've bought before.", importance: 2 },
        { category: "feasibility", text: "Search can rank by purchase history without slowing down.", importance: 2 },
      ],
    },
    {
      id: "s4",
      opportunity: "o3",
      title: "Live courier tracking with an arrival window",
      description: "Show where the courier is and a narrowing arrival window.",
      answerId: null,
      quote: null,
      assumptions: [{ category: "feasibility", text: "Couriers' phones report location reliably.", importance: 3 }],
    },
  ],
};

/**
 * A recorded brain dump for the same board: Basket's founder thinking out loud after an investor
 * call, and Qalam AI's answers to it, shaped like the model's raw output and checked by the same
 * code. Cards on the board are named "@<their title>" (sampleRaw swaps in the ids a call gives
 * them). Planted on purpose:
 *   - read: a piece the founder never wrote, a piece overlapping another, a role that isn't one,
 *     pushback on the made-up piece, and pushback naming a card that isn't on the board;
 *   - place: a solution and an outcome with nothing of the founder's behind them, a need that
 *     repeats a card, an answer quote the founder never typed, a number they never gave (twice).
 */

export const SAMPLE_DUMP_TEXT = `ok so brain dump after the investor call. They want us at 2M dirhams a month in orders by end of Q2, we're around 1.4M now. Honestly what matters to me is people coming back every week, we're at 1.3 reorders per customer now. And the bigger leak is new people: only 38% of first-time customers place a second order within 14 days, I'd love that at 50%.

Why they don't come back, idk exactly. Parents hate substitutions, they get the wrong milk brand and nobody asked them. Lina from ops says it's the top complaint in the app reviews. We could do a substitution preferences thing where you set rules once, like never swap my milk but fine to swap bread. I'm assuming people trust us to pick substitutes if they set the rules once.

Customers need a subscription box for staples, nappies and milk every week. We could fake-door the subscription and see who taps it, if 1 in 10 taps it we build it.

Omar in support says half the tickets are about late deliveries. But I don't think arrival time is a big deal anymore, our ETAs are right 94% of the time. Maybe WhatsApp updates instead of push, people don't open our notifications.

Also the order again shelf and saved baskets are the same thing really, one usual basket button on the home screen.

Evening slots: the 8 to 10pm ones sell out by 6, that's when parents shop after bedtime.

Context: Dubai and Abu Dhabi, 40 dark stores, mostly parents with young kids. Not sure if we should even care about singles.`;

const DUMP_QUESTION = (id: string, title: string, why: string, options: [string, string, string][], recommended: string[], allowOther = false) => ({
  id,
  title,
  why,
  multi: false,
  options: options.map(([value, label, description]) => ({ value, label, description })),
  recommended,
  allowOther,
});

export const SAMPLE_DUMP_READ_RAW = {
  understanding:
    "Investors want orders at 2M dirhams a month by Q2, and you see two ways there: people reordering every week, and first-time customers coming back for a second order. You name substitutions as a pain, a few ideas (substitution rules, a staples box, WhatsApp updates) and doubt that arrival time still matters. Unclear: which goal leads, and how solid the support numbers are.",
  fragments: [
    { id: "f1", quote: "They want us at 2M dirhams a month in orders by end of Q2", role: "goal" },
    { id: "f2", quote: "we're around 1.4M now", role: "metric" },
    { id: "f3", quote: "what matters to me is people coming back every week", role: "goal" },
    { id: "f4", quote: "we're at 1.3 reorders per customer now", role: "metric" },
    { id: "f5", quote: "only 38% of first-time customers place a second order within 14 days, I'd love that at 50%", role: "goal" },
    { id: "f6", quote: "Parents hate substitutions, they get the wrong milk brand and nobody asked them", role: "need" },
    { id: "f6b", quote: "Parents hate substitutions", role: "need" },
    { id: "f7", quote: "Lina from ops says it's the top complaint in the app reviews", role: "evidence" },
    { id: "f8", quote: "a substitution preferences thing where you set rules once, like never swap my milk but fine to swap bread", role: "idea" },
    { id: "f9", quote: "I'm assuming people trust us to pick substitutes if they set the rules once", role: "assumption" },
    { id: "f10", quote: "Customers need a subscription box for staples, nappies and milk every week", role: "need" },
    { id: "f11", quote: "We could fake-door the subscription and see who taps it, if 1 in 10 taps it we build it", role: "test" },
    { id: "f12", quote: "Omar in support says half the tickets are about late deliveries", role: "evidence" },
    { id: "f13", quote: "I don't think arrival time is a big deal anymore, our ETAs are right 94% of the time", role: "evidence" },
    { id: "f14", quote: "Maybe WhatsApp updates instead of push, people don't open our notifications", role: "idea" },
    { id: "f15", quote: "the order again shelf and saved baskets are the same thing really, one usual basket button on the home screen", role: "idea" },
    { id: "f16", quote: "the 8 to 10pm ones sell out by 6, that's when parents shop after bedtime", role: "evidence" },
    { id: "f17", quote: "Dubai and Abu Dhabi, 40 dark stores, mostly parents with young kids", role: "setting" },
    { id: "f18", quote: "Not sure if we should even care about singles", role: "question" },
    { id: "f19", quote: "parents told us they would pay for priority evening slots", role: "evidence" },
  ],
  challenges: [
    { kind: "business-goal", fragmentId: "f1", cardId: null, text: "2M a month in orders is a business number: it moves when customers reorder weekly and come back for a second order. I'd put it on top, with those two as the outcomes under it." },
    { kind: "solution-as-need", fragmentId: "f10", cardId: "@I forget to reorder until I've run out", text: "A subscription box is an idea, not a need. The need behind it may be running out of staples, which the board already has as an Assumed card." },
    { kind: "second-hand", fragmentId: "f12", cardId: null, text: "Half the tickets is Omar's read, not a count. A week of tickets, counted, would tell you whether late deliveries really lead." },
    { kind: "conflict", fragmentId: "f13", cardId: "@I'm never sure when my order will arrive", text: "You doubt arrival time matters, but the board has it as a need and Omar's tickets point the other way. ETAs being right doesn't mean customers feel sure." },
    { kind: "competing-goals", fragmentId: "f3", cardId: "c999", text: "Three goals pull at once: orders, weekly reorders and second orders. Which one does the team work on first?" },
    { kind: "second-hand", fragmentId: "f19", cardId: null, text: "Who told you parents would pay for priority slots?" },
  ],
  questions: [
    DUMP_QUESTION("which-goal", "Which goal should the team work on first?", "It decides which outcome the board grows under first.", [["weekly-reorders", "Weekly reorders", "Existing customers coming back every week"], ["second-orders", "Second orders", "First-time customers ordering again within 14 days"], ["orders", "Orders overall", "The 2M a month the investors asked for"]], ["weekly-reorders"]),
    DUMP_QUESTION("subscription-need", "What's behind the subscription box idea?", "A subscription is a solution: the need behind it decides where it goes.", [["run-out", "They run out of staples", "Milk and nappies run out before the next shop"], ["same-basket", "They buy the same things", "Most of the weekly shop repeats"], ["save-money", "They want it cheaper", "A box would come with a discount"]], ["run-out"], true),
    { id: "tickets-source", title: "Where does “half the tickets” come from?", why: "A count backs the late-delivery need; a guess doesn't.", multi: false, options: [], recommended: [], allowOther: false },
    DUMP_QUESTION("singles", "Who should this board be about?", "Needs split differently for parents and singles.", [["parents", "Parents with young kids", "Your main customers today"], ["everyone", "Parents and singles", "Two groups of needs side by side"]], ["parents"]),
  ],
};

/** The founder's own words for the open questions, so the sample can be clicked through. */
export const SAMPLE_DUMP_ANSWERS: Record<string, string> = {
  "tickets-source": "Omar's guess from a busy week, we never counted them.",
};

export const SAMPLE_DUMP_FOLLOWUP_RAW = [
  {
    analysis:
      "Weekly reorders lead, so the orders goal sits on top with reorders and second orders under it. The subscription box answers running out of staples, so it goes under that need. “Half the tickets” is a guess, so it backs the arrival need only lightly, and your doubt about ETAs still conflicts with it.",
    understanding: "Orders at 2M a month is the business goal; weekly reorders (first) and second orders are the outcomes that move it. Parents with young kids are the customers.",
    roles: [{ fragmentId: "f10", role: "idea" }],
    challenges: [
      { kind: "second-hand", fragmentId: "f12", cardId: null, text: "Half the tickets is Omar's guess. Count a week of tickets before it decides anything." },
      { kind: "conflict", fragmentId: "f13", cardId: "@I'm never sure when my order will arrive", text: "Right ETAs and customers who feel unsure can both be true: ask a few parents before you drop the need." },
    ],
    ready: false,
    questions: [
      DUMP_QUESTION("eta-feel", "Do parents still feel unsure when an order will arrive?", "It decides whether the arrival need stays on the board.", [["unsure", "Yes, they still wonder", "Right ETAs, but they don't trust them"], ["sure", "No, not any more", "Drop the need"], ["check", "Not sure, I'll ask", "Keep it and mark it to check"]], ["check"]),
      DUMP_QUESTION("cadence", "How often would a staples box go out?", "It shapes the test and the solution's assumptions.", [["weekly", "Every week", "With the weekly shop"], ["fortnight", "Every two weeks", "Staples last longer"], ["choose", "They choose", "Each family sets its own"]], ["choose"]),
    ],
  },
  {
    analysis: "Keeping the arrival need and checking it with parents settles the conflict for now; families choosing their own cadence goes into the box's assumptions. Ready to place.",
    understanding: "Orders at 2M a month is the business goal; weekly reorders (first) and second orders move it. Parents with young kids are the customers; arrival time stays a need to check.",
    roles: [],
    challenges: [{ kind: "second-hand", fragmentId: "f12", cardId: null, text: "Half the tickets is Omar's guess. Count a week of tickets before it decides anything." }],
    ready: true,
    questions: [],
  },
];

export const SAMPLE_DUMP_PLACE_RAW = {
  summary: "A new business goal on top (2M dirhams a month in orders) with weekly reorders and second orders under it, a substitutions need with your rules idea, the subscription box and its fake-door test. I'd reword the evening slots need, merge the shelf and saved baskets, and note what's still open.",
  cards: [
    { id: "n1", kind: "outcome", parentCard: null, parentNew: null, title: "Reach 2M dirhams a month in orders", description: "What investors asked for by the end of Q2.", fragmentIds: ["f1", "f2"], answers: [], metric: { name: "Orders per month", unit: "AED", direction: "increase", baseline: 1400000, current: null, target: 2000000, timeframe: "by end of Q2" }, assumptions: [], test: null, why: "The investors' number, above the outcomes that move it" },
    { id: "n2", kind: "outcome", parentCard: null, parentNew: "n1", title: "More first-time customers order a second time", description: "New customers drop off after their first order.", fragmentIds: ["f5"], answers: [], metric: { name: "Second order within 14 days", unit: "%", direction: "increase", baseline: 38, current: 42, target: 50, timeframe: null }, assumptions: [], test: null, why: "The leak you named, moving orders" },
    { id: "n3", kind: "opportunity", parentCard: "@More customers reorder every week", parentNew: null, title: "I get the wrong brand and nobody asks me", description: "Substitutions are made without asking.", fragmentIds: ["f6", "f7"], answers: [{ answerId: "a3", quote: "customers say it every single day" }], metric: null, assumptions: [], test: null, why: "Parents hate substitutions" },
    { id: "n4", kind: "solution", parentCard: null, parentNew: "n3", title: "Substitution rules you set once", description: "Never swap my milk, fine to swap bread.", fragmentIds: ["f8"], answers: [], metric: null, assumptions: [{ category: "desirability", text: "Customers trust Basket to pick substitutes once rules are set.", importance: 3 }, { category: "usability", text: "Parents set rules before their first swap goes wrong.", importance: 2 }], test: null, why: "Your idea for it" },
    { id: "n5", kind: "solution", parentCard: "@I forget to reorder until I've run out", parentNew: null, title: "Staples subscription box", description: "Milk and nappies on a schedule each family chooses.", fragmentIds: ["f10"], answers: [], metric: null, assumptions: [{ category: "desirability", text: "Families want staples on a schedule they choose.", importance: 3 }], test: null, why: "The need behind the box is running out" },
    { id: "n6", kind: "test", parentCard: null, parentNew: "n5", title: "Fake-door subscription button", description: "", fragmentIds: ["f11"], answers: [], metric: null, assumptions: [], test: { method: "A subscription button that leads to a waitlist", criterion: "1 in 10 who see it tap it" }, why: "Your test for the box" },
    { id: "n7", kind: "solution", parentCard: "@I'm never sure when my order will arrive", parentNew: null, title: "WhatsApp delivery updates", description: "Updates where parents read them, instead of push.", fragmentIds: ["f14"], answers: [], metric: null, assumptions: [{ category: "desirability", text: "Parents read WhatsApp messages from Basket.", importance: 3 }], test: null, why: "People don't open the notifications" },
    { id: "n8", kind: "solution", parentCard: "@Evening slots are full when I need them", parentNew: null, title: "Priority evening slots for a fee", description: "Pay to keep an evening slot.", fragmentIds: [], answers: [], metric: null, assumptions: [], test: null, why: "An idea for the evening slots" },
    { id: "n9", kind: "outcome", parentCard: null, parentNew: null, title: "Bigger baskets", description: "", fragmentIds: [], answers: [], metric: null, assumptions: [], test: null, why: "Another way to grow orders" },
    { id: "n10", kind: "opportunity", parentCard: "@More customers reorder every week", parentNew: null, title: "I can't find what I ordered last time", description: "", fragmentIds: ["f15"], answers: [], metric: null, assumptions: [], test: null, why: "The shelf idea" },
  ],
  evidence: [
    { fragmentId: "f3", cardId: "@More customers reorder every week", stance: "for", why: "What matters to you" },
    { fragmentId: "f12", cardId: "@I'm never sure when my order will arrive", stance: "for", why: "Late deliveries in support" },
    { fragmentId: "f13", cardId: "@I'm never sure when my order will arrive", stance: "against", why: "You doubt arrival time matters" },
    { fragmentId: "f16", cardId: "@Evening slots are full when I need them", stance: "for", why: "The 8–10pm slots sell out" },
    { fragmentId: "f15", cardId: "@Order again shelf on the home screen", stance: "for", why: "One usual basket button" },
  ],
  assumptions: [{ cardId: "@Order again shelf on the home screen", category: "desirability", text: "Most weeks' baskets are close to one usual basket.", importance: 2, why: "You see the shelf and saved baskets as one" }],
  metrics: [{ cardId: "@More customers reorder every week", name: null, unit: null, direction: null, baseline: null, current: 1.3, target: 1.8, timeframe: null, why: "You're at 1.3 now" }],
  edits: [{ cardId: "@Evening slots are full when I need them", title: "The 8–10pm slots are gone by the time I shop", description: "They sell out by 6, and parents shop after bedtime.", why: "You named the slots and when they go" }],
  moves: [{ cardId: "@More customers reorder every week", parentCard: null, parentNew: "n1", why: "Weekly reorders move the orders goal" }],
  merges: [{ keep: "@Order again shelf on the home screen", drop: "@Saved baskets to reorder in one tap", title: "One usual basket button on the home screen", why: "You see them as the same thing" }],
  notes: [
    { cardId: null, newCard: "n1", kind: "question", text: "Singles: in or out? The board is about parents with young kids for now.", why: "Not sure if we should even care about singles" },
    { cardId: "@I'm never sure when my order will arrive", newCard: null, kind: "challenge", text: "Half the tickets is Omar's guess: count a week of tickets before it decides anything.", why: "Still open" },
  ],
};
