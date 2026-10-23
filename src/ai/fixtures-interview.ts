import type { BriefAnswer } from "@/design-system/interview/sanitize";

/**
 * A recorded interview for when AI isn't configured (and for "Try a sample brief"): a fictional,
 * bilingual savings app. The read-back is shaped like the model's raw answer, so it goes through
 * the same sanitizer; directions come from code; nudges follow a small keyword map.
 */

export const SAMPLE_ANSWERS: BriefAnswer[] = [
  { id: "name", question: "What's it called?", answer: "Lumen" },
  { id: "product", question: "What are you making, and who is it for?", answer: "A savings and spending app for young professionals in the UAE and Saudi Arabia, many of them on their first salary." },
  { id: "feel", question: "How should people feel when they use it?", answer: "Calm and in control. Like a friend who's good with money, never a bank lecturing you." },
  { id: "place", question: "If the brand were a place, what would it be?", answer: "A bright, quiet café on a weekday morning: warm, unhurried, a little modern." },
  { id: "references", question: "Which brands do you admire, and which should it never look like?", answer: "We like Monzo, Revolut's clarity and Linear's precision. Never like a crypto exchange: no neon, no hype." },
  { id: "color", question: "Do you already have a brand colour?", answer: "" },
  { id: "where", question: "Where will people use it, and in which languages?", answer: "Phone app · English, Arabic" },
];

export const SAMPLE_READ_RAW = {
  followUps: [],
  summary: "Lumen is a savings and spending app for young professionals in the Gulf, often on their first salary. It should feel calm and in control, like a friend who's good with money.",
  adjectives: ["calm", "warm", "clear", "trustworthy"],
  domain: "consumer-finance",
  audience: "Young professionals in the Gulf",
  platform: "mobile",
  scripts: ["latin", "arabic"],
  axes: {
    authority: { value: 0.3, confidence: 0.8, evidence: ["Like a friend who's good with money"] },
    serious: { value: 0.5, confidence: 0.5, evidence: ["never a bank lecturing you"] },
    energetic: { value: 0.22, confidence: 0.85, evidence: ["Calm and in control", "no neon, no hype"] },
    compact: { value: 0.3, confidence: 0.4, evidence: ["unhurried"] },
    innovative: { value: 0.6, confidence: 0.45, evidence: ["a little modern"] },
  },
  admired: ["Monzo", "Revolut", "Linear"],
  avoided: ["Crypto exchanges", "Neon colours", "Hype"],
  language: {
    principles: [
      { title: "Calm by default", body: "Show what matters now; keep the rest a tap away." },
      { title: "Plain money talk", body: "Say amounts and dates plainly, never with jargon." },
      { title: "Earned confidence", body: "Every action says what happens next before it happens." },
    ],
    voice: "Warm and plain, like a friend who knows money.",
    dos: ["Generous spacing around balances", "One clear primary action per screen"],
    donts: ["Neon or glowing colours", "Hype words and exclamation marks"],
  },
  slots: {
    brand: "Lumen",
    currency: "AED",
    city: "Dubai",
    people: ["Sara Haddad", "Omar Nasser", "Lina Farouk"],
    places: ["Jumeirah Café", "Dubai Mall", "Business Bay"],
    ar: { brand: "لومن", city: "دبي", people: ["سارة حداد", "عمر ناصر", "لينا فاروق"] },
  },
};

const RULES: [RegExp, { knob: string; to: string }[]][] = [
  [/serious|professional|formal|grown[- ]?up/i, [{ knob: "radius", to: "none" }, { knob: "chroma", to: "muted" }]],
  [/playful|fun|friendl/i, [{ knob: "radius", to: "full" }, { knob: "chroma", to: "vivid" }]],
  [/compact|dense|tight/i, [{ knob: "density", to: "compact" }]],
  [/airy|spacious|roomy|breath/i, [{ knob: "density", to: "spacious" }]],
  [/bold|vibrant|energetic|colou?rful|louder/i, [{ knob: "chroma", to: "bold" }]],
  [/calm|quiet|muted|softer colou?r/i, [{ knob: "chroma", to: "muted" }]],
  [/round|soft/i, [{ knob: "radius", to: "full" }]],
  [/sharp|square|angular/i, [{ knob: "radius", to: "none" }]],
  [/warm/i, [{ knob: "neutralTint", to: "warm" }]],
  [/cool|cold/i, [{ knob: "neutralTint", to: "cool" }]],
  [/shadow|depth|layer/i, [{ knob: "elevation", to: "layered" }]],
  [/flat/i, [{ knob: "elevation", to: "flat" }]],
  [/outline|border/i, [{ knob: "fill", to: "outline" }]],
];

/** A nudge without AI: the first rules that match, as the model would answer. */
export function sampleNudgeRaw(text: string) {
  const deltas = RULES.filter(([re]) => re.test(text))
    .flatMap(([, d]) => d)
    .slice(0, 3)
    .map((d) => ({ ...d, reason: "from your words (sample)" }));
  return { reply: deltas.length ? "Sample: adjusted the knobs your words point to." : "Sample: try words like calmer, bolder, rounder, more compact.", deltas, hueShift: 0 };
}

export const SAMPLE_REVIEW_RAW = {
  summary: "Sample review: the home screen reads calm and clear; the warmth could come through more in the greys.",
  checks: [
    { adjective: "calm", verdict: "reads", observation: "Muted colour and generous spacing around the balance." },
    { adjective: "warm", verdict: "partly", observation: "Rounded controls help, but the greys are cool." },
    { adjective: "clear", verdict: "reads", observation: "One primary action and a plain hierarchy." },
    { adjective: "trustworthy", verdict: "reads", observation: "Steady type and restrained accents." },
  ],
  deltas: [{ knob: "neutralTint", to: "warm", reason: "warmer greys" }],
  hueShift: 0,
};
