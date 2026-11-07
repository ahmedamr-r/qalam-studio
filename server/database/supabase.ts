import type { DatabaseLocal } from "@/database/local";
import { DatabaseError, type Runner } from "./runner";

/** A Supabase project, read through Supabase's own MCP server. */
export async function openSupabase(_local: DatabaseLocal): Promise<Runner> {
  throw new DatabaseError("Qalam doesn't read Supabase yet.");
}
