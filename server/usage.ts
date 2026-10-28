import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { summarizeUsage, type UsageEntry, type UsageSummary } from "@/ai/usage-shared";
import { localDir } from "./paths";

/*
 * What Qalam AI used on this computer, one line per call in ~/Qalam/.qalam/usage/<YYYY-MM>.jsonl.
 * Per computer, never an organization's: the engine and the account that pays are this Mac's, and
 * billing doesn't belong in a folder that may be shared through Git.
 */

const month = (at: number) => new Date(at).toISOString().slice(0, 7);
const fileFor = (at: number) => path.join(localDir(), "usage", `${month(at)}.jsonl`);

export async function appendUsage(e: UsageEntry) {
  const file = fileFor(e.at);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(e)}\n`);
}

async function entriesOf(file: string): Promise<UsageEntry[]> {
  const text = await readFile(file, "utf8").catch(() => "");
  const out: UsageEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as UsageEntry);
    } catch {
      // A line cut short (the computer stopped mid-write): skipped.
    }
  }
  return out;
}

/** The last `days` days (this month's file and, near its start, the one before). */
export async function recentUsage(now = Date.now(), days = 7): Promise<UsageSummary> {
  const files = [...new Set([fileFor(now), fileFor(now - days * 86_400_000)])];
  const entries = (await Promise.all(files.map(entriesOf))).flat();
  return summarizeUsage(entries, now, days);
}
