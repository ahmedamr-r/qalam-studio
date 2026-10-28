/*
 * What a product's code says it does (pure, no tokens): the analytics events it sends (PostHog,
 * Segment, Amplitude, Mixpanel, Firebase, Google's gtag) and its screens and routes (Next.js and
 * Expo Router files, React Router and React Navigation, SwiftUI views, Android activities and
 * composables, Flutter pages), each with its file and line. The code reader (server/code) starts
 * from this list, and a step it writes keeps an event only when the event is on it.
 */

export interface CodeFile {
  /** Its path in the repository, with forward slashes. */
  path: string;
  text: string;
}

export interface FoundEvent {
  name: string;
  sdk: "posthog" | "segment" | "amplitude" | "mixpanel" | "firebase" | "gtag" | "other";
  file: string;
  line: number;
}

export interface FoundScreen {
  name: string;
  /** The address it answers, where the code says (web and Expo Router). */
  route?: string;
  file: string;
  line: number;
  kind: "page" | "route" | "screen";
}

export interface CodeScan {
  events: FoundEvent[];
  screens: FoundScreen[];
}

export const SCAN_LIMITS = { events: 400, screens: 300 } as const;

const NAME = String.raw`["'\`]([A-Za-z0-9_ .:$/-]{2,80})["'\`]`;

/** Calls that send an event, by the SDK they're from: the event's name is the string they're given. */
const EVENT_CALLS: { sdk: FoundEvent["sdk"]; re: RegExp }[] = [
  { sdk: "posthog", re: new RegExp(String.raw`(?:posthog|PostHogSDK\.shared|usePostHog\(\)|ph)\??\.capture\(\s*${NAME}`, "g") },
  { sdk: "segment", re: new RegExp(String.raw`(?:analytics|segment|rudderanalytics)\??\.track\(\s*${NAME}`, "g") },
  { sdk: "amplitude", re: new RegExp(String.raw`(?:amplitude|ampli)\??\.(?:track|logEvent)\(\s*${NAME}`, "g") },
  { sdk: "mixpanel", re: new RegExp(String.raw`mixpanel(?:\.mainInstance\(\))?\??\.track\(\s*(?:event:\s*)?${NAME}`, "gi") },
  { sdk: "firebase", re: new RegExp(String.raw`(?:logEvent\(\s*[A-Za-z_.]+\s*,\s*|(?:Analytics|analytics\(\)|firebaseAnalytics|FirebaseAnalytics)\.logEvent\(\s*)${NAME}`, "g") },
  { sdk: "gtag", re: new RegExp(String.raw`gtag\(\s*["']event["']\s*,\s*${NAME}`, "g") },
  { sdk: "other", re: new RegExp(String.raw`\b(?:trackEvent|captureEvent|logAnalyticsEvent)\(\s*${NAME}`, "g") },
];

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** A Next.js or Expo Router file's address: route groups out, [id] as :id, index as its folder. */
export function routeOf(path: string): string | null {
  const m = /(?:^|\/)(?:src\/)?(app|pages)\/(.+)\.(tsx|jsx|ts|js)$/.exec(path);
  if (!m) return null;
  const [, root, rest] = m;
  const parts = rest.split("/");
  const file = parts.pop()!;
  // Next's app router: only page files are pages; Expo Router: every file but layouts is a screen.
  if (root === "app" && /^(layout|loading|error|not-found|template|default|route|_layout|\+.+)$/.test(file)) return null;
  if (root === "pages" && (/^_/.test(file) || parts[0] === "api")) return null;
  const segs = [...parts, ...(file === "page" || file === "index" ? [] : [file])].filter((s) => !/^\(.*\)$/.test(s)).map((s) => s.replace(/^\[\.\.\.(.+)\]$/, "*$1").replace(/^\[(.+)\]$/, ":$1"));
  return `/${segs.join("/")}`;
}

/** The events a product's code sends, and its screens, each where the code has it. */
export function scanCode(files: CodeFile[]): CodeScan {
  const events: FoundEvent[] = [];
  const screens: FoundScreen[] = [];
  const seenEvent = new Set<string>();
  const seenScreen = new Set<string>();
  const addScreen = (s: FoundScreen) => {
    const key = `${s.kind}:${s.route ?? s.name}`;
    if (seenScreen.has(key) || screens.length >= SCAN_LIMITS.screens) return;
    seenScreen.add(key);
    screens.push(s);
  };
  for (const f of files) {
    for (const { sdk, re } of EVENT_CALLS)
      for (const m of f.text.matchAll(re)) {
        const name = m[1].trim();
        if (seenEvent.has(name) || events.length >= SCAN_LIMITS.events) continue;
        seenEvent.add(name);
        events.push({ name, sdk, file: f.path, line: lineAt(f.text, m.index ?? 0) });
      }
    const route = routeOf(f.path);
    if (route !== null && /export\s+default|function\s+[A-Z]/.test(f.text)) addScreen({ name: route, route, file: f.path, line: 1, kind: "page" });
    for (const m of f.text.matchAll(/<Route\b[^>]*\bpath=["'{`]+([^"'}`]+)["'}`]/g)) addScreen({ name: m[1], route: m[1], file: f.path, line: lineAt(f.text, m.index ?? 0), kind: "route" });
    for (const m of f.text.matchAll(/<(?:[A-Za-z]+\.)?Screen\b[^>]*\bname=["']([^"']+)["']/g)) addScreen({ name: m[1], file: f.path, line: lineAt(f.text, m.index ?? 0), kind: "screen" });
    if (/\.swift$/.test(f.path)) for (const m of f.text.matchAll(/struct\s+([A-Z]\w*(?:View|Screen))\s*:\s*View\b/g)) addScreen({ name: m[1], file: f.path, line: lineAt(f.text, m.index ?? 0), kind: "screen" });
    if (/\.(kt|java)$/.test(f.path)) for (const m of f.text.matchAll(/(?:class\s+([A-Z]\w*(?:Activity|Fragment))\b|@Composable\s+fun\s+([A-Z]\w*Screen)\s*\()/g)) addScreen({ name: m[1] ?? m[2], file: f.path, line: lineAt(f.text, m.index ?? 0), kind: "screen" });
    if (/\.dart$/.test(f.path)) for (const m of f.text.matchAll(/class\s+([A-Z]\w*(?:Screen|Page))\s+extends\s+(?:Stateless|Stateful)Widget/g)) addScreen({ name: m[1], file: f.path, line: lineAt(f.text, m.index ?? 0), kind: "screen" });
  }
  return { events, screens };
}
