import type { Locale } from "@/lib/i18n";
import { ar } from "./ar";
import { en, type Copy } from "./en";

export const copy: Record<Locale, Copy> = { en, ar };
export type { Copy };
