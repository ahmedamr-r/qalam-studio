import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";

import { copy } from "@/content";
import { dirOf, hasLocale, locales } from "@/lib/i18n";

import "../globals.css";

const sans = localFont({ src: "../fonts/CubitSans-Variable.woff2", variable: "--font-cubit", display: "swap", weight: "100 900" });
const mono = localFont({ src: "../fonts/CubitMono-Variable.woff2", variable: "--font-cubit-mono", display: "swap", weight: "100 900" });
const arabic = localFont({
  src: [
    { path: "../fonts/IBMPlexSansArabic-400.woff2", weight: "400" },
    { path: "../fonts/IBMPlexSansArabic-600.woff2", weight: "600" },
  ],
  variable: "--font-plex-ar",
  display: "swap",
});

export const dynamicParams = false;
export const generateStaticParams = () => locales.map((lang) => ({ lang }));

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3202";

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = copy[lang].meta;
  return {
    metadataBase: new URL(SITE),
    title: t.title,
    description: t.description,
    alternates: { canonical: `/${lang}`, languages: { en: "/en", ar: "/ar" } },
    openGraph: { title: t.title, description: t.description, type: "website", locale: lang === "ar" ? "ar" : "en_US" },
    twitter: { card: "summary_large_image", title: t.title, description: t.description },
  };
}

export const viewport: Viewport = { themeColor: "#090908", colorScheme: "dark" };

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return (
    <html lang={lang} dir={dirOf(lang)} className={`${sans.variable} ${mono.variable} ${arabic.variable}`} suppressHydrationWarning>
      <head>
        {/* Motion hides a few things until their entrance runs; without JS they stay visible. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
