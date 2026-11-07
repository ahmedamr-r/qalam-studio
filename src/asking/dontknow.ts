/**
 * Whether an answer says they don't know (pure, and deliberately strict). It must lead with a don't-know
 * or don't-have phrase, in English or Arabic (standard, Gulf, Egyptian, Levantine), carry no figure, not
 * be a guess ("maybe", "around", "I think"…), and be short. Anything else stays their words: "Nothing on
 * this yet" is an answer, "None of these" is a choice, and "maybe 9% of ARR" is a figure they gave.
 * A don't-know is never a quote and never what a card rests on, so a miss costs a repeat question; a
 * false hit would lose what they said, which is why it leans the other way.
 */

/** After this many answers in a row that they don't know, a turn asks no more facts: only what they can decide. */
export const DONT_KNOW_STREAK = 3;

const MAX_WORDS = 25;
const DIGITS = /[0-9٠-٩۰-۹]/;
const HEDGE_EN = /\b(maybe|probably|perhaps|around|roughly|approximately|i think|i guess|i'?d guess|my guess|might be|could be|likely|i believe|guessing)\b/i;
const HEDGE_AR = /(يمكن|ربما|تقريبا|احتمال|اظن|اعتقد|اتوقع|غالبا)/;
/** Words people start with before saying it. */
const LEAD_EN = /^(?:(?:honestly|frankly|well|hmm+|um+|uh+|ok(?:ay)?|so|sorry|ah|oh|to be honest|tbh)[,.!\s]+)+/i;
const LEAD_AR = /^(?:(?:والله|صراحه|بصراحه|للاسف|اسف|اه|امم+)[،,.!\s]+)+/;

const EN = new RegExp(
  [
    // I don't know / we don't have that / we don't track it
    String.raw`^(?:i\s+|we\s+)?(?:really\s+|honestly\s+|just\s+|truly\s+)?(?:do\s*n[o'’]?t|do\s+not)\s+(?:really\s+|actually\s+|yet\s+)?(?:know|have\s+(?:that|it|this|those|these|them|a\s+clue|any\s+idea|the\s+(?:number|numbers|data|figure|figures|details?))|track(?:\s+(?:that|it|this))?|measure(?:\s+(?:that|it|this))?)\b`,
    // no idea / no clue / I have no idea
    String.raw`^(?:i\s+have\s+|we\s+have\s+)?no\s+(?:idea|clue)\b`,
    // not sure / I'm not sure / we're not really sure
    String.raw`^(?:i'?m\s+|i\s+am\s+|we'?re\s+|we\s+are\s+)?(?:really\s+)?not\s+(?:really\s+|quite\s+)?sure\b`,
    String.raw`^dunno\b`,
    String.raw`^idk\b`,
    // I wouldn't know / I can't say
    String.raw`^(?:i|we)\s+(?:wouldn[o'’]?t|would\s+not|couldn[o'’]?t|could\s+not|can[o'’]?t|cannot)\s+(?:really\s+)?(?:know|say|tell)\b`,
    // we haven't measured / asked
    String.raw`^(?:i\s+|we\s+)?(?:have\s*n[o'’]?t|have\s+not|never)\s+(?:measured|tracked|checked|asked|looked)\b`,
    String.raw`^(?:no\s+data|unknown|not\s+known|hard\s+to\s+say|no\s*one\s+knows|nobody\s+knows|can[o'’]?t\s+say)\b`,
  ].join("|"),
  "i",
);

const AR = new RegExp(
  "^(?:" +
    [
      String.raw`ما\s*ادري`,
      "مادري",
      "مدري",
      String.raw`ما\s*اعرف(?:ش)?`,
      String.raw`ما\s*نعرف`,
      String.raw`ما\s*بعرف(?:ش)?`,
      String.raw`ما\s*بنعرف`,
      String.raw`مش\s*عارف(?:ين|ه)?`,
      "معرفش",
      "ماعرفش",
      String.raw`لا\s*اعرف`,
      String.raw`لا\s*نعرف`,
      String.raw`لا\s*ادري`,
      String.raw`لست\s*متاكد`,
      String.raw`مش\s*متاكد`,
      String.raw`غير\s*متاكد`,
      String.raw`ما\s*عند(?:ي|نا)\s*(?:اي\s*)?(?:فكره|علم|معلومه|معلومات|رقم|ارقام|بيانات)`,
      String.raw`ليس\s*لدي(?:نا)?\s*(?:اي\s*)?(?:فكره|علم|معلومات|ارقام|بيانات)`,
      String.raw`لا\s*فكره`,
    ].join("|") +
    ")",
);

/** Arabic as it's written loosely: no marks or stretching, one alef, ى as ي, ة as ه. */
const arabic = (s: string) =>
  s
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");

export function saysDontKnow(text: string): boolean {
  const t = arabic(text.replace(/\s+/g, " ").trim());
  if (!t || DIGITS.test(t) || HEDGE_EN.test(t) || HEDGE_AR.test(t)) return false;
  if (t.split(" ").length > MAX_WORDS) return false;
  return EN.test(t.replace(LEAD_EN, "")) || AR.test(t.replace(LEAD_AR, ""));
}
