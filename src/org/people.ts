import { nanoid } from "nanoid";
import { create } from "zustand";
import type { Person } from "@/hub/people";
import { orgFetch, orgJson } from "./client";
import { useOrgContext } from "./context";

/**
 * The people the organization hears from (people/*.md), loaded when a window opens and kept
 * current as they change elsewhere. Sources say which of them is in each (src/hub/people.ts).
 */

export const usePeople = create<{ people: Person[]; loaded: boolean }>(() => ({ people: [], loaded: false }));

export async function loadPeople() {
  const people = await orgJson<Person[]>("/people").catch(() => [] as Person[]);
  usePeople.setState({ people, loaded: true });
}

export const personById = (id: string | null | undefined) => (id ? usePeople.getState().people.find((p) => p.id === id) : undefined);

export const newPerson = (name: string, segments: string[] = []): Person => ({ id: nanoid(10), name: name.replace(/\s+/g, " ").trim().slice(0, 80), segments });

export async function savePerson(p: Person) {
  usePeople.setState((s) => ({ people: [...s.people.filter((x) => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name)) }));
  await orgFetch(`/people/${p.id}`, { method: "PUT", json: p });
}

export async function removePerson(id: string) {
  usePeople.setState((s) => ({ people: s.people.filter((x) => x.id !== id) }));
  await orgFetch(`/people/${id}`, { method: "DELETE" });
}

/** Every segment the organization and its products name (each once, as first written), for picking. */
export function knownSegments(product?: string | null): string[] {
  const { about, products } = useOrgContext.getState();
  const own = product ? (products.find((p) => p.id === product)?.segments ?? []) : [];
  const rest = [...about.segments, ...products.flatMap((p) => p.segments), ...usePeople.getState().people.flatMap((p) => p.segments)];
  const out: string[] = [];
  for (const s of [...own, ...rest]) if (s.trim() && !out.some((x) => x.toLowerCase() === s.trim().toLowerCase())) out.push(s.trim());
  return out;
}
