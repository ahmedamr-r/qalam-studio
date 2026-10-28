import { placeHref } from "@/projects/model";

/*
 * An AI call's error, read for what fixes it (pure): Claude Code signed out or missing, no key, a
 * key rejected. Those are fixed in Connections, so the error says so in a word and links there.
 * Anything else (a refusal, a cut-off answer, the network) is shown as it came.
 */

export interface ErrorFix {
  /** What's wrong, in a few words. */
  word: string;
  href: string;
}

const RULES: [RegExp, string][] = [
  [/isn't signed in|claude auth login|authentication_failed/i, "Claude Code is signed out"],
  [/couldn't start claude code|install claude code|cli_missing|ENOENT/i, "Claude Code isn't installed"],
  [/key was rejected|invalid x-api-key|authentication_error/i, "The API key was rejected"],
  [/isn't set up here|not configured|no_key|ANTHROPIC_API_KEY/i, "Qalam AI isn't set up"],
];

export function errorFix(message: string): ErrorFix | null {
  for (const [re, word] of RULES) if (re.test(message)) return { word, href: placeHref("connections") };
  return null;
}
