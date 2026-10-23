import { MAX_SOURCE_TEXT } from "@/discovery/sources";

/*
 * Plain text as a source keeps it (pure): line endings unified, control characters and trailing
 * spaces gone, runs of blank lines shortened. The words themselves are never touched, since quotes
 * are checked against them.
 */

export function cleanText(raw: string): string {
  return raw
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t ]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A text no longer than a source keeps, and whether it was cut. */
export function capText(text: string): { text: string; truncated?: boolean } {
  if (text.length <= MAX_SOURCE_TEXT) return { text };
  // Cut at a paragraph near the limit.
  const cut = text.lastIndexOf("\n\n", MAX_SOURCE_TEXT);
  return { text: text.slice(0, cut > MAX_SOURCE_TEXT * 0.9 ? cut : MAX_SOURCE_TEXT), truncated: true };
}

/** A connected tool's result as text a person can read: JSON becomes "key: value" lines, the rest stays as it came. */
export function captureText(raw: string): string {
  const t = raw.trim();
  if (!/^[[{]/.test(t)) return cleanText(raw);
  let data: unknown;
  try {
    data = JSON.parse(t);
  } catch {
    return cleanText(raw);
  }
  const lines: string[] = [];
  const walk = (v: unknown, label: string) => {
    if (typeof v === "string") {
      // Ids and links aren't anyone's words.
      if (v.trim() && !/^(https?:\/\/\S+|[0-9a-f-]{20,})$/i.test(v.trim())) lines.push(label ? `${label}: ${v.trim()}` : v.trim());
    } else if (typeof v === "number" || typeof v === "boolean") {
      if (label) lines.push(`${label}: ${v}`);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, label));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(data, "");
  return cleanText(lines.join("\n\n"));
}

/** A capture's title: a "Title:" line near its top, else its first line when that reads like one, else what was looked up. */
export function captureTitle(text: string, fallback: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 15);
  const fits = (t: string) => t.length >= 3 && t.length <= 90;
  const named = lines.map((l) => /^title:\s*(.+)$/i.exec(l)?.[1]?.trim() ?? "").find(fits);
  if (named) return named;
  // A heading, not a label for what follows ("Detailed Results:").
  const first = lines[0]?.replace(/^#+\s*/, "") ?? "";
  return fits(first) && !first.endsWith(":") ? first : fallback.replace(/^[^·]+·\s*/, "").slice(0, 120);
}
