import { notFound } from "next/navigation";

import { Landing } from "@/components/Landing";
import { hasLocale } from "@/lib/i18n";

export default async function Page({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <Landing locale={lang} />;
}
