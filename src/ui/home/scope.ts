/**
 * Which part of the organization a page shows: everything, what's for the whole organization, or
 * one product. It rides in the address (?product=), so the sidebar's Products and a reload keep it.
 */
export type Scope = "all" | "org" | (string & {});

export const readScope = (search: string = window.location.search): Scope => new URLSearchParams(search).get("product") ?? "all";

export const inScope = (product: string | null | undefined, scope: Scope) => scope === "all" || (scope === "org" ? !product : product === scope);

/** The query with this scope in it (Everything leaves ?product= out). */
export function withScope(search: string, scope: Scope): string {
  const q = new URLSearchParams(search);
  if (scope === "all") q.delete("product");
  else q.set("product", scope);
  const s = q.toString();
  return s ? `?${s}` : "";
}
