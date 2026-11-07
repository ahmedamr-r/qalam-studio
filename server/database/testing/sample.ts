import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/** The sample Postgres (sample-db.mts) in its own process, for tests: its port, and a way to say whose session connections get. */
export interface SampleDb {
  port: number;
  url(user?: string): string;
  as(role: string): Promise<void>;
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function startSampleDb(): Promise<SampleDb> {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ["--import", "tsx", path.join(here, "sample-db.mts")], { cwd: path.resolve(here, "../../.."), stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  const waiting: ((line: string) => void)[] = [];
  lines.on("line", (line) => waiting.shift()?.(line));
  const next = () => new Promise<string>((resolve) => waiting.push(resolve));
  let err = "";
  child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
  return new Promise((resolve, reject) => {
    const fail = setTimeout(() => reject(new Error(`The sample database didn't start: ${err}`)), 60_000);
    child.on("exit", (code) => reject(new Error(`The sample database stopped (${code}): ${err}`)));
    void next().then((line) => {
      clearTimeout(fail);
      const port = Number(/^READY (\d+)$/.exec(line)?.[1]);
      if (!port) return reject(new Error(`The sample database said: ${line} ${err}`));
      resolve({
        port,
        url: (user = "postgres") => `postgres://${user}@127.0.0.1:${port}/postgres`,
        as: async (role) => {
          const answer = next();
          child.stdin.write(`AS ${role}\n`);
          const line = await answer;
          if (!line.startsWith("OK")) throw new Error(line);
        },
        close: () =>
          new Promise<void>((done) => {
            child.once("exit", () => done());
            child.stdin.end();
            setTimeout(() => (child.kill(), done()), 5000);
          }),
      });
    });
  });
}
