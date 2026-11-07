import type { Drafts } from "@/database/draft";
import type { Layout } from "@/database/layout";
import { atomicWrite, readJson } from "../org/fsx";
import type { OrgStore } from "../org/store";

/*
 * What this computer keeps of its database (.qalam/database, out of Git): the layout it last read and
 * the drafts waiting on it, each with the database it came from, so a reconnect to another database
 * never shows the old one's.
 */

export async function getLayout(store: OrgStore): Promise<Layout | null> {
  const l = await readJson<Layout & { where?: string }>(store.databaseFile("layout"));
  return l && l.where === store.databaseLocal?.where ? l : null;
}

export const putLayout = (store: OrgStore, l: Layout, where: string) => atomicWrite(store.databaseFile("layout"), JSON.stringify({ ...l, where }));

export async function getDrafts(store: OrgStore): Promise<Drafts | null> {
  const d = await readJson<Drafts>(store.databaseFile("drafts"));
  return d && d.where === store.databaseLocal?.where ? d : null;
}

export const putDrafts = (store: OrgStore, d: Drafts) => atomicWrite(store.databaseFile("drafts"), JSON.stringify(d));
