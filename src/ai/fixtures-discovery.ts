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
