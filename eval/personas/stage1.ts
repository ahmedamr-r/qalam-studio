/** Questions with a known answer, to see the player say only what it's asked: an expected topic id, or null where nothing should come out. */
export const CANNED: { persona: string; questions: { q: string; expect: string | null }[] }[] = [
  {
    persona: "a3",
    questions: [
      { q: "What are most of your support tickets about?", expect: "mix" },
      { q: "How many tickets do you get a month?", expect: "volume" },
      { q: "What have you already tried to bring tickets down?", expect: "tried" },
      { q: "How many engineers can work on this?", expect: "capacity" },
      { q: "Why does your VP want a chatbot specifically?", expect: "why" },
      { q: "How has customer satisfaction with support changed lately?", expect: "csat" },
      { q: "Tell me more about your business.", expect: null },
      { q: "What's your favourite colour?", expect: null },
    ],
  },
  {
    persona: "b2",
    questions: [
      { q: "What's your monthly churn rate?", expect: "churn" },
      { q: "How many signups do you get, and how many activate?", expect: "activation" },
      { q: "How many paying accounts do you have?", expect: "accounts" },
      { q: "Why do customers leave?", expect: "why" },
      { q: "Anything else I should know?", expect: null },
    ],
  },
  {
    persona: "c1",
    questions: [
      { q: "What do you want to build?", expect: "idea" },
      { q: "What have you worked on before?", expect: "work" },
      { q: "Who do you know who could try something early?", expect: "access" },
      { q: "How much do you want this to earn?", expect: "goal" },
      { q: "Who would pay for it?", expect: "pay" },
    ],
  },
  {
    persona: "a4",
    questions: [
      { q: "ليش تفشل محاولات التسليم غالبا؟", expect: "cause" },
      { q: "كم مهندس عندكم؟", expect: "capacity" },
      { q: "وش جربتوا قبل؟", expect: "tried" },
      { q: "وش يسوون المنافسين؟", expect: "rivals" },
      { q: "How much does a failed attempt cost you?", expect: "money" },
    ],
  },
];
