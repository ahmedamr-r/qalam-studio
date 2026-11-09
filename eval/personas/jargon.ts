/**
 * Product and business words someone new to them may not know: the bench counts any the consultant asks
 * a newcomer with no word of explanation (src/consult/). English, and the Arabic ones that turn up.
 */

export const JARGON = [
  "conversion rate",
  "conversion",
  "retention",
  "churn",
  "funnel",
  "cohort",
  "activation",
  "lifetime value",
  "LTV",
  "CAC",
  "acquisition cost",
  "AOV",
  "average order value",
  "north star",
  "KPI",
  "OKR",
  "MVP",
  "product-market fit",
  "PMF",
  "A/B test",
  "segment",
  "persona",
  "jobs to be done",
  "JTBD",
  "TAM",
  "unit economics",
  "margin",
  "ARPU",
  "MRR",
  "ARR",
  "NPS",
  "drop-off",
  "abandonment",
  "attribution",
  "CTR",
  "value proposition",
  "go-to-market",
  "معدل التحويل",
  "الاحتفاظ",
  "قمع المبيعات",
  "شريحة العملاء",
  "مؤشر الأداء",
  "تكلفة الاستحواذ",
  "متوسط قيمة الطلب",
] as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RE = new RegExp(`(?<![\\p{L}\\p{N}])(${[...JARGON].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\p{L}\\p{N}])`, "giu");

/** The jargon in some words, each once, as the list writes it. */
export function jargonIn(text: string): string[] {
  const out = new Map<string, string>();
  for (const m of text.matchAll(RE)) {
    const hit = JARGON.find((j) => j.toLowerCase() === m[1].toLowerCase()) ?? m[1];
    out.set(hit.toLowerCase(), hit);
  }
  return [...out.values()];
}
