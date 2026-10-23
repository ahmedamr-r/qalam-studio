import type { ScanResult } from "./ds-schemas";

/**
 * The first look at the bundled sample screenshot (public/samples/lumen-wallet.png), written by
 * hand from the image. Used when AI is off or for "Try the sample"; the candidates match the new
 * components in the recorded guide (src/ai/fixtures/ds-guide.json) so picks can be honoured.
 */
export const SAMPLE_DS_SCAN: ScanResult = {
  product: "Lumen Wallet",
  platform: "mobile",
  look: "Soft lavender canvas with white rounded cards, a violet-to-magenta gradient hero, flat deep-violet actions, pill-light radii (16–24px) and a friendly geometric sans.",
  components: [
    { name: "SearchBar", images: [1], count: 1, evidence: "“Search transactions” field under the balance card" },
    { name: "Button", images: [1], count: 4, evidence: "Top up, Send and Swap in the balance card; Pay a bill at the bottom" },
    { name: "ChipGroup", images: [1], count: 1, evidence: "All / Income / Spending / Bills filters" },
    { name: "Card", images: [1], count: 2, evidence: "Balance hero card and the Recent activity card" },
    { name: "ListItem", images: [1], count: 3, evidence: "Brew & Co., Salary and City Ride rows" },
    { name: "Avatar", images: [1], count: 1, evidence: "“LA” initials, top right" },
    { name: "Divider", images: [1], count: 2, evidence: "Hairlines between the activity rows" },
    { name: "BottomNav", images: [1], count: 1, evidence: "Home, Cards, Insights, Profile" },
    { name: "MediaPlaceholder", images: [1], count: 3, evidence: "Emoji tiles leading each activity row" },
  ],
  candidates: [
    { name: "Balance hero card", description: "Gradient card with the total balance and three translucent quick actions (Card, Text, Button).", images: [1] },
    { name: "Greeting header", description: "“Good morning / Hi, Layla” with the avatar on the trailing side (Stack, Text, Avatar).", images: [1] },
    { name: "Filter rail", description: "Horizontal filter chips with a dark selected chip (ChipGroup in a Stack).", images: [1] },
    { name: "Section header row", description: "Section title with a trailing “See all” link (Stack, Text, Button).", images: [1] },
  ],
  recommendation: { fetch: "components", why: "One home screen shows a coherent set of nine components; the rest of the catalog would be guesses." },
  questions: [
    {
      id: "ai-1",
      text: "Which is the primary action colour: the flat violet of “Pay a bill” or the balance card's violet-to-magenta gradient?",
      why: "It decides what every primary button and highlight is filled with.",
      options: ["Flat violet", "The gradient", "Gradient for heroes, violet for buttons"],
      recommended: "Gradient for heroes, violet for buttons",
    },
    {
      id: "ai-2",
      text: "Is the green of “+AED 9,200” the system's success colour, or only for incoming money?",
      why: "It sets the success role used by alerts, tags and confirmations.",
      options: ["Success colour", "Only incoming amounts"],
      recommended: "Success colour",
    },
  ],
};
