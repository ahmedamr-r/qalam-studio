import type { Person } from "@/hub/people";
import { frontMatter, readFrontMatter } from "./context-md";

/**
 * A person the organization hears from, as a Markdown file people can read and edit
 * (people/<slug>.md): their id, name, segments and role on top, notes below.
 */

export function personToMarkdown(p: Person): string {
  return `${frontMatter({ id: p.id, name: p.name, segments: p.segments, ...(p.role ? { role: p.role } : {}) })}${p.notes?.trim() ? `${p.notes.trim()}\n` : ""}`;
}

export function personFromMarkdown(md: string): Person | null {
  const { fields, body } = readFrontMatter(md.replace(/\r\n/g, "\n"));
  if (typeof fields.id !== "string" || !fields.id) return null;
  const segments = Array.isArray(fields.segments) ? fields.segments.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()) : typeof fields.segments === "string" && fields.segments.trim() ? [fields.segments.trim()] : [];
  return {
    id: fields.id,
    name: typeof fields.name === "string" && fields.name.trim() ? fields.name.trim() : "Someone",
    segments,
    ...(typeof fields.role === "string" && fields.role.trim() ? { role: fields.role.trim() } : {}),
    ...(body.trim() ? { notes: body.trim() } : {}),
  };
}
