import type { Doc } from "@/doc/schema";
import { boardsInSpace } from "@/space/members";
import type { OrgStore } from "./store";

export interface SpaceBoardAt {
  id: string;
  name: string;
  product: string | null;
  /** The document's version, which a save names (src/space). */
  version: string;
  doc: Doc | null;
}

/** The boards a space's canvas holds, each with its whole document (src/space/members.ts). */
export async function spaceBoards(store: OrgStore, space: string | null): Promise<SpaceBoardAt[]> {
  const projects = store.listProjects();
  const ids = boardsInSpace(projects, (await store.getGoals()).goals, space);
  const out: SpaceBoardAt[] = [];
  for (const id of ids) {
    const p = projects.find((x) => x.id === id)!;
    const d = await store.getDoc(id).catch(() => null);
    if (d) out.push({ id, name: p.name, product: p.product ?? null, version: d.version, doc: d.doc });
  }
  return out;
}
