import type { Layout } from "@/database/layout";
import { connectionView, layoutSummary, metricViews, type DatabaseView, type LayoutSummary } from "@/database/view";
import type { OrgStore } from "../org/store";
import { withDatabase, type Opener } from "./connect";
import { getDrafts, getLayout, putLayout } from "./files";
import { readPostgresLayout } from "./layout";

/*
 * A project's database in the core: what the window sees of it (the connection as it may be shown,
 * and each of the team's numbers with where it stands on this computer). The connection itself is
 * connect.ts; reading its layout, drafting and checking the numbers, and reading them, sit beside it.
 */

export type { DatabaseView } from "@/database/view";

export async function databaseView(store: OrgStore): Promise<DatabaseView> {
  const local = store.databaseLocal;
  const file = await store.getMetrics();
  const layout = local ? await getLayout(store) : null;
  return { connection: connectionView(local), layout: layout ? layoutSummary(layout) : null, drafts: local ? await getDrafts(store) : null, metrics: metricViews(file.metrics, local) };
}

/** Read the database's layout again, with no tokens, and keep it on this computer. */
export async function readLayout(store: OrgStore, o: { emit?: (label: string) => void; signal?: AbortSignal; open?: Opener } = {}): Promise<LayoutSummary> {
  return withDatabase(
    store,
    async (r, local) => {
      if (r.dialect === "mysql") {
        const { readMysqlLayout } = await import("./mysql-layout");
        return keepLayout(store, await readMysqlLayout(r, { emit: o.emit, signal: o.signal, version: local.version }), local.where);
      }
      return keepLayout(store, await readPostgresLayout(r, { hidden: local.hidden, version: local.version, emit: o.emit, signal: o.signal }), local.where);
    },
    { open: o.open },
  );
}

async function keepLayout(store: OrgStore, layout: Layout, where: string): Promise<LayoutSummary> {
  await putLayout(store, layout, where);
  await store.changeDatabaseLocal((d) => (d ? { ...d, readAt: layout.at } : d));
  return layoutSummary(layout);
}
