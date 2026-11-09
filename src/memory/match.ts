/**
 * Whether two questions ask the same thing (pure, words only, English and Arabic): a key of each
 * question's telling words, numbers kept whole ("9%" is a word here, where other matching drops it),
 * question words and generic words out, plurals as one, Arabic written loosely, and the project's
 * avoided words read as its terms (`fold`). Exact: the same key. Near: two telling words or more in
 * common besides the product itself (`PRODUCT`), most of the shorter one's, and no number one has that
 * the other contradicts. Only exact may stand in for a question; near only shows what was said beside it.
 * `pnpm eval:memory` holds the thresholds to a labelled set of question pairs from the bench.
 */

export const MATCH = { nearShared: 2, nearShare: 0.75 } as const;

/**
 * The product itself, which every product's questions name: "Who orders from the app most?" and "How does
 * the app earn on an order?" share only the app and its orders. It stays in a key, so an exact match still
 * needs the same one (orders in the app aren't orders on the website), but it's never one of the two words
 * in common a near match needs.
 */
const PRODUCT = new Set(["app", "apps", "application", "platform", "product", "website", "تطبيق", "تطبيقات", "منصه", "منصات", "منتج", "منتجات"]);

/** Words that set where a question stands: a current number and a target one aren't the same question. */
const STANCE = new Set(["target", "goal", "aim", "plan", "planned", "expect", "expected", "hope", "ideal", "future", "next", "previous", "last", "before", "past", "forecast", "budget", "هدف", "المستهدف", "مستهدف", "خطه", "القادم", "السابق"]);
const stanceOf = (q: string) => new Set(arabic(q.toLowerCase()).split(/[^\p{L}\p{N}%]+/u).filter((w) => STANCE.has(w) || STANCE.has(w.replace(/^ال/u, ""))));
const sameStance = (a: string, b: string) => {
  const x = stanceOf(a);
  const y = stanceOf(b);
  return x.size === y.size && [...x].every((w) => y.has(w));
};

const STOP = new Set(
  (
    "a about an and are aren as at be been but by can could did didn do does doesn don for from had has have how i if in into is it its may might me my now of on or our should so that the their them then there these they this to today was we were what when where which while who whom whose why will with would you your yours currently current right " +
    // Arabic: question words, particles, pronouns
    "ما ماذا ماهو ماهي من هل كيف كم متى اين لماذا ليش وش ايش شو مين وين كيفاش في على عن الى إلى من مع او أو و ف ب ل هو هي هم انت انتم احنا نحن عندك عندكم الان حاليا اليوم"
  ).split(" "),
);
const GENERIC = new Set(
  "thing things something anything really still even ever every always get gets got make makes made take takes see say said tell told know knew think want wants going come came use used using most more much many lot lots kind kinds sort type types way ways number numbers".split(" "),
);

/** Arabic as it's written loosely: no marks or stretching, one alef, ى as ي, ة as ه, Arabic-Indic digits as digits. */
const arabic = (s: string) =>
  s
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

const isNumber = (w: string) => /^\d/.test(w);
const singular = (w: string) => (isNumber(w) || w.length <= 4 ? w : w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** A question's telling words, as a set: what matching compares. */
export function questionKey(q: string, fold?: (s: string) => string): Set<string> {
  const t = arabic((fold ? fold(q) : q).toLowerCase()).replace(/(\d)[,.](?=\d)/g, "$1·");
  const out = new Set<string>();
  for (const raw of t.split(/[^\p{L}\p{N}%·]+/u)) {
    const w = raw.replace(/·/g, ".").replace(/^ال(?=\p{L}{3})/u, "");
    if (!w || STOP.has(w) || GENERIC.has(w) || (!isNumber(w) && w.length < 3)) continue;
    out.add(singular(w));
  }
  return out;
}

const numbersOf = (k: Set<string>) => [...k].filter(isNumber);

export type Match = "exact" | "near" | null;

/** Whether two questions ask the same thing: exactly, nearly, or not. */
export function matchQuestions(a: string, b: string, fold?: (s: string) => string): Match {
  const x = questionKey(a, fold);
  const y = questionKey(b, fold);
  if (!x.size || !y.size || !sameStance(a, b)) return null;
  const shared = [...x].filter((w) => y.has(w));
  if (shared.length === x.size && x.size === y.size) return "exact";
  // A number one names and the other doesn't share: two different things (a 9% and a 38%).
  const nx = numbersOf(x);
  const ny = numbersOf(y);
  if (nx.length && ny.length && !nx.some((n) => ny.includes(n))) return null;
  if (shared.filter((w) => !PRODUCT.has(w)).length < MATCH.nearShared) return null;
  // A number both name is the surest sign they're about the same thing: it counts twice.
  const weight = shared.reduce((n, w) => n + (isNumber(w) ? 2 : 1), 0);
  return weight / Math.min(x.size, y.size) >= MATCH.nearShare ? "near" : null;
}
