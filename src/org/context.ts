import { nanoid } from "nanoid";
import { create } from "zustand";
import { contextText, emptyContext, type ContextFields, type Product } from "./context-md";
import { orgFetch, orgJson } from "./client";

/**
 * What the organization and its products are (about.md, products/*.md), loaded when a window
 * opens and kept current as they change elsewhere. Boards and sources belong to a product or to
 * the whole organization; Qalam AI is told about the one a board is for.
 */

export interface OrgContext {
  about: ContextFields;
  products: Product[];
  loaded: boolean;
}

export const useOrgContext = create<OrgContext>(() => ({ about: emptyContext(), products: [], loaded: false }));

export async function loadOrgContext() {
  const [about, products] = await Promise.all([orgJson<ContextFields>("/about").catch(() => emptyContext()), orgJson<Product[]>("/products").catch(() => [] as Product[])]);
  useOrgContext.setState({ about, products, loaded: true });
}

export const productOf = (id: string | null | undefined) => (id ? useOrgContext.getState().products.find((p) => p.id === id) : undefined);

export const newProduct = (name: string): Product => ({ id: nanoid(10), name: name.trim().slice(0, 80), ...emptyContext() });

export async function saveProduct(p: Product) {
  useOrgContext.setState((s) => ({ products: [...s.products.filter((x) => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name)) }));
  await orgFetch(`/products/${p.id}`, { method: "PUT", json: p });
}

/** Delete a product: its boards and sources become the whole organization's. */
export async function removeProduct(id: string) {
  useOrgContext.setState((s) => ({ products: s.products.filter((x) => x.id !== id) }));
  await orgFetch(`/products/${id}`, { method: "DELETE" });
}

export async function saveAbout(about: ContextFields) {
  useOrgContext.setState({ about });
  await orgFetch("/about", { method: "PUT", json: about });
}

/** What Qalam AI is told about a board's product (and the organization around it), or about the organization alone. */
export function contextFor(productId: string | null | undefined): string {
  const { about } = useOrgContext.getState();
  const p = productOf(productId);
  return [p ? contextText(p, `The product (${p.name}):`) : "", contextText(about, "The organization:")].filter(Boolean).join("\n\n");
}
