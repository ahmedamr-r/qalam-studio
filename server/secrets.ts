import { execFile, spawn } from "node:child_process";

/*
 * Secrets this computer keeps for Qalam (a Claude API key, a connector's token), in the macOS
 * Keychain under the service "Qalam Studio". The core asks the Keychain itself through
 * /usr/bin/security, so it works the same in the desktop app, `pnpm dev` and browser mode. A value
 * goes in on the tool's stdin, never as an argument (`ps` shows arguments to everyone on the Mac).
 * QALAM_SECRETS=memory keeps them in memory (tests); elsewhere than a Mac there's no store, and a
 * key comes from the environment as before. Claude Code's own Keychain item is never read.
 */

export const SERVICE = "Qalam Studio";
const SECURITY = "/usr/bin/security";
/** `security` exits with this when there's no such item. */
const NOT_FOUND = 44;

export interface Secrets {
  /** False where nothing can be stored (a key comes from the environment there). */
  readonly available: boolean;
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export class NoSecretStore extends Error {
  constructor() {
    super("This computer has nowhere safe to keep it: set it in the environment instead.");
  }
}

// One store per process, whichever copy of this module asks (the dev server reloads routes).
const g = globalThis as { __qalamSecrets?: Secrets };

export function secrets(): Secrets {
  return (g.__qalamSecrets ??= process.env.QALAM_SECRETS === "memory" ? memory() : process.platform === "darwin" ? keychain() : none());
}

/** For tests: start from an empty store. */
export const resetSecrets = () => void (g.__qalamSecrets = undefined);

function memory(): Secrets {
  const m = new Map<string, string>();
  return {
    available: true,
    get: async (name) => m.get(name) ?? null,
    set: async (name, value) => void m.set(name, value),
    remove: async (name) => void m.delete(name),
  };
}

function none(): Secrets {
  return {
    available: false,
    get: async () => null,
    set: async () => {
      throw new NoSecretStore();
    },
    remove: async () => {},
  };
}

/** A line for `security -i`, each argument quoted (the interactive reader splits on spaces). */
export const securityLine = (args: string[]) => `${args.map((a) => `"${a.replace(/["\\]/g, "\\$&")}"`).join(" ")}\n`;

function keychain(): Secrets {
  return {
    available: true,
    get: (name) =>
      new Promise((resolve, reject) => {
        execFile(SECURITY, ["find-generic-password", "-s", SERVICE, "-a", name, "-w"], { timeout: 10_000 }, (err, out) => {
          if (!err) return resolve(String(out).replace(/\n$/, "") || null);
          if ((err as { code?: unknown }).code === NOT_FOUND) return resolve(null);
          reject(new Error(`The Keychain didn't answer: ${err.message}`));
        });
      }),
    set: (name, value) =>
      new Promise((resolve, reject) => {
        // Hex keeps any character safe inside the line; -U replaces an item already there.
        const child = spawn(SECURITY, ["-i"], { stdio: ["pipe", "ignore", "pipe"] });
        let err = "";
        child.stderr.on("data", (d) => (err += d));
        child.on("error", reject);
        child.on("close", (code) => (code === 0 && !/error/i.test(err) ? resolve() : reject(new Error(`The Keychain didn't keep it: ${err.trim() || `exit ${code}`}`))));
        child.stdin.end(securityLine(["add-generic-password", "-U", "-s", SERVICE, "-a", name, "-X", Buffer.from(value, "utf8").toString("hex")]));
      }),
    remove: (name) =>
      new Promise((resolve, reject) => {
        execFile(SECURITY, ["delete-generic-password", "-s", SERVICE, "-a", name], { timeout: 10_000 }, (err) => {
          if (!err || (err as { code?: unknown }).code === NOT_FOUND) return resolve();
          reject(new Error(`The Keychain didn't let go of it: ${err.message}`));
        });
      }),
  };
}
