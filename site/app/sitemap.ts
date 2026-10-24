import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3202";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["en", "ar"].map((lang) => ({
    url: `${SITE}/${lang}`,
    alternates: { languages: { en: `${SITE}/en`, ar: `${SITE}/ar` } },
  }));
}
