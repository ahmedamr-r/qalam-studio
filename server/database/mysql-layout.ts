import type { Layout } from "@/database/layout";
import { DatabaseError, type Runner } from "./runner";

/** MySQL's layout, from information_schema. */
export async function readMysqlLayout(_r: Runner, _o: { emit?: (label: string) => void; signal?: AbortSignal } = {}): Promise<Layout> {
  throw new DatabaseError("Qalam doesn't read MySQL yet.");
}
