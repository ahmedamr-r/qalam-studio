import { nanoid } from "nanoid";
import { secrets } from "../secrets";

/*
 * Qalam's own sign-in to GitHub, read-only: the Qalam GitHub App (Contents and Metadata, read
 * only) through GitHub's device flow, which needs only the app's public client ID. The person
 * enters a code on github.com; the token and its refresh go in the Keychain and only ever in a
 * request's header. A token reaches only what both the person and the app can reach.
 */

const KEY = "connector:github:oauth";
const clientId = () => process.env.QALAM_GITHUB_CLIENT_ID?.trim() || "";

/** Whether Qalam's GitHub App is registered here (its client ID is known). */
export const githubAppReady = () => !!clientId();

interface Kept {
  access_token: string;
  refresh_token?: string;
  /** When the access token stops working (ms). */
  expires_at?: number;
}

async function post(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "user-agent": "Qalam Studio" }, body: JSON.stringify(body) });
  return ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

// Sign-ins under way, by the id the window polls with: the device code never leaves the core.
const flows = new Map<string, { device: string; interval: number; until: number }>();

/** Start signing in: the code to enter on github.com, and where. */
export async function startGitHubSignIn(): Promise<{ id: string; code: string; url: string; interval: number }> {
  if (!clientId()) throw new Error("Qalam's GitHub App isn't registered yet: use this Mac's GitHub CLI or a folder.");
  const r = await post("https://github.com/login/device/code", { client_id: clientId() });
  if (typeof r.device_code !== "string" || typeof r.user_code !== "string") throw new Error(typeof r.error_description === "string" ? r.error_description : "GitHub didn't start the sign-in.");
  const id = nanoid(12);
  const interval = Math.max(5, Number(r.interval) || 5);
  flows.set(id, { device: r.device_code, interval, until: Date.now() + (Number(r.expires_in) || 900) * 1000 });
  return { id, code: r.user_code, url: typeof r.verification_uri === "string" ? r.verification_uri : "https://github.com/login/device", interval };
}

/** Whether the person has entered the code yet; once they have, the token is kept. */
export async function pollGitHubSignIn(id: string): Promise<"pending" | "done" | "expired" | "denied"> {
  const f = flows.get(id);
  if (!f || Date.now() > f.until) return flows.delete(id), "expired";
  const r = await post("https://github.com/login/oauth/access_token", { client_id: clientId(), device_code: f.device, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  if (r.error === "authorization_pending" || r.error === "slow_down") return "pending";
  flows.delete(id);
  if (r.error === "access_denied") return "denied";
  if (typeof r.access_token !== "string") return "expired";
  await keep(r);
  return "done";
}

async function keep(r: Record<string, unknown>) {
  const kept: Kept = { access_token: r.access_token as string, ...(typeof r.refresh_token === "string" ? { refresh_token: r.refresh_token } : {}), ...(Number(r.expires_in) ? { expires_at: Date.now() + Number(r.expires_in) * 1000 } : {}) };
  await secrets().set(KEY, JSON.stringify(kept));
}

/** The token to read a repository with (refreshed when it has run out), or null when not signed in. */
export async function githubToken(): Promise<string | null> {
  const raw = await secrets().get(KEY).catch(() => null);
  if (!raw) return null;
  let kept: Kept;
  try {
    kept = JSON.parse(raw) as Kept;
  } catch {
    return null;
  }
  if (!kept.expires_at || kept.expires_at - 60_000 > Date.now()) return kept.access_token;
  if (!kept.refresh_token || !clientId()) return null;
  const r = await post("https://github.com/login/oauth/access_token", { client_id: clientId(), grant_type: "refresh_token", refresh_token: kept.refresh_token });
  if (typeof r.access_token !== "string") {
    await secrets().remove(KEY).catch(() => {});
    return null;
  }
  await keep(r);
  return r.access_token;
}

export const githubSignedIn = async () => !!(await secrets().get(KEY).catch(() => null));
export const forgetGitHub = () => secrets().remove(KEY).catch(() => {});
