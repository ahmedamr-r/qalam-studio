import type { Connection } from "@/database/connection";
import { DatabaseError, type Runner } from "./runner";

/** A MySQL database, read straight from the core (mysql2). */
export async function openMysql(_t: { conn: Connection; ca?: string }): Promise<Runner> {
  throw new DatabaseError("Qalam doesn't read MySQL yet.");
}
