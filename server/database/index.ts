import { connectionView, metricViews, type ConnectionView, type MetricView } from "@/database/view";
import type { OrgStore } from "../org/store";

/*
 * A project's database in the core: what the window sees of it (the connection as it may be shown,
 * and each of the team's numbers with where it stands on this computer). The connection itself is
 * connect.ts; reading its layout, drafting and checking the numbers, and reading them, sit beside it.
 */

export interface DatabaseView {
  connection: ConnectionView | null;
  metrics: MetricView[];
}

export async function databaseView(store: OrgStore): Promise<DatabaseView> {
  const local = store.databaseLocal;
  const file = await store.getMetrics();
  return { connection: connectionView(local), metrics: metricViews(file.metrics, local) };
}
