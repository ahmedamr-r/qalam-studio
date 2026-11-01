const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;

/**
 * When something comes up, short: "in 25 min", "6:00 PM" (today), "Fri 6:00 PM" (within the week),
 * "Dec 1". `phrase`: to follow a verb ("in 25 min", "at 6:00 PM", "on Fri at 6:00 PM", "on Dec 1").
 */
export function upcoming(ts: number, now = Date.now(), phrase = false): string {
  const ms = ts - now;
  if (ms < 60_000) return phrase ? "in a moment" : "now";
  if (ms < 3_600_000) return `in ${Math.round(ms / 60_000)} min`;
  const at = new Date(ts);
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (at.toDateString() === new Date(now).toDateString()) return phrase ? `at ${time}` : time;
  if (ms < 6 * 86_400_000) {
    const day = at.toLocaleDateString(undefined, { weekday: "short" });
    return phrase ? `on ${day} at ${time}` : `${day} ${time}`;
  }
  const date = at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return phrase ? `on ${date}` : date;
}

/** "just now", "5 minutes ago", "yesterday"… */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.round((ts - now) / 1000);
  const abs = Math.abs(s);
  if (!rtf || abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
