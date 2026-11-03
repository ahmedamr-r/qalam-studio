import type { ScanRequest } from "@/scan/session";

/**
 * The launch loop's eval inputs (docs/launch-loop.md): real apps, ideas with app competitors, and
 * ideas whose competitors are only on the web, where the scan is expected to find less.
 */

export interface LoopInput {
  id: string;
  group: "app" | "idea with apps" | "idea on the web";
  request: ScanRequest;
}

const idea = (id: string, group: LoopInput["group"], said: string, country = "us"): LoopInput => ({ id, group, request: { target: { kind: "idea", said }, country } });
const app = (id: string, name: string): LoopInput => ({ id, group: "app", request: { target: { kind: "product", name }, country: "us" } });

export const LOOP_INPUTS: LoopInput[] = [
  app("duolingo", "Duolingo"),
  app("myfitnesspal", "MyFitnessPal"),
  app("notion", "Notion"),
  idea("meal-shift", "idea with apps", "A meal planner for people who work night shifts"),
  idea("budget-freelance", "idea with apps", "A budgeting app for freelancers whose income changes every month"),
  idea("habit-adhd", "idea with apps", "A habit tracker for adults with ADHD"),
  idea("grocery-sa", "idea with apps", "An app that compares grocery delivery prices for families in Saudi Arabia", "sa"),
  idea("invoice-chase", "idea on the web", "A tool that chases late invoices for freelancers"),
  idea("changelog", "idea on the web", "A changelog tool for small SaaS teams"),
  idea("uptime", "idea on the web", "Uptime monitoring and status pages for very small developer teams"),
];
