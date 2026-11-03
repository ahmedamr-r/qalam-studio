import { isQuestion } from "@/discovery/speakers";

/**
 * Where ⌘K's Ask goes among what it found. It costs tokens, so ↵ reaches it first only for a
 * question or when nothing else matched; a name typed in full goes to that name.
 */
export function withAsk<T>(found: readonly T[], ask: T, query: string): T[] {
  return isQuestion(query) ? [ask, ...found] : [...found, ask];
}
