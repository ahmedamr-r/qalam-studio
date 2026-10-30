import { readFileSync, renameSync, writeFileSync } from "node:fs";

/*
 * Secrets on a computer with no Keychain (Windows): the desktop app's main process keeps them,
 * each sealed with the system's own encryption (Electron's safeStorage, DPAPI on Windows) in one
 * file in the app's data folder that only this user can open. The core asks for them over its
 * parent port (`useSealedSecrets` in server/secrets.ts); the values never touch the window.
 */

export interface Cipher {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(sealed: Buffer): string;
}

export interface SecretAsk {
  t: "secret";
  id: number;
  op: "get" | "set" | "remove";
  name: string;
  value?: string;
}

export interface SecretReply {
  t: "secret";
  id: number;
  value?: string | null;
  error?: string;
}

export function sealedFile(file: string, cipher: Cipher) {
  const read = (): Record<string, string> => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const write = (all: Record<string, string>) => {
    writeFileSync(`${file}.tmp`, JSON.stringify(all), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };
  return {
    get(name: string): string | null {
      const v = read()[name];
      return v ? cipher.decrypt(Buffer.from(v, "base64")) : null;
    },
    set(name: string, value: string) {
      if (!cipher.available()) throw new Error("This computer can't encrypt secrets for Qalam: set it in the environment instead.");
      write({ ...read(), [name]: cipher.encrypt(value).toString("base64") });
    },
    remove(name: string) {
      const all = read();
      if (!(name in all)) return;
      delete all[name];
      write(all);
    },
  };
}

/** One question from the core, answered. */
export function answerSecret(store: ReturnType<typeof sealedFile>, m: SecretAsk): SecretReply {
  try {
    if (m.op === "get") return { t: "secret", id: m.id, value: store.get(m.name) };
    if (m.op === "set") store.set(m.name, m.value ?? "");
    else store.remove(m.name);
    return { t: "secret", id: m.id, value: null };
  } catch (e) {
    return { t: "secret", id: m.id, error: e instanceof Error ? e.message : String(e) };
  }
}
