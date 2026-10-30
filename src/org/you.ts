import { create } from "zustand";
import { orgJson } from "./client";

/**
 * Who works on this computer, as the team names them: decisions and comments carry it, so a team
 * sharing the organization's folder (through Git) can see who decided and who asked. Kept with
 * this computer's local state, never in the shared files.
 */

export const useYou = create<{ name: string | null; loaded: boolean }>(() => ({ name: null, loaded: false }));

export async function loadYou() {
  const r = await orgJson<{ name: string | null }>("/you").catch(() => ({ name: null }));
  useYou.setState({ name: r.name, loaded: true });
}

export async function setYou(name: string | null) {
  const r = await orgJson<{ name: string | null }>("/you", { method: "PUT", json: { name } });
  useYou.setState({ name: r.name });
}
