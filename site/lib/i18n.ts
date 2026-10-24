export const locales = ["en", "ar"] as const;
export type Locale = (typeof locales)[number];

export const hasLocale = (value: string): value is Locale => (locales as readonly string[]).includes(value);
export const dirOf = (locale: Locale) => (locale === "ar" ? "rtl" : "ltr");
export const otherLocale = (locale: Locale): Locale => (locale === "ar" ? "en" : "ar");

/** Quote marks as each language writes them: “…” in English, «…» in Arabic. */
export const quoted = (text: string, locale: Locale) => (locale === "ar" ? `«${text}»` : `“${text}”`);

export const REPO = "https://github.com/ahmedamr-r/qalam-studio";
export const CLONE = `git clone ${REPO}.git`;
